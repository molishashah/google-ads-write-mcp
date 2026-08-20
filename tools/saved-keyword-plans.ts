import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums, type MutateOperation } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  customerScopedConstant,
  enumValue,
  escapeGaql,
  extractRequestId,
  extractResourceNames,
  quoteGaql,
  toResourceName,
  type JsonRecord,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MUTATE_OPERATIONS = 10_000;
const NETWORKS = ["GOOGLE_SEARCH", "GOOGLE_SEARCH_AND_PARTNERS"] as const;
const MATCH_TYPES = ["BROAD", "PHRASE", "EXACT"] as const;
const FORECAST_INTERVALS = ["NEXT_WEEK", "NEXT_MONTH", "NEXT_QUARTER"] as const;

type Network = (typeof NETWORKS)[number];
type MatchType = (typeof MATCH_TYPES)[number];
type ForecastInterval = (typeof FORECAST_INTERVALS)[number];

export type SavedPlanForecastPeriod =
  | { date_interval: ForecastInterval; date_range?: never }
  | {
      date_interval?: never;
      date_range: { start_date: string; end_date: string };
    };

export type SavedKeywordInput = {
  text: string;
  match_type: MatchType;
  cpc_bid_micros?: number;
  negative?: boolean;
};

export type CreateSavedKeywordPlanInput = {
  customer_id: string;
  name: string;
  forecast_period?: SavedPlanForecastPeriod;
  campaign?: {
    name: string;
    cpc_bid_micros: number;
    keyword_plan_network?: Network;
    language_constant_id?: string;
    geo_target_constant_ids?: string[];
  };
  ad_groups?: Array<{
    name: string;
    cpc_bid_micros?: number;
    keywords?: SavedKeywordInput[];
  }>;
  negative_keywords?: Array<{ text: string; match_type: MatchType }>;
  validate_only?: boolean;
};

type AdGroupMutationInput = {
  customer_id: string;
  keyword_plan_campaign?: string;
  create?: Array<{ name: string; cpc_bid_micros?: number }>;
  update?: Array<{
    resource_name: string;
    name?: string;
    cpc_bid_micros?: number;
  }>;
  remove?: string[];
  validate_only?: boolean;
  partial_failure?: boolean;
};

type KeywordMutationInput = {
  customer_id: string;
  ad_group_create?: Array<{
    keyword_plan_ad_group: string;
    text: string;
    match_type: MatchType;
    cpc_bid_micros?: number;
    negative?: boolean;
  }>;
  ad_group_update?: Array<{
    resource_name: string;
    text?: string;
    match_type?: MatchType;
    cpc_bid_micros?: number;
  }>;
  ad_group_remove?: string[];
  campaign_negative_create?: Array<{
    keyword_plan_campaign: string;
    text: string;
    match_type: MatchType;
  }>;
  campaign_negative_update?: Array<{
    resource_name: string;
    text?: string;
    match_type?: MatchType;
  }>;
  campaign_negative_remove?: string[];
  validate_only?: boolean;
  partial_failure?: boolean;
};

