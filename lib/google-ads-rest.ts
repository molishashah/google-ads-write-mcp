import { getAuthClientForApi, getDeveloperToken } from "@/lib/ads-client";
import { env } from "@/lib/env";
import { googleAdsRestUrl } from "@/lib/google-ads-constants";

export async function googleAdsRestFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const authClient = getAuthClientForApi();
  const tokenResponse = await authClient.getAccessToken();
  if (!tokenResponse.token) {
    throw new Error("Failed to mint Google Ads API access token");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tokenResponse.token}`);
  headers.set("developer-token", getDeveloperToken());
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers.set("login-customer-id", env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(googleAdsRestUrl(path), {
    ...init,
    headers,
  });
  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new Error(
      `Google Ads API error (${response.status}): ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`
    );
  }

  return data as T;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
