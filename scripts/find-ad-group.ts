/**
 * Helper: list a few ad groups on the target customer so the write
 * smoke test has a real resource_name to target.
 *
 * Usage:
 *   npx tsx scripts/find-ad-group.ts [customer_id]
 */

import { loadEnvConfig } from "@next/env";
import { getAdsClient } from "../lib/ads-client";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const customerId = process.argv[2] ?? "9232939339";
  const customer = getAdsClient(customerId);

  const rows = await customer.query<
    {
      campaign: { id?: string; name?: string; status?: string };
      ad_group: {
        id?: string;
        name?: string;
        status?: string;
        resource_name?: string;
      };
    }[]
  >(
    `SELECT campaign.id,
            campaign.name,
            campaign.status,
            ad_group.id,
            ad_group.name,
            ad_group.status,
            ad_group.resource_name
     FROM ad_group
     WHERE ad_group.status IN ('ENABLED', 'PAUSED')
     ORDER BY ad_group.id
     LIMIT 5`
  );

  if (rows.length === 0) {
    console.log("No ad groups found on this customer.");
    return;
  }

  console.log(`Found ${rows.length} ad group(s):\n`);
  for (const row of rows) {
    console.log(
      `  ${row.ad_group.resource_name}` +
        `  (campaign: "${row.campaign.name}" [${row.campaign.status}],` +
        `   ad_group: "${row.ad_group.name}" [${row.ad_group.status}])`
    );
  }
}

main().catch((err: unknown) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