const forecastPeriodSchema = z
  .object({
    date_interval: z.enum(FORECAST_INTERVALS).optional(),
    date_range: z
      .object({
        start_date: z.string().regex(DATE_RE, "Use YYYY-MM-DD"),
        end_date: z.string().regex(DATE_RE, "Use YYYY-MM-DD"),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.date_interval) !== Boolean(value.date_range), {
    message: "Set exactly one of date_interval or date_range.",
  });

const savedKeywordSchema = z.object({
  text: z.string().trim().min(1),
  match_type: z.enum(MATCH_TYPES),
  cpc_bid_micros: z.number().int().positive().optional(),
  negative: z.boolean().optional(),
});

const mutateOptionsSchema = {
  validate_only: z.boolean().optional().describe("Validate without writing."),
  partial_failure: z
    .boolean()
    .optional()
    .describe("Allow valid operations to succeed if another operation fails."),
};

export function registerSavedKeywordPlanTools(server: McpServer) {
  registerListSavedKeywordPlans(server);
  registerGetSavedKeywordPlan(server);
  registerCreateSavedKeywordPlan(server);
  registerUpdateSavedKeywordPlan(server);
  registerRemoveSavedKeywordPlan(server);
  registerUpdateSavedKeywordPlanCampaign(server);
  registerMutateSavedKeywordPlanAdGroups(server);
  registerMutateSavedKeywordPlanKeywords(server);
}

function registerListSavedKeywordPlans(server: McpServer) {
  server.registerTool(
    "list_saved_keyword_plans",
    {
      title: "List Saved Keyword Plans",
      description:
        "List saved Keyword Planner plans in a Google Ads customer, optionally filtering by name.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        name_contains: z.string().trim().min(1).optional(),
        limit: z.number().int().positive().max(10_000).optional(),
      },
    },
    async (params) => {
      const tool = "list_saved_keyword_plans";
      try {
        const query = buildListSavedKeywordPlansQuery(params);
        const rows = await getAdsClient(params.customer_id).query(query);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: { count: rows.length, rows },
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerGetSavedKeywordPlan(server: McpServer) {
  server.registerTool(
    "get_saved_keyword_plan",
    {
      title: "Get Saved Keyword Plan",
      description:
        "Get a saved Keyword Planner plan and its campaign, ad groups, ad-group keywords, and campaign negative keywords.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        keyword_plan: z
          .string()
          .min(1)
          .describe("Keyword plan ID or full resource name."),
      },
    },
    async (params) => {
      const tool = "get_saved_keyword_plan";
      try {
        const customer = getAdsClient(params.customer_id);
        const keywordPlan = keywordPlanResourceName(
          params.customer_id,
          params.keyword_plan
        );
        const queries = buildSavedKeywordPlanQueries(keywordPlan);
        const planRows = await customer.query(queries.plan);
        const campaignRows = await customer.query(queries.campaign);
        const campaign = resourceNameFromRow(
          campaignRows[0],
          "keyword_plan_campaign"
        );
        const adGroupRows = campaign
          ? await customer.query(buildSavedPlanAdGroupsQuery(campaign))
          : [];
        const adGroupNames = adGroupRows
          .map((row) => resourceNameFromRow(row, "keyword_plan_ad_group"))
          .filter((name): name is string => Boolean(name));
        const [adGroupKeywordRows, campaignKeywordRows] = await Promise.all([
          adGroupNames.length
            ? customer.query(buildSavedPlanAdGroupKeywordsQuery(adGroupNames))
            : Promise.resolve([]),
          campaign
            ? customer.query(buildSavedPlanCampaignKeywordsQuery(campaign))
            : Promise.resolve([]),
        ]);

        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: {
            keyword_plan: keywordPlan,
            found: planRows.length > 0,
            plan: planRows[0] ?? null,
            campaign: campaignRows[0] ?? null,
            ad_groups: adGroupRows,
            ad_group_keywords: adGroupKeywordRows,
            campaign_negative_keywords: campaignKeywordRows,
            counts: {
              ad_groups: adGroupRows.length,
              ad_group_keywords: adGroupKeywordRows.length,
              campaign_negative_keywords: campaignKeywordRows.length,
            },
          },
        });
      } catch (err) {
        return mcpJsonError(tool, err, {
          customer_id: params.customer_id,
        });
      }
    }
  );
}

function registerCreateSavedKeywordPlan(server: McpServer) {
  server.registerTool(
    "create_saved_keyword_plan",
    {
      title: "Create Saved Keyword Plan",
      description:
        "Atomically create a saved keyword plan, its single plan campaign, ad groups, positive or negative ad-group keywords, and campaign negative keywords. Can also create an empty plan when campaign is omitted.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        name: z.string().trim().min(1),
        forecast_period: forecastPeriodSchema.optional(),
        campaign: z
          .object({
            name: z.string().trim().min(1),
            cpc_bid_micros: z.number().int().positive(),
            keyword_plan_network: z.enum(NETWORKS).optional(),
            language_constant_id: z.string().min(1).optional(),
            geo_target_constant_ids: z.array(z.string().min(1)).max(20).optional(),
          })
          .optional(),
        ad_groups: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              cpc_bid_micros: z.number().int().positive().optional(),
              keywords: z.array(savedKeywordSchema).max(10_000).optional(),
            })
          )
          .max(200)
          .optional(),
        negative_keywords: z
          .array(
            z.object({
              text: z.string().trim().min(1),
              match_type: z.enum(MATCH_TYPES),
            })
          )
          .max(1_000)
          .optional(),
        validate_only: z.boolean().optional().describe("Validate without writing."),
      },
    },
    async (params) => {
      const tool = "create_saved_keyword_plan";
      try {
        const operations = buildCreateSavedKeywordPlanOperations(
          params as CreateSavedKeywordPlanInput
        );
        const result = await getAdsClient(params.customer_id).mutateResources(
          operations,
          {
            validate_only: params.validate_only ?? false,
            partial_failure: false,
            response_content_type: enums.ResponseContentType.MUTABLE_RESOURCE,
          }
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: {
            atomic: true,
            operation_count: operations.length,
            response: result,
          },
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, {
          customer_id: params.customer_id,
          validate_only: params.validate_only,
        });
      }
    }
  );
}

