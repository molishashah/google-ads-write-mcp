import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyToken } from "@/lib/mcp-auth";

// Tool registrations are added in Phase 3. Keep this file in sync with
// tools/* as new ones land.
// import { registerRsaTools } from "@/tools/rsa";
// import { registerExperimentTools } from "@/tools/experiments";

const handler = createMcpHandler(
  (_server) => {
    // registerRsaTools(_server);
    // registerExperimentTools(_server);
  },
  {
    serverInfo: {
      name: "Google Ads Write",
      version: "2.0.0",
    },
  },
  {
    basePath: "/api",
    maxDuration: 60,
  }
);

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
