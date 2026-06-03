import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import { mcpText, mcpError } from "@/lib/mcp-helpers";

// ──────────────────────────────────────────────────────────────────────
// Ad lifecycle tools
//
// These tools manage the enabled/paused state of ads, ad groups, and
// campaigns. All three are recoverable — pausing preserves the resource
// and its historical metrics; unpause via the Google Ads UI (or by
// updating status back to ENABLED) to resume serving.
//
// Use cases:
//   - pause_ad:       complete the RSA "swap" workflow (create new ad,
//                     pause old). Required because Google blocks
//                     AdService.MutateAds UPDATE on RSA headlines.
//   - pause_ad_group: surgically kill an underperforming ad group while
//                     keeping the rest of the campaign serving.
//   - pause_campaign: stop a campaign entirely. Used for budget cleanup
//                     or to retire a campaign whose targeting no longer
//                     fits the product/positioning.
// ──────────────────────────────────────────────────────────────────────

export function registerAdLifecycleTools(server: McpServer) {
  registerPauseAd(server);
  registerPauseAdGroup(server);
  registerPauseCampaign(server);
}

// ── pause_ad ──────────────────────────────────────────────────────────
function registerPauseAd(server: McpServer) {
  server.registerTool(
    "pause_ad",
    {
      title: "Pause Ad",
      description:
        "Pause an existing ad in an ad group. Use this to complete the " +
        "RSA swap workflow: after create_responsive_search_ad creates the " +
        "new ad, call pause_ad with the old ad's resource name to stop it " +
        "from serving. This is the only supported way to retire an RSA " +
        "because Google blocks AdService.MutateAds UPDATE on RSA " +
        "headlines/descriptions. The ad remains in the account (not " +
        "deleted) so its historical metrics are preserved.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens (e.g. '9232939339')"),
        ad_id: z
          .string()
          .describe(
            "Ad resource name to pause (e.g. " +
              "'customers/9232939339/adGroupAds/123~456'). This is the full " +
              "resource name, NOT just the numeric ad id."
          ),
        validate_only: z
          .boolean()
          .optional()
          .describe(
            "If true, validate the request against Google Ads schema rules " +
              "but do NOT actually pause the ad. Useful for confirming the " +
              "resource name is well-formed before making the real call. " +
              "Default: false."
          ),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);

        const result = await customer.adGroupAds.update(
          [
            {
              resource_name: params.ad_id,
              status: enums.AdGroupAdStatus.PAUSED,
            },
          ],
          { validate_only: params.validate_only ?? false }
        );

        if (params.validate_only) {
          return mcpText(
            [
              "✅ validate_only: pause request passed Google Ads validation.",
              "",
              `  Ad:     ${params.ad_id}`,
              `  Action: set status to PAUSED`,
              "",
              "No change was applied. Re-run with validate_only=false to " +
                "actually pause the ad.",
            ].join("\n")
          );
        }

        const resourceName = result.results?.[0]?.resource_name;
        if (!resourceName) {
          return mcpError(
            "pausing ad",
            new Error("mutate succeeded but no resource_name was returned")
          );
        }

        return mcpText(
          `Paused ad: ${resourceName}\n` +
            "The ad is now in PAUSED status and will stop serving. " +
            "Historical metrics are preserved; you can un-pause later by " +
            "updating status back to ENABLED in the Google Ads UI."
        );
      } catch (err) {
        return mcpError("pausing ad", err);
      }
    }
  );
}

