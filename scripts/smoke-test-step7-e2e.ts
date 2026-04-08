/**
 * End-to-end smoke test for Step 7 (Deploy) of the autoresearch-ads
 * daily cycle, exercising the FULL pipeline:
 *
 *   1. Fetch winning RSA via get_ad                    (new write-MCP tool)
 *   2. Apply normalised text-match swap                (new program.md rules)
 *   3. Validate new RSA via create_responsive_search_ad validate_only
 *   4. Validate pause of old ad via pause_ad validate_only
 *
 * The fixture uses a headline that we know is currently in the
 * winning (enabled, top-impression) RSA for the claude_code ad group,
 * so the match is guaranteed to succeed. We pick one of the current
 * enabled-ad headlines and propose a swap to a placeholder. The real
 * agent follows the same shape in cycle N+1.
 *
 * IMPORTANT — a cycle-2 proposal like "Free with Claude Code Sub" →
 * "Parallel Claude Code Agents" does NOT match any current winning
 * ad's headlines because that original lives in a now-paused ad. The
 * snapshot's asset signal can come from paused ads (which still hold
 * 30-day metrics), but Step 7 can only swap headlines in enabled
 * ads. See Finding #14 in the QA batch-fix list.
 *
 * If all four steps pass, Step 7 is reliable end-to-end for the
 * direct_swap path. No real mutations are made.
 */

import { loadEnvConfig } from "@next/env";
import { enums } from "google-ads-api";
import { getAdsClient } from "../lib/ads-client";
import { getAdImpl } from "../tools/ad-read";

loadEnvConfig(process.cwd());

const CUSTOMER_ID = "9232939339";
const AD_GROUP_ID = "customers/9232939339/adGroups/191506291605"; // claude_code
// Pick any headline from the current winning enabled RSA. "Claude Code
// in One Workspace" is one we verified earlier is present in ad
// 803604473915. The NEW headline is a clearly-marked placeholder.
const ORIGINAL_HEADLINE = "Claude Code in One Workspace";
const NEW_HEADLINE = "Claude Code Agents in Sync";

/** Normalise text for fuzzy matching. Mirrors the program.md Step 7.3 rules. */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[.,!?:;]+$/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-");
}

async function main(): Promise<void> {
  console.log("▶ Step 7 (Deploy) end-to-end smoke test");
  console.log(`  customer:   ${CUSTOMER_ID}`);
  console.log(`  ad_group:   ${AD_GROUP_ID}`);
  console.log(`  swap:       "${ORIGINAL_HEADLINE}" → "${NEW_HEADLINE}"\n`);

  // ── Step 1: fetch winning RSA via get_ad ────────────────────────
  console.log("1. get_ad → fetch winning RSA");
  const adResult = (await getAdImpl({
    customer_id: CUSTOMER_ID,
    ad_group_id: AD_GROUP_ID,
    select_winning: true,
  })) as { content: Array<{ text: string }>; isError?: boolean };

  if (adResult.isError) {
    console.error(`❌ get_ad failed: ${adResult.content[0]?.text}`);
    process.exit(1);
  }
  const baseAd = JSON.parse(adResult.content[0]?.text ?? "{}");
  console.log(`   ✓ resource_name: ${baseAd.resource_name}`);
  console.log(`   ✓ headlines: ${baseAd.headlines.length}, descriptions: ${baseAd.descriptions.length}`);
  console.log(`   ✓ final_urls: ${JSON.stringify(baseAd.final_urls)}\n`);

  // ── Step 2: apply normalised text-match swap ────────────────────
  console.log("2. normalised swap");
  const targetKey = normalize(ORIGINAL_HEADLINE);
  const matches = baseAd.headlines
    .map((h: { text: string }, idx: number) => ({ idx, key: normalize(h.text) }))
    .filter((h: { idx: number; key: string }) => h.key === targetKey);

  if (matches.length === 0) {
    console.error(`❌ no headline matched "${ORIGINAL_HEADLINE}" after normalization.`);
    console.error(`   base headlines:`);
    for (const h of baseAd.headlines) console.error(`     • ${h.text}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.log(`   ⚠️  ${matches.length} fuzzy matches; using first`);
  }

  const newHeadlines = baseAd.headlines.map((h: { text: string }) => h.text);
  newHeadlines[matches[0].idx] = NEW_HEADLINE;

  // Character-limit pre-check (matches program.md constraints)
  for (const h of newHeadlines) {
    if (h.length > 30) {
      console.error(`❌ headline over 30 chars: "${h}" (${h.length})`);
      process.exit(1);
    }
  }
  const newDescriptions = baseAd.descriptions.map((d: { text: string }) => d.text);
  for (const d of newDescriptions) {
    if (d.length > 90) {
      console.error(`❌ description over 90 chars: "${d}" (${d.length})`);
      process.exit(1);
    }
  }
  console.log(`   ✓ swapped headline at index ${matches[0].idx}`);
  console.log(`   ✓ all headlines ≤ 30 chars, all descriptions ≤ 90 chars\n`);

  // ── Step 3: create_responsive_search_ad validate_only ───────────
  console.log("3. create_responsive_search_ad validate_only=true");
  const customer = getAdsClient(CUSTOMER_ID);
  await customer.adGroupAds.create(
    [
      {
        ad_group: AD_GROUP_ID,
        status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          final_urls: [baseAd.final_urls[0]],
          responsive_search_ad: {
            headlines: newHeadlines.map((text: string) => ({ text })),
            descriptions: newDescriptions.map((text: string) => ({ text })),
          },
        },
      },
    ],
    { validate_only: true }
  );
  console.log(`   ✓ new RSA payload passed Google Ads validation\n`);

  // ── Step 4: pause_ad validate_only ──────────────────────────────
  console.log("4. pause_ad validate_only=true");
  await customer.adGroupAds.update(
    [
      {
        resource_name: baseAd.resource_name,
        status: enums.AdGroupAdStatus.PAUSED,
      },
    ],
    { validate_only: true }
  );
  console.log(`   ✓ pause of ${baseAd.resource_name} passed validation\n`);

  console.log("✅ Step 7 end-to-end smoke test PASSED");
  console.log("   Production pipeline is ready for the direct_swap path.");
}

main().catch((err) => {
  console.error("❌ Step 7 smoke test failed:", err);
  process.exit(1);
});
