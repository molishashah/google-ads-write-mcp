/**
 * Validate-only smoke test for the create_ad_group tool.
 *
 * Run with:
 *   npx tsx scripts/smoke-test-create-ad-group.ts [customer_id] [campaign_resource_name]
 */

import { loadEnvConfig } from "@next/env";
import { enums } from "google-ads-api";
import { getAdsClient } from "../lib/ads-client";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const customerId = process.argv[2] ?? "9232939339";
  const campaign =
    process.argv[3] ?? "customers/9232939339/campaigns/22231531386";
  const name = `SMOKE-TEST ad group (${Date.now()})`;

  console.log(
    `▶ Validate-only create_ad_group in ${campaign}\n  name="${name}"\n`
  );

  const customer = getAdsClient(customerId);

  const result = await customer.adGroups.create(
    [
      {
        name,
        campaign,
        status: enums.AdGroupStatus.ENABLED,
        type: enums.AdGroupType.SEARCH_STANDARD,
      },
    ],
    { validate_only: true }
  );

  console.log("✅ create_ad_group validate_only PASSED — nothing persisted.\n");
  console.log("Raw response:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error("\n❌ create_ad_group smoke test FAILED\n");
  console.error(err instanceof Error ? err.message : JSON.stringify(err, null, 2));
  process.exit(1);
});