function registerUpdateSavedKeywordPlan(server: McpServer) {
  server.registerTool(
    "update_saved_keyword_plan",
    {
      title: "Update Saved Keyword Plan",
      description: "Update a saved keyword plan name or forecast period.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        keyword_plan: z.string().min(1).describe("Plan ID or resource name."),
        name: z.string().trim().min(1).optional(),
        forecast_period: forecastPeriodSchema.optional(),
        ...mutateOptionsSchema,
      },
    },
    async (params) => {
      const tool = "update_saved_keyword_plan";
      try {
        if (params.name == null && params.forecast_period == null) {
          throw new Error("Set name and/or forecast_period.");
        }
        const resource = {
          resource_name: keywordPlanResourceName(
            params.customer_id,
            params.keyword_plan
          ),
          ...(params.name != null ? { name: params.name } : {}),
          ...(params.forecast_period != null
            ? {
                forecast_period: buildForecastPeriod(
                  params.forecast_period as SavedPlanForecastPeriod
                ),
              }
            : {}),
        };
        const result = await getAdsClient(params.customer_id).keywordPlans.update(
          [resource],
          mutationOptions(params)
        );
        return mutationSuccess(tool, params, result, 1);
      } catch (err) {
        return mcpJsonError(tool, err, {
          customer_id: params.customer_id,
        });
      }
    }
  );
}

function registerRemoveSavedKeywordPlan(server: McpServer) {
  server.registerTool(
    "remove_saved_keyword_plan",
    {
      title: "Remove Saved Keyword Plan",
      description:
        "Remove a saved keyword plan. Child plan resources are removed with the plan.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        keyword_plan: z.string().min(1).describe("Plan ID or resource name."),
        ...mutateOptionsSchema,
      },
    },
    async (params) => {
      const tool = "remove_saved_keyword_plan";
      try {
        const resourceName = keywordPlanResourceName(
          params.customer_id,
          params.keyword_plan
        );
        const result = await getAdsClient(params.customer_id).keywordPlans.remove(
          [resourceName],
          mutationOptions(params)
        );
        return mutationSuccess(tool, params, result, 1);
      } catch (err) {
        return mcpJsonError(tool, err, {
          customer_id: params.customer_id,
        });
      }
    }
  );
}

function registerUpdateSavedKeywordPlanCampaign(server: McpServer) {
  server.registerTool(
    "update_saved_keyword_plan_campaign",
    {
      title: "Update Saved Keyword Plan Campaign",
      description:
        "Update the single campaign in a saved keyword plan, including bid, network, language, and geo targeting.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        keyword_plan_campaign: z
          .string()
          .min(1)
          .describe("Plan campaign ID or resource name."),
        name: z.string().trim().min(1).optional(),
        cpc_bid_micros: z.number().int().positive().optional(),
        keyword_plan_network: z.enum(NETWORKS).optional(),
        language_constant_id: z.string().min(1).nullable().optional(),
        geo_target_constant_ids: z
          .array(z.string().min(1))
          .max(20)
          .optional(),
        ...mutateOptionsSchema,
      },
    },
    async (params) => {
      const tool = "update_saved_keyword_plan_campaign";
      try {
        const fields = buildCampaignUpdateFields(params);
        if (Object.keys(fields).length === 0) {
          throw new Error("Set at least one campaign field to update.");
        }
        const resource = {
          resource_name: keywordPlanCampaignResourceName(
            params.customer_id,
            params.keyword_plan_campaign
          ),
          ...fields,
        };
        const result = await getAdsClient(
          params.customer_id
        ).keywordPlanCampaigns.update([resource as never], mutationOptions(params));
        return mutationSuccess(tool, params, result, 1);
      } catch (err) {
        return mcpJsonError(tool, err, {
          customer_id: params.customer_id,
        });
      }
    }
  );
}

