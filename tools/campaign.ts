import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  enums,
  ResourceNames,
  toMicros,
  type MutateOperation,
} from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  enumValue,
  extractRequestId,
  extractResourceNames,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import {
  buildSearchCampaignBiddingStrategy,
  TARGET_IMPRESSION_SHARE_LOCATIONS,
  type SearchCampaignBiddingInput,
} from "@/tools/campaign-bidding";
import { buildCampaignDateTimeFields } from "@/tools/campaign-fields";

// ──────────────────────────────────────────────────────────────────────
// Campaign structure tools (create campaign + ad group)
//
// These build the skeleton that the existing ad / keyword tools fill in:
//   create_campaign → create_ad_group → create_responsive_search_ad +
//   add_keywords.
//
// Safety choices (matching the rest of this server):
//   - New campaigns default to PAUSED. Callers can explicitly set ENABLED
//     when they want a complete UI-free launch.
//   - Bidding defaults to Maximize Clicks (the `target_spend` strategy). It
//     needs no conversion history, so it remains the safe default for a
//     brand-new campaign. Target Impression Share can be selected explicitly.
//   - There is deliberately NO remove/delete tool. Pausing (pause_campaign,
//     pause_ad_group) stops spend and is reversible; a REMOVED resource is
//     permanent. Pause is always the right lever here.
//   - Every tool supports validate_only so you can dry-run against Google's
//     schema/policy rules before committing.
// ──────────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Minimal view of MutateGoogleAdsResponse — we only read the resource
// names of the entities we created. The library's response type is a deep
// proto union; this keeps the read-out type-safe without importing it.
type MutateResponse = {
  mutate_operation_responses?: Array<{
    campaign_budget_result?: { resource_name?: string };
    campaign_result?: { resource_name?: string };
  }>;
};

export type CreateCampaignInput = SearchCampaignBiddingInput & {
  customer_id: string;
  name: string;
  daily_budget: number;
  include_search_partners?: boolean;
  include_display_network?: boolean;
  start_date?: string;
  end_date?: string;
  initial_status?: "PAUSED" | "ENABLED";
};

export function buildCreateCampaignOperations(
  params: CreateCampaignInput,
  budgetNameSuffix: number | string = Date.now()
): MutateOperation<Record<string, unknown>>[] {
  const cid = params.customer_id;
  const budgetTmp = ResourceNames.campaignBudget(cid, "-1");

  return [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetTmp,
        name: `${params.name} — budget (${budgetNameSuffix})`,
        amount_micros: toMicros(params.daily_budget),
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        explicitly_shared: false,
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        name: params.name,
        status: enumValue(
          enums.CampaignStatus,
          params.initial_status ?? "PAUSED"
        ),
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        campaign_budget: budgetTmp,
        contains_eu_political_advertising:
          enums.EuPoliticalAdvertisingStatus
            .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        ...buildSearchCampaignBiddingStrategy(params),
        network_settings: {
          target_google_search: true,
          target_search_network: params.include_search_partners ?? true,
          target_content_network: params.include_display_network ?? false,
          target_partner_search_network: false,
        },
        ...buildCampaignDateTimeFields(params),
      },
    },
  ];
}

export function registerCampaignTools(server: McpServer) {
  registerCreateCampaign(server);
  registerCreateAdGroup(server);
}

