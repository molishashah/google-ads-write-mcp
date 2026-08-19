import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildGenerateAdGroupThemesRequest,
  buildGenerateKeywordForecastRequest,
  buildGenerateKeywordHistoricalMetricsRequest,
  buildGenerateKeywordIdeasRequest,
  normalizeAdGroupThemesResponse,
  normalizeKeywordForecastResponse,
  normalizeKeywordHistoricalMetricsResponse,
  normalizeKeywordIdeasResponse,
} from "./keyword-planner";

describe("Keyword Planner request builders", () => {
  it("builds an idea request with typed options", () => {
    expect(
      buildGenerateKeywordIdeasRequest({
        customer_id: "123",
        keywords: ["crm software"],
        page_url: "https://example.com/crm",
        language_constant_id: "1000",
        geo_target_constant_ids: ["2840"],
        include_keyword_concepts: true,
        include_device_aggregate_metrics: true,
        historical_metrics: {
          start: { year: 2025, month: "JANUARY" },
          end: { year: 2025, month: "MARCH" },
          include_average_cpc: true,
        },
        page_size: 100,
      })
    ).toEqual({
      customer_id: "123",
      language: "languageConstants/1000",
      geo_target_constants: ["geoTargetConstants/2840"],
      include_adult_keywords: false,
      keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
      keyword_annotation: [
        enums.KeywordPlanKeywordAnnotation.KEYWORD_CONCEPT,
      ],
      aggregate_metrics: {
        aggregate_metric_types: [
          enums.KeywordPlanAggregateMetricType.DEVICE,
        ],
      },
      historical_metrics_options: {
        year_month_range: {
          start: { year: 2025, month: enums.MonthOfYear.JANUARY },
          end: { year: 2025, month: enums.MonthOfYear.MARCH },
        },
        include_average_cpc: true,
      },
      page_size: 100,
      keyword_and_url_seed: {
        keywords: ["crm software"],
        url: "https://example.com/crm",
      },
    });
  });

  it("rejects mutually exclusive site and keyword seeds", () => {
    expect(() =>
      buildGenerateKeywordIdeasRequest({
        customer_id: "123",
        keywords: ["crm"],
        site_url: "https://example.com",
      })
    ).toThrow("site_url cannot be combined");
  });

  it("builds historical metrics targeting and options", () => {
    expect(
      buildGenerateKeywordHistoricalMetricsRequest({
        customer_id: "123",
        keywords: ["crm", "sales crm"],
        keyword_plan_network: "GOOGLE_SEARCH_AND_PARTNERS",
        historical_metrics: { include_average_cpc: true },
      })
    ).toEqual({
      customer_id: "123",
      keywords: ["crm", "sales crm"],
      include_adult_keywords: false,
      keyword_plan_network:
        enums.KeywordPlanNetwork.GOOGLE_SEARCH_AND_PARTNERS,
      historical_metrics_options: { include_average_cpc: true },
    });
  });

  it("builds a planless forecast campaign", () => {
    expect(
      buildGenerateKeywordForecastRequest(
        {
          customer_id: "123",
          language_constant_ids: ["1000"],
          geo_target_constant_ids: ["2840"],
          currency_code: "USD",
          forecast_period: {
            start_date: "2030-02-01",
            end_date: "2030-02-28",
          },
          bidding_strategy: {
            type: "MANUAL_CPC",
            max_cpc_bid_micros: 1_500_000,
            daily_budget_micros: 20_000_000,
          },
          ad_groups: [
            {
              keywords: [
                { text: "crm software", match_type: "PHRASE" },
              ],
            },
          ],
        },
        new Date("2030-01-01T00:00:00Z")
      )
    ).toEqual({
      customer_id: "123",
      currency_code: "USD",
      forecast_period: {
        start_date: "2030-02-01",
        end_date: "2030-02-28",
      },
      campaign: {
        language_constants: ["languageConstants/1000"],
        geo_target_constants: ["geoTargetConstants/2840"],
        bidding_strategy: {
          manual_cpc_bidding_strategy: {
            max_cpc_bid_micros: 1_500_000,
            daily_budget_micros: 20_000_000,
          },
        },
        ad_groups: [
          {
            keywords: [
              {
                text: "crm software",
                match_type: enums.KeywordMatchType.PHRASE,
              },
            ],
          },
        ],
      },
    });
  });

  it("validates forecast dates", () => {
    expect(() =>
      buildGenerateKeywordForecastRequest(
        {
          customer_id: "123",
          forecast_period: {
            start_date: "2030-01-01",
            end_date: "2030-01-10",
          },
          bidding_strategy: {
            type: "MAXIMIZE_CLICKS",
            daily_target_spend_micros: 10_000_000,
          },
          ad_groups: [
            { keywords: [{ text: "crm", match_type: "BROAD" }] },
          ],
        },
        new Date("2030-01-01T00:00:00Z")
      )
    ).toThrow("start_date must be in the future");
  });

  it("normalizes ad group resource names", () => {
    expect(
      buildGenerateAdGroupThemesRequest({
        customer_id: "123",
        keywords: ["crm"],
        ad_group_ids: ["456", "customers/123/adGroups/789"],
      })
    ).toEqual({
      customer_id: "123",
      keywords: ["crm"],
      ad_groups: [
        "customers/123/adGroups/456",
        "customers/123/adGroups/789",
      ],
    });
  });
});

