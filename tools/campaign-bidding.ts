import { enums, toMicros } from "google-ads-api";

export const TARGET_IMPRESSION_SHARE_LOCATIONS = [
  "ANYWHERE_ON_PAGE",
  "TOP_OF_PAGE",
  "ABSOLUTE_TOP_OF_PAGE",
] as const;

export type TargetImpressionShareLocation =
  (typeof TARGET_IMPRESSION_SHARE_LOCATIONS)[number];

export type SearchCampaignBiddingInput = {
  bidding_strategy?: "MAXIMIZE_CLICKS" | "TARGET_IMPRESSION_SHARE";
  cpc_bid_ceiling?: number;
  target_impression_share_location?: TargetImpressionShareLocation;
  target_impression_share_percentage?: number;
};

/**
 * Build the campaign-level Search bidding strategy used by typed create tools.
 * Omitting bidding_strategy intentionally preserves the existing Maximize Clicks
 * default.
 */
export function buildSearchCampaignBiddingStrategy(
  params: SearchCampaignBiddingInput
) {
  const strategy = params.bidding_strategy ?? "MAXIMIZE_CLICKS";

  if (strategy !== "TARGET_IMPRESSION_SHARE") {
    if (params.target_impression_share_location != null) {
      throw new Error(
        "target_impression_share_location is only valid when bidding_strategy is TARGET_IMPRESSION_SHARE"
      );
    }
    if (params.target_impression_share_percentage != null) {
      throw new Error(
        "target_impression_share_percentage is only valid when bidding_strategy is TARGET_IMPRESSION_SHARE"
      );
    }
    return {
      target_spend:
        params.cpc_bid_ceiling != null
          ? { cpc_bid_ceiling_micros: toMicros(params.cpc_bid_ceiling) }
          : {},
    };
  }

  if (params.target_impression_share_location == null) {
    throw new Error(
      "target_impression_share_location is required when bidding_strategy is TARGET_IMPRESSION_SHARE"
    );
  }
  if (params.target_impression_share_percentage == null) {
    throw new Error(
      "target_impression_share_percentage is required when bidding_strategy is TARGET_IMPRESSION_SHARE"
    );
  }
  if (
    params.target_impression_share_percentage <= 0 ||
    params.target_impression_share_percentage > 100
  ) {
    throw new Error(
      "target_impression_share_percentage must be greater than 0 and at most 100"
    );
  }
  if (params.cpc_bid_ceiling == null) {
    throw new Error(
      "cpc_bid_ceiling is required when bidding_strategy is TARGET_IMPRESSION_SHARE"
    );
  }
  if (params.cpc_bid_ceiling <= 0) {
    throw new Error("cpc_bid_ceiling must be greater than 0");
  }

  return {
    target_impression_share: {
      location:
        enums.TargetImpressionShareLocation[
          params.target_impression_share_location
        ],
      // Google stores the fraction in micros: 1% = 10,000.
      location_fraction_micros: Math.round(
        params.target_impression_share_percentage * 10_000
      ),
      cpc_bid_ceiling_micros: toMicros(params.cpc_bid_ceiling),
    },
  };
}
