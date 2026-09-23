import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import editionRules from "../../../edition.json";
import {
  buildLayout,
  bundleResources,
  inside,
  readBuildManifest,
  stagePortable,
  writeBuildManifest,
} from "../../../scripts/release-artifacts.mjs";

const ROOT = resolve(__dirname, "../../..");
const SCRATCH = join(ROOT, "scratch");
const fixtures: string[] = [];
const put = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

function fixture() {
  mkdirSync(SCRATCH, { recursive: true });
  const root = mkdtempSync(join(SCRATCH, "release-fixture-"));
  fixtures.push(root);
  put(join(root, "edition.json"), JSON.stringify(editionRules));
  put(
    join(root, "src-tauri/tauri.conf.json"),
    JSON.stringify({
      productName: "TestMovie",
      version: "1.2.3",
      bundle: { resources: ["resources/local/engines/*.py"] },
    }),
  );
  put(join(root, "src-tauri/Cargo.toml"), '[[bin]]\nname = "TestMovie"\n');
  put(
    join(root, "src-tauri/resources/local/engines/seedvr2.py"),
    "허용 파일\n",
  );
  for (const id of editionRules.public.excludeEngines)
    put(
      join(root, `src-tauri/resources/local/engines/${id}.py`),
      "비공개 파일\n",
    );
  return root;
}

function built(root: string, edition = "public") {
  const layout = buildLayout(root, edition);
  put(join(layout.releaseDir, layout.executable), "실행 파일 시험 자료");
  // 이전 private 파일이 public 빌드 폴더에 남았다는 조건을 일부러 만듭니다.
  for (const resource of bundleResources(root, "private").kept) {
    put(
      join(layout.releaseDir, resource),
      readFileSync(join(root, "src-tauri", resource), "utf8"),
    );
  }
  put(
    join(layout.releaseDir, "bundle/nsis", layout.installer),
    "설치 파일 시험 자료",
  );
  put(
    join(layout.releaseDir, "bundle/portable", layout.portable),
    "압축 파일 시험 자료",
  );
  writeBuildManifest(layout, bundleResources(root, edition).kept);
  return layout;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    const checked = resolve(root);
    if (
      !checked.startsWith(resolve(SCRATCH) + sep) ||
      !relative(SCRATCH, checked).startsWith("release-fixture-")
    )
      throw new Error("시험 폴더 경계가 다릅니다.");
    rmSync(checked, { recursive: true, force: true });
  }
});

describe("배포 판과 실제 산출물", () => {
  it("같은 버전과 target 기준 폴더여도 판마다 빌드 폴더와 이름이 다릅니다", () => {
    const root = fixture();
    const privateBuild = buildLayout(root, "private");
    const publicBuild = buildLayout(root, "public");
    expect(privateBuild.targetDir).not.toBe(publicBuild.targetDir);
    expect(publicBuild.installer).toBe("TestMovie-Public_1.2.3_x64-setup.exe");
    expect(privateBuild.installer).toBe("TestMovie_1.2.3_x64-setup.exe");
    expect(() => buildLayout(root, "오타")).toThrow();
    expect(() =>
      inside(publicBuild.releaseDir, "../../private/secret"),
    ).toThrow();
  });

  it("공개 무설치본에 잔존 제외 파일을 옮기지 않고 원본 private 파일은 보존합니다", () => {
    const root = fixture();
    const layout = built(root);
    const stage = join(layout.releaseDir, "portable-stage-test");
    mkdirSync(stage);
    stagePortable(layout, stage);
    expect(existsSync(join(stage, "resources/local/engines/seedvr2.py"))).toBe(
      true,
    );
    for (const id of editionRules.public.excludeEngines) {
      expect(existsSync(join(stage, `resources/local/engines/${id}.py`))).toBe(
        false,
      );
      expect(
        existsSync(join(root, `src-tauri/resources/local/engines/${id}.py`)),
      ).toBe(true);
    }
    expect(bundleResources(root, "private").kept.length).toBe(
      editionRules.public.excludeEngines.length + 1,
    );
  });

  it("허용 리소스라도 소스와 다른 옛 파일이면 포장하지 않습니다", () => {
    const root = fixture();
    const layout = built(root);
    put(
      join(layout.releaseDir, "resources/local/engines/seedvr2.py"),
      "옛 파일",
    );
    const stage = join(layout.releaseDir, "portable-stage-test");
    mkdirSync(stage);
    expect(() => stagePortable(layout, stage)).toThrow("소스와 다릅니다");
  });

  it("명세를 만든 뒤 파일이나 판이 달라지면 배포를 막습니다", () => {
    const root = fixture();
    const layout = built(root);
    expect(readBuildManifest(layout).edition).toBe("public");
    const manifest = JSON.parse(readFileSync(layout.manifestPath, "utf8"));
    put(
      layout.manifestPath,
      JSON.stringify({ ...manifest, edition: "private" }),
    );
    expect(() => readBuildManifest(layout)).toThrow("판·버전");
    put(layout.manifestPath, JSON.stringify(manifest));
    put(
      join(layout.releaseDir, "bundle/nsis", layout.installer),
      "바뀐 설치 파일",
    );
    expect(() => readBuildManifest(layout)).toThrow("산출물이 바뀌었습니다");
  });

  it("실제 업데이터 스크립트가 같은 버전 private 파일을 두어도 public 명세만 읽습니다", () => {
    const root = fixture();
    const layout = built(root);
    for (const name of ["updater-manifest.mjs", "release-artifacts.mjs"]) {
      mkdirSync(join(root, "scripts"), { recursive: true });
      cpSync(join(ROOT, "scripts", name), join(root, "scripts", name));
    }
    const installerDir = join(layout.releaseDir, "bundle/nsis");
    put(join(installerDir, "TestMovie_1.2.3_x64-setup.exe"), "다른 판");
    put(
      join(installerDir, `${layout.installer}.sig`),
      "가짜 서명 시험 자료 — 실제 키가 아닙니다",
    );
    const env = { ...process.env };
    delete env.CARGO_TARGET_DIR;
    const run = spawnSync(
      process.execPath,
      [join(root, "scripts/updater-manifest.mjs"), "--tag", "v1.2.3"],
      { env, encoding: "utf8" },
    );
    expect(run.status, run.stderr).toBe(0);
    const latest = JSON.parse(
      readFileSync(
        join(layout.releaseDir, "bundle/updater/latest.json"),
        "utf8",
      ),
    );
    expect(latest.platforms["windows-x86_64"].url).toBe(
      `https://github.com/${["raon", "olje"].join("")}/AIMovieStorage/releases/download/v1.2.3/${layout.installer}`,
    );
    const mismatch = spawnSync(
      process.execPath,
      [join(root, "scripts/updater-manifest.mjs"), "--tag", "v9.9.9"],
      { env, encoding: "utf8" },
    );
    expect(mismatch.status).toBe(1);
  });
});

