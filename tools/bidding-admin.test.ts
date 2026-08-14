import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildPortfolioBiddingStrategy,
  buildSmartBiddingEvent,
} from "./bidding-admin";

describe("buildPortfolioBiddingStrategy", () => {
  it("builds a portfolio Target Impression Share strategy", () => {
    expect(
      buildPortfolioBiddingStrategy({
        name: "Brand coverage",
        strategy: "TARGET_IMPRESSION_SHARE",
        cpc_bid_ceiling: 5,
        target_impression_share_location: "ABSOLUTE_TOP_OF_PAGE",
        target_impression_share_percentage: 90,
      })
    ).toMatchObject({
      name: "Brand coverage",
      target_impression_share: {
        location: enums.TargetImpressionShareLocation.ABSOLUTE_TOP_OF_PAGE,
        location_fraction_micros: 900_000,
        cpc_bid_ceiling_micros: 5_000_000,
      },
    });
  });

  it("requires the target for target CPA", () => {
    expect(() =>
      buildPortfolioBiddingStrategy({ name: "CPA", strategy: "TARGET_CPA" })
    ).toThrow("target_cpa is required");
  });
});

describe("buildSmartBiddingEvent", () => {
  it("builds a campaign-scoped seasonality adjustment", () => {
    expect(
      buildSmartBiddingEvent({
        customer_id: "123",
        name: "Holiday sale",
        start_date_time: "2026-11-27 00:00:00",
        end_date_time: "2026-11-30 23:59:59",
        campaign_ids: ["456"],
        devices: ["MOBILE"],
        conversion_rate_modifier: 1.4,
      })
    ).toMatchObject({
      scope: enums.SeasonalityEventScope.CAMPAIGN,
      campaigns: ["customers/123/campaigns/456"],
      devices: [enums.Device.MOBILE],
      conversion_rate_modifier: 1.4,
    });
  });
});
