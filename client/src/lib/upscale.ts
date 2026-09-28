import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isDesktopApp } from "@/lib/llm";
import { isEngineIncluded } from "@/lib/edition";

/**
 * 업스케일 엔진 체계 — 프런트 쪽.
 *
 * 「SeedVR2로 부탁해 … 다른 로컬 업스케일링 도구들 리스트업 해서 골라서 사용할 수
 * 있게 해줘」 「없어 넷 다 진행해」.
 *
 * 그래서 엔진은 앱 데이터 폴더 `upscale/engines/<id>/` 에 **각자 고정 환경**(uv venv + 고정
 * 커밋 코드 + 검증된 가중치)으로 설치되고, Rust(`src-tauri/src/upscale.rs`)가 상주 워커를
 * 띄워 stdin/stdout JSON 줄로 일을 시킵니다. ComfyUI 와는 무관합니다. 앞서 만든 ComfyUI
 * 다리는 «외부 엔진» `comfy` 로 같은 목록에 남겨 두되 기본은 아닙니다.
 *
 * 설정(기본 엔진·목표 크기·모델 선택·워커 유지)은 다른 옵션처럼 localStorage 에 둡니다.
 * 엔진의 설치 상태는 Rust 가 폴더를 보고 답하는 것이라(`upscale_engines_status`) 여기서는
 * 캐시만 들고, 화면은 그 캐시를 구독합니다 — 설치·제거는 오래 걸리고 설정 화면을 떠나 있는
 * 동안에도 진행 이벤트(`upscale-progress`)가 오므로 상태를 컴포넌트가 아니라 모듈이 듭니다.
 */

/* ────────────────────────── 엔진 목록(정적) ────────────────────────── */

export type UpscaleEngineId = "seedvr2" | "spandrel" | "nvvfx" | "vosr" | "upscayl" | "comfy";

/**
 * 이 빌드에 실린 엔진 — 상태 캐시·설정 검증·기본 엔진 고르기가 전부 이 목록을 돕니다.
 *
 * 공개판(`lib/edition.ts`)에서 빠진 엔진은 **여기서** 걸러집니다. 그래서 설정 화면·업스케일 단추가
 * 따로 거를 필요가 없고, 저장된 설정에 빠진 엔진이 적혀 있어도 `isEngineId` 가 «모르는 값» 으로 봅니다.
 */
export const UPSCALE_ENGINE_IDS: UpscaleEngineId[] = (
  ["seedvr2", "spandrel", "nvvfx", "vosr", "upscayl", "comfy"] as UpscaleEngineId[]
).filter(isEngineIncluded);

/**
 * 화면에 보이는 이름·용도·라이선스·용량 — Rust 상태에 없는 «사람 말» 은 여기서 듭니다.
 * 값은 `docs/복원/11_로컬_업스케일러_비교.md` 의 표를 따릅니다. 고정 버전·URL·해시는 리소스의
 * manifest(`src-tauri/resources/upscale/engines/<id>/manifest.json`) 에 있고 여기엔 안 둡니다 —
 * 두 곳에 적으면 하나만 바뀌는 사고가 납니다.
 */
export interface UpscaleEngineInfo {
  id: UpscaleEngineId;
  name: string;
  purpose: string;
  license: string;
  /** 설치 전에 보여 줄 대략 용량. 실제는 상태의 `diskBytes`. */
  sizeHint: string;
  experimental?: boolean;
  external?: boolean;
  /** 기본 엔진 자동 선택 순서(작을수록 먼저). 사용자가 고르지 않았을 때만. */
  priority: number;
}

/**
 * 파일 이름에 붙일 엔진 딱지 — «냥이_전신_업스케일_SeedVR2_001».
 *
 *
 * 엔진마다 결과 성격이 달라서(디테일을 만드는 것 / 선명하게만 하는 것) 나중에 견줄 때 이름으로
 * 가려야 합니다. 화면 이름(`name`)은 길어서 파일에 못 쓰고, 폴더 이름 규칙(`safeFileName`)에
 * 걸리지 않도록 **영문·숫자만** 씁니다.
 */
export const UPSCALE_ENGINE_TAG: Record<UpscaleEngineId, string> = {
  seedvr2: "SeedVR2",
  spandrel: "RealPLKSR",
  nvvfx: "Maxine",
  vosr: "VOSR",
  upscayl: "Upscayl",
  comfy: "ComfyUI",
};

/** 그 엔진의 딱지. 모르는 id 면 빈 문자열 — 이름에 아무것도 안 붙입니다. */
export function upscaleEngineTag(engine?: UpscaleEngineId | null): string {
  return (engine && UPSCALE_ENGINE_TAG[engine]) || "";
}

export const UPSCALE_ENGINE_CATALOG: Record<UpscaleEngineId, UpscaleEngineInfo> = {
  seedvr2: {
    id: "seedvr2",
    name: "사실감·큰 배율 — SeedVR2 7B",
    purpose: "배경·캐릭터 4K~8K, 짧은 영상 클립. 1스텝이라 4K 십수 초. AI 생성물에 강함",
    license: "Apache 2.0 (코드·가중치)",
    sizeHint: "약 21 GB (7B fp16 16.5 GB + VAE 0.5 GB + 환경). 추가 모델은 sharp +16.5 GB · 3B +6.8 GB",
    priority: 0,
  },
  spandrel: {
    id: "spandrel",
    name: "빠르고 가벼움 — RealPLKSR / SPAN",
    purpose: "미리보기·시트 칸 확대·영상 프레임 대량 처리. 4× 고정 후 목표 크기로 맞춤. 디테일 생성 없음",
    license: "spandrel MIT · 모델 CC-BY-4.0",
    sizeHint: "약 3.5 GB (torch 포함, 모델 30 MB)",
    priority: 1,
  },
  nvvfx: {
    id: "nvvfx",
    name: "8K 마감 — NVIDIA Maxine SR",
    purpose: "다른 엔진 결과를 최종 8K 로, 또는 1차 노이즈 정리. 초 단위. «아주 좋은 Lanczos» 성향",
    license: "NVIDIA 독점(상업 허용 — SDK 는 이 앱만 접근·브랜딩 표기 조건)",
    sizeHint: "약 3.5 GB (torch 포함)",
    priority: 2,
  },
  vosr: {
    id: "vosr",
    name: "디테일 생성 (실험) — VOSR 2.0",
    // 2026-09-09 에 4K·6K·8K 를 실제로 뽑았습니다(12번 문서 §5.2). 그래도 «실험» 인 이유는
    // 성능이 아니라 구조입니다 — 모델을 상주시키지 못하고 장마다 CLI 를 새로 띄웁니다.
    purpose: "영웅 컷. 환각 적고 구조에 충실한 1스텝 확산형. 장마다 CLI 를 새로 띄워 한 장이 느림",
    license: "Apache 2.0",
    sizeHint: "약 11 GB (가중치 7 GB + 환경)",
    experimental: true,
    priority: 3,
  },
  upscayl: {
    id: "upscayl",
    name: "비상 대안 — Upscayl (ESRGAN, 파이썬 불필요)",
    purpose: "지금 당장 필요할 때. 설치가 가장 빠름. 보수적 선명화, 애니·일러스트에 적합",
    license: "AGPL-3.0 (별도 프로세스로 호출)",
    sizeHint: "약 50 MB (실행 파일 + 모델)",
    priority: 4,
  },
  comfy: {
    id: "comfy",
    name: "외부 — ComfyUI (API)",
    purpose: "직접 만든 ComfyUI 워크플로(API 형식 JSON)로 돌림. ComfyUI 가 켜져 있어야 함",
    license: "— (ComfyUI 와 워크플로의 노드에 따름)",
    sizeHint: "설치 없음",
    external: true,
    priority: 5,
  },
};

