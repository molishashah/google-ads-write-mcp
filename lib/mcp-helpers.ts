export function mcpText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function mcpError(label: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error ${label}: ${message}` }],
    isError: true,
  };
}
