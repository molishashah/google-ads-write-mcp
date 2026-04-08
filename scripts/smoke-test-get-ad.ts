/**
 * Smoke test for the new `get_ad` tool. Verifies that we can fetch
 * an RSA's full content (headlines, descriptions, final URLs) via
 * the write MCP, bypassing the read MCP's RepeatedComposite
 * serializer crash.
 *
 * Run with:
 *   npx tsx scripts/smoke-test-get-ad.ts \
 *     [customer_id] [ad_group_resource_name]
 *
 * Defaults to the claude_code ad group (191506291605) under
 * customer 9232939339, which has a known winning RSA at
 * 803604473915.
 */

import { loadEnvConfig } from "@next/env";
import { getAdsClient } from "../lib/ads-client";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const customerId = process.argv[2] ?? "9232939339";
  const adGroupResourceName =
    process.argv[3] ?? "customers/9232939339/adGroups/191506291605";

  console.log(
    `▶ get_ad smoke test\n  customer:  ${customerId}\n  ad_group:  ${adGroupResourceName}\n`
  );

  const customer = getAdsClient(customerId);

  // Step 1: select winning RSA in the ad group (mirrors the
  // get_ad implementation's select_winning branch).
  console.log("Step 1: finding winning RSA …");
  const escape = (v: string) =>
    v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
     WHERE ad_group_ad.ad_group = '${escape(adGroupResourceName)}'
       AND ad_group_ad.status = 'ENABLED'
       AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
       AND segments.date DURING LAST_30_DAYS
     ORDER BY metrics.impressions DESC
     LIMIT 1`
  );

  const resourceName = winningRows[0]?.ad_group_ad?.resource_name;
  if (!resourceName) {
    console.error("❌ no enabled RSA found");
    process.exit(1);
  }
  console.log(`  ✓ winning RSA: ${resourceName}`);
  console.log(`    impressions: ${winningRows[0]?.metrics?.impressions}\n`);

  // Step 2: fetch the full RSA content (the part that crashes the read MCP)
  console.log("Step 2: fetching RSA composite fields …");
  type RsaAssetRow = { text?: string | null; pinned_field?: string | null };
  const rows = await customer.query<
    {
      ad_group_ad: {
        resource_name?: string | null;
        status?: string | null;
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
    }[]
  >(
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
     WHERE ad_group_ad.resource_name = '${escape(resourceName)}'
       AND segments.date DURING LAST_30_DAYS`
  );

  if (!rows.length) {
    console.error("❌ ad not found");
    process.exit(1);
  }

  const row = rows[0];
  const ad = row.ad_group_ad?.ad;
  const rsa = ad?.responsive_search_ad;
  if (!rsa) {
    console.error("❌ ad has no responsive_search_ad payload");
    process.exit(1);
  }

  console.log(`  ✓ fetched. ad_id=${ad?.id}, status=${row.ad_group_ad?.status}`);
  console.log(`  ✓ final_urls: ${JSON.stringify(ad?.final_urls)}`);
  console.log(`  ✓ headlines (${rsa.headlines?.length ?? 0}):`);
  for (const h of rsa.headlines ?? []) {
    const pin =
      h?.pinned_field && h.pinned_field !== "UNSPECIFIED"
        ? ` [pinned=${h.pinned_field}]`
        : "";
    console.log(`      • ${h?.text}${pin}`);
  }
  console.log(`  ✓ descriptions (${rsa.descriptions?.length ?? 0}):`);
  for (const d of rsa.descriptions ?? []) {
    const pin =
      d?.pinned_field && d.pinned_field !== "UNSPECIFIED"
        ? ` [pinned=${d.pinned_field}]`
        : "";
    console.log(`      • ${d?.text}${pin}`);
  }
  console.log("\n✅ get_ad smoke test passed");
}

main().catch((err) => {
  console.error("❌ smoke test failed:", err);
  process.exit(1);
});
