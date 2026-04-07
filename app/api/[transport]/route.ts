import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyToken } from "@/lib/mcp-auth";
import { registerRsaTools } from "@/tools/rsa";
import { registerExperimentTools } from "@/tools/experiments";

const handler = createMcpHandler(
  (server) => {
    registerRsaTools(server);
    registerExperimentTools(server);
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
