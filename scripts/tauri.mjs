/**
 * 어느 창에서든 Tauri 를 띄웁니다.
 *
 * node scripts/tauri.mjs dev|build [--edition private|public] [--dry-run] [--portable-only]
 *
 * # 왜 이 파일이 있는가
 *
 * 원래 스크립트는 한 줄짜리였습니다.
 *
 * call "%ProgramFiles(x86)%\...\VsDevCmd.bat" -arch=x64 && set PATH=%USERPROFILE%\.cargo\bin;%PATH% && tauri dev
 *
 * 여기에 함정이 둘 있습니다.
 *
 * **하나 — cmd 는 줄을 읽을 때 `%PATH%` 를 한 번에 펼칩니다.**
 * 그래서 세 번째 명령의 `%PATH%` 는 VsDevCmd 가 고치기 *전*의 값입니다.
 * 즉 VsDevCmd 가 앞에 붙여 놓은 MSVC 경로를 그 다음 줄이 도로 날려 버립니다.
 * VsDevCmd 배너는 멀쩡히 뜨는데 링커는 없는, 알아보기 힘든 상태가 됩니다.
 *
 * **둘 — Git Bash 안에는 `link` 라는 리눅스 도구가 있습니다.**
 * 하드링크를 만드는 coreutils 명령인데 MSVC 링커와 이름이 같습니다.
 * MSVC 가 PATH 에서 빠진 자리에 이게 대신 잡히면, 크레이트 600개를 다
 * 컴파일한 다음에야 «extra operand» 라는 엉뚱한 오류가 쏟아집니다.
 *
 * 그래서 여기서는 환경을 **이어 붙이지 않습니다.** VsDevCmd 를 돌린 뒤
 * 그 결과 환경을 통째로 읽어 와서, 그것을 자식 프로세스에 그대로 넘깁니다.
 * 어떤 창에서 시작했든 결과가 같습니다.
 *
 * # 판(edition) — 비공개 / 공개
 *
 *
 *
 * - `private`(기본) — 전체 엔진을 유지하고 `target/private` 에 빌드합니다.
 * - `public` — 저장소 뿌리 `edition.json` 의 제외 엔진을 번들에서 뺍니다. 세 군데가 같이 움직입니다.
 * 1. `VITE_EDITION=public` → 화면 목록에서 빠짐 (`client/src/lib/edition.ts`)
 * 2. `FRAMEFORGE_EDITION=public` → Rust 가 설치·실행을 거절 (`src-tauri/src/edition.rs`)
 * 3. `tauri build --config <덧씌움>` → 워커 스크립트·manifest 가 번들에서 빠짐 (여기)
 *
 * 3번이 이 파일의 몫입니다. tauri.conf.json 의 `bundle.resources` 는 `engines/*.py` 같은
 * 글롭인데, 글롭으로는 «이것만 빼고» 를 적을 수 없습니다. 그래서 글롭을 **실제 파일 목록으로
 * 펼친 뒤** 제외 엔진의 것을 걸러, 그 명시 목록을 `--config` 로 덧씌웁니다(Tauri 의 `--config`
 * 는 RFC 7396 병합이라 배열은 통째로 바뀝니다). 어느 파일이 빠지는지는 `--dry-run` 이
 * 빌드 없이 보여 줍니다 — 실제 빌드는 10분이 넘어서, 덧씌움을 확인할 길이 그것뿐입니다.
 *
 * 같은 덧씌움이 `productName` 에 «-Public» 을 붙입니다. NSIS 설치 파일 이름이
 * `<productName>_<version>_<arch>-setup.exe` 라서, 안 붙이면 두 판의 설치 파일이 이름 한 글자
 * 안 다릅니다 — 비공개판을 Releases 에 올리는 사고를 파일 이름으로는 못 알아챕니다.
 *
 * 1·2번의 환경 변수는 **결정한 판만** 심습니다. 부모 셸에 `FRAMEFORGE_EDITION=public` 이 남아
 * 있는 채로 `--edition private` 를 주면 인자가 이겨 비공개판으로 결정되지만, 자식(vite · cargo)은
 * 셸의 변수를 그대로 물려받아 화면·Rust 만 공개판이 되는 «섞인 판» 이 나옵니다. 그래서 물려받은
 * 판 변수를 먼저 지우고 나서 심습니다(`stripEditionKeys`).
 *
 * 제외 id 는 여기 적지 않습니다. `edition.json` 한 곳만 읽습니다.
 * 공개판은 `target/public` 에 빌드하고, 두 판 모두 정확한 파일 이름·해시를
 * `release/bundle/build-manifest.json` 에 남깁니다. 업데이트와 게시도 이 명세를 읽습니다.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLayout,
  bundleResources,
  inside,
  stagePortable,
  writeBuildManifest,
} from "./release-artifacts.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tauriDir = path.join(repoRoot, "src-tauri");

// ─────────────────────────────────────────────────────────────────────────────
// 인자
// ─────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const action = argv[0] === "build" ? "build" : "dev";
/** 환경 변수로도 받습니다 — CI 가 스크립트 인자를 못 고칠 때를 위해. 인자가 있으면 인자가 이깁니다. */
let edition = process.env.FRAMEFORGE_EDITION || "private";
let dryRun = false;
let portableOnly = false;

