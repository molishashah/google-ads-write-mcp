import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  enumValue,
  extractRequestId,
  extractResourceNames,
  toResourceName,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import { mutateOptionSchema, mutateOptions } from "@/tools/tool-utils";

export function registerKeywordTools(server: McpServer) {
  registerAddKeywords(server);
  registerAddNegativeKeywords(server);
  registerAddAdGroupNegativeKeywords(server);
  registerSharedNegativeKeywordTools(server);
}

// ──────────────────────────────────────────────────────────────────────
// add_keywords — add positive keywords to an ad group
// ──────────────────────────────────────────────────────────────────────

const MATCH_TYPE_MAP: Record<string, number> = {
  BROAD: enums.KeywordMatchType.BROAD,
  PHRASE: enums.KeywordMatchType.PHRASE,
  EXACT: enums.KeywordMatchType.EXACT,
};

function registerAddKeywords(server: McpServer) {
  server.registerTool(
    "add_keywords",
    {
      title: "Add Keywords to Ad Group",
      description:
        "Add one or more positive keywords to an existing ad group. " +
        "Each keyword needs a text and match type (BROAD, PHRASE, or EXACT). " +
        "Use this for keyword expansion — adding new search terms you want " +
        "your ads to show for. To see existing keywords first, use the " +
        "search tool with resource 'ad_group_criterion'.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens (e.g. '9232939339')"),
        ad_group_id: z
          .string()
          .describe(
            "Ad group resource name (e.g. 'customers/123/adGroups/456')"
          ),
        keywords: z
          .array(
            z.object({
              text: z.string().describe("The keyword text (e.g. 'running shoes')"),
              match_type: z
                .enum(["BROAD", "PHRASE", "EXACT"])
                .describe("Keyword match type"),
            })
          )
          .min(1)
          .max(200)
          .describe("Keywords to add (1–200 per call)"),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "add_keywords";
      try {
        const customer = getAdsClient(params.customer_id);

        const operations = params.keywords.map((kw) => ({
          ad_group: params.ad_group_id,
          status: enums.AdGroupCriterionStatus.ENABLED,
          keyword: {
            text: kw.text,
            match_type: MATCH_TYPE_MAP[kw.match_type],
          },
        }));

        const result = await customer.adGroupCriteria.create(operations, {
          validate_only: params.validate_only ?? false,
          partial_failure: params.partial_failure ?? false,
        });

        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: result,
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

// ──────────────────────────────────────────────────────────────────────
// add_negative_keywords — add negative keywords at campaign level
// ──────────────────────────────────────────────────────────────────────

function registerAddNegativeKeywords(server: McpServer) {
  server.registerTool(
    "add_negative_keywords",
    {
      title: "Add Negative Keywords to Campaign",
      description:
        "Add one or more negative keywords to a campaign. Negative keywords " +
        "prevent your ads from showing for irrelevant search queries, " +
        "reducing wasted spend. Each keyword needs a text and match type " +
        "(BROAD, PHRASE, or EXACT). To see existing negative keywords, use " +
        "the search tool with resource 'campaign_criterion' and condition " +
        "'campaign_criterion.type = KEYWORD' and " +
        "'campaign_criterion.negative = TRUE'.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens (e.g. '9232939339')"),
        campaign_id: z
          .string()
          .describe(
            "Campaign resource name (e.g. 'customers/123/campaigns/789')"
          ),
        keywords: z
          .array(
            z.object({
              text: z.string().describe("The negative keyword text (e.g. 'free')"),
              match_type: z
                .enum(["BROAD", "PHRASE", "EXACT"])
                .describe("Keyword match type"),
            })
          )
          .min(1)
          .max(200)
          .describe("Negative keywords to add (1–200 per call)"),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "add_negative_keywords";
      try {
        const customer = getAdsClient(params.customer_id);

        const operations = params.keywords.map((kw) => ({
          campaign: params.campaign_id,
          negative: true,
          keyword: {
            text: kw.text,
            match_type: MATCH_TYPE_MAP[kw.match_type],
          },
        }));

        const result = await customer.campaignCriteria.create(operations, {
          validate_only: params.validate_only ?? false,
          partial_failure: params.partial_failure ?? false,
        });

        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: result,
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

function registerAddAdGroupNegativeKeywords(server: McpServer) {
  server.registerTool(
    "add_ad_group_negative_keywords",
    {
      title: "Add Negative Keywords to Ad Group",
      description: "Add negative keywords at ad group level.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
        keywords: z
          .array(
            z.object({
              text: z.string(),
              match_type: z.enum(["BROAD", "PHRASE", "EXACT"]),
            })
          )
          .min(1)
          .max(200),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "add_ad_group_negative_keywords";
      try {
        const customer = getAdsClient(params.customer_id);
        const adGroup = toResourceName(
          params.customer_id,
          "adGroups",
          params.ad_group_id
        );
        const result = await customer.adGroupCriteria.create(
          params.keywords.map((kw) => ({
            ad_group: adGroup,
            negative: true,
            keyword: {
              text: kw.text,
              match_type: MATCH_TYPE_MAP[kw.match_type],
            },
          })),
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: result,
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

function registerSharedNegativeKeywordTools(server: McpServer) {
  server.registerTool(
    "create_negative_keyword_shared_set",
    {
      title: "Create Negative Keyword Shared Set",
      description: "Create a shared set for reusable negative keyword lists.",
      inputSchema: {
        customer_id: z.string(),
        name: z.string().min(1),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_negative_keyword_shared_set";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.sharedSets.create(
          [
            {
              name: params.name,
              type: enumValue(enums.SharedSetType, "NEGATIVE_KEYWORDS") as never,
            },
          ] as never[],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: result,
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

  server.registerTool(
    "add_shared_negative_keywords",
    {
      title: "Add Keywords to Negative Shared Set",
      description: "Add negative keyword criteria to a shared negative keyword set.",
      inputSchema: {
        customer_id: z.string(),
        shared_set_id: z.string().describe("Shared set resource name or numeric ID."),
        keywords: z
          .array(
            z.object({
              text: z.string(),
              match_type: z.enum(["BROAD", "PHRASE", "EXACT"]),
            })
          )
          .min(1)
          .max(200),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "add_shared_negative_keywords";
      try {
        const customer = getAdsClient(params.customer_id);
        const sharedSet = toResourceName(
          params.customer_id,
          "sharedSets",
          params.shared_set_id
        );
        const result = await customer.sharedCriteria.create(
          params.keywords.map((kw) => ({
            shared_set: sharedSet,
            negative: true,
            keyword: {
              text: kw.text,
              match_type: MATCH_TYPE_MAP[kw.match_type],
            },
          })),
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: result,
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

  server.registerTool(
    "attach_negative_keyword_shared_set",
    {
      title: "Attach Negative Keyword Shared Set",
      description: "Attach a shared negative keyword set to a campaign.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string().describe("Campaign resource name or numeric ID."),
        shared_set_id: z.string().describe("Shared set resource name or numeric ID."),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "attach_negative_keyword_shared_set";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.campaignSharedSets.create(
          [
            {
              campaign: toResourceName(
                params.customer_id,
                "campaigns",
                params.campaign_id
              ),
              shared_set: toResourceName(
                params.customer_id,
                "sharedSets",
                params.shared_set_id
              ),
            },
          ],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: result,
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

  server.registerTool(
    "remove_shared_negative_keyword_entities",
    {
      title: "Remove Shared Negative Keyword Entities",
      description:
        "Remove shared criteria, campaign shared-set links, or shared sets by resource name.",
      inputSchema: {
        customer_id: z.string(),
        entity: z.enum(["sharedCriteria", "campaignSharedSets", "sharedSets"]),
        resource_names: z.array(z.string()).min(1),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "remove_shared_negative_keyword_entities";
      try {
        const customer = getAdsClient(params.customer_id);
        const collection = (
          customer as unknown as Record<
            string,
            { remove: (resourceNames: string[], options?: unknown) => Promise<unknown> }
          >
        )[params.entity];
        const result = await collection.remove(
          params.resource_names,
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: result,
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