// ── create_campaign ───────────────────────────────────────────────────
function registerCreateCampaign(server: McpServer) {
  server.registerTool(
    "create_campaign",
    {
      title: "Create Search Campaign",
      description:
        "Create a new Search campaign with its own daily budget, in a " +
        "single atomic operation. The campaign defaults to PAUSED so it " +
        "never starts spending on its own, but you can pass " +
        "initial_status=ENABLED for UI-free launch after setup. Bidding defaults to Maximize " +
        "Clicks, or can use Target Impression Share for anywhere, top, or absolute-top " +
        "placement. To retire a campaign later use " +
        "pause_campaign — there is no delete (a removed campaign is " +
        "permanent; a paused one is reversible).",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens (e.g. '9232939339')"),
        name: z
          .string()
          .min(1)
          .describe(
            "Campaign name. Must be unique among the account's non-removed " +
              "campaigns, or Google returns DUPLICATE_CAMPAIGN_NAME."
          ),
        daily_budget: z
          .number()
          .positive()
          .describe(
            "Average daily budget in the account's currency (e.g. 50 = " +
              "$50/day for a USD account). Converted to micros internally."
          ),
        cpc_bid_ceiling: z
          .number()
          .positive()
          .optional()
          .describe(
            "Max CPC bid limit in account currency. Optional for Maximize Clicks " +
              "and required for Target Impression Share."
          ),
        bidding_strategy: z
          .enum(["MAXIMIZE_CLICKS", "TARGET_IMPRESSION_SHARE"])
          .optional()
          .describe("Campaign bidding strategy. Default: MAXIMIZE_CLICKS."),
        target_impression_share_location: z
          .enum(TARGET_IMPRESSION_SHARE_LOCATIONS)
          .optional()
          .describe(
            "Required for Target Impression Share: anywhere, top, or absolute top of the page."
          ),
        target_impression_share_percentage: z
          .number()
          .positive()
          .max(100)
          .optional()
          .describe(
            "Required for Target Impression Share. Desired impression share as a percentage greater than 0 and at most 100."
          ),
        include_search_partners: z
          .boolean()
          .optional()
          .describe(
            "Show on Google's Search Network partner sites in addition to " +
              "Google Search. Default: true."
          ),
        include_display_network: z
          .boolean()
          .optional()
          .describe(
            "Also opt into the Display Network. Usually left off for a pure " +
              "Search campaign. Default: false."
          ),
        start_date: z
          .string()
          .regex(DATE_RE, "Use YYYY-MM-DD")
          .optional()
          .describe(
            "Optional campaign start date, format YYYY-MM-DD. Defaults to " +
              "today if omitted."
          ),
        end_date: z
          .string()
          .regex(DATE_RE, "Use YYYY-MM-DD")
          .optional()
          .describe(
            "Optional campaign end date, format YYYY-MM-DD. Omit to run with " +
              "no end date."
          ),
        initial_status: z
          .enum(["PAUSED", "ENABLED"])
          .optional()
          .describe("Initial campaign status. Default: PAUSED."),
        validate_only: z
          .boolean()
          .optional()
          .describe(
            "If true, validate the budget + campaign against Google Ads " +
              "schema/policy rules but do NOT create anything. Default: false."
          ),
      },
    },
    async (params) => {
      const tool = "create_campaign";
      try {
        const customer = getAdsClient(params.customer_id);
        // Temp resource names let the budget and campaign be created atomically.
        const operations = buildCreateCampaignOperations(params);

        const result = (await customer.mutateResources(operations, {
          validate_only: params.validate_only ?? false,
        })) as unknown as MutateResponse;

        if (params.validate_only) {
          return mcpSuccess({
            tool,
            customer_id: params.customer_id,
            validate_only: true,
            resource_names: [],
            results: {
              message: "Budget + campaign passed Google Ads validation.",
              campaign: params.name,
              status: params.initial_status ?? "PAUSED",
              daily_budget: params.daily_budget,
            },
          });
        }

        const responses = result.mutate_operation_responses ?? [];
        const budgetRn = responses
          .map((r) => r.campaign_budget_result?.resource_name)
          .find(Boolean);
        const campaignRn = responses
          .map((r) => r.campaign_result?.resource_name)
          .find(Boolean);

        if (!campaignRn) {
          return mcpJsonError(
            tool,
            new Error("mutate succeeded but no campaign resource_name returned"),
            { customer_id: params.customer_id }
          );
        }

        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: false,
          resource_names: extractResourceNames(result),
          results: {
            campaign: campaignRn,
            budget: budgetRn,
            status: params.initial_status ?? "PAUSED",
            channel: "SEARCH",
            bidding: params.bidding_strategy ?? "MAXIMIZE_CLICKS",
            daily_budget: params.daily_budget,
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

// ── create_ad_group ───────────────────────────────────────────────────
function registerCreateAdGroup(server: McpServer) {
  server.registerTool(
    "create_ad_group",
    {
      title: "Create Ad Group",
      description:
        "Create a Search ad group inside an existing campaign. This is the " +
        "container for ads and keywords: after creating it, call " +
        "create_responsive_search_ad and add_keywords with the returned ad " +
        "group resource name. The ad group is created ENABLED, but it won't " +
        "serve until its parent campaign is enabled. To retire an ad group " +
        "later use pause_ad_group (reversible) — there is no delete.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens (e.g. '9232939339')"),
        campaign_id: z
          .string()
          .describe(
            "Parent campaign resource name (e.g. " +
              "'customers/9232939339/campaigns/22264786246'). This is the " +
              "full resource name, NOT just the numeric campaign id."
          ),
        name: z
          .string()
          .min(1)
          .describe(
            "Ad group name. Must be unique within the campaign, or Google " +
              "returns DUPLICATE_ADGROUP_NAME."
          ),
        cpc_bid: z
          .number()
          .positive()
          .optional()
          .describe(
            "Optional default max CPC bid (account currency) for this ad " +
              "group. With Maximize Clicks bidding the strategy manages bids, " +
              "so this is usually left unset."
          ),
        validate_only: z
          .boolean()
          .optional()
          .describe(
            "If true, validate against Google Ads rules but do NOT create " +
              "the ad group. Default: false."
          ),
      },
    },
    async (params) => {
      const tool = "create_ad_group";
      try {
        const customer = getAdsClient(params.customer_id);

        const result = await customer.adGroups.create(
          [
            {
              name: params.name,
              campaign: params.campaign_id,
              status: enums.AdGroupStatus.ENABLED,
              type: enums.AdGroupType.SEARCH_STANDARD,
              ...(params.cpc_bid != null
                ? { cpc_bid_micros: toMicros(params.cpc_bid) }
                : {}),
            },
          ],
          { validate_only: params.validate_only ?? false }
        );

        if (params.validate_only) {
          return mcpSuccess({
            tool,
            customer_id: params.customer_id,
            validate_only: true,
            resource_names: [],
            results: {
              message: "Ad group passed Google Ads validation.",
              ad_group: params.name,
              campaign: params.campaign_id,
            },
          });
        }

        const resourceName = result.results?.[0]?.resource_name;
        if (!resourceName) {
          return mcpJsonError(
            tool,
            new Error("mutate succeeded but no resource_name was returned"),
            { customer_id: params.customer_id }
          );
        }

        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: false,
          resource_names: [resourceName],
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
