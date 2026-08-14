import { describe, expect, it } from "vitest";
import {
  GENERATED_GOOGLE_ADS_API_VERSION,
  GOOGLE_ADS_CLIENT_PACKAGE_VERSION,
  TARGET_GOOGLE_ADS_API_VERSION,
  assertGoogleAdsVersionAlignment,
  getApiMigrationStatus,
  getGoogleAdsApiCapabilities,
} from "./google-ads-version";

describe("Google Ads API version readiness", () => {
  it("derives the REST version from the installed generated client", () => {
    expect(GENERATED_GOOGLE_ADS_API_VERSION).toBe("v24");
    expect(GOOGLE_ADS_CLIENT_PACKAGE_VERSION).toBe("24.1.0");
    expect(TARGET_GOOGLE_ADS_API_VERSION).toBe("v25");
    expect(getApiMigrationStatus()).toBe("UPGRADE_AVAILABLE");
  });

  it("detects unsafe REST/client drift", () => {
    expect(
      getApiMigrationStatus({
        generatedVersion: "v24",
        restVersion: "v25",
        targetVersion: "v25",
      })
    ).toBe("VERSION_DRIFT");
    expect(() => assertGoogleAdsVersionAlignment("v25")).toThrow(
      "client/REST version drift"
    );
  });

  it("reports the concrete v25 migration gates", () => {
    expect(getGoogleAdsApiCapabilities()).toMatchObject({
      generated_api_version: "v24",
      target_api_version: "v25",
      migration_status: "UPGRADE_AVAILABLE",
      safe_to_enable_v25_fields: false,
      migration_gates: expect.arrayContaining([
        expect.objectContaining({ gate: "upstream_node_client" }),
      ]),
    });
  });
});
