import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import { mcpText, mcpError } from "@/lib/mcp-helpers";

// Normalise enum values coming back from google-ads-api into canonical
// strings. The TypeScript google-ads-api package returns enum fields
// as integers (e.g. ad_group_ad.status === 2 for ENABLED) while the
// Python read MCP returns strings. Always return strings so the agent
// has a stable interface across MCPs.
function normalizeFromEnum<T extends Record<string | number, string | number>>(
  value: unknown,
  enumObj: T
): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    const map = enumObj as unknown as Record<number, string>;
    return map[value] ?? String(value);
  }
  return String(value);
}

function normalizeAdStatus(value: unknown): string | null {
  return normalizeFromEnum(value, enums.AdGroupAdStatus);
}

function normalizePinnedField(value: unknown): string | null {
  const s = normalizeFromEnum(value, enums.ServedAssetFieldType);
  if (!s || s === "UNSPECIFIED" || s === "UNKNOWN") return null;
  return s;
}

// ──────────────────────────────────────────────────────────────────────
// Ad read tool — fetch a single RSA's full content
//
// Why this lives in the WRITE MCP
// -------------------------------
// The read-only `google-ads` MCP (Python, googleads/google-ads-mcp)
// crashes with `Unable to serialize unknown type:
// proto.marshal.collections.repeated.RepeatedComposite` whenever a
// query asks for `ad_group_ad.ad.responsive_search_ad.headlines`,
// `.descriptions`, or `ad_group_ad.ad.final_urls`. These are the
// exact fields the agent needs in Step 7 (Deploy) of the
// autoresearch-ads daily cycle to construct a replacement RSA.
//
// The write MCP uses the TypeScript `google-ads-api` package, which
// returns these fields as plain JS objects natively. So we can fetch
// them here, repackage as JSON text, and hand them back to the agent
// without ever touching the Python marshaling layer that breaks.
//
// Two access modes:
//   (1) ad_id           — exact resource name lookup
//   (2) ad_group_id +
//       select_winning  — find the top-impression ENABLED RSA in the
//                         given ad group over the last 30 days. This
//                         is the typical Step 7 deploy pattern.
// ──────────────────────────────────────────────────────────────────────

export function registerAdReadTools(server: McpServer) {
  registerGetAd(server);
}

function registerGetAd(server: McpServer) {
  server.registerTool(
    "get_ad",
    {
      title: "Get RSA Ad Details",
      description:
        "Fetch a Responsive Search Ad's full content — headlines, " +
        "descriptions, final URLs, paths, and pinned positions — as " +
        "structured JSON. Use this in the Step 7 'direct_swap' deploy " +
        "flow to read the current winning ad's copy before constructing " +
        "the replacement RSA. Bypasses a serializer bug in the read-only " +
        "google-ads MCP that crashes on RSA composite fields. " +
        "Either pass `ad_id` (exact resource name) or pass `ad_group_id` " +
        "+ `select_winning: true` to pick the top-impression enabled RSA " +
        "in that ad group over the last 30 days.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens (e.g. '9232939339')"),
        ad_id: z
          .string()
          .optional()
          .describe(
            "Optional: full resource name of a specific ad to fetch " +
              "(e.g. 'customers/9232939339/adGroupAds/123~456'). If " +
              "provided, ad_group_id is ignored."
          ),
        ad_group_id: z
          .string()
          .optional()
          .describe(
            "Optional: full ad group resource name " +
              "(e.g. 'customers/9232939339/adGroups/456'). Combine with " +
              "select_winning=true to fetch the top-impression RSA. " +
              "Ignored if ad_id is provided."
          ),
        select_winning: z
          .boolean()
          .optional()
          .describe(
            "If true and ad_group_id is set, fetch the ENABLED " +
              "RESPONSIVE_SEARCH_AD in that ad group with the highest " +
              "impressions over the last 30 days. Default: false."
          ),
      },
    },
    async (params) => getAdImpl(params)
  );
}

export interface GetAdParams {
  customer_id: string;
  ad_id?: string;
  ad_group_id?: string;
  select_winning?: boolean;
}