/** SeedVR2 가중치 — 기본은 7B fp16, 나머지는 «추가 모델» 로 골라 받습니다. */
export type SeedVr2Model = "7b" | "7b_sharp" | "3b";
export const SEEDVR2_MODEL_OPTIONS: { id: SeedVr2Model; label: string; extra: boolean; hint: string }[] = [
  { id: "7b", label: "7B fp16 (기본)", extra: false, hint: "16.5 GB · 기본 설치에 포함" },
  { id: "7b_sharp", label: "7B sharp fp16", extra: true, hint: "16.5 GB · 더 또렷하게, 그레인 적음" },
  { id: "3b", label: "3B fp16", extra: true, hint: "6.8 GB · 영상 프레임 대량 처리용, 빠름" },
];

/**
 * spandrel 모델 — id 는 manifest 의 파일 이름(확장자 뺀 것)과 같아야 워커가 찾습니다.
 * 원래 표의 «속도» 모델 `4xNomos8k_span_otf_medium` 은 구글 드라이브에만 있어 자동으로 받을 수
 * 없어서(2026-09-09 확인) 직접 받을 수 있는 SPAN 사전학습본으로 바꿨습니다.
 */
export type SpandrelModel = "4xNomosWebPhoto_RealPLKSR" | "4xmssim_span_pretrain";
export const SPANDREL_MODEL_OPTIONS: { id: SpandrelModel; label: string; hint: string }[] = [
  { id: "4xNomosWebPhoto_RealPLKSR", label: "품질 — 4xNomosWebPhoto RealPLKSR", hint: "사진·실사 복원, 30 MB" },
  { id: "4xmssim_span_pretrain", label: "속도 — 4x SPAN (mssim 사전학습)", hint: "가장 빠름, 9 MB" },
];

/* ────────────────────────── 목표 크기 ────────────────────────── */

/** 목표 긴 변. 6면은 정사각이라 그대로 한 변 크기입니다. */
export type UpscaleTarget = 2048 | 4096 | 6144 | 8192;

export const UPSCALE_TARGET_OPTIONS: { id: UpscaleTarget; label: string }[] = [
  { id: 2048, label: "2K (2048)" },
  { id: 4096, label: "4K (4096)" },
  { id: 6144, label: "6K (6144)" },
  { id: 8192, label: "8K (8192)" },
];

function isTarget(value: unknown): value is UpscaleTarget {
  return UPSCALE_TARGET_OPTIONS.some((option) => option.id === value);
}

/** 목표가 클수록 오래 걸립니다. 8K 는 30분까지 봐 줍니다. */
export function upscaleTimeoutFor(targetSize: number): number {
  if (targetSize >= 8192) return 1800;
  if (targetSize >= 6144) return 1500;
  return 900;
}

/**
 * «업스케일이 필요한가» — 고른 크기가 원래 해상도의 1.5배 이상이면 그렇다고 봅니다.
 * 파노라마의 90° 한 면은 원래 해상도가 대략 `파노라마 가로 / 4` 입니다.
 */
export function needsUpscale(nativeSize: number, wantedSize: number): boolean {
  return nativeSize > 0 && wantedSize >= nativeSize * 1.5;
}

/* ────────────────────────── 엔진이 «진짜로» 키울 수 있는 한계 ────────────────────────── */

/**
 * 엔진별 **최대 배율** — 이 배율까지가 «모델이 없는 화소를 만들어 내는» 구간이고,
 * 그 위는 그냥 Lanczos 로 늘린 것입니다(워커의 `common.fit_to`).
 *
 * 사용자 2026-09-09: 목표 크기를 고를 때 «그 엔진이 원본에서 그 크기를 진짜로 만들 수 있는지»
 * 를 알려 줘야 합니다. spandrel·upscayl 은 4× 고정 모델이라 원본 1024 면 4096 이 상한이고,
 * 6K·8K 를 골라도 4096 까지만 만든 뒤 늘립니다. 문서에 적힌 «spandrel 8K 도 타일로» 는
 * 오해를 부르는 문장이었습니다 — 타일은 **입력**을 나누는 것이지 배율을 늘리지 않습니다.
 *
 * `null` 은 «제한 없음» — 확산형(seedvr2·vosr)은 목표 해상도를 직접 받아 그 크기로 만들고,
 * nvvfx 는 4× 패스를 필요한 만큼 이어 붙입니다. `comfy` 는 남의 워크플로라 우리가 알 수
 * 없어 역시 `null` 입니다.
 */
