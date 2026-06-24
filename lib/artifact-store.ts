import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ──────────────────────────────────────────────────────────────────────
// Artifact store — durable server-side blob storage for large tool results
//
// Why this exists
// ---------------
// `search_to_artifact` runs a GAQL query that may return thousands of
// rows. Returning those rows in the MCP tool response floods the agent's
// context window. Instead we serialise the rows to a JSON array, persist
// the bytes here, and return only metadata (id, size, checksum, row
// count) plus a short-lived download_url to the agent.
//
// Backends
// --------
//   • vercel_blob — durable, production. Stores PRIVATE blobs on Vercel
//     Blob. This is the right backend for the deployed serverless app.
//   • filesystem  — local/dev fallback. Writes under ARTIFACT_DIR
//     (default <os.tmpdir()>/google-ads-mcp-artifacts). On Vercel only
//     /tmp is writable and it is ephemeral and per-instance, so this is
//     NOT durable in production — use it for local smoke tests only.
//
// Backend selection (selectedBackend()):
//   ARTIFACT_BACKEND=vercel_blob | filesystem  → explicit
//   otherwise: vercel_blob if BLOB_READ_WRITE_TOKEN is set, else filesystem
//
// Retrieval is via the token-protected /api/artifacts/[id] route, which
// streams raw bytes (never JSON through an MCP response). The download_url
// embeds a short-lived HMAC token signed with JWT_SECRET.
//
// This module never logs row contents: only counts/sizes/ids.
// ──────────────────────────────────────────────────────────────────────

export type Compression = "none" | "gzip";
export type ArtifactBackend = "filesystem" | "vercel_blob";

/** Metadata describing a stored artifact. Safe to return to the agent. */
export interface ArtifactMetadata {
  id: string;
  name: string;
  /** Logical content type of the (decompressed) payload. */
  mime_type: string;
  compression: Compression;
  /** Size in bytes of the STORED payload (after gzip, if applied). */
  byte_size: number;
  /** SHA-256 (hex) of the STORED payload — verifiable against a download. */
  sha256: string;
  /** Number of rows in the JSON array. */
  row_count: number;
  /** Short-lived signed URL to download the bytes. Present when configured. */
  download_url?: string;
}

const MIME_JSON = "application/json";
const MIME_GZIP = "application/gzip";

/** Transfer content-type for the STORED bytes (gzip stays a .gz download). */
export function contentTypeFor(compression: Compression): string {
  return compression === "gzip" ? MIME_GZIP : MIME_JSON;
}

/** Artifact ids are opaque and filename-safe; this regex gates path lookups. */
const ARTIFACT_ID_RE = /^art_[a-f0-9]{32}$/;

/** TTL for download URLs / signed tokens. Kept short — these are one-shot fetches. */
const DOWNLOAD_TOKEN_TTL_SEC = 15 * 60;

function artifactDir(): string {
  return (
    process.env.ARTIFACT_DIR?.trim() ||
    path.join(os.tmpdir(), "google-ads-mcp-artifacts")
  );
}

export function selectedBackend(): ArtifactBackend {
  const explicit = process.env.ARTIFACT_BACKEND?.trim().toLowerCase();
  if (explicit === "vercel_blob" || explicit === "blob") return "vercel_blob";
  if (explicit === "filesystem" || explicit === "fs") return "filesystem";
  // Auto: prefer durable Blob storage whenever credentials are present.
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel_blob" : "filesystem";
}

/** Vercel Blob access mode. Defaults to private; override only if your store lacks it. */
function blobAccess(): "public" | "private" {
  return process.env.ARTIFACT_BLOB_ACCESS?.trim() === "public"
    ? "public"
    : "private";
}

function sanitizeName(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  // Strip anything that isn't a tame filename character. The name is
  // echoed in metadata and used as the download filename; the id (not the
  // name) is the storage key, so this is cosmetic hardening.
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
  return cleaned.length > 0 ? cleaned : fallback;
}

// ── Download URL signing ────────────────────────────────────────────────

function hmac(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * Mint a short-lived signed token authorising download of one artifact id.
 * Format: `<expEpochSec>.<base64url hmac>`. Signed with JWT_SECRET.
 */
export function signArtifactToken(
  id: string,
  ttlSec: number = DOWNLOAD_TOKEN_TTL_SEC
): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required to sign artifact download URLs");
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${exp}.${hmac(`${id}:${exp}`, secret)}`;
}

/** Verify a download token for an id: correct signature AND not expired. */
export function verifyArtifactToken(id: string, token: string): boolean {
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) return false;

  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  const expected = hmac(`${id}:${exp}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function publicBaseUrl(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || undefined
  );
}

/** Build the short-lived signed download URL for an artifact, if possible. */
function buildDownloadUrl(id: string): string | undefined {
  const base = publicBaseUrl();
  if (!base) return undefined;
  let token: string;
  try {
    token = signArtifactToken(id);
  } catch {
    return undefined; // JWT_SECRET missing — return id only, no URL.
  }
  return `${base}/api/artifacts/${id}?token=${encodeURIComponent(token)}`;
}

// ── Payload construction (pure) ──────────────────────────────────────────

/**
 * Serialise rows to a JSON array and compute the artifact payload +
 * metadata WITHOUT persisting. Pure and deterministic.
 *
 * The serialisation (`JSON.stringify(rows, null, 2)`) matches the exact
 * output shape of the `search` tool, so artifact content is byte-identical
 * to what `search` would have returned inline.
 */
