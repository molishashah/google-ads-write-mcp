import {
  getArtifact,
  verifyArtifactToken,
  contentTypeFor,
} from "@/lib/artifact-store";

// Needs Node APIs (crypto, @vercel/blob streaming); never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────────────────
// GET /api/artifacts/:id?token=<signed>
//
// Streams the raw artifact bytes produced by `search_to_artifact`. This is
// the retrieval path for large query results: the bytes are downloaded
// here as an attachment, NOT returned through an MCP tool response, so the
// row data never re-enters the agent's context.
//
// Auth is a short-lived HMAC token (see signArtifactToken) carried in the
// query string — independent of the MCP bearer auth on /api/[transport].
// The artifact itself is stored as a private blob; only this route, with a
// valid token, can read it.
//
// gzip artifacts are served as application/gzip (a .gz download), so the
// downloaded bytes match artifact.sha256 exactly (no transparent decode).
// ──────────────────────────────────────────────────────────────────────

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token") ?? "";

  if (!verifyArtifactToken(id, token)) {
    return new Response("Forbidden: missing or expired artifact token.", {
      status: 403,
    });
  }

  const artifact = await getArtifact(id);
  if (!artifact) {
    return new Response("Artifact not found.", { status: 404 });
  }

  const { meta, payload } = artifact;
  return new Response(new Uint8Array(payload), {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(meta.compression),
      "Content-Length": String(meta.byte_size),
      "Content-Disposition": `attachment; filename="${meta.name}"`,
      "Cache-Control": "private, no-store",
      // Lets a downloader verify integrity without a second round trip.
      "X-Artifact-Sha256": meta.sha256,
    },
  });
}
