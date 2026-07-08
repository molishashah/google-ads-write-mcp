import { describe, expect, it } from "vitest";
import {
  buildGaqlQuery,
  escapeGaql,
  extractRequestId,
  extractResourceNames,
  summarizeMetricRows,
  quoteGaql,
  toResourceName,
} from "./google-ads-utils";
import { googleAdsRestUrl, GOOGLE_ADS_API_VERSION } from "./google-ads-constants";
import { mcpSuccess } from "./mcp-helpers";

describe("google ads helpers", () => {
  it("builds v24 REST URLs", () => {
    expect(GOOGLE_ADS_API_VERSION).toBe("v24");
    expect(googleAdsRestUrl("customers:listAccessibleCustomers")).toBe(
      "https://googleads.googleapis.com/v24/customers:listAccessibleCustomers"
    );
  });

  it("escapes GAQL string literals", () => {
    expect(escapeGaql("Bob's \\ query")).toBe("Bob\\'s \\\\ query");
    expect(quoteGaql("Bob's")).toBe("'Bob\\'s'");
  });

  it("builds structured GAQL", () => {
    expect(
      buildGaqlQuery({
        fields: ["campaign.name", "metrics.clicks"],
        resource: "campaign",
        conditions: ["campaign.status = ENABLED"],
        orderings: ["metrics.clicks DESC"],
        limit: 10,
      })
    ).toBe(
      "SELECT campaign.name, metrics.clicks FROM campaign WHERE campaign.status = ENABLED ORDER BY metrics.clicks DESC LIMIT 10"
    );
  });

  it("normalizes resource names", () => {
    expect(toResourceName("123", "campaigns", "456")).toBe(
      "customers/123/campaigns/456"
    );
    expect(toResourceName("123", "campaigns", "customers/1/campaigns/2")).toBe(
      "customers/1/campaigns/2"
    );
  });

  it("extracts resource names and request ids from nested responses", () => {
    const response = {
      request_id: "abc",
      results: [{ resource_name: "customers/1/campaigns/2" }],
      nested: { resourceName: "customers/1/adGroups/3" },
    };
    expect(extractRequestId(response)).toBe("abc");
    expect(extractResourceNames(response)).toEqual([
      "customers/1/campaigns/2",
      "customers/1/adGroups/3",
    ]);
  });

  it("returns structured MCP success JSON", () => {
    const response = mcpSuccess({
      tool: "example",
      customer_id: "123",
      results: { ok: true },
    });
    const text = response.content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      tool: "example",
      customer_id: "123",
      results: { ok: true },
    });
  });

  it("summarizes Google Ads metric rows", () => {
    expect(
      summarizeMetricRows([
        {
          metrics: {
            impressions: 100,
            clicks: 10,
            cost_micros: 2_500_000,
            conversions: 2,
            conversions_value: 20,
          },
        },
        {
          metrics: {
            impressions: "50",
            clicks: "5",
            cost_micros: "500000",
            conversions: "1",
            conversions_value: "5",
          },
        },
      ])
    ).toEqual({
      row_count: 2,
      totals: {
        impressions: 150,
        clicks: 15,
        cost_micros: 3_000_000,
        cost: 3,
        conversions: 3,
        conversions_value: 25,
      },
      derived: {
        ctr: 0.1,
        average_cpc: 0.2,
        conversion_rate: 0.2,
        cost_per_conversion: 1,
        conversion_value_per_cost: 25 / 3,
      },
    });
  });
});