export function buildArtifactPayload(
  rows: unknown[],
  compression: Compression
): { payload: Buffer; sha256: string; byte_size: number; row_count: number } {
  const json = Buffer.from(JSON.stringify(rows, null, 2), "utf8");
  const payload = compression === "gzip" ? gzipSync(json) : json;
  const sha256 = createHash("sha256").update(payload).digest("hex");
  return {
    payload,
    sha256,
    byte_size: payload.byteLength,
    row_count: Array.isArray(rows) ? rows.length : 0,
  };
}

/** Decompress a stored payload back to its JSON text, honouring compression. */
export function decodeArtifactPayload(
  payload: Buffer,
  compression: Compression
): string {
  const json = compression === "gzip" ? gunzipSync(payload) : payload;
  return json.toString("utf8");
}

// ── Filesystem backend (local/dev fallback) ─────────────────────────────

async function persistFilesystem(
  meta: ArtifactMetadata,
  payload: Buffer
): Promise<void> {
  const dir = artifactDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, meta.id), payload);
  await fs.writeFile(
    path.join(dir, `${meta.id}.meta.json`),
    JSON.stringify(meta, null, 2),
    "utf8"
  );
}

async function readFilesystem(
  id: string
): Promise<{ meta: ArtifactMetadata; payload: Buffer } | null> {
  const dir = artifactDir();
  try {
    const metaRaw = await fs.readFile(
      path.join(dir, `${id}.meta.json`),
      "utf8"
    );
    const meta = JSON.parse(metaRaw) as ArtifactMetadata;
    const payload = await fs.readFile(path.join(dir, id));
    return { meta, payload };
  } catch {
    return null;
  }
}

// ── Vercel Blob backend (durable, production) ────────────────────────────

function blobKey(id: string): string {
  return `artifacts/${id}`;
}

async function streamToBuffer(
  stream: ReadableStream<Uint8Array>
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function persistBlob(
  meta: ArtifactMetadata,
  payload: Buffer
): Promise<void> {
  const { put } = await import("@vercel/blob");
  const access = blobAccess();
  // Deterministic pathnames keyed by id so retrieval needs no mapping;
  // allowOverwrite makes re-puts idempotent. Token is read from
  // BLOB_READ_WRITE_TOKEN in the environment.
  await put(blobKey(meta.id), payload, {
    access,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: contentTypeFor(meta.compression),
  });
  await put(`${blobKey(meta.id)}.meta.json`, Buffer.from(JSON.stringify(meta), "utf8"), {
    access,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: MIME_JSON,
  });
}

async function readBlob(
  id: string
): Promise<{ meta: ArtifactMetadata; payload: Buffer } | null> {
  const { get } = await import("@vercel/blob");
  const access = blobAccess();

  const metaRes = await get(`${blobKey(id)}.meta.json`, { access });
  if (!metaRes?.stream) return null;
  const meta = JSON.parse(
    (await streamToBuffer(metaRes.stream)).toString("utf8")
  ) as ArtifactMetadata;

  const payloadRes = await get(blobKey(id), { access });
  if (!payloadRes?.stream) return null;
  const payload = await streamToBuffer(payloadRes.stream);

  return { meta, payload };
}

// ── Public API (backend-dispatching) ─────────────────────────────────────

/**
 * Persist a rows array as a private artifact and return its metadata,
 * including a short-lived signed download_url when configured.
 */
export async function putArtifact(
  rows: unknown[],
  opts: { name?: string; compression?: Compression } = {}
): Promise<ArtifactMetadata> {
  const compression: Compression = opts.compression ?? "none";
  const { payload, sha256, byte_size, row_count } = buildArtifactPayload(
    rows,
    compression
  );

  const id = `art_${randomUUID().replace(/-/g, "")}`;
  const name = sanitizeName(
    opts.name,
    `search-${id}.json${compression === "gzip" ? ".gz" : ""}`
  );

  const meta: ArtifactMetadata = {
    id,
    name,
    mime_type: MIME_JSON,
    compression,
    byte_size,
    sha256,
    row_count,
  };

  if (selectedBackend() === "vercel_blob") {
    await persistBlob(meta, payload);
  } else {
    await persistFilesystem(meta, payload);
  }

  const download_url = buildDownloadUrl(id);
  if (download_url) meta.download_url = download_url;

  return meta;
}

/**
 * Fetch a previously stored artifact by id (payload still compressed if it
 * was gzipped). Returns null if the id is malformed or not found. Used by
 * the /api/artifacts/[id] download route — NOT exposed to the agent.
 */
export async function getArtifact(
  id: string
): Promise<{ meta: ArtifactMetadata; payload: Buffer } | null> {
  // Reject anything that isn't a well-formed id BEFORE any lookup —
  // prevents path traversal via crafted ids.
  if (!ARTIFACT_ID_RE.test(id)) return null;
  try {
    return selectedBackend() === "vercel_blob"
      ? await readBlob(id)
      : await readFilesystem(id);
  } catch {
    return null;
  }
}

/** Delete an artifact and its metadata sidecar. Best-effort; used by tests. */
export async function deleteArtifact(id: string): Promise<void> {
  if (!ARTIFACT_ID_RE.test(id)) return;
  if (selectedBackend() === "vercel_blob") {
    const { del } = await import("@vercel/blob");
    await del([blobKey(id), `${blobKey(id)}.meta.json`]).catch(() => {});
  } else {
    const dir = artifactDir();
    await fs.rm(path.join(dir, id), { force: true }).catch(() => {});
    await fs.rm(path.join(dir, `${id}.meta.json`), { force: true }).catch(() => {});
  }
}