export const UPSCALE_ENGINE_MAX_SCALE: Record<UpscaleEngineId, number | null> = {
  // 목표 해상도를 그대로 받는 확산형 — 배율 제한이 아니라 VRAM·시간이 한계입니다.
  seedvr2: null,
  vosr: null,
  // 4× 고정 모델. 타일은 입력을 나눌 뿐 배율을 바꾸지 않습니다.
  spandrel: 4,
  upscayl: 4,
  // Maxine SR 은 «한 패스» 가 4× 까지지만, 워커(`nvvfx.py` 의 `_passes`)는 남은 비율이 4 이하가
  // 될 때까지 `while True` 로 패스를 **몇 번이든** 이어 붙입니다 — 배율 상한이 없습니다.
  //
  // 2026-09-09 지적: 여기 16 을 적어 두었더니 원본 긴 변이 작은 그림(시트에서 잘라낸 칸, 얼굴
  // 크롭 등)에서 8192/원본 > 16 이 되어, ▾ 메뉴가 실제로는 세 패스로 진짜 키우는 nvvfx 줄에
  // «늘리기» 딱지를 잘못 붙였습니다. 게다가 기본 엔진이면 «원본 1024px 이면 16384px 이 상한»
  // 이라는, 아무 데도 근거가 없는 문장이 늘 떠 있었습니다.
  nvvfx: null,
  // 남의 워크플로 — 우리가 장담할 수 없습니다.
  comfy: null,
};

/** 원본 긴 변이 주어지면 «진짜로 만들 수 있는 긴 변». 제한 없는 엔진은 `null`. */
export function realCeilingFor(engine: UpscaleEngineId, sourceLongEdge?: number | null): number | null {
  const scale = UPSCALE_ENGINE_MAX_SCALE[engine];
  if (scale === null) return null;
  if (!sourceLongEdge || sourceLongEdge <= 0) return null;
  return Math.round(sourceLongEdge * scale);
}

/** 고른 목표가 그 엔진에서 «늘리기» 가 되는가. 모르면 false(겁주지 않습니다). */
export function isStretchedTarget(
  engine: UpscaleEngineId,
  target: number,
  sourceLongEdge?: number | null,
): boolean {
  const ceiling = realCeilingFor(engine, sourceLongEdge);
  return ceiling !== null && target > ceiling;
}

/**
 * 목표 고르기 옆에 붙일 한 줄. 제한 없는 엔진은 `null`(할 말이 없습니다).
 * 원본 크기를 모르면 배율만 말합니다 — 없는 숫자를 지어내지 않습니다.
 */
export function upscaleReachNote(engine: UpscaleEngineId, sourceLongEdge?: number | null): string | null {
  const scale = UPSCALE_ENGINE_MAX_SCALE[engine];
  if (scale === null) return null;
  const ceiling = realCeilingFor(engine, sourceLongEdge);
  if (ceiling === null) {
    return `이 엔진은 원본의 ${scale}배까지만 진짜로 키웁니다. 그 위는 늘리기입니다.`;
  }
  return `이 엔진은 원본의 ${scale}배까지만 진짜로 키웁니다 — 원본 ${sourceLongEdge}px 이면 ${ceiling}px 이 상한이고, 그 위는 늘리기입니다.`;
}

/* ────────────────────────── 설정 (localStorage) ────────────────────────── */

const SETTINGS_KEY = "ai-video-storage.upscale.v1";
/** 예전 «ComfyUI 업스케일» 설정 키 — 처음 한 번 읽어 옮깁니다. */
const LEGACY_COMFY_KEY = "ai-video-storage.comfy-upscale.v1";

export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";

export interface ComfySettings {
  /** ComfyUI 주소. 비면 기본 자리. */
  baseUrl: string;
  /** Save (API Format) 로 저장한 업스케일 워크플로 JSON 경로. 비면 comfy 엔진을 못 씁니다. */
  workflowPath: string;
}

export interface UpscaleSettings {
  /** «업스케일» 단추가 쓰는 엔진. 빈 값이면 설치된 것 중 우선순위대로 자동. */
  defaultEngine: UpscaleEngineId | "";
  /** «업스케일» 단추가 쓰는 기본 목표 긴 변. */
  defaultTarget: UpscaleTarget;
  /** 작업이 끝나도 워커(모델이 올라간 파이썬)를 살려 둘지. 끄면 매번 다시 올리느라 느립니다. */
  keepWorker: boolean;
  seedvr2: {
    /** 설치 때 같이 받을 추가 가중치. */
    extraModels: { sharp: boolean; b3: boolean };
    /** 업스케일에 쓸 가중치. 안 받은 것을 고르면 워커가 오류를 냅니다(설정 화면이 막습니다). */
    model: SeedVr2Model;
  };
  spandrel: { model: SpandrelModel };
  comfy: ComfySettings;
}

export const DEFAULT_UPSCALE_SETTINGS: UpscaleSettings = {
  defaultEngine: "",
  defaultTarget: 4096,
  keepWorker: true,
  seedvr2: { extraModels: { sharp: false, b3: false }, model: "7b" },
  spandrel: { model: "4xNomosWebPhoto_RealPLKSR" },
  comfy: { baseUrl: DEFAULT_COMFY_URL, workflowPath: "" },
};

function isEngineId(value: unknown): value is UpscaleEngineId {
  return typeof value === "string" && (UPSCALE_ENGINE_IDS as string[]).includes(value);
}

function normalizeSettings(raw: unknown): UpscaleSettings {
  const parsed = (raw && typeof raw === "object" ? raw : {}) as Partial<UpscaleSettings> & {
    seedvr2?: Partial<UpscaleSettings["seedvr2"]>;
    spandrel?: Partial<UpscaleSettings["spandrel"]>;
    comfy?: Partial<ComfySettings>;
  };
  const seedModel = parsed.seedvr2?.model;
  const spandrelModel = parsed.spandrel?.model;
  return {
    defaultEngine: isEngineId(parsed.defaultEngine) ? parsed.defaultEngine : "",
    defaultTarget: isTarget(parsed.defaultTarget) ? parsed.defaultTarget : DEFAULT_UPSCALE_SETTINGS.defaultTarget,
    keepWorker: typeof parsed.keepWorker === "boolean" ? parsed.keepWorker : DEFAULT_UPSCALE_SETTINGS.keepWorker,
    seedvr2: {
      extraModels: {
        sharp: Boolean(parsed.seedvr2?.extraModels?.sharp),
        b3: Boolean(parsed.seedvr2?.extraModels?.b3),
      },
      model: SEEDVR2_MODEL_OPTIONS.some((option) => option.id === seedModel) ? (seedModel as SeedVr2Model) : "7b",
    },
    spandrel: {
      model: SPANDREL_MODEL_OPTIONS.some((option) => option.id === spandrelModel)
        ? (spandrelModel as SpandrelModel)
        : DEFAULT_UPSCALE_SETTINGS.spandrel.model,
    },
    comfy: {
      baseUrl:
        typeof parsed.comfy?.baseUrl === "string" && parsed.comfy.baseUrl.trim() ? parsed.comfy.baseUrl.trim() : DEFAULT_COMFY_URL,
      workflowPath: typeof parsed.comfy?.workflowPath === "string" ? parsed.comfy.workflowPath.trim() : "",
    },
  };
}

