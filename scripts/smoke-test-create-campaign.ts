/**
 * Validate-only smoke test for the create_campaign tool's atomic mutate.
 *
 * Runs the exact budget + campaign create that tools/campaign.ts performs,
 * with validate_only:true — exercises auth, schema, and policy checks but
 * persists NOTHING (no budget, no campaign).
 *
 * Expected: no exception thrown → the mutate is valid and the SA has write
 * permission. USER_PERMISSION_DENIED → SA still read-only on the account.
 *
 * Run with:
 *   npx tsx scripts/smoke-test-create-campaign.ts [customer_id]
 */

import { loadEnvConfig } from "@next/env";
import {
  enums,
  ResourceNames,
  toMicros,
  type MutateOperation,
} from "google-ads-api";
import { getAdsClient } from "../lib/ads-client";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const customerId = process.argv[2] ?? "9232939339";
  const name = `SMOKE-TEST campaign (${Date.now()})`;
  const dailyBudget = 50; // account currency units

  console.log(
    `▶ Validate-only create_campaign against customer ${customerId}` +
      `\n  name="${name}", daily_budget=${dailyBudget}, Maximize Clicks, PAUSED\n`
  );

  const customer = getAdsClient(customerId);
  const budgetTmp = ResourceNames.campaignBudget(customerId, "-1");

  const operations: MutateOperation<Record<string, unknown>>[] = [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetTmp,
        name: `${name} — budget`,
        amount_micros: toMicros(dailyBudget),
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        explicitly_shared: false,
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        name,
        status: enums.CampaignStatus.PAUSED,
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        campaign_budget: budgetTmp,
        contains_eu_political_advertising:
          enums.EuPoliticalAdvertisingStatus
            .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        target_spend: {},
        network_settings: {
          target_google_search: true,
          target_search_network: true,
          target_content_network: false,
          target_partner_search_network: false,
        },
      },
    },
  ];

  const result = await customer.mutateResources(operations, {
    validate_only: true,
  });

  console.log("✅ create_campaign validate_only PASSED — nothing persisted.\n");
  console.log("Raw response:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error("\n❌ create_campaign smoke test FAILED\n");
  if (err instanceof Error) {
    console.error("Error:", err.message);
    if (/USER_PERMISSION_DENIED|PermissionDenied/i.test(err.message)) {
      console.error(
        "\n💡 The service account is likely read-only on this customer. " +
          "Promote it to Standard role in Google Ads → Tools & Settings → " +
          "Access and security."
      );
    }
    if (err.stack) console.error("\nStack:\n", err.stack);
  } else {
    console.error(JSON.stringify(err, null, 2));
  }
  process.exit(1);
});
