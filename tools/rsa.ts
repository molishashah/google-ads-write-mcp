import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import { mcpText, mcpError } from "@/lib/mcp-helpers";

// ──────────────────────────────────────────────────────────────────────
// Responsive Search Ad tools
//
// Why CREATE and not UPDATE:
//   AdService.MutateAds UPDATE is blocked by Google for RSA headlines /
//   descriptions (IMMUTABLE_FIELD). The only way to "edit" an RSA's copy
//   is to CREATE a new ad in the same ad group and PAUSE the old one.
//   The paired `pause_ad` tool lives elsewhere; this tool only handles
//   the CREATE half.
// ──────────────────────────────────────────────────────────────────────

export function registerRsaTools(server: McpServer) {
  server.registerTool(
    "create_responsive_search_ad",
    {
      title: "Create Responsive Search Ad",
      description:
        "Create a new RSA in an existing ad group. Use this to replace an " +
        "underperforming ad: call create_responsive_search_ad to create the " +
        "new one, then pause_ad to pause the old one. Do NOT use " +
        "update_responsive_search_ad — Google blocks RSA asset updates via " +
        "AdService.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens (e.g. '9232939339')"),
        ad_group_id: z
          .string()
          .describe(
            "Ad group resource name (e.g. 'customers/123/adGroups/456')"
          ),
        final_url: z.string().url().describe("Landing page URL"),
        headlines: z
          .array(z.string().max(30))
          .min(3)
          .max(15)
          .describe("3–15 headline strings, each max 30 characters"),
        descriptions: z
          .array(z.string().max(90))
          .min(2)
          .max(4)
          .describe("2–4 description strings, each max 90 characters"),
        validate_only: z
          .boolean()
          .optional()
          .describe(
            "If true, validate the request against Google Ads policy and " +
              "schema rules but do NOT actually create the ad. Useful for " +
              "testing creative copy without spending. Default: false."
          ),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);

        const result = await customer.adGroupAds.create(
          [
            {
              ad_group: params.ad_group_id,
              status: enums.AdGroupAdStatus.ENABLED,
              ad: {
                final_urls: [params.final_url],
                responsive_search_ad: {
                  headlines: params.headlines.map((text) => ({ text })),
                  descriptions: params.descriptions.map((text) => ({ text })),
                },
              },
            },
          ],
          { validate_only: params.validate_only ?? false }
        );

        if (params.validate_only) {
          return mcpText(
            "✅ validate_only: request passed all Google Ads validation " +
              "(schema, policy, asset limits). No ad was created."
          );
        }

        const resourceName = result.results?.[0]?.resource_name;
        if (!resourceName) {
          return mcpError(
            "creating responsive search ad",
            new Error("mutate succeeded but no resource_name was returned")
          );
        }
        const adId = resourceName.split("/").pop();

        return mcpText(
          `Created ad: ${resourceName}\n` +
            `Ad ID: ${adId}\n\n` +
            `Next step: call pause_ad with the old ad's resource name to ` +
            `complete the swap.`
        );
      } catch (err) {
        return mcpError("creating responsive search ad", err);
      }
    }
  );
}
