import { NextRequest, NextResponse } from "next/server";
import { getGoogleOAuthUrl } from "@/lib/mcp-auth";
import { pendingAuthStore, clientStore } from "@/lib/auth-store";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state") || "";
  const codeChallenge = params.get("code_challenge") || undefined;
  const codeChallengeMethod = params.get("code_challenge_method") || undefined;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "client_id and redirect_uri required" }, { status: 400 });
  }

  // Validate redirect_uri against registered client
  const client = clientStore.get(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return NextResponse.json({ error: "invalid_client or redirect_uri mismatch" }, { status: 400 });
  }

  // PKCE is required (OAuth 2.1)
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return NextResponse.json({ error: "code_challenge with S256 method is required" }, { status: 400 });
  }

  const encodedState = await pendingAuthStore.encode({
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  });

  const googleUrl = getGoogleOAuthUrl(encodedState);
  return NextResponse.redirect(googleUrl);
}
