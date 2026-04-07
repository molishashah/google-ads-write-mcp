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
  // Layer 1: Google Ads API access (single shared identity)
  // ───────────────────────────────────────────────────────
  get GOOGLE_ADS_DEVELOPER_TOKEN() {
    return required("GOOGLE_ADS_DEVELOPER_TOKEN");
  },
  get GOOGLE_ADS_REFRESH_TOKEN() {
    return required("GOOGLE_ADS_REFRESH_TOKEN");
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
