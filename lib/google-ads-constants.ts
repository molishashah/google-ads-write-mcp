import {
  GENERATED_GOOGLE_ADS_API_VERSION,
  assertGoogleAdsVersionAlignment,
} from "./google-ads-version";

export const GOOGLE_ADS_API_VERSION = GENERATED_GOOGLE_ADS_API_VERSION;
export const GOOGLE_ADS_BASE_URL = "https://googleads.googleapis.com";

assertGoogleAdsVersionAlignment(GOOGLE_ADS_API_VERSION);

export function googleAdsRestUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${GOOGLE_ADS_BASE_URL}/${GOOGLE_ADS_API_VERSION}/${normalizedPath}`;
}
