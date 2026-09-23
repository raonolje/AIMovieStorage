import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
  **자동 업데이트가 실제로 돌 모양인가** — 글로 셉니다.

  

  이 기능은 **조각이 하나만 빠져도 조용히 안 됩니다.** 서명 열쇠가 없으면 받아도 거절하고,
  `latest.json` 이 안 올라가면 영영 「최신입니다」 이고, 비공개판이 공개판 끝점을 보면
  모션캡처·업스케일 엔진이 통째로 사라집니다. 어느 쪽도 화면에는 아무 말이 안 나옵니다.
*/
const ROOT = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8");

const CONF = JSON.parse(read("src-tauri/tauri.conf.json"));
const LIB = read("src-tauri/src/lib.rs");
const CARGO = read("src-tauri/Cargo.toml");
const RELEASE = read(".github/workflows/release.yml");
const MANIFEST = read("scripts/updater-manifest.mjs");
const CAPS = JSON.parse(read("src-tauri/capabilities/default.json"));

describe("업데이터 설정", () => {
  it("산출물을 만들게 켜 두었습니다", () => {
    // 이게 꺼져 있으면 `.sig` 가 안 나오고, 서명 없는 업데이트는 거절당합니다.
    expect(CONF.bundle.createUpdaterArtifacts).toBe(true);
  });

  it("끝점이 https 입니다", () => {
    // 릴리스 빌드에서 https 가 아니면 플러그인이 `InsecureTransportProtocol` 로 막습니다.
    const endpoints: string[] = CONF.plugins.updater.endpoints;
    expect(endpoints.length).toBeGreaterThan(0);
    for (const url of endpoints) expect(url.startsWith("https://")).toBe(true);
  });

  it("공개 열쇠가 들어 있습니다", () => {
    // 없으면 플러그인이 설정을 못 읽어 **앱이 아예 안 뜹니다.**
    expect(typeof CONF.plugins.updater.pubkey).toBe("string");
    expect(CONF.plugins.updater.pubkey.length).toBeGreaterThan(50);
  });

  it("설치가 조용히 돕니다 — 사람이 «다음» 을 누를 일이 없게", () => {
    expect(CONF.plugins.updater.windows.installMode).toBe("passive");
  });

  it("권한이 열려 있습니다", () => {
    // 권한이 없으면 화면에서 `check()` 가 「허용되지 않음」 으로 막힙니다.
    expect(CAPS.permissions).toContain("updater:default");
    // 깔고 나서 앱을 다시 띄우는 것은 우리가 부릅니다 — NSIS 가 안 해 줍니다.
    expect(CAPS.permissions).toContain("process:allow-restart");
  });
});

describe("언제 보는가", () => {
  it("켤 때 봅니다 — 설정을 열어야 아는 건 「자동 감지」 가 아닙니다", () => {
    /*
       처음에는 설정 화면에만 두었는데
      그러면 설정을 열어야 알게 됩니다. 앱을 켤 때 한 번 봅니다.
    */
    const app = read("client/src/App.tsx");
    expect(app).toContain("checkForUpdate()");
  });

  it("없으면 아무 말도 안 합니다", () => {
    // 켤 때마다 「최신입니다」 가 뜨면 잔소리입니다.
    const app = read("client/src/App.tsx");
    expect(app).toContain("if (!alive || !found) return;");
  });

  it("말풍선이 저절로 사라지지 않습니다", () => {
    // 몇 초 만에 사라지면 자리를 비운 사이에 지나가 「감지가 안 된다」 가 됩니다.
    const app = read("client/src/App.tsx");
    expect(app).toContain("duration: Infinity");
  });
});

describe("판 가르기", () => {
  it("업데이터는 공개판에서만 등록됩니다", () => {
    /*
      끝점은 공개판 릴리스를 가리킵니다. 비공개판(내 PC용, 모션캡처·업스케일 엔진이 든 판)이
      그것을 받아 깔면 그 엔진들이 사라지거나, 이름이 달라 **엉뚱한 앱이 하나 더 생깁니다.*    */
    const setup = LIB.slice(LIB.indexOf(".setup(|app|"));
    const body = setup.slice(0, setup.indexOf("\n        })"));
    expect(body).toContain("edition::is_public()");
    expect(body).toContain("tauri_plugin_updater");
    // 등록 줄이 판 검사 **안쪽**에 있어야 합니다.
    expect(body.indexOf("is_public()")).toBeLessThan(
      body.indexOf("tauri_plugin_updater"),
    );
  });
});