for (let i = 1; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--dry-run") dryRun = true;
  else if (arg === "--portable-only") portableOnly = true;
  else if (arg === "--edition") edition = argv[(i += 1)] ?? "";
  else if (arg.startsWith("--edition="))
    edition = arg.slice("--edition=".length);
  else if (arg === "dev" || arg === "build") {
    /* 첫 인자와 같은 것을 또 준 것 — 무시 */
  } else {
    fail([
      `모르는 인자입니다: ${arg}`,
      "",
      "  쓰는 법: node scripts/tauri.mjs dev|build [--edition private|public] [--dry-run] [--portable-only]",
    ]);
  }
}

if (edition !== "private" && edition !== "public") {
  fail([`판은 private 또는 public 입니다: ${edition}`]);
}
if (portableOnly && action !== "build") fail(["--portable-only는 build에서만 사용할 수 있습니다."]);

// ─────────────────────────────────────────────────────────────────────────────
// 판 — 제외 엔진과 번들 덧씌움
// ─────────────────────────────────────────────────────────────────────────────

const rules = JSON.parse(
  readFileSync(path.join(repoRoot, "edition.json"), "utf8"),
);
/** @type {string[]} */
const excluded = edition === "public" ? rules.public.excludeEngines : [];

/**
 * `tauri.conf.json` — 판 번호와 제품 이름이 여기 한 곳에 있습니다.
 *
 * `Cargo.toml` 에도 판이 있지만 Tauri 는 **설정 쪽을 씁니다**(설정에 있으면 그것이 이김).
 * 두 값이 어긋나 있던 적이 있어(Cargo 0.1.0 · 설정 0.2.0) 여기서 한 곳만 봅니다.
 */
const layout = buildLayout(repoRoot, edition, process.env.CARGO_TARGET_DIR);
const resources = bundleResources(repoRoot, edition);

/** 판 이름을 나르는 환경 변수 — 화면(vite)과 Rust(cargo)가 하나씩 읽습니다. 심는 것도 지우는 것도 이 목록입니다. */
const EDITION_KEYS = ["VITE_EDITION", "FRAMEFORGE_EDITION"];

/** 자식(vite · cargo)에 심을 환경. 비공개판은 **아무것도 안 심습니다** — 지금까지와 바이트 단위로 같아야 합니다. */
const editionEnv =
  edition === "public"
    ? Object.fromEntries(EDITION_KEYS.map((key) => [key, "public"]))
    : {};

/**
 * 부모 셸이 물려준 판 변수를 자식 환경에서 걷어냅니다. 지운 «이름=값» 을 돌려줍니다(dry-run 이 보여 줌).
 *
 * 왜: 비공개판은 «아무것도 안 심는» 판입니다. 그런데 셸에 `FRAMEFORGE_EDITION=public` 이 남아 있으면
 * (CI 의 `env:`, 또는 공개판을 한 번 만들고 그대로 둔 창) 안 심어도 자식이 그 값을 물려받아,
 * 인자로 정한 비공개판이 화면·Rust 에서는 공개판이 됩니다 — 번들에는 엔진이 다 있는데 화면에는
 * 없는 실행 파일. 결정한 판이 늘 이기려면 물려받은 값을 지우는 것이 곧 «안 심는 것» 이어야 합니다.
 * 윈도우는 변수 이름의 대소문자를 안 가려서(`frameforge_edition` 도 같은 변수) 소문자로 견줍니다.
 */
