import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildCampaignConversionGoalResourceName,
  buildCallConversion,
  buildConversionActionResource,
  buildConversionAdjustment,
  buildConversionCustomVariableResource,
  buildConversionValueRuleResource,
  buildCustomerConversionGoalResourceName,
} from "./conversions";

describe("conversion setup helpers", () => {
  it("builds a typed offline conversion action resource", () => {
    expect(
      buildConversionActionResource({
        name: "Qualified lead",
        type: "UPLOAD_CLICKS",
        category: "QUALIFIED_LEAD",
        default_value: 250,
        currency_code: "USD",
        click_through_lookback_window_days: 30,
      })
    ).toMatchObject({
      name: "Qualified lead",
      type: enums.ConversionActionType.UPLOAD_CLICKS,
      category: enums.ConversionActionCategory.QUALIFIED_LEAD,
      status: enums.ConversionActionStatus.ENABLED,
      include_in_conversions_metric: true,
      counting_type: enums.ConversionActionCountingType.ONE_PER_CLICK,
      primary_for_goal: true,
      value_settings: {
        default_value: 250,
        default_currency_code: "USD",
        always_use_default_value: false,
      },
      click_through_lookback_window_days: 30,
    });
  });

  it("builds customer and campaign conversion goal resource names", () => {
    expect(
      buildCustomerConversionGoalResourceName("123", "PURCHASE", "WEBSITE")
    ).toBe("customers/123/customerConversionGoals/PURCHASE~WEBSITE");

    expect(
      buildCustomerConversionGoalResourceName(
        "123",
        "QUALIFIED_LEAD",
        "WEBSITE"
      )
    ).toBe("customers/123/customerConversionGoals/QUALIFIED_LEAD~WEBSITE");

    expect(
      buildCampaignConversionGoalResourceName(
        "123",
        "customers/123/campaigns/456",
        "IMPORTED_LEAD",
        "WEBSITE"
      )
    ).toBe(
      "customers/123/campaignConversionGoals/456~IMPORTED_LEAD~WEBSITE"
    );
  });

  it("builds a typed conversion custom variable resource", () => {
    expect(
      buildConversionCustomVariableResource({
        name: "Lead score",
        tag: "lead_score",
        status: "ENABLED",
      })
    ).toEqual({
      name: "Lead score",
      tag: "lead_score",
      status: enums.ConversionCustomVariableStatus.ENABLED,
    });
  });

  it("builds a typed conversion value rule with common conditions", () => {
    expect(
      buildConversionValueRuleResource({
        customer_id: "123",
        operation: "MULTIPLY",
        value: 1.2,
        geo_target_constant_ids: ["2840"],
        geo_match_type: "LOCATION_OF_PRESENCE",
        device_types: ["MOBILE"],
        user_list_ids: ["555"],
        user_interest_ids: ["999"],
      })
    ).toMatchObject({
      action: {
        operation: enums.ValueRuleOperation.MULTIPLY,
        value: 1.2,
      },
      status: enums.ConversionValueRuleStatus.ENABLED,
      geo_location_condition: {
        geo_target_constants: ["geoTargetConstants/2840"],
        geo_match_type: enums.ValueRuleGeoLocationMatchType.LOCATION_OF_PRESENCE,
      },
      device_condition: {
        device_types: [enums.ValueRuleDeviceType.MOBILE],
      },
      audience_condition: {
        user_lists: ["customers/123/userLists/555"],
        user_interests: ["userInterests/999"],
      },
    });
  });

  it("builds a typed call conversion with custom values and consent", () => {
    expect(
      buildCallConversion("123", {
        conversion_action: "456",
        caller_id: "+14155550100",
        call_start_date_time: "2026-08-01 10:00:00-07:00",
        conversion_date_time: "2026-08-01 10:05:00-07:00",
        conversion_value: 100,
        currency_code: "USD",
        custom_variables: [
          { conversion_custom_variable: "789", value: "enterprise" },
        ],
        consent: { adUserData: "GRANTED" },
      })
    ).toMatchObject({
      conversion_action: "customers/123/conversionActions/456",
      caller_id: "+14155550100",
      conversion_value: 100,
      custom_variables: [
        {
          conversion_custom_variable:
            "customers/123/conversionCustomVariables/789",
          value: "enterprise",
        },
      ],
      consent: { ad_user_data: enums.ConsentStatus.GRANTED },
    });
  });

  it("builds typed conversion restatements", () => {
    expect(
      buildConversionAdjustment("123", {
        conversion_action: "456",
        adjustment_type: "RESTATEMENT",
        adjustment_date_time: "2026-08-02 10:00:00-07:00",
        order_id: "order-1",
        adjusted_value: 250,
        currency_code: "USD",
      })
    ).toEqual({
      conversion_action: "customers/123/conversionActions/456",
      adjustment_type: enums.ConversionAdjustmentType.RESTATEMENT,
      adjustment_date_time: "2026-08-02 10:00:00-07:00",
      order_id: "order-1",
      restatement_value: { adjusted_value: 250, currency_code: "USD" },
    });
  });

  it("requires a complete adjustment identifier", () => {
    expect(() =>
      buildConversionAdjustment("123", {
        conversion_action: "456",
        adjustment_type: "RETRACTION",
        adjustment_date_time: "2026-08-02 10:00:00-07:00",
      })
    ).toThrow("Provide order_id");
  });
});
