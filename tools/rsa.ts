import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums, type MutateOperation } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  extractRequestId,
  extractResourceNames,
  toResourceName,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import { mutateOptionSchema } from "@/tools/tool-utils";

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
  registerCreateResponsiveSearchAd(server);
  registerReplaceResponsiveSearchAd(server);
}

const rsaAssetSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    pinned_field: z
      .enum([
        "HEADLINE_1",
        "HEADLINE_2",
        "HEADLINE_3",
        "DESCRIPTION_1",
        "DESCRIPTION_2",
      ])
      .optional(),
  }),
]);

function registerCreateResponsiveSearchAd(server: McpServer) {
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
          .array(rsaAssetSchema)
          .min(3)
          .max(15)
          .describe("3–15 headline strings or {text,pinned_field} objects"),
        descriptions: z
          .array(rsaAssetSchema)
          .min(2)
          .max(4)
          .describe("2–4 description strings or {text,pinned_field} objects"),
        path1: z.string().max(15).optional(),
        path2: z.string().max(15).optional(),
        final_url_suffix: z.string().optional(),
        tracking_url_template: z.string().optional(),
        url_custom_parameters: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional(),
        labels: z
          .array(z.string())
          .optional()
          .describe("Ad group ad label resource names to attach on create if supported."),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_responsive_search_ad";
      try {
        const customer = getAdsClient(params.customer_id);
        const adGroup = toResourceName(params.customer_id, "adGroups", params.ad_group_id);

        const result = await customer.adGroupAds.create(
          [
            {
              ad_group: adGroup,
              status: enums.AdGroupAdStatus.ENABLED,
              ...(params.labels ? { labels: params.labels } : {}),
              ad: {
                final_urls: [params.final_url],
                ...(params.final_url_suffix
                  ? { final_url_suffix: params.final_url_suffix }
                  : {}),
                ...(params.tracking_url_template
                  ? { tracking_url_template: params.tracking_url_template }
                  : {}),
                ...(params.url_custom_parameters
                  ? { url_custom_parameters: params.url_custom_parameters }
                  : {}),
                responsive_search_ad: {
                  headlines: params.headlines.map(toAdTextAsset),
                  descriptions: params.descriptions.map(toAdTextAsset),
                  ...(params.path1 ? { path1: params.path1 } : {}),
                  ...(params.path2 ? { path2: params.path2 } : {}),
                },
              },
            },
          ],
          {
            validate_only: params.validate_only ?? false,
            partial_failure: params.partial_failure ?? false,
          }
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

function registerReplaceResponsiveSearchAd(server: McpServer) {
  server.registerTool(
    "replace_responsive_search_ad",
    {
      title: "Replace Responsive Search Ad",
      description:
        "Create a new RSA and retire the old RSA in one GoogleAdsService.Mutate call. " +
        "Use retirement_action=PAUSE to preserve history or REMOVE for full admin cleanup.",
      inputSchema: {
        customer_id: z.string(),
        old_ad_id: z.string().describe("Old ad group ad resource name."),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
        final_url: z.string().url(),
        headlines: z.array(rsaAssetSchema).min(3).max(15),
        descriptions: z.array(rsaAssetSchema).min(2).max(4),
        path1: z.string().max(15).optional(),
        path2: z.string().max(15).optional(),
        final_url_suffix: z.string().optional(),
        tracking_url_template: z.string().optional(),
        url_custom_parameters: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional(),
        retirement_action: z.enum(["PAUSE", "REMOVE"]).optional(),
        validate_only: z.boolean().optional(),
      },
    },
    async (params) => {
      const tool = "replace_responsive_search_ad";
      try {
        const customer = getAdsClient(params.customer_id);
        const adGroup = toResourceName(params.customer_id, "adGroups", params.ad_group_id);
        const operations: MutateOperation<unknown>[] = [
          {
            entity: "ad_group_ad",
            operation: "create",
            resource: {
              ad_group: adGroup,
              status: enums.AdGroupAdStatus.ENABLED,
              ad: {
                final_urls: [params.final_url],
                ...(params.final_url_suffix
                  ? { final_url_suffix: params.final_url_suffix }
                  : {}),
                ...(params.tracking_url_template
                  ? { tracking_url_template: params.tracking_url_template }
                  : {}),
                ...(params.url_custom_parameters
                  ? { url_custom_parameters: params.url_custom_parameters }
                  : {}),
                responsive_search_ad: {
                  headlines: params.headlines.map(toAdTextAsset),
                  descriptions: params.descriptions.map(toAdTextAsset),
                  ...(params.path1 ? { path1: params.path1 } : {}),
                  ...(params.path2 ? { path2: params.path2 } : {}),
                },
              },
            },
          },
          params.retirement_action === "REMOVE"
            ? {
                entity: "ad_group_ad",
                operation: "remove",
                resource: params.old_ad_id,
              }
            : {
                entity: "ad_group_ad",
                operation: "update",
                resource: {
                  resource_name: params.old_ad_id,
                  status: enums.AdGroupAdStatus.PAUSED,
                },
              },
        ];
        const result = await customer.mutateResources(operations, {
          validate_only: params.validate_only ?? false,
        });
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: {
            retirement_action: params.retirement_action ?? "PAUSE",
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

function toAdTextAsset(asset: z.infer<typeof rsaAssetSchema>) {
  if (typeof asset === "string") return { text: asset };
  return {
    text: asset.text,
    ...(asset.pinned_field
      ? {
          pinned_field: asset.pinned_field,
        }
      : {}),
  };
}
