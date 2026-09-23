import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp } from "@/lib/llm";
import { safeFileName, saveProjectMediaAsset, type ProjectAssetType } from "@/lib/mediaLibrary";
import { loadMagnificModels } from "@/lib/magnificModels";
import { assertMagnificVideoInputs, findMagnificVideoModel } from "@/lib/magnificVideoInputs";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
import { generationResponse, generationNotices, measureMagnificMedia, measuredDifferences, type MagnificGenerationMetadata } from "./magnificGenerationMetadata";

/**
 * **마그니픽 MCP** — 창을 거치지 않고 끝까지 뽑습니다.
 *
 *
 *
 * # 두 길이 함께 남습니다
 *
 * - **마그니픽 창**(`magnificCompose`) — 생성기를 «차려 놓기» 까지. 뽑는 것은 사람이
 * 그 창에서 누릅니다. «무제한» 이 적용되는 길이라 손으로 골라 가며 작업할 때 맞습니다.
 * - **마그니픽 MCP**(여기) — 끝까지 뽑습니다. 건당 과금이지만 밤새 통째로 돌릴 수 있습니다.
 *
 * 어느 쪽을 쓸지는 **프로젝트가** 고릅니다(`batchEngines`).
 *
 * # 왜 로그인이 브라우저에서 일어나는가
 *
 * 디바이스 코드 플로우입니다 — 앱이 코드를 보여 주고, 사람이 브라우저에서 그 코드를
 * 넣어 허락합니다. 데스크톱 앱이 비밀번호를 직접 받지 않는 것이 요점입니다(우리는
 * 비밀번호를 볼 일이 없고, 볼 이유도 없습니다).
 */

export interface MagnificStatus {
  connected: boolean;
  account?: string | null;
}

export interface DeviceLogin {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string | null;
  interval: number;
}

let status: MagnificStatus = { connected: false };
const listeners = new Set<() => void>();
/**
 * 한 번이라도 물어봤는가.
 *
 * 사라진 게 아니라 **연결
 * 상태를 아무도 안 읽고 있었습니다.** 읽는 곳이 설정 화면 하나뿐이라, 그 화면을 안 열면
 * 앱은 내내 「연결 안 됨」 으로 알고 있었습니다. 그래서 목록에 그 줄이 안 뜬 것입니다.
 *
 * 이제 **쓰는 쪽이 물어봅니다** — 아래 `useMagnificStatus` 가 처음 불릴 때 한 번.
 */
let asked = false;

function publish(next: MagnificStatus) {
  status = next;
  listeners.forEach((listener) => listener());
}

/** 앱이 켜질 때 한 번, 그리고 연결·해제 때마다 새로 읽습니다. */
export async function refreshMagnificStatus(): Promise<MagnificStatus> {
  if (!isDesktopApp()) return status;
  try {
    publish(await invoke<MagnificStatus>("magnific_status"));
  } catch {
    publish({ connected: false });
  }
  return status;
}

export function useMagnificStatus(): MagnificStatus {
  /*
    처음 쓰는 순간 한 번 물어봅니다. 그리기 도중에 상태를 바꾸면 안 되므로
    다음 틱으로 미룹니다 — 답이 오면 구독자들이 알아서 다시 그립니다.
  */
  if (!asked) {
    asked = true;
    queueMicrotask(() => void refreshMagnificStatus());
  }
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
    () => status,
  );
}

export function startMagnificLogin(): Promise<DeviceLogin> {
  return invoke<DeviceLogin>("magnific_login_start");
}


export async function pollMagnificLogin(deviceCode: string) {
  const reply = await invoke<{ pending: boolean; connected: boolean }>("magnific_login_poll", {
    deviceCode,
  });
  if (reply.connected) await refreshMagnificStatus();
  return reply;
}

export async function logoutMagnific() {
  await invoke("magnific_logout");
  await refreshMagnificStatus();
}

/** 붙었는지 확인 — 도구 몇 개가 보이는지 세어 봅니다. 아무것도 만들지 않습니다. */
export function checkMagnific(): Promise<number> {
  return invoke<number>("magnific_check");
}

// ── 뽑기 ────────────────────────────────────────────────────────────────────

/** 우리 폴더의 파일을 올리고 creation id 를 받습니다. 레퍼런스는 id 로만 겁니다. */
export function uploadToMagnific(path: string): Promise<string> {
  return invoke<string>("magnific_upload", { path });
}

