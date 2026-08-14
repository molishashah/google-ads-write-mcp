import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  enumValue,
  escapeGaql,
  extractRequestId,
  extractResourceNames,
  toResourceName,
  type JsonRecord,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import {
  jsonRecordSchema,
  mutateOptionSchema,
  mutateOptions,
  registerCollectionMutateTool,
} from "@/tools/tool-utils";

const TARGETING_DIMENSIONS = [
  "AUDIENCE",
  "AGE_RANGE",
  "GENDER",
  "PARENTAL_STATUS",
  "PLACEMENT",
  "TOPIC",
] as const;

type TargetingRestrictionInput = {
  dimension: (typeof TARGETING_DIMENSIONS)[number];
  mode: "TARGETING" | "OBSERVATION";
};

type AdGroupAudienceInput = {
  customer_id: string;
  ad_group_id: string;
  audience_ids?: string[];
  user_list_ids?: string[];
  negative?: boolean;
  status?: "ENABLED" | "PAUSED";
  bid_modifier?: number;
  final_urls?: string[];
  fields?: JsonRecord;
};

export function registerAudienceTargetingTools(server: McpServer) {
  registerTargetingSettingTool(server, "campaign");
  registerTargetingSettingTool(server, "ad_group");
  registerAdGroupAudienceTools(server);
  registerAudienceResourceTools(server);
}

