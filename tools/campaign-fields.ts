import { enums } from "google-ads-api";

export function buildCampaignDateTimeFields(params: {
  start_date?: string;
  end_date?: string;
}) {
  return {
    ...(params.start_date
      ? { start_date_time: `${params.start_date} 00:00:00` }
      : {}),
    ...(params.end_date
      ? { end_date_time: `${params.end_date} 23:59:59` }
      : {}),
  };
}

export function buildFinalUrlExpansionAutomation(
  optOut: boolean | undefined
) {
  if (optOut == null) return {};

  return {
    asset_automation_settings: [
      {
        asset_automation_type:
          enums.AssetAutomationType
            .FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION,
        asset_automation_status: optOut
          ? enums.AssetAutomationStatus.OPTED_OUT
          : enums.AssetAutomationStatus.OPTED_IN,
      },
    ],
  };
}
