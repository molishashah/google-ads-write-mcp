export const GOOGLE_ADS_API_VERSION = "v24";
export const GOOGLE_ADS_BASE_URL = "https://googleads.googleapis.com";

export function googleAdsRestUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${GOOGLE_ADS_BASE_URL}/${GOOGLE_ADS_API_VERSION}/${normalizedPath}`;
}
