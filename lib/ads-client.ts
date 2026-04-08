import { GoogleAdsApi, type Customer } from "google-ads-api";
import { JWT } from "google-auth-library";
import { credentials as grpcCredentials, Metadata } from "@grpc/grpc-js";
import * as fs from "node:fs";
import { env } from "./env";

// ──────────────────────────────────────────────────────────────────────
// Google Ads API client factory (service-account auth)
//
// Why this file looks weird
// -------------------------
// The `google-ads-api` npm package is hardcoded to OAuth refresh-token
// auth (UserRefreshClient). It exposes no public API for service-account
// auth, even though the underlying gRPC layer is auth-agnostic.
//
// We work around this by constructing a Customer with placeholder
// refresh-token credentials, then monkey-patching the two private auth
// methods on the instance:
//
//   • getCredentials()  — used by every gRPC call (most operations).
//                         Synchronous; returns ChannelCredentials.
//   • getAccessToken()  — used by the rare REST calls (streaming).
//                         Async; returns a string bearer token.
//
// Both originally construct a `UserRefreshClient` from the env-var
// refresh token; we replace them with a `JWT` auth client backed by a
// service-account key file. From the library's perspective nothing
// changed; from gRPC's perspective the Authorization header is now
// signed with the SA's private key instead of a refresh token.
//
// This matches the auth model used by Google's official
// googleads/google-ads-mcp Python server, which uses
// google.auth.default() under the hood to pick up
// GOOGLE_APPLICATION_CREDENTIALS.
//
// If google-ads-api ever ships first-class SA support, delete the
// monkey-patch and pass the auth client through the official API.
// ──────────────────────────────────────────────────────────────────────

const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

// Cached SA-backed auth client. JWT construction is sync but the JSON
// parse + file read are not free, so we memoise across requests.
let cachedAuthClient: JWT | null = null;

export function getAuthClientForApi(): JWT {
  return getAuthClient();
}

function getAuthClient(): JWT {
  if (cachedAuthClient) return cachedAuthClient;

  let keyFileJson: string;
  if (env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    keyFileJson = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  } else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      keyFileJson = fs.readFileSync(
        env.GOOGLE_APPLICATION_CREDENTIALS,
        "utf8"
      );
    } catch (err) {
      throw new Error(
        `Failed to read GOOGLE_APPLICATION_CREDENTIALS at "${env.GOOGLE_APPLICATION_CREDENTIALS}": ${(err as Error).message}`
      );
    }
  } else {
    throw new Error(
      "Missing service account credentials. Set either " +
        "GOOGLE_APPLICATION_CREDENTIALS (path to a service-account JSON " +
        "file) for local dev, or GOOGLE_APPLICATION_CREDENTIALS_JSON " +
        "(inline JSON content) for Vercel / serverless deployments."
    );
  }

  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(keyFileJson);
  } catch (err) {
    throw new Error(
      `Service-account JSON is not valid JSON: ${(err as Error).message}`
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "Service-account JSON is missing required fields (client_email, private_key)."
    );
  }

  cachedAuthClient = new JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: [ADS_SCOPE],
  });

  return cachedAuthClient;
}

// Singleton GoogleAdsApi instance — uses placeholder client_id /
// client_secret since our patched auth methods don't read them.
// developer_token IS used by the gRPC interceptor on every call, so
// it must be the real token.
let adsApi: GoogleAdsApi | null = null;

export function getAdsApi() {
  return getApi();
}

export function getDeveloperToken(): string {
  return env.GOOGLE_ADS_DEVELOPER_TOKEN;
}

function getApi(): GoogleAdsApi {
  if (adsApi) return adsApi;
  adsApi = new GoogleAdsApi({
    client_id: "unused-by-service-account-auth",
    client_secret: "unused-by-service-account-auth",
    developer_token: env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });
  return adsApi;
}

/**
 * Returns a `Customer` handle authenticated via the configured service
 * account, scoped to the given Google Ads customer ID.
 *
 * @param customerId  Target account CID (no hyphens).
 *                    Example: "9232939339".
 */
export function getAdsClient(customerId: string): Customer {
  const customer = getApi().Customer({
    customer_id: customerId,
    // Unique-per-customer placeholder so the library's internal service
    // cache (keyed by client_id + refresh_token) doesn't collide across
    // customers. The value is never used for actual auth — patchAuth()
    // below replaces the methods that would have read it.
    refresh_token: `sa-${customerId}`,
    login_customer_id: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  });

  patchAuth(customer);
  return customer;
}

function patchAuth(customer: Customer): void {
  const authClient = getAuthClient();

  // ── gRPC path (used by virtually every write operation) ──────────
  // We CANNOT use grpc.credentials.createFromGoogleCredential(jwt)
  // here, even though JWT extends OAuth2Client. In google-auth-
  // library v9+, JWT.getRequestHeaders() returns a Web `Headers`
  // object, not a plain `{authorization: '...'}` POJO. Inside
  // grpc-js, createFromGoogleCredential does:
  //
  //     for (const key of Object.keys(headers)) { ... }
  //
  // ...which iterates an empty array on a Headers instance, so the
  // resulting gRPC metadata is empty, the request goes out with no
  // Authorization header, and the server returns:
  //
  //     16 UNAUTHENTICATED: Request is missing required authentication
  //     credential.
  //
  // Workaround: bypass createFromGoogleCredential entirely. Build the
  // call credentials with createFromMetadataGenerator and populate the
  // metadata ourselves from JWT.getAccessToken() (which still returns
  // a plain {token: string}). The JWT class caches and refreshes the
  // token internally, so this is no slower than the original path.
  (
    customer as unknown as { getCredentials: () => unknown }
  ).getCredentials = () => {
    const sslCreds = grpcCredentials.createSsl();
    const callCreds = grpcCredentials.createFromMetadataGenerator(
      (_options, callback) => {
        authClient.getAccessToken().then(
          (tokenResponse) => {
            if (!tokenResponse.token) {
              callback(
                new Error(
                  "Service account failed to mint Google Ads access token"
                )
              );
              return;
            }
            const metadata = new Metadata();
            metadata.add("authorization", `Bearer ${tokenResponse.token}`);
            callback(null, metadata);
          },
          (err: unknown) => {
            callback(err instanceof Error ? err : new Error(String(err)));
          }
        );
      }
    );
    return grpcCredentials.combineChannelCredentials(sslCreds, callCreds);
  };

  // ── REST path (streaming queries) ────────────────────────────────
  // Streaming uses getAccessToken() and reads the bearer string
  // directly into a request header, so the v9 Headers issue doesn't
  // affect it. We just need to return a string from the JWT.
  (
    customer as unknown as { getAccessToken: () => Promise<string> }
  ).getAccessToken = async () => {
    const tokenResponse = await authClient.getAccessToken();
    if (!tokenResponse.token) {
      throw new Error("Service account failed to mint Google Ads access token");
    }
    return tokenResponse.token;
  };
}