function stripEditionKeys(env) {
  const cleared = [];
  for (const key of Object.keys(env)) {
    if (!EDITION_KEYS.some((name) => name.toLowerCase() === key.toLowerCase()))
      continue;
    cleared.push(`${key}=${env[key]}`);
    delete env[key];
  }
  return cleared;
}

/** `tauri build` 에 붙일 인자와, 그 덧씌움 파일. 비공개판·dev 는 덧씌움이 없습니다. */
function tauriExtraArgs() {
  if (edition !== "public" || action !== "build")
    return { args: [], overlay: null, dropped: [] };
  const conf = JSON.parse(
    readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8"),
  );
  const { kept, dropped } = resources;
  /*
    productName 에 «-Public» 을 붙입니다 — 설치 파일 이름·설치 폴더·시작 메뉴가 전부 여기서 나와,
    어느 판을 받았고 어느 판이 깔려 있는지 이름만으로 보입니다. `identifier` 는 **그대로** 둡니다:
    앱 데이터 폴더(설정·받아 둔 엔진 가중치)가 그 이름이라, 바꾸면 한 컴퓨터에서 두 판이
    엔진을 두 벌 받게 됩니다.

    **이름은 전부 영문입니다.** 설치 폴더가 한글이면 파이썬 워커·CUDA 라이브러리가 경로를 못 읽는
    일이 생기고, 받는 사람이 한국어 윈도우를 쓴다는 보장도 없습니다. 화면에 뜨는 글은 그대로
    한국어(다국어)이고, 폴더와 파일 이름만 영문으로 둡니다.
  */
  const productName = layout.productName;
  const overlay = { productName, bundle: { resources: kept } };
  /* Tauri NSIS 번들러의 이름 규칙(`<productName>_<version>_<arch>-setup.exe`). release.yml 의 글롭
     `bundle/nsis/*.exe` 는 그대로 맞습니다. */
  const installerName = layout.installer;
  const overlayPath = path.join(layout.targetDir, "tauri-public.conf.json");
  if (!dryRun) {
    mkdirSync(layout.targetDir, { recursive: true });
    writeFileSync(overlayPath, JSON.stringify(overlay, null, 2));
  }
  // shell: true 로 띄우므로 경로에 공백이 있어도 되게 따옴표를 우리가 칩니다.
  return {
    args: ["--config", `"${overlayPath}"`],
    overlay,
    overlayPath,
    dropped,
    installerName,
  };
}

const extra = tauriExtraArgs();

console.log(
  edition === "public"
    ? `  판: 공개판(public) — 제외 엔진: ${excluded.join(", ")}`
    : "  판: 비공개판(private) — 엔진 전부",
);

if (dryRun) {
  console.log("");
  if (portableOnly) console.log("  [dry-run] 기존 빌드의 무설치본만 포장합니다. 컴파일·설치본·서명은 만들지 않습니다.");
  console.log(
    portableOnly
      ? "  [dry-run] 실행할 작업: 기존 실행 파일·리소스로 무설치본 및 빌드 명세 생성"
      : `  [dry-run] 실행할 명령: pnpm exec tauri ${[action, ...extra.args].join(" ")}`,
  );
  // 실제 실행과 같은 순서 — 물려받은 판 변수를 지운 뒤 결정한 판을 심습니다. 셸에 남은 값이 보이게.
  const inherited = stripEditionKeys({ ...process.env });
  console.log(
    `  [dry-run] 부모 셸에서 지우는 환경: ${inherited.length ? inherited.join(", ") : "(없음)"}`,
  );
  console.log(`  [dry-run] 빌드 폴더: ${layout.targetDir}`);
  console.log(
    `  [dry-run] 심을 환경: ${Object.keys(editionEnv).length ? JSON.stringify(editionEnv) : "(없음)"}`,
  );
  if (extra.overlay) {
    console.log(`  [dry-run] 설치 파일 이름: ${extra.installerName}`);
    console.log(`  [dry-run] 번들에서 빠지는 파일 ${extra.dropped.length}개:`);
    for (const file of extra.dropped) console.log(`    - ${file}`);
    console.log(`  [dry-run] 덧씌울 설정(${extra.overlayPath}):`);
    console.log(JSON.stringify(extra.overlay, null, 2));
  } else {
    console.log("  [dry-run] 덧씌움 없음 — tauri.conf.json 그대로");
  }
  process.exit(0);
}

