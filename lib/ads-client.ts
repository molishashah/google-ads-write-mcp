import { GoogleAdsApi, type Customer } from "google-ads-api";
import { env } from "./env";

// ──────────────────────────────────────────────────────────────────────
// Google Ads API client factory
//
// Uses a single shared refresh token (per-org, NOT per-user). The same
// Google OAuth 2.0 client that mints team-member identity JWTs is reused
// to mint a one-time refresh token scoped to
// `https://www.googleapis.com/auth/adwords`; that token is stored in
// GOOGLE_ADS_REFRESH_TOKEN and used for every Ads API call here.
//
// Per-customer authorization is enforced upstream by the Google Ads
// manager account (login_customer_id) and the MCC linking model, not by
// anything in this MCP server.
// ──────────────────────────────────────────────────────────────────────

let client: GoogleAdsApi | null = null;

function getClient(): GoogleAdsApi {
  if (client) return client;
  client = new GoogleAdsApi({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    developer_token: env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });
  return client;
}

/**
 * Returns a `Customer` handle for the given Google Ads customer ID.
 *
 * @param customerId  Target account CID (no hyphens).
 *                    Example: "9232939339".
 */
export function getAdsClient(customerId: string): Customer {
  return getClient().Customer({
    customer_id: customerId,
    refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
    login_customer_id: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  });
}
