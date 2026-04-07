function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value.trim();
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export const env = {
  // Base URL of this MCP server (no trailing slash)
  get BASE_URL() {
    return required("NEXT_PUBLIC_BASE_URL");
  },

  // ───────────────────────────────────────────────────────
  // Layer 1: Google Ads API access (service-account auth)
  //
  // The Google Ads API supports service-account auth provided the SA
  // is registered as a user on the target Google Ads account (or has
  // domain-wide delegation set up). This is the same model used by
  // the official Google googleads/google-ads-mcp Python server.
  //
  // Provide credentials in ONE of two ways:
  //   GOOGLE_APPLICATION_CREDENTIALS       — path to a service-account
  //                                          key JSON file (local dev)
  //   GOOGLE_APPLICATION_CREDENTIALS_JSON  — inline JSON content
  //                                          (Vercel / serverless)
  //
  // The runtime check that "at least one of the two is set" lives in
  // lib/ads-client.ts so the more actionable error message can include
  // the actual env var names being looked at.
  // ───────────────────────────────────────────────────────
  get GOOGLE_ADS_DEVELOPER_TOKEN() {
    return required("GOOGLE_ADS_DEVELOPER_TOKEN");
  },
  get GOOGLE_APPLICATION_CREDENTIALS() {
    return optional("GOOGLE_APPLICATION_CREDENTIALS");
  },
  get GOOGLE_APPLICATION_CREDENTIALS_JSON() {
    return optional("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  },
  get GOOGLE_ADS_LOGIN_CUSTOMER_ID() {
    return optional("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  },

  // ───────────────────────────────────────────────────────
  // Layer 2: Team member identity via Google OAuth
  // (mints the bearer JWT used by MCP clients; same OAuth
  //  client used to mint the Layer 1 refresh token, but
  //  the per-user OAuth here only verifies email + domain)
  // ───────────────────────────────────────────────────────
  get GOOGLE_CLIENT_ID() {
    return required("GOOGLE_CLIENT_ID");
  },
  get GOOGLE_CLIENT_SECRET() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get JWT_SECRET() {
    return required("JWT_SECRET");
  },
  get ALLOWED_DOMAIN() {
    return optional("ALLOWED_DOMAIN");
  },
};

// Internal MCP scope label (advertised in OAuth metadata
// and stamped on issued bearer tokens). Not a Google API scope.
const SCOPES = ["ads:write"] as const;
export const MCP_SCOPES = SCOPES;
export const MCP_SCOPES_STRING = SCOPES.join(" ");