const EXPORT_SCRIPT = join(ROOT, "scripts/public-export.mjs");
describe.skipIf(!existsSync(EXPORT_SCRIPT))("실제 공개 소스 내보내기", () => {
  it("새 Git 시험 저장소에서 실행해 제외 파일·키·링크·라이선스와 원본 보존을 확인합니다", () => {
    const root = fixture();
    const source = join(root, "source");
    const out = join(root, "public");
    const account = ["raon", "olje"].join("");
    const link = `https://github.com/${account}/AIMovieStorage/releases`;
    put(
      join(source, "scripts/public-export.mjs"),
      readFileSync(EXPORT_SCRIPT, "utf8"),
    );
    put(join(source, "edition.json"), JSON.stringify(editionRules));
    put(join(source, "README.md"), `[받기](${link})\n`);
    const license = `MIT License\nCopyright (c) 2020–2026 ${account}\n기존 저작권 고지\n`;
    put(join(source, "LICENSE"), license);
    put(join(source, "test.key"), "시험용 가짜 값");
    put(join(source, ".env.local"), "시험용 가짜 값");
    put(
      join(source, "src-tauri/tauri.conf.json"),
      JSON.stringify({
        plugins: {
          updater: { endpoints: [`${link}/latest/download/latest.json`] },
        },
        bundle: { resources: [] },
      }),
    );
    for (const id of editionRules.public.excludeEngines)
      put(
        join(source, `src-tauri/resources/local/engines/${id}.py`),
        "비공개 파일",
      );
    put(
      join(source, "src-tauri/resources/local/engines/seedvr2.py"),
      "허용 파일",
    );
    execFileSync("git", ["init", "--quiet"], { cwd: source });
    execFileSync("git", ["add", "--all"], { cwd: source });
    const run = spawnSync(
      process.execPath,
      [join(source, "scripts/public-export.mjs"), "--out", out],
      { encoding: "utf8" },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(join(out, "README.md"), "utf8")).toContain(link);
    expect(readFileSync(join(out, "LICENSE"), "utf8")).toBe(license);
    expect(
      readFileSync(join(out, "src-tauri/tauri.conf.json"), "utf8"),
    ).toContain(`${link}/latest/download/latest.json`);
    expect(existsSync(join(out, "test.key"))).toBe(false);
    expect(existsSync(join(out, ".env.local"))).toBe(false);
    expect(existsSync(join(out, "scripts/public-export.mjs"))).toBe(false);
    for (const id of editionRules.public.excludeEngines) {
      expect(
        existsSync(join(out, `src-tauri/resources/local/engines/${id}.py`)),
      ).toBe(false);
      expect(
        existsSync(join(source, `src-tauri/resources/local/engines/${id}.py`)),
      ).toBe(true);
    }
    const again = spawnSync(
      process.execPath,
      [join(source, "scripts/public-export.mjs"), "--out", out],
      { encoding: "utf8" },
    );
    expect(again.status).toBe(1);
    expect(readFileSync(join(out, "LICENSE"), "utf8")).toBe(license);
  });
});
