import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { signJwt, verifyJwt } from "./jwt";
import { env, MCP_SCOPES } from "./env";

export function isAllowedEmail(email: string): boolean {
  const domain = env.ALLOWED_DOMAIN;
  if (!domain) return true;
  return email.endsWith(`@${domain}`);
}

export async function issueToken(email: string): Promise<string> {
  return signJwt({ email }, "30d");
}

export async function verifyToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;

  const payload = await verifyJwt(bearerToken);
  if (!payload) return undefined;

  const email = payload.email as string;
  if (!isAllowedEmail(email)) return undefined;

  return {
    token: bearerToken,
    clientId: email,
    scopes: [...MCP_SCOPES],
    extra: { email },
  };
}

export function getGoogleOAuthUrl(state: string): string {
  const params: Record<string, string> = {
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.BASE_URL}/api/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "consent",
  };

  const domain = env.ALLOWED_DOMAIN;
  if (domain) params.hd = domain;

  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(params)}`;
}

export async function exchangeCodeForEmail(code: string): Promise<string> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.BASE_URL}/api/auth/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    throw new Error("Authentication failed");
  }

  const { access_token } = await tokenRes.json();

  const userRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  if (!userRes.ok) {
    throw new Error("Authentication failed");
  }

  const { email } = await userRes.json();

  if (!isAllowedEmail(email)) {
    throw new Error("Access denied");
  }

  return email;
}