interface WaitResult {
  done: boolean;
  url?: string | null;
  failed: boolean;
  message?: string | null;
  response?: unknown;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * 뽑으라고 시키고 **다 될 때까지** 기다렸다가 우리 폴더에 내려놓습니다.
 *
 * 기다리는 일이 길어서(영상은 몇 분) 한 번에 25초씩 끊어 묻습니다. 그 사이 작업 줄이
 * 「살아 있다」 고 알릴 수 있게 `onBeat` 를 부릅니다 — 안 그러면 판이 「소식 없음」 으로
 * 보입니다.
 */
export async function generateWithMagnific(input: {
  kind: "image" | "video";
  args: Record<string, unknown>;
  projectName: string;
  assetType: ProjectAssetType;
  ownerName: string;
  stem: string;
  extension: string;
  onBeat?: (message: string) => void;
  /** 그만두라는 신호. 참이 되면 기다리기를 멈춥니다(뽑던 것은 마그니픽에 남습니다). */
  stopped?: () => boolean;
  onMetadata?: (metadata: MagnificGenerationMetadata, path?: string) => void;
}): Promise<{ path: string; name: string; metadata: MagnificGenerationMetadata }> {
  const requested = JSON.parse(JSON.stringify({ kind: input.kind, args: input.args })) as MagnificGenerationMetadata["requested"];
  let args = input.args;
  if (input.kind === "video") {
    const selected = String(args.slug ?? args.model ?? "");
    if (selected || args.references || args.keyframes) {
      const model = findMagnificVideoModel(await loadMagnificModels("video"), selected);
      if (selected && !model) throw new Error(t("선택한 Magnific 영상 모델이 현재 목록에 없습니다. 모델 목록을 새로 불러와 다시 고르세요."));
      assertMagnificVideoInputs(model, args);
      if (model) args = { ...args, slug: model.slug };
    }
  }
  // 구형 명령으로 재시도하지 않습니다. 접수 뒤 응답만 유실됐을 때 생성이 두 번 될 수 있습니다.
  const accepted = await invoke<{ identifier: string; response: unknown }>("magnific_generate_details", {
    kind: input.kind,
    args,
  });
  const identifier = accepted.identifier;
  const metadata: MagnificGenerationMetadata = { requested, submitted: JSON.parse(JSON.stringify(args)),
    accepted: { identifier, response: generationResponse(accepted.response) }, measured: { status: "pending" },
    notices: generationNotices(accepted.response) };
  const showNotices = (notices: string[]) => {
    if (notices.length) toast.warning(t("Magnific 생성 안내"), { description: notices.join("\n").slice(0, 1200), duration: 15000 });
  };
  input.onMetadata?.(metadata);
  showNotices(metadata.notices);
  input.onBeat?.("마그니픽이 만드는 중");

  let url = "";
  // 그림은 대개 1분 안, 영상은 몇 분입니다. 25초씩 최대 40번 = 약 16분까지 기다립니다.
  for (let turn = 0; turn < 40 && !url; turn += 1) {
    if (input.stopped?.()) throw new Error("멈췄습니다. 뽑던 것은 마그니픽에 남아 있습니다.");
    const reply = await invoke<WaitResult>("magnific_wait", { identifier });
    if (reply.response !== undefined && (reply.url || reply.failed)) {
      metadata.completion = generationResponse(reply.response);
      const notices = generationNotices(reply.response).filter(notice => !metadata.notices.includes(notice));
      metadata.notices.push(...notices); input.onMetadata?.(metadata); showNotices(notices);
    }
    if (reply.failed) throw new Error(reply.message || "마그니픽이 만들다 실패했습니다.");
    if (reply.url) {
      url = reply.url;
      break;
    }
    input.onBeat?.(`마그니픽이 만드는 중 · ${Math.round((turn + 1) * 25 / 60)}분째`);
    await sleep(1500);
  }
  if (!url)
    throw new Error(
      "마그니픽이 너무 오래 걸립니다. 그림은 이미 만들어져 있을 수 있습니다 — " +
        "마그니픽에서 확인하고, 없으면 «다시 하기» 로 이어 주세요.",
    );

  /*
    놓을 자리는 **우리 규칙**이 정합니다(규칙 5). 빈 파일로 자리를 잡고 그 위에 덮어씁니다 —
    로컬 엔진과 달리 여기서는 Rust 가 번호를 다시 붙이지 않으므로(그냥 씁니다) 자리 경로가
    곧 결과 경로입니다.
  */
  const stem = `${safeFileName(input.stem)}_마그니픽`;
  const saved = await saveProjectMediaAsset(
    new File([new Uint8Array(0)], `${stem}.${input.extension}`, {
      type: input.kind === "video" ? "video/mp4" : "image/png",
    }),
    {
      projectName: input.projectName,
      assetType: input.assetType,
      ownerName: input.ownerName,
      stem,
    },
  );
  if (!saved?.path) throw new Error("결과를 놓을 자리를 만들지 못했습니다.");
  input.onBeat?.("내려받는 중");
  await invoke<string>("magnific_download", { url, outputPath: saved.path });
  input.onMetadata?.(metadata, saved.path);
  metadata.measured = await measureMagnificMedia(saved.path, input.kind).catch(() => ({ status: "unavailable" as const }));
  const differences = measuredDifferences(requested.args, metadata.measured);
  metadata.notices.push(...differences); input.onMetadata?.(metadata, saved.path); showNotices(differences);
  return { path: saved.path, name: saved.name || stem, metadata };
}
