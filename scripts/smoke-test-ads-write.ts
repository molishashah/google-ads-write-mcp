/**
 * Write smoke test for the service-account-based Google Ads client.
 *
 * Calls AdGroupAdService.MutateAdGroupAds with `validate_only: true`,
 * which runs the entire create path (auth, validation, policy checks)
 * but does NOT persist anything. This is the canonical way to test
 * write authorization without polluting a real account.
 *
 * Expected outcomes:
 *   ✅  Empty results array, no error            → SA has Standard role
 *   ❌  USER_PERMISSION_DENIED                    → SA still Read-only;
 *                                                   promote it in
 *                                                   Google Ads → Tools
 *                                                   & Settings → Access
 *                                                   and security
 *   ❌  Anything else                             → genuine bug; report
 *
 * Run with:
 *   npx tsx scripts/smoke-test-ads-write.ts \
 *     [customer_id] [ad_group_resource_name]
 */

import { loadEnvConfig } from "@next/env";
import { enums } from "google-ads-api";
import { getAdsClient } from "../lib/ads-client";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const customerId = process.argv[2] ?? "9232939339";
  const adGroupResourceName =
    process.argv[3] ?? "customers/9232939339/adGroups/170186548530";

  console.log(
    `▶ Validate-only RSA create against ${adGroupResourceName}` +
      `\n  (customer ${customerId})\n`
  );

  const customer = getAdsClient(customerId);

  // Headlines (max 30 chars each, need 3-15) and descriptions (max 90
  // chars each, need 2-4). Using clearly-labelled smoke-test copy so
  // it's obvious what they are if they ever leak through.
  const result = await customer.adGroupAds.create(
    [
      {
        ad_group: adGroupResourceName,
        status: enums.AdGroupAdStatus.PAUSED, // belt-and-braces: even
        // if validate_only were
        // ignored, ad would be PAUSED
        ad: {
          final_urls: ["https://www.augmentcode.com/"],
          responsive_search_ad: {
            // Benign, policy-clean copy. Even though validate_only
            // does not persist anything, Google's policy engine still
            // evaluates the content and rejects prohibited terms.
            headlines: [
              { text: "Augment Code for Developers" },
              { text: "AI Coding Assistant" },
              { text: "Build Software Faster" },
            ],
            descriptions: [
              {
                text: "Augment helps engineering teams ship higher quality code, faster.",
              },
              {
                text: "Codebase aware AI for professional software development teams.",
              },
            ],
          },
        },
      },
    ],
    { validate_only: true }
  );

  // With validate_only:true, results is typically [] and no error is
  // thrown. The lack of an exception IS the success signal.
  console.log("✅ WRITE smoke test passed (validate_only).");
  console.log("   No data was persisted.\n");
  console.log("Raw response:");
  console.log(JSON.stringify(result, null, 2));
  console.log(
    "\nThe service account has WRITE permission on this customer."
  );
  console.log(
    "Next step: wire up the MCP server (npm run dev) and call the tools " +
      "from an MCP client."
  );
}

main().catch((err: unknown) => {
  console.error("\n❌ WRITE smoke test FAILED\n");
  if (err instanceof Error) {
    console.error("Error:", err.message);

    // Hint for the most common failure mode.
    if (/USER_PERMISSION_DENIED|PermissionDenied/i.test(err.message)) {
      console.error(
        "\n💡 This usually means the service account is still " +
          "Read-only on this customer.\n" +
          "   Promote google-ads-syl@gtm-services-prod.iam." +
          "gserviceaccount.com to\n" +
          "   Standard role: Google Ads → Tools & Settings → Access " +
          "and security."
      );
    }
    if (err.stack) console.error("\nStack:\n", err.stack);
  } else {
    console.error(err);
  }
  process.exit(1);
});
