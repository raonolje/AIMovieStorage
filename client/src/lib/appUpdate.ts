import { isDesktopApp } from "@/lib/llm";
import { EDITION } from "@/lib/edition";
import { t } from "@/lib/i18n";
import { invoke } from "@tauri-apps/api/core";

/*
  **앱 자동 업데이트.**

  

  두 판의 업데이트 끝점은 빌드 설정에서 가릅니다. 공개판은 GitHub, 원본판은
  인증이 필요한 GitLab 릴리스입니다. 원본판은 읽기 토큰이 없으면 조회하지 않습니다.

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

/** 브라우저에서는 네이티브 업데이트가 없습니다. 두 데스크톱 판은 각자의 채널을 씁니다. */
export function updatesUnavailable(): boolean {
  return !isDesktopApp();
}

async function updateHeaders(): Promise<Record<string, string> | null> {
  if (EDITION === "public") return {};
  const token = await invoke<string | null>("private_update_token");
  return token ? { "PRIVATE-TOKEN": token } : null;
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
  const headers = await updateHeaders();
  if (headers === null) return null;
  let check: typeof import("@tauri-apps/plugin-updater").check;
  try {
    ({ check } = await import("@tauri-apps/plugin-updater"));
  } catch {
    // 브라우저/오래된 번들에서는 플러그인이 없을 수 있습니다.
    return null;
  }
  let update;
  try {
    update = await check({ headers });
  } catch (error) {
    /*
      오래된 번들에는 플러그인이 없을 수 있습니다. 그 경우만 조용히 넘기고
      인증·네트워크·서명 오류는 사람이 볼 수 있도록 그대로 올립니다.
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
    throw new Error(t("자동 업데이트는 데스크톱 앱에서만 사용할 수 있습니다."));
  }
  const headers = await updateHeaders();
  if (headers === null) throw new Error("GitLab 읽기 토큰을 먼저 등록해 주세요.");
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const update = await check({ headers });
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
  }, { headers });
  /*
    **다시 띄우기는 우리가 부릅니다.**

    NSIS 설치기는 조용히 깔고 끝납니다 — 앱을 스스로 다시 띄워 주지 않습니다.
    안 부르면 「업데이트했는데 그대로네」 가 됩니다.
  */
  await relaunch();
}