describe("Keyword Planner response normalization", () => {
  const metrics = {
    avg_monthly_searches: 1200,
    competition: enums.KeywordPlanCompetitionLevel.HIGH,
    competition_index: 85,
    low_top_of_page_bid_micros: 1_000_000,
    high_top_of_page_bid_micros: 3_500_000,
    average_cpc_micros: 2_000_000,
    monthly_search_volumes: [
      {
        year: 2025,
        month: enums.MonthOfYear.JANUARY,
        monthly_searches: 1100,
      },
    ],
  };

  it("normalizes idea pagination and historical metrics", () => {
    expect(
      normalizeKeywordIdeasResponse({
        total_size: 10,
        next_page_token: "next",
        results: [
          {
            text: "crm software",
            close_variants: ["crm tool"],
            keyword_idea_metrics: metrics,
          },
        ],
      })
    ).toMatchObject({
      item_count: 1,
      total_size: 10,
      next_page_token: "next",
      items: [
        {
          text: "crm software",
          close_variants: ["crm tool"],
          metrics: {
            competition: "HIGH",
            low_top_of_page_bid: 1,
            high_top_of_page_bid: 3.5,
            average_cpc: 2,
            monthly_search_volumes: [
              { year: 2025, month: "JANUARY", monthly_searches: 1100 },
            ],
          },
        },
      ],
    });
  });

  it("normalizes historical result close variants", () => {
    expect(
      normalizeKeywordHistoricalMetricsResponse({
        results: [
          { text: "crm", close_variants: ["crm app"], keyword_metrics: metrics },
        ],
      })
    ).toMatchObject({
      item_count: 1,
      items: [{ text: "crm", close_variants: ["crm app"] }],
    });
  });

  it("makes the campaign forecast scope and currency explicit", () => {
    expect(
      normalizeKeywordForecastResponse(
        {
          campaign_forecast_metrics: {
            clicks: 42.5,
            cost_micros: 25_000_000,
            average_cpc_micros: 500_000,
          },
        },
        "USD"
      )
    ).toEqual({
      scope: "CAMPAIGN",
      currency_code: "USD",
      metrics: {
        clicks: 42.5,
        conversions: null,
        average_cpc_micros: 500_000,
        average_cpc: 0.5,
        cost_micros: 25_000_000,
        cost: 25,
        average_cpa_micros: null,
        average_cpa: null,
      },
    });
  });

  it("normalizes theme match type labels", () => {
    expect(
      normalizeAdGroupThemesResponse({
        ad_group_keyword_suggestions: [
          {
            keyword_text: "crm",
            suggested_keyword_text: "crm software",
            suggested_match_type: enums.KeywordMatchType.PHRASE,
            suggested_ad_group: "customers/123/adGroups/456",
            suggested_campaign: "customers/123/campaigns/789",
          },
        ],
        unusable_ad_groups: [{ ad_group: "customers/123/adGroups/999" }],
      })
    ).toMatchObject({
      suggestion_count: 1,
      unusable_ad_group_count: 1,
      suggestions: [{ suggested_match_type: "PHRASE" }],
    });
  });
});
