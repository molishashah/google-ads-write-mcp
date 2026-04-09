import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import { mcpText, mcpError } from "@/lib/mcp-helpers";

export function registerKeywordTools(server: McpServer) {
  registerAddKeywords(server);
  registerAddNegativeKeywords(server);
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
        validate_only: z
          .boolean()
          .optional()
          .describe(
            "If true, validate the request against Google Ads rules but " +
              "do NOT actually add the keywords. Default: false."
          ),
      },
    },
    async (params) => {
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
        });

        if (params.validate_only) {
          return mcpText(
            `✅ validate_only: ${params.keywords.length} keyword(s) passed ` +
              "Google Ads validation. No keywords were added."
          );
        }

        const resourceNames = (result.results ?? [])
          .map((r) => r.resource_name)
          .filter(Boolean);

        return mcpText(
          `Added ${resourceNames.length} keyword(s) to ${params.ad_group_id}:\n\n` +
            params.keywords
              .map((kw, i) => `  ${kw.match_type} "${kw.text}" → ${resourceNames[i] ?? "ok"}`)
              .join("\n")
        );
      } catch (err) {
        return mcpError("adding keywords", err);
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
        validate_only: z
          .boolean()
          .optional()
          .describe(
            "If true, validate the request against Google Ads rules but " +
              "do NOT actually add the negative keywords. Default: false."
          ),
      },
    },
    async (params) => {
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
        });

        if (params.validate_only) {
          return mcpText(
            `✅ validate_only: ${params.keywords.length} negative keyword(s) ` +
              "passed Google Ads validation. No keywords were added."
          );
        }

        const resourceNames = (result.results ?? [])
          .map((r) => r.resource_name)
          .filter(Boolean);

        return mcpText(
          `Added ${resourceNames.length} negative keyword(s) to ${params.campaign_id}:\n\n` +
            params.keywords
              .map((kw, i) => `  ${kw.match_type} "${kw.text}" → ${resourceNames[i] ?? "ok"}`)
              .join("\n")
        );
      } catch (err) {
        return mcpError("adding negative keywords", err);
      }
    }
  );
}
