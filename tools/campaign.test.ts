import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import { buildCreateCampaignOperations } from "./campaign";

describe("buildCreateCampaignOperations", () => {
  it("creates an absolute-top Target Impression Share campaign", () => {
    const operations = buildCreateCampaignOperations(
      {
        customer_id: "123",
        name: "Brand Search",
        daily_budget: 50,
        bidding_strategy: "TARGET_IMPRESSION_SHARE",
        target_impression_share_location: "ABSOLUTE_TOP_OF_PAGE",
        target_impression_share_percentage: 90,
        cpc_bid_ceiling: 4.25,
      },
      "test"
    );

    expect(operations[0].resource).toMatchObject({
      name: "Brand Search — budget (test)",
      amount_micros: 50_000_000,
    });
    expect(operations[1].resource).toMatchObject({
      name: "Brand Search",
      target_impression_share: {
        location: enums.TargetImpressionShareLocation.ABSOLUTE_TOP_OF_PAGE,
        location_fraction_micros: 900_000,
        cpc_bid_ceiling_micros: 4_250_000,
      },
    });
    expect(operations[1].resource).not.toHaveProperty("target_spend");
  });

  it("preserves Maximize Clicks as the default", () => {
    const operations = buildCreateCampaignOperations({
      customer_id: "123",
      name: "Generic Search",
      daily_budget: 20,
      cpc_bid_ceiling: 2,
    });

    expect(operations[1].resource).toMatchObject({
      target_spend: { cpc_bid_ceiling_micros: 2_000_000 },
    });
    expect(operations[1].resource).not.toHaveProperty(
      "target_impression_share"
    );
  });
});
