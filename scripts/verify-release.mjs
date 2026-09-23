import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLayout,
  inside,
  readBuildManifest,
} from "./release-artifacts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const edition = process.env.FRAMEFORGE_EDITION || "public";
try {
  const layout = buildLayout(root, edition, process.env.CARGO_TARGET_DIR);
  const manifest = readBuildManifest(layout);
  const paths = {
    installer: inside(layout.releaseDir, manifest.artifacts.installer.path),
    portable: inside(layout.releaseDir, manifest.artifacts.portable.path),
    manifest: layout.manifestPath,
  };
  // Actions 도 글롭 대신 검증한 파일만 게시해야 캐시에 남은 옛 판이 따라가지 않습니다.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(paths)
        .map(([key, value]) => `${key}=${value.replaceAll("\\", "/")}\n`)
        .join(""),
    );
  }
  console.log(
    `${edition} ${manifest.version} — 산출물 이름·해시·리소스 확인 완료`,
  );
} catch (error) {
  console.error(`배포 검사가 실패했습니다: ${String(error)}`);
  process.exitCode = 1;
}
