/**
 * Smoke test for `search_to_artifact`, the artifact store (both backends),
 * and the /api/artifacts/[id] download route.
 *
 * Parts:
 *   A — Artifact store, FILESYSTEM backend (deterministic, no creds).
 *   B — Live `search_to_artifact` tool (requires Google Ads creds; skipped
 *       otherwise).
 *   C — Vercel Blob backend + download route (requires BLOB_READ_WRITE_TOKEN
 *       and JWT_SECRET; skipped otherwise). Verifies durable storage, that
 *       downloaded bytes match artifact.sha256, JSON-array shape, gzip
 *       round-trip, and short-lived token enforcement.
 *
 * Run with:
 *   npx tsx scripts/smoke-test-search-to-artifact.ts [customer_id]
 */

import { loadEnvConfig } from "@next/env";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";

loadEnvConfig(process.cwd());

// Parts A & B exercise the filesystem backend; isolate its output dir.
// (Set BEFORE importing the store, since the backend/dir are read at call
// time.) Part C overrides ARTIFACT_BACKEND to vercel_blob locally.
const TEST_DIR = path.join(os.tmpdir(), "gads-mcp-artifact-smoke");
process.env.ARTIFACT_DIR = TEST_DIR;
process.env.ARTIFACT_BACKEND = "filesystem";

import {
  buildArtifactPayload,
  putArtifact,
  getArtifact,
  deleteArtifact,
  decodeArtifactPayload,
  signArtifactToken,
  verifyArtifactToken,
} from "../lib/artifact-store";
import { searchToArtifactImpl } from "../tools/search-artifact";
import { GET as downloadArtifact } from "../app/api/artifacts/[id]/route";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

const sha256hex = (buf: Buffer) =>
  createHash("sha256").update(buf).digest("hex");

const SYNTHETIC_ROWS = [
  { campaign: { name: "Brand — Search" }, metrics: { impressions: 1234 } },
  { campaign: { name: "Competitor — Search" }, metrics: { impressions: 56 } },
  { campaign: { name: "Poseidon Launch" }, metrics: { impressions: 0 } },
];

const EXPECTED_JSON = JSON.stringify(SYNTHETIC_ROWS, null, 2);

async function callDownloadRoute(id: string, token: string): Promise<Response> {
  const url = `http://localhost/api/artifacts/${id}?token=${encodeURIComponent(token)}`;
  return downloadArtifact(new Request(url), {
    params: Promise.resolve({ id }),
  });
}

/**
 * Exercise the /api/artifacts/[id] route against whatever backend is
 * currently active: 200 + checksum + JSON shape on a valid token, 403 on
 * bad/expired tokens. Requires JWT_SECRET.
 */
async function verifyDownloadRoute(
  id: string,
  compression: "none" | "gzip",
  sha256: string
): Promise<void> {
  const res = await callDownloadRoute(id, signArtifactToken(id));
  assert(res.status === 200, `download expected 200, got ${res.status}`);
  const expectedType =
    compression === "gzip" ? "application/gzip" : "application/json";
  assert(
    res.headers.get("content-type") === expectedType,
    `wrong content-type: ${res.headers.get("content-type")}`
  );
  assert(
    res.headers.get("content-disposition")?.includes("attachment") === true,
    "download should be an attachment"
  );
  const downloaded = Buffer.from(await res.arrayBuffer());
  assert(sha256hex(downloaded) === sha256, "downloaded bytes != artifact.sha256");
  assert(
    decodeArtifactPayload(downloaded, compression) === EXPECTED_JSON,
    "downloaded content is not the expected JSON array shape"
  );

  const badRes = await callDownloadRoute(id, "garbage.token");
  assert(badRes.status === 403, "invalid token should be 403");
  const expiredRes = await callDownloadRoute(id, signArtifactToken(id, -10));
  assert(expiredRes.status === 403, "expired token should be 403");
}

async function testStore(): Promise<void> {
  console.log("─── Part A: artifact store (filesystem, deterministic) ───");

  for (const compression of ["none", "gzip"] as const) {
    console.log(`  · compression = ${compression}`);

    const meta = await putArtifact(SYNTHETIC_ROWS, {
      compression,
      artifact_name: "smoke fixture!.json",
    });

    assert(/^art_[a-f0-9]{32}$/.test(meta.id), `bad artifact id: ${meta.id}`);
    assert(meta.mime_type === "application/json", "mime_type should be JSON");
    assert(meta.compression === compression, "compression echoed wrong");
    assert(meta.row_count === SYNTHETIC_ROWS.length, "row_count wrong");
    assert(meta.byte_size > 0, "byte_size should be positive");
    assert(/^[a-f0-9]{64}$/.test(meta.sha256), "sha256 should be hex digest");
    assert(!/[^A-Za-z0-9._-]/.test(meta.name), `name not sanitised: ${meta.name}`);

    const fetched = await getArtifact(meta.id);
    assert(fetched !== null, "getArtifact returned null for a stored id");
    assert(fetched!.payload.byteLength === meta.byte_size, "byte_size mismatch");
    assert(sha256hex(fetched!.payload) === meta.sha256, "sha256 mismatch");

    const text = decodeArtifactPayload(fetched!.payload, compression);
    const parsed = JSON.parse(text);
    assert(Array.isArray(parsed), "artifact content is not a JSON array");
    assert(text === EXPECTED_JSON, "content does not match search output shape");

    // download_url should be a signed URL into our route.
    assert(
      typeof meta.download_url === "string" &&
        meta.download_url.includes(`/api/artifacts/${meta.id}?token=`),
      `download_url missing/malformed: ${meta.download_url}`
    );
    // The route streams bytes for the filesystem backend too.
    await verifyDownloadRoute(meta.id, compression, meta.sha256);
  }

  const built = buildArtifactPayload(SYNTHETIC_ROWS, "none");
  assert(built.row_count === SYNTHETIC_ROWS.length, "built row_count wrong");
  assert(built.payload.toString("utf8") === EXPECTED_JSON, "built payload wrong");

  assert((await getArtifact("../etc/passwd")) === null, "traversal id allowed");
  assert((await getArtifact("art_short")) === null, "malformed id allowed");

  console.log("✓ metadata-only contract, content shape, and checksum verified");
  console.log("✓ gzip round-trips to identical JSON");
  console.log("✓ path-traversal / malformed ids rejected");
  console.log();
}

