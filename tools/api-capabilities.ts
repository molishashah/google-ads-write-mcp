import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGoogleAdsApiCapabilities } from "@/lib/google-ads-version";
import { mcpSuccess } from "@/lib/mcp-helpers";

export function registerApiCapabilityTools(server: McpServer) {
  server.registerTool(
    "get_google_ads_api_capabilities",
    {
      title: "Get Google Ads API Capabilities",
      description:
        "Report the installed generated Google Ads API version, the target version, and concrete migration gates. Use this before attempting version-specific fields.",
      inputSchema: {},
    },
    async () =>
      mcpSuccess({
        tool: "get_google_ads_api_capabilities",
        results: getGoogleAdsApiCapabilities(),
      })
  );
}
