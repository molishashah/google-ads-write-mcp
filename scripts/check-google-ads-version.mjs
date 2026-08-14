import googleAdsPackage from "google-ads-api/package.json" with { type: "json" };
import { googleAdsVersion } from "google-ads-api/build/src/version.js";

const targetVersion = "v25";
const current = googleAdsVersion === targetVersion;
const result = {
  package: `google-ads-api@${googleAdsPackage.version}`,
  generatedApiVersion: googleAdsVersion,
  targetApiVersion: targetVersion,
  status: current ? "CURRENT" : "UPGRADE_AVAILABLE",
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (process.argv.includes("--require-target") && !current) {
  process.stderr.write(
    `Target ${targetVersion} is not available in the installed generated client.\n`
  );
  process.exitCode = 1;
}
