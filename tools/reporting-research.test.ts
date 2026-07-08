import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import { buildGenerateKeywordIdeasRequest } from "./reporting-research";

describe("keyword planning helpers", () => {
  it("builds a keyword and URL seed request", () => {
    expect(
      buildGenerateKeywordIdeasRequest({
        customer_id: "123",
        keywords: ["crm software"],
        page_url: "https://example.com/crm",
        language_constant_id: "1000",
        geo_target_constant_ids: ["2840"],
        keyword_plan_network: "GOOGLE_SEARCH_AND_PARTNERS",
      })
    ).toEqual({
      customer_id: "123",
      language: "languageConstants/1000",
      geo_target_constants: ["geoTargetConstants/2840"],
      include_adult_keywords: false,
      keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH_AND_PARTNERS,
      keyword_and_url_seed: {
        keywords: ["crm software"],
        url: "https://example.com/crm",
      },
    });
  });

  it("preserves raw keyword idea requests", () => {
    expect(
      buildGenerateKeywordIdeasRequest({
        customer_id: "123",
        request: { keyword_seed: { keywords: ["ads"] } },
      })
    ).toEqual({
      customer_id: "123",
      keyword_seed: { keywords: ["ads"] },
    });
  });
});