/** 옛 키(ComfyUI 전용 시절)의 값을 새 설정으로. 새 키가 이미 있으면 건드리지 않습니다. */
function migrateLegacyComfy(): UpscaleSettings | null {
  try {
    const legacy = window.localStorage.getItem(LEGACY_COMFY_KEY);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy) as { baseUrl?: string; workflowPath?: string; defaultTarget?: unknown };
    const next = normalizeSettings({
      defaultTarget: parsed.defaultTarget,
      comfy: { baseUrl: parsed.baseUrl, workflowPath: parsed.workflowPath },
    });
    // 워크플로를 잡아 두고 쓰던 사람은 새 엔진을 깔기 전까지 ComfyUI 로 계속 돌아가야 합니다.
    if (next.comfy.workflowPath) next.defaultEngine = "comfy";
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

export function getUpscaleSettings(): UpscaleSettings {
  if (typeof window === "undefined") return structuredClone(DEFAULT_UPSCALE_SETTINGS);
  try {
    const saved = window.localStorage.getItem(SETTINGS_KEY);
    if (!saved) return migrateLegacyComfy() ?? structuredClone(DEFAULT_UPSCALE_SETTINGS);
    return normalizeSettings(JSON.parse(saved));
  } catch {
    return structuredClone(DEFAULT_UPSCALE_SETTINGS);
  }
}

/**
 * 설정을 고쳐 저장하고 저장된 전체를 돌려줍니다.
 * «지금 값을 받아 다음 값을 만드는 함수» 로만 받습니다 — 값으로 덮어쓰면 다른 칸에서 방금 저장한
 * 것을 지웁니다(CLAUDE.md «상태를 고칠 때»).
 */
export function saveUpscaleSettings(update: (current: UpscaleSettings) => UpscaleSettings): UpscaleSettings {
  const next = normalizeSettings(update(getUpscaleSettings()));
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  publish();
  return next;
}

/** ComfyUI 몫만 — 설정 화면의 «외부 엔진» 절과 comfy 다리가 씁니다. */
export function getComfySettings(): ComfySettings {
  return getUpscaleSettings().comfy;
}

export function saveComfySettings(patch: Partial<ComfySettings>): ComfySettings {
  return saveUpscaleSettings((current) => ({ ...current, comfy: { ...current.comfy, ...patch } })).comfy;
}

/**
 * ComfyUI 다리를 쓸 수 있는 상태인가 — 데스크톱 + 워크플로 경로가 잡힘.
 * 연결이 실제로 되는지는 여기서 안 봅니다(동기 함수 — 렌더 중에 부릅니다).
 */
export function isComfyConfigured(): boolean {
  return isDesktopApp() && Boolean(getComfySettings().workflowPath.trim());
}

/* ────────────────────────── 엔진 상태 (Rust 캐시 + 구독) ────────────────────────── */

export interface UpscaleEngineStatus extends UpscaleEngineInfo {
  installed: boolean;
  installing: boolean;
  /** 지금 가중치를 미리 받는 중인가(Rust `UpscaleState::prefetching`). 로컬 모델 쪽과 같은 모양 — 업스케일 엔진은 아직 미리 받기가 없어 늘 false. */
  prefetching: boolean;
  version: string;
  modelsReady: boolean;
  diskBytes: number;
  /** 가중치를 통째로 받아 두었는가(Rust 설치 기록의 `weights_ready`). 업스케일 엔진은 늘 설치 때 받으므로 표시에만 씁니다. */
  weightsReady: boolean;
  /** 이 엔진이 «미리 받기»(워커 op prefetch)를 아는가 — manifest 의 `prefetch`. 업스케일 쪽은 아직 없습니다. */
  canPrefetch: boolean;
  lastError: string;
}

export type UpscaleStage = "uv" | "python" | "deps" | "code" | "models" | "verify" | "run";

/** Rust 가 `upscale-progress` 로 보내는 것(설치 단계와 작업 진행이 같은 이벤트를 씁니다). */
export interface UpscaleProgressEvent {
  engine: string;
  stage?: UpscaleStage | string;
  percent?: number | null;
  message?: string;
  done?: boolean;
  error?: string | null;
}

export interface UpscaleInstallProgress {
  stage: string;
  percent: number | null;
  message: string;
}

export interface UpscaleWorkerInfo {
  cuda: boolean;
  device: string;
  torch: string;
  vramGb: number;
}

interface UpscaleSnapshot {
  engines: UpscaleEngineStatus[];
  /** 지금 설치 중인 것의 마지막 진행(엔진 id → 단계·퍼센트·문구). */
  installs: Record<string, UpscaleInstallProgress>;
  /** 상태를 한 번이라도 Rust 에서 받아 왔는가. 아니면 «확인 중» 으로 보입니다. */
  loaded: boolean;
  /** 상태를 못 받았을 때의 이유(명령이 없거나 Rust 오류). */
  statusError: string;
}

/** Rust 쪽 필드 이름이 snake_case 든 camelCase 든 받습니다 — 두 워크플로가 동시에 만드는 중이라 둘 다 봅니다. */
type RawEngineStatus = {
  id?: string;
  installed?: boolean;
  installing?: boolean;
  prefetching?: boolean;
  version?: string | null;
  models_ready?: boolean;
  modelsReady?: boolean;
  disk_bytes?: number;
  diskBytes?: number;
  weights_ready?: boolean;
  prefetch?: boolean;
  last_error?: string | null;
  lastError?: string | null;
};

function blankStatus(info: UpscaleEngineInfo): UpscaleEngineStatus {
  return {
    ...info,
    installed: false,
    installing: false,
    prefetching: false,
    version: "",
    modelsReady: false,
    diskBytes: 0,
    weightsReady: false,
    canPrefetch: false,
    lastError: "",
  };
}

function mergeStatus(raw: RawEngineStatus[]): UpscaleEngineStatus[] {
  const byId = new Map(raw.filter((item) => item.id).map((item) => [item.id as string, item]));
  return UPSCALE_ENGINE_IDS.map((id) => {
    const info = UPSCALE_ENGINE_CATALOG[id];
    const item = byId.get(id);
    // comfy 는 «설치» 가 아니라 «워크플로가 잡혔는가» 입니다 — Rust 가 뭐라 하든 설정이 기준.
    if (id === "comfy") {
      const configured = isComfyConfigured();
      return { ...blankStatus(info), installed: configured, modelsReady: configured };
    }
    if (!item) return blankStatus(info);
    return {
      ...info,
      installed: Boolean(item.installed),
      installing: Boolean(item.installing),
      prefetching: Boolean(item.prefetching),
      version: item.version ?? "",
      modelsReady: Boolean(item.models_ready ?? item.modelsReady),
      diskBytes: Number(item.disk_bytes ?? item.diskBytes ?? 0) || 0,
      weightsReady: Boolean(item.weights_ready),
      canPrefetch: Boolean(item.prefetch),
      lastError: item.last_error ?? item.lastError ?? "",
    };
  });
}

let snapshot: UpscaleSnapshot = {
  engines: UPSCALE_ENGINE_IDS.map((id) => blankStatus(UPSCALE_ENGINE_CATALOG[id])),
  installs: {},
  loaded: false,
  statusError: "",
};
const listeners = new Set<() => void>();

function publish(patch: Partial<UpscaleSnapshot> = {}) {
  // comfy 의 «설치됨» 은 설정에서 나오므로 설정이 바뀔 때도 다시 계산합니다.
  const engines = (patch.engines ?? snapshot.engines).map((engine) =>
    engine.id === "comfy" ? { ...engine, installed: isComfyConfigured(), modelsReady: isComfyConfigured() } : engine,
  );
  snapshot = { ...snapshot, ...patch, engines };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 엔진 상태·설치 진행을 구독합니다. 처음 붙을 때 Rust 에 한 번 물어봅니다(렌더 중이 아니라 effect 에서). */
export function useUpscaleEngines(): UpscaleSnapshot {
  useEffect(() => {
    if (!snapshot.loaded && !statusPending) void listEngines();
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}


let statusPending: Promise<UpscaleEngineStatus[]> | null = null;

/** Rust 에 엔진 상태를 물어 캐시를 갱신합니다. 브라우저에서는 전부 «설치 안 됨». */
export async function listEngines(): Promise<UpscaleEngineStatus[]> {
  if (!isDesktopApp()) {
    publish({ engines: mergeStatus([]), loaded: true, statusError: "" });
    return snapshot.engines;
  }
  if (statusPending) return statusPending;
  statusPending = (async () => {
    try {
      const raw = await invoke<RawEngineStatus[]>("upscale_engines_status");
      publish({ engines: mergeStatus(Array.isArray(raw) ? raw : []), loaded: true, statusError: "" });
    } catch (error) {
      // 명령이 아직 없거나 폴더를 못 읽어도 comfy 는 살아 있어야 합니다.
      publish({ engines: mergeStatus([]), loaded: true, statusError: String(error) });
    } finally {
      statusPending = null;
    }
    return snapshot.engines;
  })();
  return statusPending;
}

/* ────────────────────────── 진행 이벤트 ────────────────────────── */

const progressListeners = new Set<(event: UpscaleProgressEvent) => void>();
let progressHooked: Promise<void> | null = null;

/**
 * Tauri `upscale-progress` 를 **한 번만** 걸고 여기서 나눠 줍니다. 부르는 쪽마다 `listen` 을 걸면
 * 페이지를 오갈 때마다 리스너가 쌓입니다.
 */
function ensureProgressHook(): Promise<void> {
  if (!isDesktopApp()) return Promise.resolve();
  if (!progressHooked) {
    progressHooked = listen<UpscaleProgressEvent>("upscale-progress", (event) => {
      const payload = event.payload;
      if (!payload || typeof payload !== "object") return;
      // «disk» 는 Rust 가 엔진 폴더 크기를 뒤에서 다시 잰 뒤 보내는 살림 신호(2026-09-22) — 상태만 다시 읽고,
      // 작업 진행을 듣는 쪽에는 넘기지 않습니다(빈 문구가 진행 줄을 지우면 안 됩니다).
      if (payload.stage === "disk") {
        if (payload.done) void listEngines();
        return;
      }
      trackInstallProgress(payload);
      progressListeners.forEach((listener) => listener(payload));
    })
      .then(() => undefined)
      .catch((error) => {
        progressHooked = null;
        console.warn("업스케일 진행 이벤트를 걸지 못했습니다", error);
      });
  }
  return progressHooked;
}

/** 진행 이벤트를 받습니다. 돌려주는 함수로 뗍니다. 엔진을 주면 그 엔진 것만. */
export function onUpscaleProgress(listener: (event: UpscaleProgressEvent) => void, engine?: string): () => void {
  const wrapped = engine ? (event: UpscaleProgressEvent) => event.engine === engine && listener(event) : listener;
  progressListeners.add(wrapped);
  void ensureProgressHook();
  return () => {
    progressListeners.delete(wrapped);
  };
}

const INSTALL_STAGES = new Set(["uv", "python", "deps", "code", "models", "verify"]);

/** 설치 단계 이벤트를 캐시에 적습니다 — 설정 화면을 떠났다 돌아와도 진행 줄이 이어지게. */
function trackInstallProgress(event: UpscaleProgressEvent) {
  if (!event.stage || !INSTALL_STAGES.has(event.stage)) return;
  const installs = { ...snapshot.installs };
  if (event.done || event.error) {
    delete installs[event.engine];
    publish({ installs });
    // 끝났으면(성공이든 실패든) 폴더 상태가 바뀌었으니 다시 읽습니다.
    void listEngines();
    return;
  }
  installs[event.engine] = {
    stage: event.stage,
    percent: typeof event.percent === "number" ? event.percent : null,
    message: event.message ?? "",
  };
  publish({ installs });
}

export const UPSCALE_STAGE_LABELS: Record<string, string> = {
  uv: "uv 준비",
  python: "파이썬 환경",
  deps: "패키지 설치",
  code: "코드 받기",
  models: "가중치 받기",
  verify: "검증",
  run: "실행",
};

/* ────────────────────────── 설치·제거 ────────────────────────── */

function assertDesktop(what: string) {
  if (!isDesktopApp()) throw new Error(`데스크톱 앱에서만 ${what}할 수 있습니다.`);
}

/**
 * 엔진을 설치합니다(오래 걸림 — 수 GB). 진행은 `onProgress` 와 전역 캐시 둘 다로 갑니다.
 * SeedVR2 의 추가 모델(sharp·3B)은 설정의 체크를 읽어 함께 넘깁니다.
 */
export async function installEngine(id: UpscaleEngineId, onProgress?: (event: UpscaleProgressEvent) => void): Promise<void> {
  assertDesktop("엔진을 설치");
  if (id === "comfy") throw new Error("ComfyUI 는 설치하는 것이 아니라 주소와 워크플로를 잡는 것입니다.");
  await ensureProgressHook();
  const off = onProgress ? onUpscaleProgress(onProgress, id) : () => {};
  const settings = getUpscaleSettings();
  const extraModels =
    id === "seedvr2"
      ? [settings.seedvr2.extraModels.sharp ? "7b_sharp" : "", settings.seedvr2.extraModels.b3 ? "3b" : ""].filter(Boolean)
      : [];
  publish({ installs: { ...snapshot.installs, [id]: { stage: "uv", percent: null, message: "시작하는 중" } } });
  try {
    await invoke("upscale_install_engine", { id, extraModels });
  } finally {
    off();
    const installs = { ...snapshot.installs };
    delete installs[id];
    publish({ installs });
    await listEngines();
  }
}

/** 설치를 멈춥니다. 받다 만 파일은 다음 설치 때 이어받습니다. */
export async function cancelInstall(id: UpscaleEngineId): Promise<void> {
  assertDesktop("설치를 취소");
  await invoke("upscale_cancel_install", { id });
}

/** `upscale/engines/<id>/` 만 지웁니다(Rust 가 그 안인지 확인). 가중치도 같이 사라집니다. */
export async function uninstallEngine(id: UpscaleEngineId): Promise<void> {
  assertDesktop("엔진을 제거");
  if (id === "comfy") throw new Error("ComfyUI 는 제거할 것이 없습니다. 워크플로 경로를 비우세요.");
  try {
    await invoke("upscale_uninstall_engine", { id });
  } finally {
    await listEngines();
  }
}

/** 워커가 `ready` 로 알린 것(CUDA·장치·torch·VRAM). 워커가 안 떠 있으면 null. */
export async function workerInfo(engine: UpscaleEngineId): Promise<UpscaleWorkerInfo | null> {
  if (!isDesktopApp() || engine === "comfy") return null;
  const raw = await invoke<{ cuda?: boolean; device?: string; torch?: string; vram_gb?: number; vramGb?: number } | null>(
    "upscale_worker_info",
    { engine },
  );
  if (!raw) return null;
  return {
    cuda: Boolean(raw.cuda),
    device: raw.device ?? "",
    torch: raw.torch ?? "",
    vramGb: Number(raw.vram_gb ?? raw.vramGb ?? 0) || 0,
  };
}

/** 워커를 전부 내립니다(`quit` → 3초 뒤 PID 로 kill). VRAM 을 비우고 싶을 때. */
export async function stopWorkers(): Promise<void> {
  if (!isDesktopApp()) return;
  await invoke("upscale_stop_workers");
}

/* ────────────────────────── 기본 엔진 고르기 ────────────────────────── */

/** 설치돼 있어 지금 쓸 수 있는 엔진(우선순위 순). */
export function availableEngines(): UpscaleEngineStatus[] {
  return snapshot.engines.filter((engine) => engine.installed).sort((a, b) => a.priority - b.priority);
}

/**
 * «업스케일» 단추가 쓸 엔진 — 설정에서 고른 것이 설치돼 있으면 그것, 아니면 설치된 것 중 첫째.
 * 아무것도 없으면 null(단추가 숨습니다).
 */
export function defaultEngine(): UpscaleEngineId | null {
  const wanted = getUpscaleSettings().defaultEngine;
  const available = availableEngines();
  if (wanted && available.some((engine) => engine.id === wanted)) return wanted;
  return available[0]?.id ?? null;
}

/** 업스케일 단추를 보여도 되는가 — 데스크톱이고 쓸 엔진이 하나라도 있음(동기, 렌더 중에 부릅니다). */
export function isUpscaleReady(): boolean {
  return isDesktopApp() && defaultEngine() !== null;
}

/* ────────────────────────── ComfyUI 다리 (외부 엔진) ────────────────────────── */

/** «연결 확인» — 성공하면 «ComfyUI 0.3.x · NVIDIA … · VRAM 24 GB» 같은 한 줄, 실패하면 throw(한국어). */
export async function checkComfy(baseUrl = getComfySettings().baseUrl): Promise<string> {
  if (!isDesktopApp()) throw new Error("데스크톱 앱에서만 ComfyUI 에 연결할 수 있습니다.");
  return invoke<string>("comfy_check_connection", { baseUrl });
}

export interface ComfyWorkflowInfo {
  nodeCount: number;
  loadImageNodes: number;
  saveImageNodes: number;
  /** SeedVR2 노드(`new_resolution` 있음) 수. 0 이면 목표 크기를 못 넣고 그대로 돌립니다. */
  seedvr2Nodes: number;
}

/** 워크플로 JSON 이 쓸 만한지 — LoadImage 하나·SaveImage 하나가 있어야 합니다. 형식이 틀리면 throw. */
export async function inspectComfyWorkflow(workflowPath = getComfySettings().workflowPath): Promise<ComfyWorkflowInfo> {
  if (!isDesktopApp()) throw new Error("데스크톱 앱에서만 워크플로를 읽을 수 있습니다.");
  if (!workflowPath.trim()) throw new Error("워크플로 파일을 먼저 고르세요.");
  return invoke<ComfyWorkflowInfo>("comfy_inspect_workflow", { workflowPath });
}

/** 워크플로 검사 결과를 사람 말로. 문제가 있으면 그 문장, 없으면 null. */
export function workflowProblem(info: ComfyWorkflowInfo): string | null {
  if (info.loadImageNodes === 0) return "LoadImage 노드가 없습니다. 원본을 받을 LoadImage 노드 하나가 필요합니다.";
  if (info.loadImageNodes > 1) return `LoadImage 노드가 ${info.loadImageNodes}개입니다. 하나만 남기세요.`;
  if (info.saveImageNodes === 0) return "SaveImage 노드가 없습니다. 결과를 받을 SaveImage 노드 하나가 필요합니다.";
  return null;
}

/**
 * 워크플로 JSON 파일을 고릅니다. 취소하면 null, 고르면 경로.
 * 지금 잡힌 파일의 폴더에서 대화상자를 엽니다 — 매번 드라이브 뿌리에서 찾게 두지 않습니다.
 */
export async function chooseComfyWorkflowFile(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  const current = getComfySettings().workflowPath;
  const directory = current ? current.split(/[\\/]/).slice(0, -1).join("\\") : "";
  const picked = await invoke<{ path: string; contents: string } | null>("choose_text_file", {
    directory,
    extension: "json",
  });
  return picked?.path ?? null;
}

/* ────────────────────────── 업스케일 실행 ────────────────────────── */

export interface UpscaleTargetSpec {
  /** 목표 긴 변(px). 짧은 변은 비율대로(16 배수). */
  long_edge?: number;
  /** 배율(2·3·4). long_edge 가 있으면 무시. */
  scale?: number;
}

export interface UpscaleResult {
  /** 결과가 놓인 경로 (덮어썼으면 원본 경로 그대로) */
  path: string;
  width: number;
  height: number;
  seconds: number;
  /** 실제로 쓴 엔진. */
  engine: UpscaleEngineId;
  /** comfy 전용 — SeedVR2 노드에 넣은 짧은 변. null 이면 워크플로를 손대지 않고 그대로 돌렸습니다. */
  seedvr2Resolution?: number | null;
}

/** «업스케일» 단추·메뉴가 넘기는 선택. 비우면 설정의 기본값. */
export interface UpscaleRunOptions {
  engine?: UpscaleEngineId;
  /** 목표 긴 변. `targetSize` 와 같은 뜻(옛 이름 — 6면 흐름이 씁니다). */
  target?: number;
}

export interface UpscaleOptions extends UpscaleRunOptions {
  /** 목표 긴 변. 비우면 설정의 «기본 목표 크기». */
  targetSize?: number;
  /** 배율. 목표 긴 변이 없을 때만. */
  scale?: number;
  /** 기다릴 최대 초. 비우면 목표 크기에 따라 (`upscaleTimeoutFor`). */
  timeoutSecs?: number;
  /** 진행 — 한 줄 문구와(있으면) 퍼센트. 취소는 못 합니다. */
  onProgress?: (message: string, percent?: number | null) => void;
}

/** 엔진에 넘길 옵션 — 설정에서 고른 모델 등. 워커의 `opts` 로 그대로 갑니다. */
function engineOpts(engine: UpscaleEngineId, settings: UpscaleSettings): Record<string, unknown> {
  const common = { keep_worker: settings.keepWorker };
  switch (engine) {
    case "seedvr2":
      return { ...common, model: settings.seedvr2.model };
    case "spandrel":
      return { ...common, model: settings.spandrel.model };
    default:
      return common;
  }
}

/** 지금 도는 작업 수 — «워커 유지» 를 껐을 때 마지막 작업이 끝나야 워커를 내립니다. */
let runningJobs = 0;

/**
 * «한 묶음»(6면 세트 등)이 도는 동안 켜 둡니다. 켜져 있으면 파일 하나가 끝날 때마다
 * 워커를 내리지 않고 묶음이 끝난 뒤 한 번만 내립니다.
 *
 * 예전에는 파일마다 `void stopWorkers()` 를 **기다리지 않고** 던지고 바로 다음 파일을
 * 시작했습니다. 그 사이 `ensure_worker` 가 아직 살아 있는 워커를 재사용하면, 곧이어 도착한
 * stop 이 작업 중인 그 워커를 죽여 「워커가 멈췄습니다」 로 실패했습니다
 * (재현: «작업 후 워커 유지» 를 끄고 6면 세트 업스케일).
 */
let batchDepth = 0;

/**
 * 지금 이 앱 어딘가에서 업스케일이 돌고 있는가.
 *
 * 창마다 들고 있는 `busy`(useUpscaleActions)로는 **다른 창의 작업이 안 보입니다.** 편집 창을
 * 여럿 띄우고 각각 «업스케일» 을 누르면 엔진 둘이 겹쳐 돌아, 같은 창에서 막으려던 VRAM
 * 다툼이 창을 옮기면 그대로 일어납니다. 엔진은 앱에 하나뿐이니 판단도 여기서 합니다.
 */
export function isUpscaleRunning(): boolean {
  return runningJobs > 0 || batchDepth > 0;
}

/**
 * 파일 하나를 업스케일합니다 — 사양의 `upscaleFile`. 결과는 `output` 에 씁니다(같은 경로면 덮어쓰기 —
 * Rust 가 임시 파일에 받은 뒤 **원본을 지우지 않고 그 위로** rename 하므로, 받다 끊기거나
 * 바꿔치기가 실패해도 원본은 그대로 남습니다. 실패하면 오류 문구가 남은 결과 파일 자리를 알려 줍니다).
 * `numbered` 면 output 의 이름 끝에 빈 번호 `_NNN` 을 Rust 가 붙입니다(덮어쓰지 않음).
 * 실패하면 throw(한국어) — 부르는 쪽이 원본 그대로 두고 안내합니다.
 */
export async function upscaleFile(request: {
  engine?: UpscaleEngineId;
  input: string;
  output: string;
  target?: UpscaleTargetSpec;
  numbered?: boolean;
  opts?: Record<string, unknown>;
  timeoutSecs?: number;
  onProgress?: (message: string, percent?: number | null) => void;
}): Promise<UpscaleResult> {
  assertDesktop("업스케일");
  const settings = getUpscaleSettings();
  const engine = request.engine ?? defaultEngine();
  if (!engine) throw new Error("설치된 업스케일 엔진이 없습니다. 설정 → 업스케일 엔진에서 하나를 설치하세요.");
  const target: UpscaleTargetSpec =
    request.target && (request.target.long_edge || request.target.scale) ? request.target : { long_edge: settings.defaultTarget };
  const longEdge = target.long_edge ?? settings.defaultTarget;
  const timeoutSecs = request.timeoutSecs ?? upscaleTimeoutFor(longEdge);

  if (engine === "comfy") return runComfy(request.input, request.output, Boolean(request.numbered), longEdge, timeoutSecs, request.onProgress);

  const status = snapshot.engines.find((item) => item.id === engine);
  if (status && !status.installed) {
    throw new Error(`${status.name} 이(가) 설치돼 있지 않습니다. 설정 → 업스케일 엔진에서 설치하세요.`);
  }
  await ensureProgressHook();
  // 작업 진행은 설치 단계가 아닌 이벤트(stage 없음 또는 "run")로 옵니다. 같은 엔진의 것만 받습니다.
  const off = onUpscaleProgress((event) => {
    if (event.stage && INSTALL_STAGES.has(event.stage)) return;
    if (event.done || event.error) return;
    request.onProgress?.(event.message || "업스케일 중", typeof event.percent === "number" ? event.percent : null);
  }, engine);
  runningJobs += 1;
  request.onProgress?.("워커에 보내는 중", null);
  try {
    const raw = await invoke<{ output?: string; path?: string; width?: number; height?: number; seconds?: number }>("upscale_run", {
      engine,
      inputPath: request.input,
      outputPath: request.output,
      target,
      numbered: Boolean(request.numbered),
      opts: { ...engineOpts(engine, settings), ...(request.opts ?? {}), numbered: Boolean(request.numbered), timeout_secs: timeoutSecs },
      timeoutSecs,
    });
    request.onProgress?.("받았습니다", 100);
    return {
      path: raw.output ?? raw.path ?? request.output,
      width: Number(raw.width ?? 0) || 0,
      height: Number(raw.height ?? 0) || 0,
      seconds: Number(raw.seconds ?? 0) || 0,
      engine,
    };
  } finally {
    off();
    runningJobs -= 1;
    // «작업 후 워커 유지» 를 껐으면 마지막 작업이 끝날 때 내립니다. 실패해도 조용히 — 다음 작업이 다시 띄웁니다.
    // **기다립니다**(await): 던져 놓고 다음 파일을 시작하면 그 stop 이 새 작업의 워커를 끊습니다.
    if (!settings.keepWorker && runningJobs === 0 && batchDepth === 0) {
      await stopWorkers().catch(() => undefined);
    }
  }
}

/** 옛 ComfyUI 다리. 목표 긴 변만 받고 진행 퍼센트는 없습니다(ComfyUI 큐를 되돌리지 못하니 취소도 없음). */
async function runComfy(
  imagePath: string,
  outPath: string,
  numbered: boolean,
  targetSize: number,
  timeoutSecs: number,
  onProgress?: (message: string, percent?: number | null) => void,
): Promise<UpscaleResult> {
  const settings = getComfySettings();
  if (!settings.workflowPath.trim()) {
    throw new Error("ComfyUI 워크플로가 설정돼 있지 않습니다. 설정 → 업스케일 엔진 → 외부 엔진에서 고르세요.");
  }
  onProgress?.("ComfyUI 에 보내는 중", null);
  const started = Date.now();
  const result = await invoke<{ path: string; seedvr2Resolution: number | null }>("comfy_upscale_image", {
    baseUrl: settings.baseUrl,
    workflowPath: settings.workflowPath,
    imagePath,
    outPath,
    timeoutSecs,
    targetSize,
    numbered,
  });
  onProgress?.("받았습니다", 100);
  return {
    path: result.path,
    width: 0,
    height: 0,
    seconds: (Date.now() - started) / 1000,
    engine: "comfy",
    seedvr2Resolution: result.seedvr2Resolution,
  };
}

function targetFrom(options: UpscaleOptions): UpscaleTargetSpec | undefined {
  const longEdge = options.targetSize ?? options.target;
  if (longEdge && longEdge > 0) return { long_edge: Math.round(longEdge) };
  if (options.scale && options.scale > 0) return { scale: Math.round(options.scale) };
  return undefined;
}

/**
 * 파일 하나를 업스케일해 **같은 경로에 덮어씁니다.** (이름 유지 — 6면 세트가 깨지지 않게)
 */
export async function upscaleFileInPlace(
  path: string,
  onProgress?: (message: string, percent?: number | null) => void,
  options: Omit<UpscaleOptions, "onProgress"> = {},
): Promise<UpscaleResult> {
  return upscaleFile({
    engine: options.engine,
    input: path,
    output: path,
    target: targetFrom(options),
    timeoutSecs: options.timeoutSecs,
    onProgress,
  });
}

/**
 * 파일 하나를 업스케일해 **같은 폴더에 새 파일**로 둡니다. 이름은 `<stem>_NNN` — 번호는 Rust 가
 * 저장 규칙대로 붙입니다(덮어쓰지 않음). «업스케일» 단추가 씁니다.
 * `stem` 은 `editedStem({ action: "업스케일", … })` 로 만들어 넘기세요.
 */
export async function upscaleFileToNew(path: string, stem: string, options: UpscaleOptions = {}): Promise<UpscaleResult> {
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]/);
  const fileName = parts.pop() || "";
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1) : "png";
  const outPath = [...parts, `${stem.trim()}.${ext}`].join(separator);
  return upscaleFile({
    engine: options.engine,
    input: path,
    output: outPath,
    numbered: true,
    target: targetFrom(options),
    timeoutSecs: options.timeoutSecs,
    onProgress: options.onProgress,
  });
}

/**
 * 여러 장을 **차례로** 업스케일합니다(덮어쓰기). 한꺼번에 넣으면 VRAM 을 다투어 느려지거나 죽으니
 * 하나씩. 진행은 «정면 업스케일 중 1/6» 꼴로 알리고, 워커가 퍼센트를 주면 «(37%)» 를 덧붙입니다.
 * 하나가 실패하면 거기서 멈추고 throw — 앞서 끝난 것은 이미 덮여 있습니다.
 */
export async function upscaleFilesInPlace(
  items: { path: string; label: string }[],
  onProgress?: (message: string, index: number, total: number) => void,
  options: Omit<UpscaleOptions, "onProgress"> = {},
): Promise<UpscaleResult[]> {
  const results: UpscaleResult[] = [];
  // 묶음이 도는 동안에는 파일 하나가 끝날 때마다 워커를 내리지 않습니다(batchDepth 설명 참조).
  batchDepth += 1;
  try {
    for (const [index, item] of items.entries()) {
      const head = `${item.label} 업스케일 중 ${index + 1}/${items.length}`;
      onProgress?.(head, index, items.length);
      results.push(
        await upscaleFileInPlace(
          item.path,
          (_message, percent) => {
            if (typeof percent === "number" && percent > 0 && percent < 100) onProgress?.(`${head} (${Math.round(percent)}%)`, index, items.length);
          },
          options,
        ),
      );
    }
  } finally {
    batchDepth -= 1;
    // 묶음이 끝난 뒤 한 번만. 실패해도 조용히 — 다음 작업이 다시 띄웁니다.
    if (!getUpscaleSettings().keepWorker && runningJobs === 0 && batchDepth === 0) {
      await stopWorkers().catch(() => undefined);
    }
  }
  return results;
}

/** 바이트를 «1.2 GB» 꼴로. 설정 표의 용량 칸. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
