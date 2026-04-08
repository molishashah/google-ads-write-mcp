/**
 * Tool-level smoke test for `get_ad`. Calls the actual tool
 * implementation (not just the underlying GAQL queries) so the
 * status / pinned_field normalisation paths are exercised end-to-end.
 *
 * Defaults: claude_code ad group under customer 9232939339.
 *
 * Run with:
 *   npx tsx scripts/smoke-test-get-ad-tool.ts \
 *     [customer_id] [ad_group_resource_name]
 */

import { loadEnvConfig } from "@next/env";
import { getAdImpl } from "../tools/ad-read";

loadEnvConfig(process.cwd());

// mcpText() returns {content} while mcpError() returns {content, isError}.
// The discriminated union is structural, so we widen here for the test.
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

async function main(): Promise<void> {
  const customerId = process.argv[2] ?? "9232939339";
  const adGroupResourceName =
    process.argv[3] ?? "customers/9232939339/adGroups/191506291605";

  console.log(
    `▶ get_ad TOOL smoke test\n` +
      `  customer:  ${customerId}\n` +
      `  ad_group:  ${adGroupResourceName}\n`
  );

  // Test 1: select_winning mode
  console.log("─── Test 1: select_winning mode ───");
  const result1: ToolResult = await getAdImpl({
    customer_id: customerId,
    ad_group_id: adGroupResourceName,
    select_winning: true,
  });
  if (result1.isError) {
    console.error("❌ tool returned error:");
    console.error(result1.content[0]?.text);
    process.exit(1);
  }
  const text1 = result1.content[0]?.text ?? "{}";
  const parsed1 = JSON.parse(text1);
  console.log(JSON.stringify(parsed1, null, 2).slice(0, 1500));
  console.log();

  // Sanity checks: status should be a STRING, not a number
  if (typeof parsed1.status !== "string") {
    console.error(
      `❌ status should be a string, got ${typeof parsed1.status}: ${parsed1.status}`
    );
    process.exit(1);
  }
  if (parsed1.status !== "ENABLED") {
    console.error(
      `❌ winning ad should be ENABLED, got: ${parsed1.status}`
    );
    process.exit(1);
  }
  if (!Array.isArray(parsed1.headlines) || parsed1.headlines.length < 3) {
    console.error(
      `❌ headlines should be an array of 3+, got: ${JSON.stringify(parsed1.headlines)}`
    );
    process.exit(1);
  }
  if (!Array.isArray(parsed1.descriptions) || parsed1.descriptions.length < 2) {
    console.error(
      `❌ descriptions should be an array of 2+, got: ${JSON.stringify(parsed1.descriptions)}`
    );
    process.exit(1);
  }
  // pinned_field should be null (not "UNSPECIFIED" and not a number)
  for (const h of parsed1.headlines) {
    if (h.pinned_field !== null && typeof h.pinned_field !== "string") {
      console.error(
        `❌ headline pinned_field should be null or string, got: ${h.pinned_field}`
      );
      process.exit(1);
    }
    if (h.pinned_field === "UNSPECIFIED" || h.pinned_field === "UNKNOWN") {
      console.error(
        `❌ pinned_field UNSPECIFIED/UNKNOWN should be normalised to null`
      );
      process.exit(1);
    }
  }
  console.log("✓ status normalised to string");
  console.log("✓ pinned_field normalised (null for UNSPECIFIED)");
  console.log("✓ headlines and descriptions populated");
  console.log();

  // Test 2: by exact ad_id (use the resource_name from test 1)
  console.log("─── Test 2: by exact ad_id ───");
  const result2: ToolResult = await getAdImpl({
    customer_id: customerId,
    ad_id: parsed1.resource_name,
  });
  if (result2.isError) {
    console.error("❌ tool returned error:");
    console.error(result2.content[0]?.text);
    process.exit(1);
  }
  const parsed2 = JSON.parse(result2.content[0]?.text ?? "{}");
  if (parsed2.resource_name !== parsed1.resource_name) {
    console.error("❌ resource_name mismatch between modes");
    process.exit(1);
  }
  console.log("✓ exact-id mode returned matching ad");
  console.log();

  // Test 3: error path — neither mode set
  console.log("─── Test 3: missing args returns error ───");
  const result3: ToolResult = await getAdImpl({ customer_id: customerId });
  if (!result3.isError) {
    console.error("❌ should have returned error");
    process.exit(1);
  }
  console.log(`✓ error returned: ${result3.content[0]?.text}`);
  console.log();

  console.log("✅ all get_ad tool smoke tests passed");
}

main().catch((err) => {
  console.error("❌ smoke test failed:", err);
  process.exit(1);
});
