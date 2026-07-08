import { describe, expect, it } from "vitest";

const runIntegration = process.env.RUN_GOOGLE_ADS_INTEGRATION === "1";
const customerId = process.env.GOOGLE_ADS_TEST_CUSTOMER_ID;

describe.skipIf(!runIntegration)("Google Ads integration smoke", () => {
  it("lists accessible customers through v24 REST", async () => {
    const { googleAdsRestFetch } = await import("./google-ads-rest");
    const result = await googleAdsRestFetch<{ resourceNames?: string[] }>(
      "customers:listAccessibleCustomers"
    );
    expect(Array.isArray(result.resourceNames)).toBe(true);
  });

  it.runIf(Boolean(customerId))("runs a small GAQL query", async () => {
    const { getAdsClient } = await import("./ads-client");
    const customer = getAdsClient(customerId!);
    const rows = await customer.query(
      "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1"
    );
    expect(Array.isArray(rows)).toBe(true);
  });
});
