/**
 * Standalone smoke test for the service-account-based Google Ads
 * client. Bypasses Layer 2 entirely — no MCP server, no JWT, no
 * team-member OAuth handshake. Only verifies that getAdsClient(cid)
 * can authenticate against the Google Ads API using the SA file
 * referenced by GOOGLE_APPLICATION_CREDENTIALS in .env.local.
 *
 * Run with:
 *   npx tsx scripts/smoke-test-ads.ts [customer_id]
 *
 * Default customer is the only one currently visible to the SA
 * (9232939339, discovered via list_accessible_customers). Pass
 * another CID as the first arg to test against a different account.
 */

import { loadEnvConfig } from "@next/env";
import { getAdsClient } from "../lib/ads-client";

// Load .env.local the same way `npm run dev` does. Safe to call
// before getAdsClient because lib/ads-client.ts only reads env
// vars lazily (via getters), not at import time.
loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const customerId = process.argv[2] ?? "9232939339";
  console.log(
    `▶ Smoke-testing Google Ads SA auth against customer ${customerId}…\n`
  );

  const customer = getAdsClient(customerId);

  // Trivial GAQL — just confirm the connection authenticates and a
  // basic SELECT returns. Reads only, no mutations.
  const rows = await customer.query<
    {
      customer: {
        id?: string;
        descriptive_name?: string;
        currency_code?: string;
        time_zone?: string;
        manager?: boolean;
        test_account?: boolean;
      };
    }[]
  >(
    `SELECT customer.id,
            customer.descriptive_name,
            customer.currency_code,
            customer.time_zone,
            customer.manager,
            customer.test_account
     FROM customer
     LIMIT 1`
  );

  if (rows.length === 0) {
    throw new Error(
      "GAQL returned 0 rows — unexpected for SELECT customer (every " +
        "customer should always return its own row)."
    );
  }

  console.log("✅ READ smoke test passed.\n");
  console.log("Customer details:");
  console.log(JSON.stringify(rows[0].customer, null, 2));
  console.log(
    "\nNext step: try a write operation (e.g. validate_only RSA " +
      "create) to confirm the SA has Standard role on the MCC."
  );
}

main().catch((err: unknown) => {
  console.error("\n❌ READ smoke test FAILED\n");
  if (err instanceof Error) {
    console.error("Error:", err.message);
    if (err.stack) console.error("\nStack:\n", err.stack);
  } else {
    console.error(err);
  }
  process.exit(1);
});