// ── pause_ad_group ────────────────────────────────────────────────────
function registerPauseAdGroup(server: McpServer) {
  server.registerTool(
    "pause_ad_group",
    {
      title: "Pause Ad Group",
      description:
        "Pause an entire ad group. All ads in the group stop serving, " +
        "and keywords/audiences in the group stop matching. Use this to " +
        "surgically kill an underperforming ad group while keeping the " +
        "rest of the campaign running. The ad group and its child " +
        "resources are not deleted — historical metrics are preserved, " +
        "and you can un-pause later by updating status back to ENABLED " +
        "in the Google Ads UI.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens (e.g. '9232939339')"),
        ad_group_id: z
          .string()
          .describe(
            "Ad group resource name to pause (e.g. " +
              "'customers/9232939339/adGroups/191506291605'). This is the " +
              "full resource name, NOT just the numeric ad group id."
          ),
        validate_only: z
          .boolean()
          .optional()
          .describe(
            "If true, validate the request against Google Ads schema rules " +
              "but do NOT actually pause the ad group. Useful for confirming " +
              "the resource name is well-formed before making the real call. " +
              "Default: false."
          ),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);

        const result = await customer.adGroups.update(
          [
            {
              resource_name: params.ad_group_id,
              status: enums.AdGroupStatus.PAUSED,
            },
          ],
          { validate_only: params.validate_only ?? false }
        );

        if (params.validate_only) {
          return mcpText(
            [
              "✅ validate_only: pause request passed Google Ads validation.",
              "",
              `  Ad group: ${params.ad_group_id}`,
              `  Action:   set status to PAUSED`,
              "",
              "No change was applied. Re-run with validate_only=false to " +
                "actually pause the ad group.",
            ].join("\n")
          );
        }

        const resourceName = result.results?.[0]?.resource_name;
        if (!resourceName) {
          return mcpError(
            "pausing ad group",
            new Error("mutate succeeded but no resource_name was returned")
          );
        }

        return mcpText(
          `Paused ad group: ${resourceName}\n` +
            "The ad group is now in PAUSED status. All ads in the group " +
            "have stopped serving and keywords/audiences are not matching. " +
            "Historical metrics are preserved; you can un-pause later by " +
            "updating status back to ENABLED in the Google Ads UI."
        );
      } catch (err) {
        return mcpError("pausing ad group", err);
      }
    }
  );
}

// ── pause_campaign ────────────────────────────────────────────────────
function registerPauseCampaign(server: McpServer) {
  server.registerTool(
    "pause_campaign",
    {
      title: "Pause Campaign",
      description:
        "Pause an entire campaign. All ad groups and ads in the campaign " +
        "stop serving, and the campaign stops spending against its " +
        "budget. Use this for budget cleanup (retiring campaigns whose " +
        "targeting no longer fits the product) or to stop ongoing spend " +
        "on a campaign you no longer want active. The campaign and its " +
        "child resources are not deleted — historical metrics are " +
        "preserved, and you can un-pause later by updating status back " +
        "to ENABLED in the Google Ads UI.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens (e.g. '9232939339')"),
        campaign_id: z
          .string()
          .describe(
            "Campaign resource name to pause (e.g. " +
              "'customers/9232939339/campaigns/22264786246'). This is the " +
              "full resource name, NOT just the numeric campaign id."
          ),
        validate_only: z
          .boolean()
          .optional()
          .describe(
            "If true, validate the request against Google Ads schema rules " +
              "but do NOT actually pause the campaign. Useful for confirming " +
              "the resource name is well-formed before making the real call. " +
              "Default: false."
          ),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);

        const result = await customer.campaigns.update(
          [
            {
              resource_name: params.campaign_id,
              status: enums.CampaignStatus.PAUSED,
            },
          ],
          { validate_only: params.validate_only ?? false }
        );

        if (params.validate_only) {
          return mcpText(
            [
              "✅ validate_only: pause request passed Google Ads validation.",
              "",
              `  Campaign: ${params.campaign_id}`,
              `  Action:   set status to PAUSED`,
              "",
              "No change was applied. Re-run with validate_only=false to " +
                "actually pause the campaign.",
            ].join("\n")
          );
        }

        const resourceName = result.results?.[0]?.resource_name;
        if (!resourceName) {
          return mcpError(
            "pausing campaign",
            new Error("mutate succeeded but no resource_name was returned")
          );
        }

        return mcpText(
          `Paused campaign: ${resourceName}\n` +
            "The campaign is now in PAUSED status. All ad groups and ads " +
            "have stopped serving and the campaign is no longer spending " +
            "against its budget. Historical metrics are preserved; you can " +
            "un-pause later by updating status back to ENABLED in the " +
            "Google Ads UI."
        );
      } catch (err) {
        return mcpError("pausing campaign", err);
      }
    }
  );
}
