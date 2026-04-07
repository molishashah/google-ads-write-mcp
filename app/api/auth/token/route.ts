import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { issueToken } from "@/lib/mcp-auth";
import { authCodeStore } from "@/lib/auth-store";
import { MCP_SCOPES_STRING } from "@/lib/env";

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  const params = contentType.includes("application/x-www-form-urlencoded")
    ? Object.fromEntries((await req.formData()).entries())
    : await req.json().catch(() => ({}));

  const code = params.code as string;
  const grantType = params.grant_type as string;
  const codeVerifier = params.code_verifier as string | undefined;
  const redirectUri = params.redirect_uri as string | undefined;

  if (grantType !== "authorization_code") {
    return NextResponse.json(
      { error: "unsupported_grant_type" },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json({ error: "invalid_request", error_description: "code is required" }, { status: 400 });
  }

  const stored = await authCodeStore.decode(code);
  if (!stored) {
    return NextResponse.json({ error: "invalid_grant", error_description: "Invalid or expired code" }, { status: 400 });
  }

  // Verify redirect_uri matches the one used during authorization (RFC 6749 Section 4.1.3)
  if (redirectUri && redirectUri !== stored.redirect_uri) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "redirect_uri mismatch" },
      { status: 400 }
    );
  }

  // PKCE verification is mandatory
  if (!stored.code_challenge || !codeVerifier) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "code_verifier required" },
      { status: 400 }
    );
  }

  const hash = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  if (hash !== stored.code_challenge) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "PKCE verification failed" },
      { status: 400 }
    );
  }

  const accessToken = await issueToken(stored.email);

  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    scope: MCP_SCOPES_STRING,
  });
}
