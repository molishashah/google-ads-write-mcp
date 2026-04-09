/**
 * Generate a long-lived bearer token for header-based MCP auth.
 *
 * Usage:
 *   npx tsx scripts/generate-token.ts <email>
 *
 * Requires JWT_SECRET env var (reads from .env.local automatically).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { SignJWT } from "jose";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npx tsx scripts/generate-token.ts <email>");
  process.exit(1);
}

const secret = new TextEncoder().encode(process.env.JWT_SECRET);
async function main() {
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(secret);

  console.log("\nBearer token (valid 365 days):\n");
  console.log(token);
}

main();
