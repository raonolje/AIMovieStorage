import { isDesktopApp } from "@/lib/llm";
import { EDITION } from "@/lib/edition";
import { t } from "@/lib/i18n";

/*
  **앱 자동 업데이트.**

  

  # 왜 공개판에서만 도는가

  끝점은 공개판 릴리스(`AIMovieStorage-Public_…-setup.exe`)를 가리킵니다. 비공개판
  (내 PC용, 모션캡처·업스케일 엔진이 들어 있는 판)이 그것을 받아 깔면 그 엔진들이
  통째로 사라집니다. 두 판은 `productName` 이 달라 설치 자리도 갈리므로, 덮어쓰는 게
  아니라 **엉뚱한 앱이 하나 더 생깁니다.** 어느 쪽이든 사고라서 Rust 가 공개판에서만
  플러그인을 등록합니다(`src-tauri/src/lib.rs` 의 `setup`).

  그래서 여기서는 **플러그인이 없을 수도 있다는 전제**로 씁니다 — 없으면 조용히
  「업데이트 기능이 없는 판」 으로 물러섭니다. 없는 것을 오류로 띄우면 내 PC 판에서
  켤 때마다 잔소리가 됩니다.

  # 왜 동적 import 인가

  `@tauri-apps/plugin-updater` 를 맨 위에서 부르면 브라우저로 열었을 때(`pnpm dev`)
  모듈을 찾다 화면이 통째로 안 뜹니다. 쓸 때만 불러옵니다.
*/

export interface UpdateInfo {
  /** 받을 수 있는 새 판. */
  version: string;
  /** 지금 판. */
  current: string;
  /** 릴리스 노트(있으면). */
  notes?: string;
}

/** 업데이트가 아예 안 되는 판인가 — 비공개판·브라우저. */
export function updatesUnavailable(): boolean {
  return !isDesktopApp() || EDITION !== "public";
}

/**
 * 새 판이 있는지 묻습니다.
 *
 * @returns 새 판이 있으면 그 정보, 없으면 `null`.
 * @throws 네트워크·설정 문제일 때만. **업데이터가 없는 판에서는 던지지 않고 `null`**
 * 입니다 — 켤 때마다 자동으로 부르는 자리라 조용해야 합니다.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (updatesUnavailable()) return null;
  let check: typeof import("@tauri-apps/plugin-updater").check;
  try {
    ({ check } = await import("@tauri-apps/plugin-updater"));
  } catch {
    // 꾸러미가 없는 판입니다. 기능이 없는 것이지 고장이 아닙니다.
    return null;
  }
  let update;
  try {
    update = await check();
  } catch (error) {
    /*
      비공개판은 플러그인을 등록하지 않았습니다. 그때 `check()` 는 「그런 명령이 없다」 로
      터지는데, 그건 **고장이 아니라 그 판의 성질**입니다. 다른 오류(네트워크·서명)는
      사람이 알아야 하므로 그대로 올려 보냅니다.
    */
    const text = String(error);
    if (text.includes("not found") || text.includes("not allowed") || text.includes("updater")) {
      if (text.includes("plugin") || text.includes("command")) return null;
    }
    throw error;
  }
  if (!update) return null;
  return {
    version: update.version,
    current: update.currentVersion,
    notes: update.body || undefined,
  };
}

/**
 * 받아서 깔고 앱을 다시 띄웁니다.
 *
 * @param onProgress 받은 바이트와 전체 바이트. 전체를 모르면 `null`.
 *
 * 설치 모드는 `passive` 입니다(`tauri.conf.json`) — 설치 창이 진행 막대만 보이고
 * 사람이 «다음» 을 누를 일이 없습니다. 설치 자리가 `currentUser` 라 **관리자 권한도
 * 묻지 않습니다.** 끝나면 앱이 스스로 꺼졌다 다시 뜹니다.
 */
export async function installUpdate(
  onProgress?: (got: number, total: number | null) => void,
): Promise<void> {
  // 화면 밖의 호출도 같은 판정을 거쳐야 원본판이 공개판 설치 경로로 들어가지 않습니다.
  if (updatesUnavailable()) {
    throw new Error(t("자동 업데이트는 공개판 데스크톱 앱에서만 사용할 수 있습니다."));
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const update = await check();
  if (!update) throw new Error("새 판이 없습니다.");

  let got = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      got = 0;
    } else if (event.event === "Progress") {
      got += event.data.chunkLength;
    }
    onProgress?.(got, total);
  });
  /*
    **다시 띄우기는 우리가 부릅니다.**

    NSIS 설치기는 조용히 깔고 끝납니다 — 앱을 스스로 다시 띄워 주지 않습니다.
    안 부르면 「업데이트했는데 그대로네」 가 됩니다.
  */
  await relaunch();
}
