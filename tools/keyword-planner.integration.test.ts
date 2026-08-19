import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";

const runIntegration =
  process.env.RUN_GOOGLE_ADS_INTEGRATION === "1" &&
  process.env.RUN_KEYWORD_PLANNER_INTEGRATION === "1";
const customerId = process.env.GOOGLE_ADS_TEST_CUSTOMER_ID;
const adGroupId = process.env.GOOGLE_ADS_TEST_AD_GROUP_ID;

describe.skipIf(!runIntegration || !customerId)(
  "Keyword Planner integration smoke",
  () => {
    it("generates keyword ideas", async () => {
      const { getAdsClient } = await import("@/lib/ads-client");
      const customer = getAdsClient(customerId!);
      const result = await customer.keywordPlanIdeas.generateKeywordIdeas({
        customer_id: customerId!,
        keyword_seed: { keywords: ["running shoes"] },
        keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
      } as never);
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("generates historical metrics", async () => {
      const { getAdsClient } = await import("@/lib/ads-client");
      const customer = getAdsClient(customerId!);
      const result =
        await customer.keywordPlanIdeas.generateKeywordHistoricalMetrics({
          customer_id: customerId!,
          keywords: ["running shoes"],
          keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
        } as never);
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("generates a planless forecast", async () => {
      const { getAdsClient } = await import("@/lib/ads-client");
      const customer = getAdsClient(customerId!);
      const result =
        await customer.keywordPlanIdeas.generateKeywordForecastMetrics({
          customer_id: customerId!,
          campaign: {
            bidding_strategy: {
              manual_cpc_bidding_strategy: {
                max_cpc_bid_micros: 1_000_000,
              },
            },
            ad_groups: [
              {
                keywords: [
                  {
                    text: "running shoes",
                    match_type: enums.KeywordMatchType.PHRASE,
                  },
                ],
              },
            ],
          },
        } as never);
      expect(result.campaign_forecast_metrics).toBeDefined();
    });

    it.runIf(Boolean(adGroupId))(
      "generates ad group themes",
      async () => {
        const { getAdsClient } = await import("@/lib/ads-client");
        const customer = getAdsClient(customerId!);
        const resourceName = adGroupId!.startsWith("customers/")
          ? adGroupId!
          : `customers/${customerId}/adGroups/${adGroupId}`;
        const result = await customer.keywordPlanIdeas.generateAdGroupThemes({
          customer_id: customerId!,
          keywords: ["running shoes"],
          ad_groups: [resourceName],
        } as never);
        expect(Array.isArray(result.ad_group_keyword_suggestions)).toBe(true);
      }
    );
  }
);
