/** Build a macOS DMG with the same public/private engine split as Windows.
 * Run on macOS: node scripts/tauri-macos.mjs --edition public|private [--dry-run]
 * The unsigned result is a test build; public distribution needs Apple signing
 * and notarization. Never point a private build at the public updater feed.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLayout, bundleResources } from "./release-artifacts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const editionAt = args.indexOf("--edition");
const edition = editionAt < 0 ? "private" : args[editionAt + 1];
const dryRun = args.includes("--dry-run");
if (!["private", "public"].includes(edition) ||
    args.some((arg, index) => !["--edition", "--dry-run"].includes(arg) && index !== editionAt + 1)) {
  throw new Error("Usage: node scripts/tauri-macos.mjs --edition public|private [--dry-run]");
}
if (!dryRun && process.platform !== "darwin") {
  throw new Error("macOS DMG must be built on a Mac or a macOS CI runner.");
}

const layout = buildLayout(root, edition, process.env.CARGO_TARGET_DIR);
const overlayPath = path.join(layout.targetDir, "tauri-macos.conf.json");
const overlay = {
  productName: layout.productName,
  bundle: {
    targets: ["dmg"],
    createUpdaterArtifacts: Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY),
    ...(edition === "public" ? { resources: bundleResources(root, edition).kept } : {}),
  },
  ...(edition === "private" ? {
    plugins: { updater: { endpoints: [
      "https://자체 호스팅 Gitea/api/v4/projects/사용자%2Faistorage/repository/files/aimoviestorage-private-latest.json/raw?ref=main",
    ] } },
  } : {}),
};

if (dryRun) {
  console.log(JSON.stringify({ edition, overlay, targetDir: layout.targetDir }, null, 2));
  process.exit(0);
}
mkdirSync(layout.targetDir, { recursive: true });
writeFileSync(overlayPath, JSON.stringify(overlay, null, 2));
const env = { ...process.env, CARGO_TARGET_DIR: layout.targetDir };
delete env.FRAMEFORGE_EDITION;
delete env.VITE_EDITION;
if (edition === "public") {
  env.FRAMEFORGE_EDITION = "public";
  env.VITE_EDITION = "public";
}
const result = spawnSync("pnpm", ["exec", "tauri", "build", "--config", overlayPath], {
  cwd: root, env, stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