export async function getAdImpl(params: GetAdParams) {
  try {
    const customer = getAdsClient(params.customer_id);

    // ── Step 1: resolve which ad to fetch ────────────────────────────
    let resourceName: string | undefined = params.ad_id;
    if (!resourceName) {
      if (!params.ad_group_id || !params.select_winning) {
        return mcpError(
          "fetching ad",
          new Error(
            "Provide either `ad_id` (exact resource name) or " +
              "`ad_group_id` + `select_winning=true`."
          )
        );
      }
      const winningRows = await customer.query<
        {
          ad_group_ad: { resource_name?: string | null };
          metrics: { impressions?: number | null };
        }[]
      >(
        `SELECT
           ad_group_ad.resource_name,
           metrics.impressions
         FROM ad_group_ad
         WHERE ad_group_ad.ad_group = '${escapeGaql(params.ad_group_id)}'
           AND ad_group_ad.status = 'ENABLED'
           AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
           AND segments.date DURING LAST_30_DAYS
         ORDER BY metrics.impressions DESC
         LIMIT 1`
      );
      resourceName = winningRows[0]?.ad_group_ad?.resource_name ?? undefined;
      if (!resourceName) {
        return mcpError(
          "fetching ad",
          new Error(
            `No enabled RSA with impressions in last 30 days found in ad ` +
              `group ${params.ad_group_id}.`
          )
        );
      }
    }

    // ── Step 2: fetch the ad's full content ──────────────────────────
    return await fetchAdByResourceName(customer, resourceName);
  } catch (err) {
    return mcpError("fetching ad", err);
  }
}

function escapeGaql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ── ad fetch implementation ───────────────────────────────────────
//
// Returns the ad as JSON-stringified text content. We pull every
// field the Step 7 build-new-RSA logic needs, plus headline metrics
// for context. Pinned fields are normalised: UNSPECIFIED → null.

interface RsaAssetRow {
  text?: string | null;
  pinned_field?: string | number | null;
}

interface AdRow {
  ad_group_ad: {
    resource_name?: string | null;
    status?: string | number | null;
    ad?: {
      id?: number | string | null;
      final_urls?: string[] | null;
      responsive_search_ad?: {
        headlines?: RsaAssetRow[] | null;
        descriptions?: RsaAssetRow[] | null;
        path1?: string | null;
        path2?: string | null;
      } | null;
    } | null;
  };
  metrics: {
    impressions?: number | null;
    clicks?: number | null;
    conversions?: number | null;
  };
}

async function fetchAdByResourceName(
  customer: ReturnType<typeof getAdsClient>,
  resourceName: string
) {
  const rows = await customer.query<AdRow[]>(
    `SELECT
       ad_group_ad.resource_name,
       ad_group_ad.status,
       ad_group_ad.ad.id,
       ad_group_ad.ad.final_urls,
       ad_group_ad.ad.responsive_search_ad.headlines,
       ad_group_ad.ad.responsive_search_ad.descriptions,
       ad_group_ad.ad.responsive_search_ad.path1,
       ad_group_ad.ad.responsive_search_ad.path2,
       metrics.impressions,
       metrics.clicks,
       metrics.conversions
     FROM ad_group_ad
     WHERE ad_group_ad.resource_name = '${escapeGaql(resourceName)}'
       AND segments.date DURING LAST_30_DAYS`
  );

  if (!rows.length) {
    return mcpError(
      "fetching ad",
      new Error(`Ad not found: ${resourceName}`)
    );
  }

  const row = rows[0];
  const ad = row.ad_group_ad?.ad;
  const rsa = ad?.responsive_search_ad;
  if (!rsa) {
    return mcpError(
      "fetching ad",
      new Error(
        `Ad ${resourceName} is not a Responsive Search Ad ` +
          `(or has no responsive_search_ad payload).`
      )
    );
  }

  const result = {
    resource_name: row.ad_group_ad?.resource_name ?? resourceName,
    ad_id: ad?.id != null ? String(ad.id) : null,
    status: normalizeAdStatus(row.ad_group_ad?.status),
    final_urls: ad?.final_urls ?? [],
    headlines: (rsa.headlines ?? []).map((h) => ({
      text: h?.text ?? "",
      pinned_field: normalizePinnedField(h?.pinned_field),
    })),
    descriptions: (rsa.descriptions ?? []).map((d) => ({
      text: d?.text ?? "",
      pinned_field: normalizePinnedField(d?.pinned_field),
    })),
    path1: rsa.path1 ?? null,
    path2: rsa.path2 ?? null,
    metrics: {
      impressions: row.metrics?.impressions ?? 0,
      clicks: row.metrics?.clicks ?? 0,
      conversions: row.metrics?.conversions ?? 0,
    },
  };

  return mcpText(JSON.stringify(result, null, 2));
}
