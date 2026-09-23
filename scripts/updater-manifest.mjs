/**
 * 업데이터가 읽을 `latest.json` 을 만듭니다.
 *
 * node scripts/updater-manifest.mjs --tag v0.2.1
 *
 * # 왜 손으로 만드는가
 *
 * `softprops/action-gh-release` 는 이 파일을 만들어 주지 않습니다. `tauri-apps/tauri-action`
 * 은 만들어 주지만 **빌드를 자기가 돌립니다** — 그러면 이 저장소의 `scripts/tauri.mjs`
 * (VsDevCmd 로 MSVC 링커 잡기 · 판 덧씌움)를 건너뛰어 공개판이 제대로 안 나옵니다.
 * 그래서 빌드는 우리가 하고, 이 파일만 여기서 만들어 얹습니다.
 *
 * # 모양
 *
 * 플러그인이 읽는 칸은 정해져 있습니다(`tauri-plugin-updater` 의 `RemoteRelease`).
 * `version` 은 필수이고 semver 로 파싱됩니다. `pub_date` 는 **RFC3339 가 아니면 오류**라
 * 여기서 `toISOString()` 으로 만듭니다. 플랫폼 열쇠는 `<os>-<arch>` — 윈도우 64비트는
 * `windows-x86_64` 입니다.
 *
 * `signature` 는 번들러가 설치 파일 옆에 떨어뜨린 `.sig` 파일 **내용 그대로**입니다.
 * 서명이 없으면(서명 열쇠 없이 빌드하면) 업데이터가 받아도 **검증에서 거절**하므로,
 * 여기서 없으면 만들지 않고 큰 소리로 멈춥니다 — 조용히 넘어가면 「업데이트가 안 된다」
 * 는 보고만 남고 까닭을 못 찾습니다.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLayout,
  inside,
  readBuildManifest,
} from "./release-artifacts.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function fail(lines) {
  console.error("\n" + lines.join("\n") + "\n");
  process.exit(1);
}

const args = process.argv.slice(2);
const tagAt = args.indexOf("--tag");
const tag = tagAt >= 0 ? args[tagAt + 1] : process.env.GITHUB_REF_NAME;
if (!tag)
  fail([
    "태그를 알 수 없습니다.",
    "  쓰는 법: node scripts/updater-manifest.mjs --tag v0.2.1",
  ]);

const conf = JSON.parse(
  readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"),
);
const version = conf.version;
// 태그와 설정의 판이 어긋나면 업데이터가 **영영 «최신입니다»** 로 답합니다 —
// 사람은 새 판을 올렸다고 믿는데 아무도 못 받습니다.
if (tag.replace(/^v/, "") !== version) {
  fail([
    `태그와 판이 어긋납니다 — 태그 ${tag}, tauri.conf.json ${version}`,
    "  둘이 다르면 업데이터가 새 판을 못 알아봅니다. 한쪽을 맞춰 주세요.",
  ]);
}

// 같은 버전의 비공개 설치본이 옆에 있어도 이번 공개 빌드 명세의 파일만 고릅니다.
const layout = buildLayout(repoRoot, "public", process.env.CARGO_TARGET_DIR);
let built;
try {
  built = readBuildManifest(layout);
} catch (error) {
  fail([
    "공개판 빌드 명세를 확인하지 못했습니다.",
    String(error),
    "  먼저 build:public 으로 다시 빌드해 주세요.",
  ]);
}
const setup = layout.installer;
const setupPath = inside(layout.releaseDir, built.artifacts.installer.path);
const nsisDir = path.dirname(setupPath);

const sigName = `${setup}.sig`;
if (!existsSync(`${setupPath}.sig`)) {
  fail([
    `서명 파일이 없습니다: ${sigName}`,
    "  `bundle.createUpdaterArtifacts` 가 켜져 있고 서명 열쇠(TAURI_SIGNING_PRIVATE_KEY)가",
    "  빌드 때 주어졌는지 확인해 주세요. 서명이 없으면 업데이터가 받아도 거절합니다.",
  ]);
}
const signature = readFileSync(path.join(nsisDir, sigName), "utf8").trim();

const manifest = {
  version,
  // 릴리스 노트는 깃허브가 태그에서 만들어 붙입니다. 여기서는 어느 판인지만 적습니다.
  notes: `${tag} — 자세한 내용은 릴리스 쪽을 봐 주세요.`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/raonolje/AIMovieStorage/releases/download/${tag}/${setup}`,
    },
  },
};

const outDir = path.join(layout.releaseDir, "bundle", "updater");
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "latest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`latest.json 을 만들었습니다 — 판 ${version}`);
console.log(`  설치 파일: ${setup}`);
console.log(`  자리: ${outPath}`);