// 설치본이 끝난 뒤 압축만 실패했다면 같은 바이너리·리소스로 복구합니다.
if (portableOnly) {
  if (process.platform !== "win32") fail(["기존 Windows 무설치본 포장은 Windows에서 실행해 주세요."]);
  if (!existsSync(path.join(layout.releaseDir, layout.executable))
    || !existsSync(path.join(layout.releaseDir, "bundle", "nsis", layout.installer))) {
    fail(["현재 판·버전의 실행 파일과 설치 파일을 먼저 빌드해 주세요."]);
  }
  try { packPortable(); } catch (error) { fail([String(error)]); }
  process.exit(0);
}

if (process.platform !== "win32") {
  // 맥·리눅스는 링커 사정이 없습니다. 물려받은 판 변수를 지우고 결정한 판만 심어 그대로 넘깁니다.
  const childEnv = { ...process.env };
  stripEditionKeys(childEnv);
  Object.assign(childEnv, editionEnv, { CARGO_TARGET_DIR: layout.targetDir });
  process.exit(
    spawnSync("pnpm", ["tauri", action, ...extra.args], {
      stdio: "inherit",
      shell: true,
      env: childEnv,
    }).status ?? 1,
  );
}

const programFilesX86 =
  process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
const programFiles = process.env.ProgramFiles || "C:\\Program Files";

