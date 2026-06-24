import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import { mcpText, mcpError } from "@/lib/mcp-helpers";
import { buildGaqlQuery, gaqlInputShape } from "@/tools/search";
import { putArtifact, type Compression } from "@/lib/artifact-store";

export function registerSearchArtifactTools(server: McpServer) {
  registerSearchToArtifact(server);
}

// ──────────────────────────────────────────────────────────────────────
// search_to_artifact — run a GAQL read query, store the rows as a private
// JSON artifact, and return ONLY metadata to the agent.
//
// Same query inputs and GAQL construction as `search` (reused from
// tools/search.ts), but instead of returning the row array inline — which
// can be thousands of rows and floods the context window — the rows are
// serialised to a JSON array, persisted via the artifact store, and the
// tool returns id / size / checksum / row count only.
//
// Read-only with respect to Google Ads. Never returns or logs the raw
// row payload.
// ──────────────────────────────────────────────────────────────────────

const artifactInputShape = {
  ...gaqlInputShape,
  artifact_name: z
    .string()
    .optional()
    .describe(
      "Optional friendly name for the stored artifact (used as the " +
        "download filename). Defaults to 'search-<id>.json'."
    ),
  compression: z
    .enum(["none", "gzip"])
    .optional()
    .describe("Compression for the stored artifact. Defaults to 'none'."),
};

/** Widened result type matching mcpText()/mcpError() (see other smoke tests). */
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type SearchToArtifactParams = {
  customer_id: string;
  fields: string[];
  resource: string;
  conditions?: string[];
  orderings?: string[];
  limit?: number;
  artifact_name?: string;
  compression?: Compression;
};

/**
 * Standalone handler implementation, exported so smoke tests can call it
 * directly (mirrors getAdImpl in tools/ad-read.ts).
 */
export async function searchToArtifactImpl(
  params: SearchToArtifactParams
): Promise<ToolResult> {
  try {
    const customer = getAdsClient(params.customer_id);
    const query = buildGaqlQuery(params);

    // Collect all rows into an array. NOTE: we deliberately do NOT log
    // `rows` — only counts/sizes are ever emitted (see byte_size below).
    const rows = (await customer.query(query)) as unknown[];

    const artifact = await putArtifact(rows, {
      name: params.artifact_name,
      compression: params.compression,
    });

    // Metadata only — the row array is intentionally absent from the
    // response so it never enters the agent's context.
    return mcpText(
      JSON.stringify(
        {
          status: "ok",
          artifact: {
            id: artifact.id,
            name: artifact.name,
            mime_type: artifact.mime_type,
            compression: artifact.compression,
            byte_size: artifact.byte_size,
            sha256: artifact.sha256,
            row_count: artifact.row_count,
            ...(artifact.download_url
              ? { download_url: artifact.download_url }
              : {}),
          },
          // Echo back the query metadata so the agent has a record of
          // exactly what was materialised, without the rows themselves.
          query: {
            customer_id: params.customer_id,
            resource: params.resource,
            fields: params.fields,
            conditions: params.conditions ?? null,
            orderings: params.orderings ?? null,
            limit: params.limit ?? null,
          },
        },
        null,
        2
      )
    );
  } catch (err) {
    return mcpError("materialising search query to artifact", err);
  }
}

function registerSearchToArtifact(server: McpServer) {
  server.registerTool(
    "search_to_artifact",
    {
      title: "Search Google Ads → Artifact",
      description:
        "Run a GAQL read query and return only metadata. The full result " +
        "rows are stored as a JSON artifact for later download. Use this " +
        "instead of `search` when the result set is large (many rows / " +
        "wide field lists) so the row data does not flood the context " +
        "window. Inputs are identical to `search`, plus an optional " +
        "artifact_name and compression ('none' or 'gzip'). The response " +
        "contains the artifact id, size, sha256, row count, and a " +
        "short-lived download_url to fetch the bytes — never the rows.",
      inputSchema: artifactInputShape,
    },
    searchToArtifactImpl
  );
}
