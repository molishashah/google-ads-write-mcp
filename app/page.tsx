export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "640px",
        margin: "0 auto",
      }}
    >
      <h1>Google Ads Write MCP</h1>
      <p>
        This is an MCP (Model Context Protocol) server for Google Ads write
        operations.
      </p>
      <p>
        The MCP endpoint is available at <code>/api/mcp</code>.
      </p>
    </main>
  );
}