/** Visual Studio 설치 위치를 찾습니다. 판이 여럿이라 넓게 훑습니다. */
function findVsDevCmd() {
  const vswhere = path.join(
    programFilesX86,
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );
  if (existsSync(vswhere)) {
    const found = spawnSync(
      vswhere,
      ["-latest", "-products", "*", "-property", "installationPath"],
      {
        encoding: "utf8",
      },
    );
    const root = (found.stdout || "").split(/\r?\n/)[0].trim();
    const candidate =
      root && path.join(root, "Common7", "Tools", "VsDevCmd.bat");
    if (candidate && existsSync(candidate)) return candidate;
  }

  for (const base of [programFilesX86, programFiles]) {
    for (const year of ["2022", "2019"]) {
      for (const edition of [
        "BuildTools",
        "Community",
        "Professional",
        "Enterprise",
      ]) {
        const candidate = path.join(
          base,
          "Microsoft Visual Studio",
          year,
          edition,
          "Common7",
          "Tools",
          "VsDevCmd.bat",
        );
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return "";
}

const vsDevCmd = findVsDevCmd();
if (!vsDevCmd) {
  fail([
    "Visual Studio 빌드 도구를 찾지 못했습니다.",
    "",
    "  Rust 로 윈도우 앱을 만들려면 MSVC 링커가 필요합니다.",
    "  Visual Studio Installer 에서 «C++ 빌드 도구» 를 설치해 주세요.",
  ]);
}
console.log(`  Visual Studio: ${vsDevCmd}`);

/**
 * VsDevCmd 를 돌린 **뒤의 환경**을 읽어 옵니다.
 *
 * `set` 이 출력한 `이름=값` 줄들을 그대로 받아 씁니다. 이어 붙이지 않으니
 * cmd 의 변수 펼치기 시점 문제에 걸리지 않습니다.
 */
function environmentAfterVsDevCmd() {
  // 인자를 배열로 넘기면 Node 가 안쪽 따옴표를 `\"` 로 바꿔 버리고,
  // cmd 는 그 표기를 모릅니다. 한 문자열로 주고 shell 에 맡깁니다.
  const result = spawnSync(`call "${vsDevCmd}" -arch=x64 >nul && set`, {
    encoding: "utf8",
    shell: true,
  });
  if (result.status !== 0 || !result.stdout) {
    if (result.stderr) console.error(result.stderr.trim());
    return null;
  }

  const env = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env.Path || env.PATH ? env : null;
}

const env = environmentAfterVsDevCmd();
if (!env) {
  fail(["VsDevCmd 를 돌리지 못했습니다.", "", `  ${vsDevCmd}`]);
}

// cmd 는 대소문자를 안 가리지만 Node 는 가립니다. 하나로 모읍니다.
const pathKey =
  Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
let entries = env[pathKey].split(";").filter(Boolean);

/**
 * Git Bash 의 `usr\bin` 을 PATH 에서 뺍니다.
 *
 * 거기 있는 `link`, `find`, `sort` 는 이름이 윈도우 도구와 겹칩니다.
 * 빌드 중에 하나라도 잘못 잡히면 원인을 찾기가 아주 어렵습니다.
 * 빌드에 필요한 것은 그 폴더에 없으니 빼도 아쉬울 게 없습니다.
 */
entries = entries.filter((entry) => !/\\Git\\usr\\bin\\?$/i.test(entry));

// cargo 는 앞쪽에 둡니다.
const cargoBin = path.join(process.env.USERPROFILE || "", ".cargo", "bin");
if (existsSync(cargoBin)) entries.unshift(cargoBin);

env[pathKey] = entries.join(";");

// 링커가 제대로 잡혔는지 **컴파일을 시작하기 전에** 확인합니다.
const linker = spawnSync("where", ["link"], { encoding: "utf8", env });
const found = (linker.stdout || "").split(/\r?\n/)[0].trim();
if (!found || /\\Git\\usr\\bin\\link\.exe$/i.test(found)) {
  fail([
    "Rust 링커가 잘못 잡혔습니다.",
    "",
    found ? `  지금 잡힌 것: ${found}` : "  link.exe 를 찾지 못했습니다.",
    "  MSVC 링커가 PATH 에 없습니다. Visual Studio 설치를 확인해 주세요.",
  ]);
}
console.log(`  링커 확인: ${found}`);

// 판 환경은 VsDevCmd 환경 위에 얹습니다 — VsDevCmd 가 이 이름을 쓸 일은 없지만, `set` 은 부모 셸의
// 변수까지 그대로 내놓으므로 물려받은 판 변수는 먼저 지웁니다(`stripEditionKeys` 의 까닭 참조).
stripEditionKeys(env);
Object.assign(env, editionEnv, { CARGO_TARGET_DIR: layout.targetDir });

const tauri = spawnSync("pnpm", ["exec", "tauri", action, ...extra.args], {
  stdio: "inherit",
  shell: true,
  env,
});
if (tauri.status === 0 && action === "build") {
  try {
    packPortable();
  } catch (error) {
    fail([String(error)]);
  }
}
process.exit(tauri.status ?? 1);

/**
 * **무설치본**을 한 벌 더 만듭니다 — 실행 파일과 리소스를 zip 으로 묶습니다.
 *
 * 설치본(NSIS)은 시작 메뉴·제거 항목을 만들지만, 「깔기 싫다」 는 사람도 있고 USB 에 넣어 다니는
 * 쓰임도 있습니다. 타우리에는 무설치 대상이 없어서 빌드가 끝난 뒤 우리가 묶습니다.
 *
 * 묶는 것은 둘뿐입니다 — 실행 파일과 그 옆의 `resources`(파이썬 워커·manifest). 타우리는 제품에서
 * 리소스를 **실행 파일 옆**에서 찾으므로 이 둘만 같이 있으면 그대로 돕니다. 모델 가중치는 어차피
 * 앱 데이터 폴더에 받으므로 들어가지 않습니다(설치본과 같습니다).
 *
 * 윈도 11 에는 WebView2 가 기본으로 있습니다. 없는 기계(옛 윈도 10)에서는 한 번 깔아야 하므로
 * 안내 파일을 함께 넣습니다.
 */
function packPortable() {
  const releaseDir = layout.releaseDir;
  // 공개·비공개가 같은 target 을 쓰지 않고, 남은 파일도 허용 목록에 없으면 옮기지 않습니다.
  const stage = mkdtempSync(path.join(releaseDir, "portable-stage-"));
  try {
    stagePortable(layout, stage, resources.kept);
    writeFileSync(
      path.join(stage, "읽어보세요.txt"),
      [
        "무설치본입니다 — 이 폴더를 원하는 자리에 두고 실행 파일을 켜면 됩니다.",
        "",
        "· 설정·프로젝트·모델 가중치는 이 폴더가 아니라 사용자 앱 데이터 폴더에 저장됩니다.",
        "  (설치본과 같은 자리라 두 판이 같은 자료를 봅니다.)",
        "· 화면이 하얗게만 나오면 WebView2 런타임이 없는 것입니다.",
        "  마이크로소프트에서 «WebView2 런타임» 을 받아 한 번 설치해 주세요(윈도 11 은 기본 탑재).",
        "· resources 폴더는 실행 파일 옆에 그대로 두어야 합니다 — 로컬 모델 워커가 거기 있습니다.",
        "",
      ].join("\r\n"),
      "utf8",
    );

    const outDir = path.join(releaseDir, "bundle", "portable");
    mkdirSync(outDir, { recursive: true });
    /*
    이름을 **설치 파일과 같은 모양**으로 답니다 — `<제품>_<판>_x64-portable.zip`.

    예전에는 실행 파일 이름을 따서 `frameforge_portable.zip` 이었습니다. 릴리스 목록에
    `AIMovieStorage-Public_0.2.0_x64-setup.exe` 와 나란히 놓이니 둘이 다른 앱처럼 보였고,
    판도 이름에 안 들어가 어느 판인지 몰랐습니다.
  */
    const zipName = layout.portable;
    const zipPath = path.join(outDir, zipName);
    const zipStage = mkdtempSync(path.join(outDir, "portable-zip-"));
    try {
      const temporaryZip = path.join(zipStage, zipName);
      // PS7의 PSModulePath가 PS5에 전달돼도 Archive 모듈을 불러오지 않습니다.
      // 경로는 코드에 끼우지 않아 한글·공백·작은따옴표·대괄호를 그대로 보존합니다.
      const command = [
        "$ErrorActionPreference = 'Stop'",
        "$null = [System.Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem')",
        "[System.IO.Compression.ZipFile]::CreateFromDirectory($env:AIMOVIE_ZIP_SOURCE, $env:AIMOVIE_ZIP_TARGET, [System.IO.Compression.CompressionLevel]::Optimal, $false, [System.Text.Encoding]::UTF8)",
      ].join("; ");
      const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const zipped = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], {
        stdio: "inherit", shell: false, windowsHide: true,
        env: { ...process.env, AIMOVIE_ZIP_SOURCE: stage, AIMOVIE_ZIP_TARGET: temporaryZip },
      });
      if (zipped.status !== 0) throw new Error("무설치본 압축에 실패했습니다.");
      // 새 ZIP 완성 전에는 이전 정상 산출물을 지우지 않습니다. 잠겼으면 교체를 실패시킵니다.
      renameSync(temporaryZip, zipPath);
    } finally {
      const checkedZipStage = inside(outDir, path.relative(outDir, zipStage));
      if (!path.basename(checkedZipStage).startsWith("portable-zip-")) throw new Error("압축 작업 폴더 이름이 다릅니다.");
      rmSync(checkedZipStage, { recursive: true, force: true });
    }
    writeBuildManifest(layout, resources.kept);
    console.log(`  무설치본: ${zipPath}`);
    console.log(`  빌드 명세: ${layout.manifestPath}`);
  } finally {
    // 이번 함수가 만든 작업 폴더만 정리합니다. 경계를 확인하기 전에 재귀 삭제하지 않습니다.
    const checkedStage = inside(releaseDir, path.relative(releaseDir, stage));
    if (!path.basename(checkedStage).startsWith("portable-stage-"))
      throw new Error("작업 폴더 이름이 다릅니다.");
    rmSync(checkedStage, { recursive: true, force: true });
  }
}

function fail(lines) {
  console.error("");
  console.error("  ✗ " + lines[0]);
  for (const line of lines.slice(1)) console.error(line ? "  " + line : "");
  console.error("");
  process.exit(1);
}
