/**
 * Local-only helper that mints a Layer 2 MCP JWT WITHOUT going
 * through the Google OAuth dance. The token is signed with the same
 * JWT_SECRET that the running dev server uses to verify, so it
 * passes withMcpAuth() at /api/[transport].
 *
 * Use this to test the MCP server locally with the MCP Inspector
 * (or curl) before you've set up real GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET. Pass the printed token as an Authorization:
 * Bearer header.
 *
 * NEVER use this for production. Anyone with JWT_SECRET can mint
 * tokens; in prod the only way to obtain a token must be a real
 * Google sign-in via /api/auth/authorize.
 *
 * Run with:
 *   npx tsx scripts/mint-jwt.ts [email]
 *
 * Defaults to dev@local.test if no email is given. The email field
 * is the only claim verifyToken cares about; isAllowedEmail()
 * returns true unconditionally when ALLOWED_DOMAIN is unset.
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

// Import AFTER env is loaded so the lazy env getters resolve.
import { signJwt } from "../lib/jwt";

async function main(): Promise<void> {
  const email = process.argv[2] ?? "dev@local.test";
  const token = await signJwt({ email }, "30d");

  console.log("──────────────────────────────────────────────────");
  console.log("MCP JWT minted for local testing");
  console.log("──────────────────────────────────────────────────");
  console.log(`email:  ${email}`);
  console.log(`expiry: 30 days`);
  console.log();
  console.log("Token (use as Bearer header):");
  console.log();
  console.log(token);
  console.log();
  console.log("──────────────────────────────────────────────────");
  console.log("Use it with MCP Inspector:");
  console.log();
  console.log("  npx @modelcontextprotocol/inspector");
  console.log();
  console.log("Then in the Inspector UI:");
  console.log("  Transport:    Streamable HTTP");
  console.log("  URL:          http://localhost:3000/api/mcp");
  console.log("  Auth header:  Authorization: Bearer <paste-token>");
  console.log();
  console.log("Or test with curl:");
  console.log();
  console.log(
    `  curl -H "Authorization: Bearer ${token.slice(0, 20)}..." \\\n` +
      `       -H "Accept: application/json, text/event-stream" \\\n` +
      `       -H "Content-Type: application/json" \\\n` +
      `       -X POST http://localhost:3000/api/mcp \\\n` +
      `       -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
  );
  console.log("──────────────────────────────────────────────────");
}

main().catch((err: unknown) => {
  console.error("Failed to mint JWT:", err);
  process.exit(1);
});