describe("판 번호", () => {
  it("설정과 Cargo 가 같은 판입니다", () => {
    /*
      Tauri 는 설정 쪽을 쓰지만, 두 값이 어긋나 있으면 어느 것이 진짜인지 사람이 헷갈립니다
      (한때 Cargo 0.1.0 · 설정 0.2.0 이었습니다).
    */
    const cargo = /^version = "([^"]+)"/m.exec(CARGO)?.[1];
    expect(cargo).toBe(CONF.version);
  });

  it("만들 때 태그와 판이 어긋나면 멈춥니다", () => {
    // 어긋나면 업데이터가 영영 «최신입니다» 로 답합니다 — 올렸는데 아무도 못 받습니다.
    expect(MANIFEST).toContain("태그와 판이 어긋납니다");
  });
});

describe("릴리스 흐름", () => {
  it("빌드가 서명 열쇠를 받습니다", () => {
    expect(RELEASE).toContain("TAURI_SIGNING_PRIVATE_KEY");
    // 저장소에 박아 두면 안 됩니다 — 비밀값에서 와야 합니다.
    expect(RELEASE).toContain("secrets.TAURI_SIGNING_PRIVATE_KEY");
  });

  it("latest.json 을 만들어 릴리스에 올립니다", () => {
    expect(RELEASE).toContain("scripts/updater-manifest.mjs");
    expect(RELEASE).toContain("bundle/updater/latest.json");
  });

  it("이번 판의 설치 파일만 고릅니다", () => {
    /*
      `target/release/bundle/nsis` 에는 지난 판들이 그대로 쌓입니다. 그냥 첫 `-setup.exe`
      를 집으면 **옛 판을 새 판이라고 올립니다** — 받는 사람은 업데이트했는데 판이 그대로이거나
      오히려 내려갑니다. 실제로 시험 삼아 돌렸다가 0.1.0 을 집었습니다(2026-09-23).
    */
    expect(MANIFEST).toContain("readBuildManifest(layout)");
    expect(MANIFEST).toContain("const setup = layout.installer");
  });

  it("암호 변수를 빈 값이라도 줍니다", () => {
    /*
      열쇠는 암호를 안 걸어도 «빈 암호로 암호화» 되어 있습니다(`rsign encrypted secret key`).
      이 변수가 없으면 서명기가 암호를 물으며 **멈춥니다** — CI 에서는 아무도 답하지 않으니
      빌드가 그 자리에서 굳습니다(2026-09-23 실측: 손으로 돌린 서명이 그렇게 멈췄습니다).
    */
    expect(RELEASE).toContain("TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
  });

  it("서명이 없으면 만들지 않고 멈춥니다", () => {
    // 조용히 넘어가면 「업데이트가 안 된다」 는 보고만 남고 까닭을 못 찾습니다.
    expect(MANIFEST).toContain("서명 파일이 없습니다");
  });
});

describe("이름", () => {
  it("실행 파일이 제품 이름과 같습니다", () => {
    /*
       설치 폴더는 `AIMovieStorage`
      인데 실행 파일만 `frameforge.exe` 였고, 무설치본 이름도 그것을 따라갔습니다.
      **업데이터를 켜기 전에** 맞춰야 합니다 — 나중에 바꾸면 첫 자동 업데이트가 옛 이름의
      실행 파일을 남깁니다.
    */
    expect(CARGO).toContain('name = "AIMovieStorage"');
    expect(read("src-tauri/src/main.rs")).toContain(
      "aimoviestorage_lib::run()",
    );
  });

  it("무설치본 이름이 설치 파일과 같은 모양입니다", () => {
    const script = read("scripts/release-artifacts.mjs");
    expect(script).toContain("portable: `${stem}-portable.zip`");
    expect(script).not.toContain("_portable.zip`;");
  });
});
