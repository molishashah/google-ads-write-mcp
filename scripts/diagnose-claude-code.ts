/**
 * Diagnostic: list ALL enabled RSAs in the claude_code ad group,
 * not just the top-impression one. Helps determine whether the
 * failing Step 7 smoke test is because the target asset lives in
 * a different (lower-impression) RSA in the same ad group.
 */

import { loadEnvConfig } from "@next/env";
import { getAdsClient } from "../lib/ads-client";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const customer = getAdsClient("9232939339");

  const rows = await customer.query<
    {
      ad_group_ad: {
        resource_name?: string | null;
        status?: string | number | null;
        ad?: {
          id?: string | number | null;
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
       metrics.impressions,
       metrics.clicks,
       metrics.conversions
     FROM ad_group_ad
     WHERE ad_group.name = 'claude_code'
       AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
       AND segments.date DURING LAST_30_DAYS
     ORDER BY metrics.impressions DESC`
  );

  console.log(`Found ${rows.length} RSA rows in claude_code ad group:\n`);
  for (const row of rows) {
    const m = row.metrics;
    console.log(
      `  status=${row.ad_group_ad?.status} ` +
        `impressions=${m?.impressions} clicks=${m?.clicks} conversions=${m?.conversions}`
    );
    console.log(`    ${row.ad_group_ad?.resource_name}`);
  }
}

main().catch((err) => {
  console.error("error:", err);
  process.exit(1);
});
