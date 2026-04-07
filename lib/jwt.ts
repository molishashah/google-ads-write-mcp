import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { env } from "./env";

let cachedSecret: Uint8Array | null = null;

export function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  cachedSecret = new TextEncoder().encode(env.JWT_SECRET);
  return cachedSecret;
}

export async function signJwt(
  payload: Record<string, unknown>,
  expiresIn?: string
): Promise<string> {
  const builder = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt();
  if (expiresIn) builder.setExpirationTime(expiresIn);
  return builder.sign(getSecret());
}

export async function verifyJwt(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}
