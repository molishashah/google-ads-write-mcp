import { describe, expect, it } from "vitest";
import {
  buildGaqlQuery,
  escapeGaql,
  extractRequestId,
  extractResourceNames,
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
});
