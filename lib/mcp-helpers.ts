export function mcpText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export type McpJsonEnvelope = {
  ok: boolean;
  tool: string;
  customer_id?: string;
  validate_only?: boolean;
  resource_names?: string[];
  results?: unknown;
  warnings?: string[];
  errors?: string[];
  request_id?: string;
};

export function mcpJson(envelope: McpJsonEnvelope, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope, null, 2) }],
    ...(isError ? { isError: true as const } : {}),
  };
}

export function mcpSuccess(envelope: Omit<McpJsonEnvelope, "ok">) {
  return mcpJson({ ok: true, ...envelope });
}

/**
 * Format any thrown value into a human-readable error message.
 *
 * Handles three shapes:
 *   1. `Error` instances                → use `.message`
 *   2. `GoogleAdsFailure` (from google-ads-api)
 *      → extract `.errors[*].message` plus the matching `error_code` enum
 *      key for debuggability. GoogleAdsFailure is NOT an `instanceof Error`
 *      and has no `.message` property on the outer object — `String(err)`
 *      would just return `"[object Object]"`.
 *   3. Anything else                    → fall back to `String(err)` or JSON.
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;

  // GoogleAdsFailure shape: { errors: [{ error_code: {...}, message, location }], request_id }
  if (
    err !== null &&
    typeof err === "object" &&
    "errors" in err &&
    Array.isArray((err as { errors: unknown }).errors)
  ) {
    const gadsErr = err as {
      errors: Array<{
        error_code?: Record<string, string | number>;
        message?: string;
      }>;
      request_id?: string;
    };
    const parts = gadsErr.errors
      .map((e) => {
        // error_code is a oneof: exactly one key is set to the enum value.
        // e.g. { query_error: 'BAD_RESOURCE' } or { authentication_error: 2 }
        const codeEntries = e.error_code ? Object.entries(e.error_code) : [];
        const codeLabel =
          codeEntries.length > 0
            ? `[${codeEntries[0][0]}=${codeEntries[0][1]}] `
            : "";
        return `${codeLabel}${e.message ?? "(no message)"}`;
      })
      .filter(Boolean);
    if (parts.length > 0) {
      const suffix = gadsErr.request_id ? ` (request_id=${gadsErr.request_id})` : "";
      return parts.join("; ") + suffix;
    }
  }

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function mcpError(label: string, err: unknown) {
  return {
    content: [
      { type: "text" as const, text: `Error ${label}: ${formatError(err)}` },
    ],
    isError: true,
  };
}

export function mcpJsonError(
  tool: string,
  err: unknown,
  context: {
    customer_id?: string;
    validate_only?: boolean;
    warnings?: string[];
  } = {}
) {
  return mcpJson(
    {
      ok: false,
      tool,
      customer_id: context.customer_id,
      validate_only: context.validate_only,
      warnings: context.warnings,
      errors: [formatError(err)],
      request_id: extractErrorRequestId(err),
    },
    true
  );
}

function extractErrorRequestId(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const obj = err as { request_id?: unknown; requestId?: unknown };
  if (typeof obj.request_id === "string") return obj.request_id;
  if (typeof obj.requestId === "string") return obj.requestId;
  return undefined;
}
