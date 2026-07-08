import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyToken } from "@/lib/mcp-auth";
import { registerRsaTools } from "@/tools/rsa";
import { registerExperimentTools } from "@/tools/experiments";
import { registerAdLifecycleTools } from "@/tools/ad-lifecycle";
import { registerAdReadTools } from "@/tools/ad-read";
import { registerSearchTools } from "@/tools/search";
import { registerKeywordTools } from "@/tools/keywords";
import { registerCampaignTools } from "@/tools/campaign";
import { registerCampaignAdminTools } from "@/tools/campaign-admin";
import { registerAssetAndAdTools } from "@/tools/assets-ads";
import { registerConversionTools } from "@/tools/conversions";
import { registerReportingAndResearchTools } from "@/tools/reporting-research";
import { registerAccountAdminTools } from "@/tools/account-admin";
import { registerGenericAdminTools } from "@/tools/admin-generic";

const handler = createMcpHandler(
  (server) => {
    registerRsaTools(server);
    registerExperimentTools(server);
    registerAdLifecycleTools(server);
    registerAdReadTools(server);
    registerSearchTools(server);
    registerKeywordTools(server);
    registerCampaignTools(server);
    registerCampaignAdminTools(server);
    registerAssetAndAdTools(server);
    registerConversionTools(server);
    registerReportingAndResearchTools(server);
    registerAccountAdminTools(server);
    registerGenericAdminTools(server);
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
