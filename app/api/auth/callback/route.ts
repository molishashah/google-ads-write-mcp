import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForEmail } from "@/lib/mcp-auth";
import { pendingAuthStore, authCodeStore } from "@/lib/auth-store";

function successPage(redirectUrl: string) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authenticated</title>
  <meta http-equiv="refresh" content="2;url=${redirectUrl.replace(/"/g, "&quot;")}">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fafafa; color: #111; }
    .card { text-align: center; padding: 3rem 2rem; max-width: 420px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #666; margin: 0.25rem 0; font-size: 0.95rem; line-height: 1.5; }
    .subtle { font-size: 0.8rem; color: #999; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>Authenticated</h1>
    <p>You can close this tab and return to your MCP client.</p>
    <p class="subtle">Redirecting automatically...</p>
  </div>
  <script>setTimeout(function(){window.location.href="${redirectUrl.replace(/"/g, '\\"')}"},1500)</script>
</body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

function errorPage(message: string) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authentication Failed</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fafafa; color: #111; }
    .card { text-align: center; padding: 3rem 2rem; max-width: 420px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #666; margin: 0.25rem 0; font-size: 0.95rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10007;</div>
    <h1>Authentication Failed</h1>
    <p>${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
    <p>Close this tab and try again from your MCP client.</p>
  </div>
</body>
</html>`,
    { status: 403, headers: { "Content-Type": "text/html" } }
  );
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const googleCode = params.get("code");
  const encodedState = params.get("state");
  const error = params.get("error");

  if (error) {
    return errorPage(`Google returned an error: ${error}`);
  }

  if (!googleCode || !encodedState) {
    return errorPage("Missing authorization code or state.");
  }

  const pending = await pendingAuthStore.decode(encodedState);
  if (!pending) {
    return errorPage("Session expired. Please try again.");
  }

  try {
    const email = await exchangeCodeForEmail(googleCode);

    const mcpCode = await authCodeStore.encode({
      email,
      code_challenge: pending.code_challenge,
      code_challenge_method: pending.code_challenge_method,
      redirect_uri: pending.redirect_uri,
    });

    const redirectUrl = new URL(pending.redirect_uri);
    redirectUrl.searchParams.set("code", mcpCode);
    if (pending.state) {
      redirectUrl.searchParams.set("state", pending.state);
    }

    return successPage(redirectUrl.toString());
  } catch {
    return errorPage("Access denied. Make sure you're using an allowed account.");
  }
}