function hasAdsCreds(): boolean {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  );
}

async function testLiveTool(customerId: string): Promise<void> {
  console.log("─── Part B: live search_to_artifact tool (filesystem) ───");

  if (!hasAdsCreds()) {
    console.log("⚠ skipping — no GOOGLE_APPLICATION_CREDENTIALS[_JSON] in env.\n");
    return;
  }

  const result: ToolResult = await searchToArtifactImpl({
    customer_id: customerId,
    resource: "campaign",
    fields: ["campaign.id", "campaign.name", "campaign.status"],
    limit: 50,
  });
  if (result.isError) fail(`tool returned error: ${result.content[0]?.text}`);

  const text = result.content[0]?.text ?? "{}";
  const parsed = JSON.parse(text);

  assert(parsed.status === "ok", "status should be 'ok'");
  assert(parsed.artifact?.id, "missing artifact.id");
  assert(typeof parsed.artifact.byte_size === "number", "missing byte_size");
  assert(typeof parsed.artifact.sha256 === "string", "missing sha256");
  assert(typeof parsed.artifact.row_count === "number", "missing row_count");
  assert(parsed.query?.resource === "campaign", "query metadata not echoed");
  assert(!("rows" in parsed), "response leaked a 'rows' field");
  assert(!Array.isArray(parsed.artifact), "artifact should be metadata object");
  assert(
    !text.includes('"resourceName"') && !text.includes('"resource_name"'),
    "response appears to contain raw row payload"
  );
  console.log(
    `✓ metadata only — ${parsed.artifact.row_count} rows, ${parsed.artifact.byte_size} bytes`
  );

  const fetched = await getArtifact(parsed.artifact.id);
  assert(fetched !== null, "stored artifact not retrievable");
  const rows = JSON.parse(
    decodeArtifactPayload(fetched!.payload, parsed.artifact.compression)
  );
  assert(Array.isArray(rows), "stored artifact is not a JSON array");
  assert(rows.length === parsed.artifact.row_count, "stored row_count mismatch");
  console.log("✓ stored artifact is a JSON array matching metadata");

  const errResult: ToolResult = await searchToArtifactImpl({
    customer_id: "not-a-real-id",
    resource: "campaign",
    fields: ["campaign.id"],
  });
  assert(errResult.isError === true, "invalid customer_id should set isError");
  console.log(`✓ invalid customer_id handled cleanly`);
  console.log();
}

async function testBlobBackend(): Promise<void> {
  console.log("─── Part C: Vercel Blob backend + download route ───");

  if (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.JWT_SECRET) {
    console.log(
      "⚠ skipping — needs BLOB_READ_WRITE_TOKEN and JWT_SECRET in env.\n"
    );
    return;
  }

  const prevBackend = process.env.ARTIFACT_BACKEND;
  process.env.ARTIFACT_BACKEND = "vercel_blob";
  const created: string[] = [];

  try {
    for (const compression of ["none", "gzip"] as const) {
      console.log(`  · compression = ${compression}`);

      const meta = await putArtifact(SYNTHETIC_ROWS, { compression });
      created.push(meta.id);

      // Durable read-back from Blob.
      const fetched = await getArtifact(meta.id);
      assert(fetched !== null, "blob artifact not durably retrievable");
      assert(sha256hex(fetched!.payload) === meta.sha256, "blob sha256 mismatch");
      assert(
        decodeArtifactPayload(fetched!.payload, compression) === EXPECTED_JSON,
        "blob content does not match search output shape"
      );

      // Download route streams raw bytes from durable storage.
      await verifyDownloadRoute(meta.id, compression, meta.sha256);

      console.log(
        `✓ durable store + download verified (${meta.byte_size} bytes, sha256 match)`
      );
    }

    // Token signing/verification unit checks.
    const id = "art_" + "0".repeat(32);
    assert(verifyArtifactToken(id, signArtifactToken(id)), "valid token rejected");
    assert(!verifyArtifactToken(id, "1.tampered"), "tampered token accepted");
    console.log("✓ short-lived token sign/verify correct");
    console.log();
  } finally {
    for (const id of created) await deleteArtifact(id);
    if (prevBackend === undefined) delete process.env.ARTIFACT_BACKEND;
    else process.env.ARTIFACT_BACKEND = prevBackend;
  }
}

async function main(): Promise<void> {
  const customerId = process.argv[2] ?? "9232939339";
  console.log("▶ search_to_artifact smoke test\n");

  try {
    await testStore();
    await testLiveTool(customerId);
    await testBlobBackend();
    console.log("✅ all search_to_artifact smoke tests passed");
  } finally {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("❌ smoke test failed:", err);
  process.exit(1);
});
