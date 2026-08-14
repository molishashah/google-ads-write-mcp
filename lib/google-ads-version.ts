import googleAdsPackage from "google-ads-api/package.json";
import { googleAdsVersion } from "google-ads-api/build/src/version";

export const GOOGLE_ADS_CLIENT_PACKAGE_VERSION = googleAdsPackage.version;
export const GENERATED_GOOGLE_ADS_API_VERSION = googleAdsVersion;
export const TARGET_GOOGLE_ADS_API_VERSION = "v25";

export type ApiMigrationStatus = "CURRENT" | "UPGRADE_AVAILABLE" | "VERSION_DRIFT";

export function getApiMigrationStatus(params: {
  generatedVersion?: string;
  restVersion?: string;
  targetVersion?: string;
} = {}): ApiMigrationStatus {
  const generatedVersion =
    params.generatedVersion ?? GENERATED_GOOGLE_ADS_API_VERSION;
  const restVersion = params.restVersion ?? GENERATED_GOOGLE_ADS_API_VERSION;
  const targetVersion = params.targetVersion ?? TARGET_GOOGLE_ADS_API_VERSION;
  if (generatedVersion !== restVersion) return "VERSION_DRIFT";
  return generatedVersion === targetVersion ? "CURRENT" : "UPGRADE_AVAILABLE";
}

export function assertGoogleAdsVersionAlignment(restVersion: string) {
  if (restVersion !== GENERATED_GOOGLE_ADS_API_VERSION) {
    throw new Error(
      `Google Ads client/REST version drift: generated client is ${GENERATED_GOOGLE_ADS_API_VERSION}, REST is ${restVersion}.`
    );
  }
}

export function getGoogleAdsApiCapabilities() {
  const migrationStatus = getApiMigrationStatus();
  return {
    client_package: "google-ads-api",
    client_package_version: GOOGLE_ADS_CLIENT_PACKAGE_VERSION,
    generated_api_version: GENERATED_GOOGLE_ADS_API_VERSION,
    target_api_version: TARGET_GOOGLE_ADS_API_VERSION,
    migration_status: migrationStatus,
    safe_to_enable_v25_fields: migrationStatus === "CURRENT",
    current_profile:
      GENERATED_GOOGLE_ADS_API_VERSION === "v24"
        ? "v24 protos with v24.1 additive client fields"
        : `${GENERATED_GOOGLE_ADS_API_VERSION} generated protos`,
    migration_gates:
      migrationStatus === "CURRENT"
        ? []
        : [
            {
              gate: "upstream_node_client",
              state: "WAITING",
              detail:
                "Install a google-ads-api release generated from Google Ads API v25 before mapping v25-only resources or fields.",
            },
            {
              gate: "service_account_auth_patch",
              state: "REVIEW_REQUIRED",
              detail:
                "Revalidate the private Customer authentication overrides after upgrading the client.",
            },
            {
              gate: "breaking_service_changes",
              state: "REVIEW_REQUIRED",
              detail:
                "Migrate lifecycle-goal services and other v25 removals before changing the generated API version.",
            },
          ],
    deferred_v25_workflows: [
      "unified new-customer acquisition and loyalty-retention goals",
      "YouTube third-party conversion attribution",
      "v25-only planning and reporting fields",
    ],
  };
}
