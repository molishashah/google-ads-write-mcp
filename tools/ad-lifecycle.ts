import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import { mcpText, mcpError } from "@/lib/mcp-helpers";

// ──────────────────────────────────────────────────────────────────────
// Ad lifecycle tools
//
// These tools manage the enabled/paused state of ads. The primary use
// case is the RSA "swap" workflow: create_responsive_search_ad creates
// a new ad, then pause_ad pauses the old one. This is the only way to
// "edit" an RSA's copy because Google blocks AdService.MutateAds UPDATE
// on RSA headlines/descriptions (IMMUTABLE_FIELD).
// ──────────────────────────────────────────────────────────────────────

export function registerAdLifecycleTools(server: McpServer) {
  registerPauseAd(server);
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