function registerTargetingSettingTool(
  server: McpServer,
  level: "campaign" | "ad_group"
) {
  const collection = level === "campaign" ? "campaigns" : "adGroups";
  const resourceSegment = level === "campaign" ? "campaigns" : "adGroups";
  const idField = level === "campaign" ? "campaign_id" : "ad_group_id";
  const tool = `set_${level}_targeting_settings`;
  server.registerTool(
    tool,
    {
      title: `Set ${level === "campaign" ? "Campaign" : "Ad Group"} Targeting Settings`,
      description:
        "Set whether each targeting dimension restricts reach (Targeting) or only observes and adjusts bids (Observation). The supplied restrictions replace the current restriction list.",
      inputSchema: {
        customer_id: z.string(),
        [idField]: z.string(),
        restrictions: z
          .array(
            z.object({
              dimension: z.enum(TARGETING_DIMENSIONS),
              mode: z.enum(["TARGETING", "OBSERVATION"]),
            })
          )
          .min(1),
        ...mutateOptionSchema,
      },
    },
    async (params: any) => {
      try {
        const customer = getAdsClient(params.customer_id);
        const resource = {
          resource_name: toResourceName(
            params.customer_id,
            resourceSegment,
            params[idField]
          ),
          targeting_setting: buildTargetingSetting(params.restrictions),
        };
        const api = (customer as unknown as Record<string, CollectionApi>)[
          collection
        ];
        const result = await api.update([resource], mutateOptions(params));
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: { resource, response: result },
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

type CollectionApi = {
  update(resources: JsonRecord[], options?: JsonRecord): Promise<unknown>;
};

export function buildTargetingSetting(
  restrictions: TargetingRestrictionInput[]
) {
  const dimensions = new Set<string>();
  for (const restriction of restrictions) {
    if (dimensions.has(restriction.dimension)) {
      throw new Error(
        `Targeting dimension ${restriction.dimension} was provided more than once.`
      );
    }
    dimensions.add(restriction.dimension);
  }
  return {
    target_restrictions: restrictions.map((restriction) => ({
      targeting_dimension: enumValue(
        enums.TargetingDimension,
        restriction.dimension
      ),
      bid_only: restriction.mode === "OBSERVATION",
    })),
  };
}

function registerAdGroupAudienceTools(server: McpServer) {
  server.registerTool(
    "list_ad_group_audience_criteria",
    {
      title: "List Ad Group Audience Criteria",
      description:
        "List reusable Audience and User List criteria attached to an ad group.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string(),
        include_removed: z.boolean().optional(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_ad_group_audience_criteria";
      try {
        const adGroup = toResourceName(
          params.customer_id,
          "adGroups",
          params.ad_group_id
        );
        const statusFilter = params.include_removed
          ? ""
          : "AND ad_group_criterion.status != REMOVED";
        const query = `
          SELECT
            ad_group_criterion.resource_name,
            ad_group_criterion.criterion_id,
            ad_group_criterion.status,
            ad_group_criterion.negative,
            ad_group_criterion.bid_modifier,
            ad_group_criterion.audience.audience,
            ad_group_criterion.user_list.user_list
          FROM ad_group_criterion
          WHERE ad_group_criterion.ad_group = '${escapeGaql(adGroup)}'
            AND ad_group_criterion.type IN ('AUDIENCE', 'USER_LIST')
            ${statusFilter}
          LIMIT ${params.limit ?? 1000}`;
        const rows = await getAdsClient(params.customer_id).query(query);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          resource_names: [adGroup],
          results: { query, rows },
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );

  server.registerTool(
    "add_ad_group_audience_criteria",
    {
      title: "Add Ad Group Audience Criteria",
      description:
        "Attach reusable Audiences or User Lists to an ad group. Pair this with set_ad_group_targeting_settings to choose Observation or Targeting semantics.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string(),
        audience_ids: z.array(z.string()).optional(),
        user_list_ids: z.array(z.string()).optional(),
        negative: z.boolean().optional(),
        status: z.enum(["ENABLED", "PAUSED"]).optional(),
        bid_modifier: z.number().positive().optional(),
        final_urls: z.array(z.string().url()).optional(),
        fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "add_ad_group_audience_criteria";
      try {
        const resources = buildAdGroupAudienceCriteria(params);
        const result = await getAdsClient(params.customer_id).adGroupCriteria.create(
          resources as never[],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: { resources, response: result },
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

  registerCollectionMutateTool({
    server,
    name: "update_ad_group_audience_criteria",
    title: "Update Ad Group Audience Criteria",
    description:
      "Update audience criterion status, bid modifier, URLs, or other mutable fields.",
    collection: "adGroupCriteria",
    action: "update",
    resourceLabel: "Ad group audience criterion",
  });
  registerCollectionMutateTool({
    server,
    name: "remove_ad_group_audience_criteria",
    title: "Remove Ad Group Audience Criteria",
    description: "Remove audience criteria by resource name.",
    collection: "adGroupCriteria",
    action: "remove",
    resourceLabel: "Ad group audience criterion",
  });
}

export function buildAdGroupAudienceCriteria(params: AdGroupAudienceInput) {
  if (!params.audience_ids?.length && !params.user_list_ids?.length) {
    throw new Error("Provide at least one audience_id or user_list_id.");
  }
  const common = {
    ad_group: toResourceName(
      params.customer_id,
      "adGroups",
      params.ad_group_id
    ),
    status: enumValue(enums.AdGroupCriterionStatus, params.status ?? "ENABLED"),
    negative: params.negative ?? false,
    ...(params.bid_modifier != null
      ? { bid_modifier: params.bid_modifier }
      : {}),
    ...(params.final_urls?.length ? { final_urls: params.final_urls } : {}),
    ...(params.fields ?? {}),
  };
  return [
    ...(params.audience_ids ?? []).map((id) => ({
      ...common,
      audience: {
        audience: toResourceName(params.customer_id, "audiences", id),
      },
    })),
    ...(params.user_list_ids ?? []).map((id) => ({
      ...common,
      user_list: {
        user_list: toResourceName(params.customer_id, "userLists", id),
      },
    })),
  ];
}

function registerAudienceResourceTools(server: McpServer) {
  server.registerTool(
    "list_audiences",
    {
      title: "List Reusable Audiences",
      description: "List reusable Google Ads Audience resources and dimensions.",
      inputSchema: {
        customer_id: z.string(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_audiences";
      try {
        const query = `SELECT audience.resource_name, audience.id, audience.name, audience.description, audience.status FROM audience ORDER BY audience.name LIMIT ${params.limit ?? 1000}`;
        const rows = await getAdsClient(params.customer_id).query(query);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: { query, rows },
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );

  server.registerTool(
    "list_user_lists",
    {
      title: "List User Lists",
      description:
        "List remarketing and Customer Match user-list resources available for targeting.",
      inputSchema: {
        customer_id: z.string(),
        include_removed: z.boolean().optional(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_user_lists";
      try {
        const where = params.include_removed
          ? ""
          : "WHERE user_list.status != REMOVED";
        const query = `SELECT user_list.resource_name, user_list.id, user_list.name, user_list.description, user_list.status, user_list.type, user_list.size_for_display, user_list.size_for_search, user_list.eligible_for_display, user_list.eligible_for_search FROM user_list ${where} ORDER BY user_list.name LIMIT ${params.limit ?? 1000}`;
        const rows = await getAdsClient(params.customer_id).query(query);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: { query, rows },
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );

  for (const config of [
    ["audience", "audiences"],
    ["user_list", "userLists"],
  ] as const) {
    for (const action of ["create", "update", "remove"] as const) {
      registerCollectionMutateTool({
        server,
        name: `${action}_${config[0]}`,
        title: `${action[0].toUpperCase()}${action.slice(1)} ${config[0].split("_").join(" ")}`,
        description: `${action[0].toUpperCase()}${action.slice(1)} Google Ads ${config[0].split("_").join(" ")} resources.`,
        collection: config[1],
        action,
        resourceLabel: config[0],
      });
    }
  }
}