function registerMutateSavedKeywordPlanAdGroups(server: McpServer) {
  server.registerTool(
    "mutate_saved_keyword_plan_ad_groups",
    {
      title: "Mutate Saved Keyword Plan Ad Groups",
      description:
        "Atomically create, update, and remove ad groups in a saved keyword plan campaign.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        keyword_plan_campaign: z
          .string()
          .min(1)
          .optional()
          .describe("Required when create is non-empty; accepts ID or resource name."),
        create: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              cpc_bid_micros: z.number().int().positive().optional(),
            })
          )
          .max(200)
          .optional(),
        update: z
          .array(
            z.object({
              resource_name: z.string().min(1),
              name: z.string().trim().min(1).optional(),
              cpc_bid_micros: z.number().int().positive().optional(),
            })
          )
          .max(200)
          .optional(),
        remove: z.array(z.string().min(1)).max(200).optional(),
        ...mutateOptionsSchema,
      },
    },
    async (params) => {
      const tool = "mutate_saved_keyword_plan_ad_groups";
      try {
        const operations = buildSavedPlanAdGroupOperations(
          params as AdGroupMutationInput
        );
        const result = await getAdsClient(params.customer_id).mutateResources(
          operations,
          mutationOptions(params)
        );
        return mutationSuccess(tool, params, result, operations.length, true);
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerMutateSavedKeywordPlanKeywords(server: McpServer) {
  server.registerTool(
    "mutate_saved_keyword_plan_keywords",
    {
      title: "Mutate Saved Keyword Plan Keywords",
      description:
        "Atomically create, update, or remove saved-plan ad-group keywords and campaign-level negative keywords.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        ad_group_create: z
          .array(
            z.object({
              keyword_plan_ad_group: z.string().min(1),
              text: z.string().trim().min(1),
              match_type: z.enum(MATCH_TYPES),
              cpc_bid_micros: z.number().int().positive().optional(),
              negative: z.boolean().optional(),
            })
          )
          .max(10_000)
          .optional(),
        ad_group_update: z
          .array(
            z.object({
              resource_name: z.string().min(1),
              text: z.string().trim().min(1).optional(),
              match_type: z.enum(MATCH_TYPES).optional(),
              cpc_bid_micros: z.number().int().positive().optional(),
            })
          )
          .max(10_000)
          .optional(),
        ad_group_remove: z.array(z.string().min(1)).max(10_000).optional(),
        campaign_negative_create: z
          .array(
            z.object({
              keyword_plan_campaign: z.string().min(1),
              text: z.string().trim().min(1),
              match_type: z.enum(MATCH_TYPES),
            })
          )
          .max(1_000)
          .optional(),
        campaign_negative_update: z
          .array(
            z.object({
              resource_name: z.string().min(1),
              text: z.string().trim().min(1).optional(),
              match_type: z.enum(MATCH_TYPES).optional(),
            })
          )
          .max(1_000)
          .optional(),
        campaign_negative_remove: z
          .array(z.string().min(1))
          .max(1_000)
          .optional(),
        ...mutateOptionsSchema,
      },
    },
    async (params) => {
      const tool = "mutate_saved_keyword_plan_keywords";
      try {
        const operations = buildSavedPlanKeywordOperations(
          params as KeywordMutationInput
        );
        const result = await getAdsClient(params.customer_id).mutateResources(
          operations,
          mutationOptions(params)
        );
        return mutationSuccess(tool, params, result, operations.length, true);
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

export function buildCreateSavedKeywordPlanOperations(
  params: CreateSavedKeywordPlanInput
): MutateOperation<unknown>[] {
  if ((params.ad_groups?.length || params.negative_keywords?.length) && !params.campaign) {
    throw new Error("campaign is required when ad_groups or negative_keywords are set.");
  }
  validateForecastPeriod(params.forecast_period);

  let nextTemporaryId = -1;
  const allocateResource = (collection: string) =>
    toResourceName(params.customer_id, collection, String(nextTemporaryId--));

  const planResourceName = allocateResource("keywordPlans");
  const operations: MutateOperation<unknown>[] = [
    {
      entity: "keyword_plan",
      operation: "create",
      resource: {
        resource_name: planResourceName,
        name: params.name,
        ...(params.forecast_period
          ? { forecast_period: buildForecastPeriod(params.forecast_period) }
          : {}),
      },
    },
  ];

  if (!params.campaign) return operations;

  const campaignResourceName = allocateResource("keywordPlanCampaigns");
  operations.push({
    entity: "keyword_plan_campaign",
    operation: "create",
    resource: {
      resource_name: campaignResourceName,
      keyword_plan: planResourceName,
      name: params.campaign.name,
      keyword_plan_network: enumValue(
        enums.KeywordPlanNetwork,
        params.campaign.keyword_plan_network ?? "GOOGLE_SEARCH"
      ),
      cpc_bid_micros: params.campaign.cpc_bid_micros,
      language_constants: params.campaign.language_constant_id
        ? [
            customerScopedConstant(
              "languageConstants",
              params.campaign.language_constant_id
            ),
          ]
        : [],
      geo_targets: (params.campaign.geo_target_constant_ids ?? []).map((id) => ({
        geo_target_constant: customerScopedConstant("geoTargetConstants", id),
      })),
    },
  });

  const adGroupResources = (params.ad_groups ?? []).map((adGroup) => ({
    input: adGroup,
    resourceName: allocateResource("keywordPlanAdGroups"),
  }));
  for (const adGroup of adGroupResources) {
    operations.push({
      entity: "keyword_plan_ad_group",
      operation: "create",
      resource: {
        resource_name: adGroup.resourceName,
        keyword_plan_campaign: campaignResourceName,
        name: adGroup.input.name,
        ...(adGroup.input.cpc_bid_micros != null
          ? { cpc_bid_micros: adGroup.input.cpc_bid_micros }
          : {}),
      },
    });
  }

  let adGroupKeywordCount = 0;
  for (const adGroup of adGroupResources) {
    for (const keyword of adGroup.input.keywords ?? []) {
      adGroupKeywordCount += 1;
      operations.push({
        entity: "keyword_plan_ad_group_keyword",
        operation: "create",
        resource: {
          resource_name: allocateResource("keywordPlanAdGroupKeywords"),
          keyword_plan_ad_group: adGroup.resourceName,
          text: keyword.text,
          match_type: enumValue(enums.KeywordMatchType, keyword.match_type),
          negative: keyword.negative ?? false,
          ...(!keyword.negative && keyword.cpc_bid_micros != null
            ? { cpc_bid_micros: keyword.cpc_bid_micros }
            : {}),
        },
      });
    }
  }
  if (adGroupKeywordCount > 10_000) {
    throw new Error("A saved keyword plan supports at most 10,000 ad-group keywords.");
  }

  for (const keyword of params.negative_keywords ?? []) {
    operations.push({
      entity: "keyword_plan_campaign_keyword",
      operation: "create",
      resource: {
        resource_name: allocateResource("keywordPlanCampaignKeywords"),
        keyword_plan_campaign: campaignResourceName,
        text: keyword.text,
        match_type: enumValue(enums.KeywordMatchType, keyword.match_type),
        negative: true,
      },
    });
  }
  assertOperationLimit(operations);
  return operations;
}

export function buildSavedPlanAdGroupOperations(
  params: AdGroupMutationInput
): MutateOperation<unknown>[] {
  if (params.create?.length && !params.keyword_plan_campaign) {
    throw new Error("keyword_plan_campaign is required for create operations.");
  }
  const operations: MutateOperation<unknown>[] = [];
  const campaign = params.keyword_plan_campaign
    ? keywordPlanCampaignResourceName(
        params.customer_id,
        params.keyword_plan_campaign
      )
    : undefined;

  for (const adGroup of params.create ?? []) {
    operations.push({
      entity: "keyword_plan_ad_group",
      operation: "create",
      resource: {
        keyword_plan_campaign: campaign,
        name: adGroup.name,
        ...(adGroup.cpc_bid_micros != null
          ? { cpc_bid_micros: adGroup.cpc_bid_micros }
          : {}),
      },
    });
  }
  for (const adGroup of params.update ?? []) {
    const fields = {
      ...(adGroup.name != null ? { name: adGroup.name } : {}),
      ...(adGroup.cpc_bid_micros != null
        ? { cpc_bid_micros: adGroup.cpc_bid_micros }
        : {}),
    };
    if (Object.keys(fields).length === 0) {
      throw new Error(`No update fields set for ${adGroup.resource_name}.`);
    }
    operations.push({
      entity: "keyword_plan_ad_group",
      operation: "update",
      resource: {
        resource_name: keywordPlanAdGroupResourceName(
          params.customer_id,
          adGroup.resource_name
        ),
        ...fields,
      },
    });
  }
  for (const resourceName of params.remove ?? []) {
    operations.push({
      entity: "keyword_plan_ad_group",
      operation: "remove",
      resource: keywordPlanAdGroupResourceName(params.customer_id, resourceName),
    });
  }
  assertHasOperations(operations);
  assertOperationLimit(operations);
  return operations;
}

export function buildSavedPlanKeywordOperations(
  params: KeywordMutationInput
): MutateOperation<unknown>[] {
  const operations: MutateOperation<unknown>[] = [];
  for (const keyword of params.ad_group_create ?? []) {
    operations.push({
      entity: "keyword_plan_ad_group_keyword",
      operation: "create",
      resource: {
        keyword_plan_ad_group: keywordPlanAdGroupResourceName(
          params.customer_id,
          keyword.keyword_plan_ad_group
        ),
        text: keyword.text,
        match_type: enumValue(enums.KeywordMatchType, keyword.match_type),
        negative: keyword.negative ?? false,
        ...(!keyword.negative && keyword.cpc_bid_micros != null
          ? { cpc_bid_micros: keyword.cpc_bid_micros }
          : {}),
      },
    });
  }
  for (const keyword of params.ad_group_update ?? []) {
    const fields = keywordUpdateFields(keyword);
    operations.push({
      entity: "keyword_plan_ad_group_keyword",
      operation: "update",
      resource: {
        resource_name: keywordPlanAdGroupKeywordResourceName(
          params.customer_id,
          keyword.resource_name
        ),
        ...fields,
      },
    });
  }
  for (const resourceName of params.ad_group_remove ?? []) {
    operations.push({
      entity: "keyword_plan_ad_group_keyword",
      operation: "remove",
      resource: keywordPlanAdGroupKeywordResourceName(
        params.customer_id,
        resourceName
      ),
    });
  }
  for (const keyword of params.campaign_negative_create ?? []) {
    operations.push({
      entity: "keyword_plan_campaign_keyword",
      operation: "create",
      resource: {
        keyword_plan_campaign: keywordPlanCampaignResourceName(
          params.customer_id,
          keyword.keyword_plan_campaign
        ),
        text: keyword.text,
        match_type: enumValue(enums.KeywordMatchType, keyword.match_type),
        negative: true,
      },
    });
  }
  for (const keyword of params.campaign_negative_update ?? []) {
    const fields = keywordUpdateFields(keyword);
    operations.push({
      entity: "keyword_plan_campaign_keyword",
      operation: "update",
      resource: {
        resource_name: keywordPlanCampaignKeywordResourceName(
          params.customer_id,
          keyword.resource_name
        ),
        ...fields,
      },
    });
  }
  for (const resourceName of params.campaign_negative_remove ?? []) {
    operations.push({
      entity: "keyword_plan_campaign_keyword",
      operation: "remove",
      resource: keywordPlanCampaignKeywordResourceName(
        params.customer_id,
        resourceName
      ),
    });
  }
  assertHasOperations(operations);
  assertOperationLimit(operations);
  return operations;
}

export function buildListSavedKeywordPlansQuery(params: {
  name_contains?: string;
  limit?: number;
}) {
  const conditions = params.name_contains
    ? [`keyword_plan.name LIKE '%${escapeGaql(params.name_contains)}%'`]
    : [];
  return [
    "SELECT keyword_plan.resource_name, keyword_plan.id, keyword_plan.name, keyword_plan.forecast_period",
    "FROM keyword_plan",
    conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    "ORDER BY keyword_plan.id DESC",
    `LIMIT ${params.limit ?? 100}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildSavedKeywordPlanQueries(keywordPlanResource: string) {
  return {
    plan: [
      "SELECT keyword_plan.resource_name, keyword_plan.id, keyword_plan.name, keyword_plan.forecast_period",
      "FROM keyword_plan",
      `WHERE keyword_plan.resource_name = ${quoteGaql(keywordPlanResource)}`,
      "LIMIT 1",
    ].join(" "),
    campaign: [
      "SELECT keyword_plan_campaign.resource_name, keyword_plan_campaign.id, keyword_plan_campaign.keyword_plan, keyword_plan_campaign.name, keyword_plan_campaign.language_constants, keyword_plan_campaign.keyword_plan_network, keyword_plan_campaign.cpc_bid_micros, keyword_plan_campaign.geo_targets",
      "FROM keyword_plan_campaign",
      `WHERE keyword_plan_campaign.keyword_plan = ${quoteGaql(keywordPlanResource)}`,
      "LIMIT 1",
    ].join(" "),
  };
}

export function buildSavedPlanAdGroupsQuery(campaignResource: string) {
  return [
    "SELECT keyword_plan_ad_group.resource_name, keyword_plan_ad_group.id, keyword_plan_ad_group.keyword_plan_campaign, keyword_plan_ad_group.name, keyword_plan_ad_group.cpc_bid_micros",
    "FROM keyword_plan_ad_group",
    `WHERE keyword_plan_ad_group.keyword_plan_campaign = ${quoteGaql(campaignResource)}`,
    "ORDER BY keyword_plan_ad_group.id",
  ].join(" ");
}

export function buildSavedPlanAdGroupKeywordsQuery(adGroupResources: string[]) {
  if (adGroupResources.length === 0) {
    throw new Error("At least one ad group resource name is required.");
  }
  return [
    "SELECT keyword_plan_ad_group_keyword.resource_name, keyword_plan_ad_group_keyword.id, keyword_plan_ad_group_keyword.keyword_plan_ad_group, keyword_plan_ad_group_keyword.text, keyword_plan_ad_group_keyword.match_type, keyword_plan_ad_group_keyword.cpc_bid_micros, keyword_plan_ad_group_keyword.negative",
    "FROM keyword_plan_ad_group_keyword",
    `WHERE keyword_plan_ad_group_keyword.keyword_plan_ad_group IN (${adGroupResources
      .map(quoteGaql)
      .join(", ")})`,
    "ORDER BY keyword_plan_ad_group_keyword.id",
  ].join(" ");
}

export function buildSavedPlanCampaignKeywordsQuery(campaignResource: string) {
  return [
    "SELECT keyword_plan_campaign_keyword.resource_name, keyword_plan_campaign_keyword.id, keyword_plan_campaign_keyword.keyword_plan_campaign, keyword_plan_campaign_keyword.text, keyword_plan_campaign_keyword.match_type, keyword_plan_campaign_keyword.negative",
    "FROM keyword_plan_campaign_keyword",
    `WHERE keyword_plan_campaign_keyword.keyword_plan_campaign = ${quoteGaql(campaignResource)}`,
    "ORDER BY keyword_plan_campaign_keyword.id",
  ].join(" ");
}

function buildForecastPeriod(period: SavedPlanForecastPeriod): JsonRecord {
  validateForecastPeriod(period);
  return period.date_interval
    ? {
        date_interval: enumValue(
          enums.KeywordPlanForecastInterval,
          period.date_interval
        ),
      }
    : { date_range: period.date_range };
}

function validateForecastPeriod(period?: SavedPlanForecastPeriod) {
  if (!period) return;
  const hasInterval = Boolean(period.date_interval);
  const hasRange = Boolean(period.date_range);
  if (hasInterval === hasRange) {
    throw new Error("Set exactly one of date_interval or date_range.");
  }
  if (period.date_range) {
    const { start_date: startDate, end_date: endDate } = period.date_range;
    const start = parseForecastDate(startDate, "start_date");
    const end = parseForecastDate(endDate, "end_date");
    if (start > end) {
      throw new Error("forecast_period start_date must be on or before end_date.");
    }
    const now = new Date();
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );
    if (start <= today) {
      throw new Error("forecast_period start_date must be in the future.");
    }
    const oneYearFromToday = new Date(today);
    oneYearFromToday.setUTCFullYear(oneYearFromToday.getUTCFullYear() + 1);
    if (end > oneYearFromToday.getTime()) {
      throw new Error("forecast_period end_date must be within one year from today.");
    }
  }
}

function parseForecastDate(value: string, field: string) {
  if (!DATE_RE.test(value)) {
    throw new Error(`forecast_period ${field} must use YYYY-MM-DD.`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`forecast_period ${field} must be a valid calendar date.`);
  }
  return parsed;
}

function buildCampaignUpdateFields(params: {
  name?: string;
  cpc_bid_micros?: number;
  keyword_plan_network?: Network;
  language_constant_id?: string | null;
  geo_target_constant_ids?: string[];
}) {
  return {
    ...(params.name != null ? { name: params.name } : {}),
    ...(params.cpc_bid_micros != null
      ? { cpc_bid_micros: params.cpc_bid_micros }
      : {}),
    ...(params.keyword_plan_network != null
      ? {
          keyword_plan_network: enumValue(
            enums.KeywordPlanNetwork,
            params.keyword_plan_network
          ),
        }
      : {}),
    ...(params.language_constant_id !== undefined
      ? {
          language_constants: params.language_constant_id
            ? [
                customerScopedConstant(
                  "languageConstants",
                  params.language_constant_id
                ),
              ]
            : [],
        }
      : {}),
    ...(params.geo_target_constant_ids != null
      ? {
          geo_targets: params.geo_target_constant_ids.map((id) => ({
            geo_target_constant: customerScopedConstant("geoTargetConstants", id),
          })),
        }
      : {}),
  };
}

function keywordUpdateFields(params: {
  resource_name: string;
  text?: string;
  match_type?: MatchType;
  cpc_bid_micros?: number;
}) {
  const fields = {
    ...(params.text != null ? { text: params.text } : {}),
    ...(params.match_type != null
      ? { match_type: enumValue(enums.KeywordMatchType, params.match_type) }
      : {}),
    ...(params.cpc_bid_micros != null
      ? { cpc_bid_micros: params.cpc_bid_micros }
      : {}),
  };
  if (Object.keys(fields).length === 0) {
    throw new Error(`No update fields set for ${params.resource_name}.`);
  }
  return fields;
}

function mutationOptions(params: {
  validate_only?: boolean;
  partial_failure?: boolean;
}) {
  return {
    validate_only: params.validate_only ?? false,
    partial_failure: params.partial_failure ?? false,
  };
}

function mutationSuccess(
  tool: string,
  params: {
    customer_id: string;
    validate_only?: boolean;
    partial_failure?: boolean;
  },
  result: unknown,
  operationCount: number,
  atomic = false
) {
  return mcpSuccess({
    tool,
    customer_id: params.customer_id,
    validate_only: params.validate_only ?? false,
    resource_names: extractResourceNames(result),
    results: {
      partial_failure: params.partial_failure ?? false,
      ...(atomic ? { atomic: !(params.partial_failure ?? false) } : {}),
      operation_count: operationCount,
      response: result,
    },
    request_id: extractRequestId(result),
  });
}

function assertHasOperations(operations: MutateOperation<unknown>[]) {
  if (operations.length === 0) {
    throw new Error("Provide at least one create, update, or remove operation.");
  }
}

function assertOperationLimit(operations: MutateOperation<unknown>[]) {
  if (operations.length > MAX_MUTATE_OPERATIONS) {
    throw new Error(
      `A single atomic request supports at most ${MAX_MUTATE_OPERATIONS.toLocaleString()} operations; received ${operations.length.toLocaleString()}.`
    );
  }
}

function resourceNameFromRow(row: unknown, field: string) {
  if (!row || typeof row !== "object") return undefined;
  const resource = (row as JsonRecord)[field];
  if (!resource || typeof resource !== "object") return undefined;
  const value = (resource as JsonRecord).resource_name;
  return typeof value === "string" ? value : undefined;
}

function keywordPlanResourceName(customerId: string, idOrName: string) {
  return toResourceName(customerId, "keywordPlans", idOrName);
}

function keywordPlanCampaignResourceName(customerId: string, idOrName: string) {
  return toResourceName(customerId, "keywordPlanCampaigns", idOrName);
}

function keywordPlanAdGroupResourceName(customerId: string, idOrName: string) {
  return toResourceName(customerId, "keywordPlanAdGroups", idOrName);
}

function keywordPlanAdGroupKeywordResourceName(
  customerId: string,
  idOrName: string
) {
  return toResourceName(customerId, "keywordPlanAdGroupKeywords", idOrName);
}

function keywordPlanCampaignKeywordResourceName(
  customerId: string,
  idOrName: string
) {
  return toResourceName(customerId, "keywordPlanCampaignKeywords", idOrName);
}
