import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isDesktopApp } from "@/lib/llm";
import { isEngineIncluded } from "@/lib/edition";
import { queueMirrorWriteAndConfirm, registerMirrorSection, whenAppSettingsReady } from "@/lib/mediaLibrary";

/**
 * 로컬 생성 엔진 — 프런트 쪽.
 *
 *
 *
 * 살림(설치·워커·취소·제거)은 업스케일 엔진과 **같은 Rust 코드**를 씁니다
 * (`src-tauri/src/upscale.rs` 의 `Family`). 이 파일은 `upscale.ts` 와 같은 모양의
 * 구독 저장소입니다 — 설치는 수십 분이 걸리고 화면을 떠나 있는 동안에도 진행 이벤트가
 * 오므로, 상태를 컴포넌트가 아니라 모듈이 듭니다.
 *
 * # 미니맥스를 씁니다
 *
 * 맞습니다. **MiniMax-H3**
 * (영상+오디오, 2026-08-03)와 **MiniMax-Music3**(2026-08-13)가 오픈 웨이트로 공개됐고
 * diffusers 로 바로 돕니다. 컴피UI 를 거치지 않고 우리가 직접 돌립니다.
 *
 * Wan·ACE-Step 은 **가벼운 대안**으로 남깁니다. H3 는 bf16 기준 125 GB 짜리라 int8 로
 * 줄여도 호스트 RAM 이 75 GB 쯤 있어야 합니다. 그 문턱에 못 미치는 기계에서도 뭔가는
 * 돌아가야 합니다.
 */

export type LocalEngineId =
  | "minimaxh3"
  | "minimaxmusic"
  | "qwenimage"
  | "zimage"
  | "krea2"
  | "anima"
  | "wanvideo"
  | "ltx25"
  | "acestep"
  | "sam3dbody"
  | "nlf"
  | "gvhmr";

export type LocalEngineKind = "image" | "video" | "music" | "mocap";

/**
 * 이 빌드에 실린 엔진 — 상태 캐시·설치 목록·모델 고르기·로라 서랍이 전부 이 목록을 돕니다.
 * (`Object.keys(LOCAL_ENGINE_CATALOG)` 로 세지 마세요 — 카탈로그는 판과 무관하게 전부 들고 있습니다.)
 *
 * 공개판(`lib/edition.ts`)에서 빠진 엔진은 **여기서** 걸러집니다. 화면마다 거르면 한 화면을 빠뜨립니다.
 */
export const LOCAL_ENGINE_IDS: LocalEngineId[] = (
  [
    "minimaxh3",
    "minimaxmusic",
    "qwenimage",
    "zimage",
    "krea2",
    "anima",
    "wanvideo",
    "ltx25",
    "acestep",
    "sam3dbody",
    "nlf",
    "gvhmr",
  ] as LocalEngineId[]
).filter(isEngineIncluded);

/* ────────────────────────── 정밀도 규칙(워커와 한 벌) ────────────────────────── */

/**
 * **판단은 워커 안에서** 합니다 — 앱이 nvidia-smi 로 읽은 값과 torch 가 보는 값이 다를 수
 * 있고(여러 장·MIG), 실제로 모델을 올리는 쪽이 torch 니까요. 아래는 그 규칙을 화면이
 * **미리 보여 주려고** 옮겨 적은 것입니다(`src-tauri/resources/local/common.py`).
 *
 * 옮겨 적은 것이라 어긋날 수 있어서, `precisionPolicy.test.ts` 가 파이썬 파일의 상수와
 * 공식을 직접 읽어 견줍니다. 한쪽만 고치면 시험이 멈춥니다.
 */

/** 가중치 말고도 텍스트 인코더·VAE·중간값이 함께 올라갑니다 — VRAM 을 이만큼 나눠 봅니다. */
export const PRECISION_HEADROOM = 1.25;
/** int8 은 bf16 의 절반쯤을 씁니다. */
export const INT8_FRACTION = 2;
/** 정밀도 사다리 — 왼쪽이 원본, 오른쪽으로 갈수록 작고 거칩니다. */
export const PRECISION_LADDER = ["bf16", "int8", "int4"] as const;

/** 실제로 모델이 올라가는 정밀도(«자동» 은 아직 고르지 않은 상태라 여기 없습니다). */
export type EnginePrecision = (typeof PRECISION_LADDER)[number];

/**
 * 이 크기의 모델을 이 VRAM 에 올리면 **어떤 정밀도가 되는가** — 워커의 `plan_precision`
 * 과 같은 공식입니다.
 *
 * GPU 를 못 읽었거나 없으면 bf16 입니다 — CPU 뿐이면 양자화가 오히려 느립니다
 * (bitsandbytes 는 CUDA 전용).
 */
export function planPrecision(bf16Gb: number, vramGb: number): EnginePrecision {
  if (!(vramGb > 0)) return "bf16";
  const room = vramGb / PRECISION_HEADROOM;
  if (room >= bf16Gb) return "bf16";
  if (room >= bf16Gb / INT8_FRACTION) return "int8";
  return "int4";
}

/**
 * 엔진이 실제로 할 수 있는 것 중 `wanted` 에 가장 가까운 것.
 *
 * **작은 쪽을 먼저** 봅니다 — 못 줄여서 안 도는 것보다, 더 줄여서라도 도는 편이 낫습니다.
 * (워커의 `_nearest_precision` 과 같은 차례여야 합니다.)
 */
export function clampPrecision(
  wanted: EnginePrecision,
  supported?: EnginePrecision[],
): EnginePrecision {
  if (!supported || supported.length === 0 || supported.includes(wanted)) return wanted;
  const order = [...PRECISION_LADDER];
  const start = order.indexOf(wanted);
  for (const mode of [...order.slice(start), ...order.slice(0, start).reverse()]) {
    if (supported.includes(mode)) return mode;
  }
  return wanted;
}

export interface LocalEngineInfo {
  id: LocalEngineId;
  kind: LocalEngineKind;
  name: string;
  purpose: string;
  license: string;
  /** 설치 전에 보여 줄 대략 용량(환경 + 가중치). 실제는 상태의 `diskBytes`. */
  sizeHint: string;
  /** 결과 파일 확장자. 엔진이 정합니다 — 화면에서 고르게 하면 엇갈립니다. */
  extension: string;
  /** 같은 갈래에서 먼저 고를 순서(작을수록 먼저). */
  priority: number;
  /**
   * **동작을 그대로 옮길 수 있는가**(컨트롤넷·포즈 조건).
   *
   *
   *
   * 아무 모델에나 뼈 그림을 준다고 따라 그리지 않습니다 — **그 조건을 학습한 가지**가
   * 따로 있어야 합니다. 없는 엔진에 주면 조용히 무시되고, 사람은 「왜 안 따라 하지」 를
   * 한참 뒤에야 알게 됩니다. 그래서 받는 엔진만 켜 두고 화면에서도 그 엔진일 때만 묻습니다.
   */
  pose?: boolean;
  /**
   * **이 기계에서 돌아갈까**를 재는 기준.
   *
   * 125 GB 를 한 시간 받고 나서 「VRAM 이 모자랍니다」 를 보는 것이 가장 나쁩니다.
   * 그래서 설치 단추 옆에 미리 적습니다.
   */
  needs: EngineNeeds;
  /**
   * 이 엔진이 **실제로 올릴 수 있는 정밀도**. 안 적으면 셋 다 됩니다.
   *
   * 워커 엔진 모듈의 `SUPPORTED` 와 **같아야** 합니다(`precisionPolicy.test.ts` 가 셉니다).
   * 모듈러 파이프라인처럼 아직 양자화 길이 없는 엔진이 있어서, 규칙이 int8 을 골라도
   * 실제로는 bf16 이 올라갑니다 — 그 차이를 화면이 알고 있어야 「줄였는데 왜 안 가벼워지지」
   * 를 설명할 수 있습니다.
   */
  precisionModes?: EnginePrecision[];
}

export interface EngineNeeds {
  /**
   * 이 모델을 bf16 으로 통째로 올릴 때의 **모델 크기**(GB).
   *
   * 워커 엔진 모듈의 `BF16_GB` 와 **같은 값**이어야 합니다 — 정밀도를 고르는 잣대가 이
   * 숫자 하나이고, 두 벌로 적어 두면 한쪽만 고치는 날이 옵니다(`precisionPolicy.test.ts`
   * 가 파이썬 쪽을 직접 읽어 셉니다). 모션 캡처 엔진처럼 정밀도 개념이 없는 쪽은 없습니다.
   */
  bf16Gb?: number;
  /**
   * 원래 정밀도(bf16)로 돌리는 데 필요한 VRAM(GB).
   *
   * `bf16Gb` 가 있으면 **손으로 적지 않습니다** — 워커와 같은 여유(`PRECISION_HEADROOM`)를
   * 얹어 `vramNeeds` 가 셈합니다. 손으로 적던 시절에는 화면이 「24 GB 면 원래 정밀도로
   * 돕니다」 라고 적고 워커는 그 카드에서 int8 로 올리고 있었습니다.
   */
  vramGb: number;
  /**
   * 양자화해서(또는 흘려서) 줄였을 때 최소 이만큼의 VRAM(GB).
   *
   * 이것은 공식이 아니라 **실측**입니다 — 오프로드가 어디까지 버티느냐라서 계산으로 안 나옵니다.
   * 없으면 줄여도 안 돈다는 뜻입니다.
   */
  quantVramGb?: number;
  /** 양자화로 돌 때 호스트 RAM 이 이만큼 필요합니다(GB) — 오프로드가 여기로 흘립니다. */
  ramGb?: number;
  /** 디스크(GB) — `sizeHint` 의 숫자와 같아야 합니다. */
  diskGb: number;
  /** 줄이는 방법을 사람 말로. 없으면 줄일 수 없습니다. */
  quantNote?: string;
}

/**
 * `needs` 한 칸을 만듭니다 — `bf16Gb` 를 주면 `vramGb` 는 **여기서** 셈합니다.
 *
 * 카탈로그에 숫자를 두 개 적어 두면 하나만 고치게 됩니다. 정밀도가 없는 엔진(모션 캡처)은
 * `vramGb` 를 그대로 적습니다.
 */
function vramNeeds(
  spec: Omit<EngineNeeds, "vramGb"> & { vramGb?: number },
): EngineNeeds {
  const { bf16Gb, vramGb, ...rest } = spec;
  if (bf16Gb == null && vramGb == null) {
    throw new Error("엔진의 VRAM 기준이 없습니다 — bf16Gb 나 vramGb 중 하나는 있어야 합니다.");
  }
  return {
    ...rest,
    bf16Gb,
    vramGb: bf16Gb != null ? bf16Gb * PRECISION_HEADROOM : (vramGb as number),
  };
}

/** 이 컴퓨터를 한 번 읽은 것. 못 읽은 값은 null 입니다. */
export interface HardwareProbe {
  gpus: { name: string; vramGb: number | null; vendor: string }[];
  ramGb: number | null;
  diskFreeGb: number | null;
  enginesDir: string;
}

export type EngineFitLevel = "ok" | "quant" | "tight" | "no" | "unknown";

export interface EngineFit {
  level: EngineFitLevel;
  /** 화면에 그대로 적을 한 줄. */
  note: string;
}

/**
 * 이 엔진이 **이 기계에서** 돌까.
 *
 * «모르면 모른다» 고 합니다 — nvidia-smi 가 없는 기계에서 넉넉하다고 적었다가 한 시간을
 * 받게 하는 것보다, 확인 못 했다고 두는 편이 낫습니다.
 */
export function engineFit(engine: LocalEngineInfo, probe: HardwareProbe | null): EngineFit {
  if (!probe) return { level: "unknown", note: "하드웨어를 아직 확인하지 않았습니다" };
  const vram = bestVramGb(probe);
  const disk = probe.diskFreeGb;
  const needs = engine.needs;

  // 디스크가 모자라면 VRAM 을 볼 것도 없습니다 — 받다가 중간에 멈춥니다.
  if (disk != null && disk < needs.diskGb) {
    return {
      level: "no",
      note: `디스크가 모자랍니다 — ${needs.diskGb} GB 가 필요한데 ${Math.floor(disk)} GB 남았습니다`,
    };
  }
  if (vram == null) {
    return { level: "unknown", note: "GPU 를 읽지 못했습니다 — 직접 확인하세요" };
  }
  /*
    bf16 으로 도는가는 **워커와 같은 공식**으로 봅니다. 여기서 재는 것은 «줄여야 하는가» 라서
    엔진이 실제로 줄일 수 있는지(`precisionModes`)는 보지 않습니다 — 못 줄이는 엔진이라면
    아래 `quantVramGb` 가 없어 그대로 «안 됩니다» 가 됩니다.
    정밀도 개념이 없는 엔진(모션 캡처)은 손으로 적은 `vramGb` 와 그냥 견줍니다.
  */
  const bf16 =
    needs.bf16Gb != null ? planPrecision(needs.bf16Gb, vram) === "bf16" : vram >= needs.vramGb;
  if (bf16) {
    return { level: "ok", note: `VRAM ${vram} GB — 원래 정밀도로 돕니다` };
  }
  const quant = needs.quantVramGb;
  if (quant != null && vram >= quant) {
    const ramShort = needs.ramGb != null && probe.ramGb != null && probe.ramGb < needs.ramGb;
    if (ramShort) {
      return {
        level: "tight",
        note: `VRAM ${vram} GB — 줄이면 돌지만 시스템 RAM 이 ${needs.ramGb} GB 필요합니다(지금 ${probe.ramGb} GB)`,
      };
    }
    return {
      level: "quant",
      note: `VRAM ${vram} GB — ${needs.quantNote || "양자화해서"} 돌립니다`,
    };
  }
  return {
    level: "no",
    note: `VRAM ${vram} GB — ${gb(needs.vramGb)} GB 가 필요합니다${quant != null ? ` (줄여도 ${quant} GB)` : ""}`,
  };
}

/** 셈해서 나온 GB 를 화면에 적을 꼴로 — `23.75` 는 «23.8», `60` 은 그냥 «60». */
function gb(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * 여러 장이면 **가장 큰 것** 하나로 봅니다 — 모델 하나는 한 장에 올라가고, 워커도 0번
 * 장치를 봅니다. 못 읽었으면 null(«모르면 모른다»).
 */
function bestVramGb(probe: HardwareProbe | null): number | null {
  return (
    probe?.gpus.reduce<number | null>(
      (best, gpu) => (gpu.vramGb != null && (best == null || gpu.vramGb > best) ? gpu.vramGb : best),
      null,
    ) ?? null
  );
}

/**
 * 사람 말은 여기, 고정 판·의존성은 리소스의 manifest 에. 두 곳에 적으면 하나만 바뀝니다.
 * (`src-tauri/resources/local/engines/<id>/manifest.json`)
 */
export const LOCAL_ENGINE_CATALOG: Record<LocalEngineId, LocalEngineInfo> = {
  minimaxh3: {
    id: "minimaxh3",
    kind: "video",
    name: "영상 — MiniMax-H3 · 멀티 로라",
    purpose:
      "영상과 사운드트랙을 한 번에. 구도잡기 레퍼런스 영상·인물 시트·배경을 통째로 물려 그 움직임과 인물을 그대로 따릅니다. 24fps · 5~15초.",
    license: "모델 카드 확인 — 오픈 웨이트(2026-08-03)",
    /*
      125 → 190 GB (2026-09-22). 사용자의 기계에는 글·첫 프레임용 transformer(62 GB)·text_encoder(63 GB)만
      있고 **레퍼런스용 transformer_ref(62 GB)가 없었습니다** — 첫 생성 때 그 워크플로 것만 받았기 때문.
      이제 설치 때 저장소를 통째로 받아 두므로 그 62 GB 까지 넣어 적습니다.
    */
    sizeHint: "약 190 GB (레퍼런스용 transformer_ref 62 GB 까지 설치 때 받아 둡니다) · 24~32 GB 카드는 int8 로 돌며 호스트 RAM 75 GB 필요",
    extension: "mp4",
    priority: 0,
    // 트랜스포머 61.7 + 조건화기 62.1. 여유를 얹으면 bf16 문턱이 155 GB 라, 지금 나와 있는
    // 어떤 카드로도 원본은 못 올립니다 — 96 GB 카드도 int8 입니다.
    needs: vramNeeds({ bf16Gb: 124, quantVramGb: 24, ramGb: 75, diskGb: 190, quantNote: "int8 로 줄이고 호스트 RAM 으로 흘려" }),
    // int4 길은 없습니다 — 여기 양자화는 torchao int8 이라야 텐서가 pin 되고, pin 이 돼야 스트리밍 오프로드가 됩니다.
    precisionModes: ["bf16", "int8"],
  },
  minimaxmusic: {
    id: "minimaxmusic",
    kind: "music",
    name: "음악 — MiniMax-Music3",
    purpose:
      "한 번에 5분짜리 완곡. 토막이 아니라 도입·전개·후렴이 이어집니다. 가사를 비우면 연주곡. 32kHz 스테레오.",
    license: "상업 가능(«MiniMax Music 3» 표기 필요) — 오픈 웨이트(2026-08-13)",
    sizeHint: "약 20 GB · 24 GB 권장, 8 GB 대도 돎",
    extension: "wav",
    priority: 0,
    // 「fp16 로 줄여」 라고 적어 두었지만 워커에는 그런 길이 없습니다 — 모듈러 파이프라인이라
    // 양자화를 못 끼웁니다. 좁으면 8B 짜리 언어 모델만 흘려 보냅니다. 적힌 대로 고쳤습니다.
    needs: vramNeeds({ bf16Gb: 19, quantVramGb: 8, ramGb: 16, diskGb: 20, quantNote: "언어 모델을 CPU 로 흘려" }),
    precisionModes: ["bf16"],
  },
  qwenimage: {
    id: "qwenimage",
    kind: "image",
    name: "그림 — Qwen-Image (20B)",
    purpose:
      "말을 가장 곧이곧대로 듣습니다. 간판·표지판 글자가 들어가거나 「왼쪽에 둘」 처럼 세는 지시가 있는 컷에.",
    license: "Apache 2.0 — 상업 이용 제한 없음",
    sizeHint: "약 45 GB (가중치 40 GB + 파이썬 환경)",
    extension: "png",
    priority: 0,
    needs: vramNeeds({ bf16Gb: 24, quantVramGb: 12, ramGb: 32, diskGb: 45, quantNote: "int8·int4 로 줄이고 CPU 로 흘려" }),
  },
  /*
    
    둘 다 게이트 저장소라 토큰을 받아야 했고, FLUX 는 가중치가 비상업이었습니다.
    새로 들어온 둘은 성격이 확실히 갈립니다 — 하나는 «빠르고 가벼운 실사», 하나는 «애니메 전용».
  */
  zimage: {
    id: "zimage",
    kind: "image",
    name: "그림 — Z-Image Turbo (6B)",
    purpose:
      "8 스텝이면 한 장. 그림 엔진 중 가장 가벼워 16 GB 카드에서도 돕니다. 컷 하나를 여러 장 굴려 보며 고를 때.",
    license: "Apache 2.0 — 상업 이용 제한 없음",
    sizeHint: "약 18 GB (가중치 12 GB + 파이썬 환경) · 토큰 필요 없음",
    extension: "png",
    priority: 1,
    // 워커는 bitsandbytes 로 줄입니다(fp8 이 아닙니다) — 적힌 대로 고쳤습니다.
    needs: vramNeeds({ bf16Gb: 16, quantVramGb: 8, ramGb: 16, diskGb: 18, quantNote: "int8·int4 로 줄여" }),
  },
  krea2: {
    id: "krea2",
    kind: "image",
    name: "그림 — Krea 2 Turbo (12B)",
    purpose:
      "8 스텝에 사진 결. 화풍 로라 생태계가 가장 활발한 쪽 — 프로젝트의 그림체를 로라로 고정할 때.",
    license: "Krea 2 Community — 연 매출 100만 달러 미만 상업 가능",
    sizeHint: "약 32 GB (bf16 가중치 26 GB) · 허깅페이스 토큰 필요(게이트 저장소)",
    extension: "png",
    priority: 2,
    needs: vramNeeds({ bf16Gb: 32, quantVramGb: 16, ramGb: 32, diskGb: 32, quantNote: "int8·int4 로 줄여" }),
  },
  anima: {
    id: "anima",
    kind: "image",
    name: "그림 — Anima Base (2B · 애니메)",
    purpose:
      "애니메·일러스트 전용. 실사 결이 아니라 처음부터 그림체를 냅니다. 화풍이 정해진 프로젝트에.",
    license: "CircleStone Labs 비상업(가중치) — **뽑은 그림은 상업 이용 가능**",
    sizeHint: "약 14 GB (가중치 8 GB) · 토큰 필요 없음",
    extension: "png",
    priority: 3,
    // 모듈러 파이프라인이라 아직 양자화 길을 안 냈습니다. `quantVramGb` 가 없으니 여유까지
    // 얹은 10 GB 아래에서는 «안 됩니다» 로 나옵니다 — 워커가 그 카드에서 하는 말과 같습니다.
    needs: vramNeeds({ bf16Gb: 8, ramGb: 8, diskGb: 14 }),
    precisionModes: ["bf16"],
  },
  wanvideo: {
    id: "wanvideo",
    kind: "video",
    name: "영상 — Wan 2.2 (A14B) · 멀티 로라",
    purpose:
      "미니맥스 H3 가 무거운 기계를 위한 가벼운 대안. 대표 그림을 주면 그 그림에서 시작하고(I2V), 로라를 여러 개 겹칩니다.",
    license: "Apache 2.0 — 상업 이용 제한 없음",
    // 65 → 120 GB (2026-09-22). 첫 장면 그림을 주는 컷에서 I2V 판 60 GB 를 «생성 중» 안에서 말없이
    // 받던 것을, 설치 때 T2V·I2V 두 판을 다 받아 두는 것으로 바꿨습니다. 둘을 합친 값입니다.
    sizeHint: "약 120 GB (T2V·I2V 두 판을 설치 때 받아 둡니다)",
    extension: "mp4",
    // 미니맥스 H3 가 무거워 못 돌릴 때의 **가벼운 대안**입니다. 기본은 H3.
    priority: 1,
    /*
      A14B 는 전문가가 **둘**이라 bf16 원본이 126 GB 입니다(트랜스포머 57.2 × 2 + 텍스트 인코더 11.4).
      오래 24 로 적어 두었는데, 그러면 24 GB 카드 주인에게 「원래 정밀도로 돕니다」 라고 알리고는
      실제로는 int4 로 내려가 오프로드로 버팁니다.
    */
    needs: vramNeeds({ bf16Gb: 126, quantVramGb: 12, ramGb: 48, diskGb: 120, quantNote: "int4 로 줄이고 블록 오프로드로" }),
  },
  ltx25: {
    id: "ltx25",
    kind: "video",
    name: "영상 — LTX 2.5 (22B)",
    purpose:
      "해상도와 길이가 필요한 컷에. 4K·24fps 까지 가고, fp8 로 줄이면 24 GB 카드에서도 돕니다. 프레임은 8n+1.",
    license: "LTX-2.x Community — 연 매출 1,000만 달러 미만 상업 가능",
    sizeHint: "약 155 GB 를 받습니다(2026-09-18 실측 — 저장소 174 GB 에서 안 쓰는 프롬프트 다듬기 모델만 뺀 값) · 허깅페이스 토큰 + 약관 동의 필요(동의 전이면 403)",
    extension: "mp4",
    priority: 2,
    /*
      동작을 그대로 옮길 수 있는 **유일한** 엔진입니다(2026-09-17 기준). Lightricks 가 낸
      포즈 IC-LoRA 를 얹어 씁니다. Wan 2.2 도 Fun-Control 로 되지만 diffusers 가 아니라
      VideoX-Fun 저장소를 따로 깔아야 해서 아직 안 붙였습니다.
    */
    pose: true,
    // 워커는 bitsandbytes 로 줄입니다(fp8-cast 가 아닙니다) — 적힌 대로 고쳤습니다.
    needs: vramNeeds({ bf16Gb: 48, quantVramGb: 24, ramGb: 64, diskGb: 170, quantNote: "int8·int4 로 줄이고 CPU 로 흘려" }),
  },
  acestep: {
    id: "acestep",
    kind: "music",
    name: "음악 — ACE-Step v1 (3.5B)",
    purpose:
      "MiniMax-Music3 가 무거운 기계를 위한 가벼운 대안. 태그로 장르·악기·bpm 을 주고, 가사를 비우면 연주곡입니다.",
    license: "Apache 2.0 — 상업 이용 제한 없음",
    sizeHint: "약 12 GB",
    extension: "wav",
    // 미니맥스 Music3 를 못 돌릴 때의 **가벼운 대안**입니다.
    priority: 1,
    // 이 파이프라인은 bitsandbytes 로 못 줄입니다 — 대신 좁으면 CPU 오프로드로 내립니다.
    // 모델이 10 GB 라 여유를 얹은 bf16 문턱은 12.5 GB 입니다(10 GB 카드에 통째로 올리면 중간값 자리가 없습니다).
    needs: vramNeeds({ bf16Gb: 10, quantVramGb: 6, ramGb: 16, diskGb: 12, quantNote: "CPU 로 흘려" }),
    precisionModes: ["bf16"],
  },
  /*
    ── 모션 캡처 ──────────────────────────────────────────────────────────
     앱 안 MediaPipe 는 설치가 필요 없어
    목록에 없고(구도잡기 창에서 늘 고를 수 있음), 여기는 파이썬으로 도는 무거운 모델들입니다. 결과는 영상 속 사람들의 관절
    좌표 JSON — 앱이 이어 붙이기·튐 보정·리타깃을 똑같이 합니다.

    넣지 않은 것(2026-09-16 확인): WHAM 은 torch 1.11 판이라 RTX 50 계열(Blackwell) GPU 에서 안 돌고, DanceHMR 은 코드가
    공개되지 않았고, SAM3DBody-cpp 는 SAM 3D Body 와 같은 모델의 C++ 판이라 따로 둘 까닭이 없습니다.
  */
  sam3dbody: {
    id: "sam3dbody",
    kind: "mocap",
    name: "모션 캡처 — SAM 3D Body (Meta)",
    purpose:
      "지금 가장 강한 모델. 뒤돈 자세 · 가림 · 특이한 자세 · 손발까지. 한 장씩 보고 앱이 사람을 이어 붙입니다. 여러 명 가능.",
    license: "SAM License — 상업 이용 가능(군사·무기 용도 금지)",
    sizeHint:
      "약 12 GB · 허깅페이스 토큰 필요 — facebook/sam-3d-body-dinov3 페이지에서 접근 승인을 먼저 받아야 합니다",
    extension: "json",
    priority: 0,
    // 모션 캡처는 정밀도를 고르지 않습니다 — 여기 VRAM 은 실측으로 적은 값입니다.
    needs: vramNeeds({ vramGb: 12, quantVramGb: 8, ramGb: 16, diskGb: 12 }),
  },
  nlf: {
    id: "nlf",
    kind: "mocap",
    name: "모션 캡처 — NLF (Neural Localizer Fields)",
    purpose:
      "여러 명을 한 번에, 떨림이 적고 가림에 강합니다. 가입·토큰 없이 설치 한 번. 첫 분석만 모델 최적화로 30초쯤 더 걸립니다.",
    license: "**비상업 연구용** 가중치 — 상업물에는 쓰지 마세요",
    sizeHint: "약 7 GB (파이썬 환경 6.5 GB + 모델 0.5 GB)",
    extension: "json",
    priority: 1,
    needs: vramNeeds({ vramGb: 8, quantVramGb: 6, ramGb: 16, diskGb: 7 }),
  },
  gvhmr: {
    id: "gvhmr",
    kind: "mocap",
    name: "모션 캡처 — GVHMR (카메라 무빙 영상)",
    purpose:
      "카메라가 따라가며 찍은 영상에서도 사람의 **실제 이동 경로**를 복원합니다. 한 번에 한 사람(가장 크게 보이는 사람).",
    license:
      "**비상업 연구용** · SMPL-X 파일을 smpl-x.is.tue.mpg.de 에 가입해 직접 받아 엔진 폴더에 넣어야 합니다",
    sizeHint: "약 15 GB",
    extension: "json",
    priority: 2,
    needs: vramNeeds({ vramGb: 12, quantVramGb: 8, ramGb: 16, diskGb: 15 }),
  },
};

export const LOCAL_KIND_LABEL: Record<LocalEngineKind, string> = {
  image: "그림",
  video: "영상",
  music: "음악",
  mocap: "모션 캡처",
};

export interface LocalEngineStatus extends LocalEngineInfo {
  installed: boolean;
  installing: boolean;
  /**
   * 지금 가중치를 미리 받는 중인가(Rust `UpscaleState::prefetching`). `installing` 과 따로인 까닭은 «멈추기»
   * 단추 문구 — 예전에는 `installed` 로 골랐는데, 새로 까는 엔진은 uv venv 직후부터 «설치됨» 이라 패키지를
   * 받는 동안에도 「받기 멈추기」 로 보였습니다(2026-09-22 점검).
   */
  prefetching: boolean;
  version: string;
  modelsReady: boolean;
  diskBytes: number;
  /**
   * 가중치를 통째로 받아 두었는가(Rust 설치 기록의 `weights_ready`).
   *
   * 미니맥스 H3 의 레퍼런스용 `transformer_ref`(62 GB)와
   * 완 I2V 판(60 GB)이 첫 생성 안에서 말없이 내려오던 것을 미리 받아 두는 개편입니다. 이 값이
   * 아닌데 `canPrefetch` 면 카드에 «가중치 미리 받기» 단추가 뜹니다.
   */
  weightsReady: boolean;
  /** 이 엔진이 «미리 받기» 를 아는가 — manifest 의 `prefetch`(한 곳). 카탈로그에 따로 적지 않습니다. */
  canPrefetch: boolean;
  lastError: string;
}

export interface LocalProgressEvent {
  engine: string;
  stage: string;
  percent: number | null;
  message: string;
  done: boolean;
  error: string | null;
}

export interface LocalSnapshot {
  engines: LocalEngineStatus[];
  installs: Record<
    string,
    { stage: string; percent: number | null; message: string }
  >;
  loaded: boolean;
  statusError: string;
}

type RawEngineStatus = {
  id?: string;
  installed?: boolean;
  installing?: boolean;
  prefetching?: boolean;
  version?: string;
  models_ready?: boolean;
  disk_bytes?: number;
  weights_ready?: boolean;
  prefetch?: boolean;
  last_error?: string | null;
};

function blankStatus(info: LocalEngineInfo): LocalEngineStatus {
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

function mergeStatus(raw: RawEngineStatus[]): LocalEngineStatus[] {
  const byId = new Map(
    raw.filter((item) => item.id).map((item) => [item.id as string, item]),
  );
  return LOCAL_ENGINE_IDS.map((id) => {
    const info = LOCAL_ENGINE_CATALOG[id];
    const item = byId.get(id);
    if (!item) return blankStatus(info);
    return {
      ...info,
      installed: Boolean(item.installed),
      installing: Boolean(item.installing),
      prefetching: Boolean(item.prefetching),
      version: item.version ?? "",
      modelsReady: Boolean(item.models_ready),
      diskBytes: Number(item.disk_bytes ?? 0) || 0,
      weightsReady: Boolean(item.weights_ready),
      canPrefetch: Boolean(item.prefetch),
      lastError: item.last_error ?? "",
    };
  });
}

let snapshot: LocalSnapshot = {
  engines: LOCAL_ENGINE_IDS.map((id) => blankStatus(LOCAL_ENGINE_CATALOG[id])),
  installs: {},
  loaded: false,
  statusError: "",
};
const listeners = new Set<() => void>();

function publish(patch: Partial<LocalSnapshot> = {}) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let statusPending: Promise<LocalEngineStatus[]> | null = null;

/** Rust 에 엔진 상태를 물어 캐시를 갱신합니다. 브라우저에서는 전부 «설치 안 됨». */
export async function listLocalEngines(): Promise<LocalEngineStatus[]> {
  if (!isDesktopApp()) {
    publish({ engines: mergeStatus([]), loaded: true, statusError: "" });
    return snapshot.engines;
  }
  if (statusPending) return statusPending;
  statusPending = (async () => {
    try {
      const raw = await invoke<RawEngineStatus[]>("local_engines_status");
      publish({
        engines: mergeStatus(Array.isArray(raw) ? raw : []),
        loaded: true,
        statusError: "",
      });
    } catch (error) {
      publish({ engines: mergeStatus([]), loaded: true, statusError: String(error) });
    } finally {
      statusPending = null;
    }
    return snapshot.engines;
  })();
  return statusPending;
}

/** 엔진 상태·설치 진행을 구독합니다. 처음 붙을 때 Rust 에 한 번 물어봅니다. */
export function useLocalEngines(): LocalSnapshot {
  useEffect(() => {
    if (!snapshot.loaded && !statusPending) void listLocalEngines();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}


/** 설치돼 있어 지금 쓸 수 있는 엔진. 갈래를 주면 그 갈래만. */
export function availableLocalEngines(kind?: LocalEngineKind): LocalEngineStatus[] {
  return snapshot.engines
    .filter((engine) => engine.installed && (!kind || engine.kind === kind))
    .sort((a, b) => a.priority - b.priority);
}

/* ────────────────────────── 진행 이벤트 ────────────────────────── */

const progressListeners = new Set<(event: LocalProgressEvent) => void>();
let progressHooked: Promise<void> | null = null;

const INSTALL_STAGES = new Set([
  "uv",
  "python",
  "deps",
  "code",
  "models",
  "verify",
]);

export const LOCAL_STAGE_LABELS: Record<string, string> = {
  /** Rust 에 시켰지만 첫 진행 줄이 아직 안 온 자리표시 — 설치·미리 받기가 같이 씁니다. */
  start: "준비",
  uv: "uv 준비",
  python: "파이썬 환경",
  deps: "패키지 설치",
  code: "코드 받기",
  models: "가중치 받기",
  verify: "검증",
  run: "생성",
};

function trackInstallProgress(event: LocalProgressEvent) {
  if (!event.stage || !INSTALL_STAGES.has(event.stage)) return;
  const installs = { ...snapshot.installs };
  if (event.done || event.error) {
    delete installs[event.engine];
    publish({ installs });
    void listLocalEngines();
    return;
  }
  /*
    단계가 바뀌면 상태도 한 번 더 읽습니다. Rust 의 `installing`·`prefetching` 은 상태 조회에만 실리고 진행 줄에는
    없는데, «멈추기» 단추 문구가 `prefetching` 을 보므로 설치 끝의 «검증 → 가중치 받기» 순간과 단추로 받기를
    시작한 순간(자리표시 «준비» → 첫 진행 줄)에 새로 읽어야 「받기 멈추기」 가 제때 뜹니다. 단계는 설치 한 번에
    예닐곱 번만 바뀌고, 설치 중 조회는 폴더를 걷지 않으므로(Rust `engines_status`) 값쌉니다.
  */
  const stageChanged = snapshot.installs[event.engine]?.stage !== event.stage;
  installs[event.engine] = {
    stage: event.stage,
    percent: typeof event.percent === "number" ? event.percent : null,
    message: event.message ?? "",
  };
  publish({ installs });
  if (stageChanged) void listLocalEngines();
}

/**
 * Tauri `local-progress` 를 **한 번만** 걸고 여기서 나눠 줍니다.
 * 업스케일과 이벤트 이름이 다른 까닭: 설정 화면(업스케일)과 로컬 모델 화면이 서로의
 * 진행 줄을 받아 엉뚱한 막대가 움직이면 안 됩니다.
 */
function ensureProgressHook(): Promise<void> {
  if (!isDesktopApp()) return Promise.resolve();
  if (!progressHooked) {
    progressHooked = listen<LocalProgressEvent>("local-progress", (event) => {
      const payload = event.payload;
      if (!payload || typeof payload !== "object") return;
      /*
        «disk» 는 Rust 가 엔진 폴더 크기를 **뒤에서** 다시 재고 난 뒤 보내는 살림 신호입니다
        . 상태를 한 번 더 읽어 카드 숫자를
        맞추고, 생성 진행을 듣는 쪽에는 넘기지 않습니다 — 빈 문구가 생성 상태 줄을 지우면 안 됩니다.
      */
      if (payload.stage === "disk") {
        if (payload.done) void listLocalEngines();
        return;
      }
      trackInstallProgress(payload);
      progressListeners.forEach((listener) => listener(payload));
    })
      .then(() => undefined)
      .catch((error) => {
        progressHooked = null;
        console.warn("로컬 모델 진행 이벤트를 걸지 못했습니다", error);
      });
  }
  return progressHooked;
}

/** 진행 이벤트를 받습니다. 돌려주는 함수로 뗍니다. 엔진을 주면 그 엔진 것만. */
export function onLocalProgress(
  listener: (event: LocalProgressEvent) => void,
  engine?: string,
): () => void {
  const wrapped = engine
    ? (event: LocalProgressEvent) => {
        if (event.engine === engine) listener(event);
      }
    : listener;
  progressListeners.add(wrapped);
  void ensureProgressHook();
  return () => {
    progressListeners.delete(wrapped);
  };
}

/* ────────────────────────── 설치·제거 ────────────────────────── */

function assertDesktop(what: string) {
  if (!isDesktopApp())
    throw new Error(`데스크톱 앱에서만 ${what}할 수 있습니다.`);
}

export async function installLocalEngine(
  id: LocalEngineId,
  onProgress?: (event: LocalProgressEvent) => void,
): Promise<void> {
  assertDesktop("엔진을 설치");
  await ensureProgressHook();
  const off = onProgress ? onLocalProgress(onProgress, id) : () => {};
  publish({
    installs: {
      ...snapshot.installs,
      [id]: { stage: "start", percent: null, message: "시작하는 중" },
    },
  });
  try {
    await invoke("local_install_engine", { id, extraModels: [] });
  } finally {
    off();
    const installs = { ...snapshot.installs };
    delete installs[id];
    publish({ installs });
    await listLocalEngines();
  }
}

/** 설치(또는 가중치 미리 받기)를 멈춥니다. 받다 만 파일은 다음에 이어받습니다. */
export async function cancelLocalInstall(id: LocalEngineId): Promise<void> {
  assertDesktop("설치를 취소");
  await invoke("local_cancel_install", { id });
}

/**
 * 이미 깔린 엔진의 가중치를 **지금** 통째로 받아 둡니다(«가중치 미리 받기» 단추).
 *
 * 이 개편 뒤에 새로 까는 엔진은 설치 끝에 받지만, 사용자의
 * 기계처럼 이미 깔린 것은 그 길을 지나쳤으므로 단추가 따로 있어야 합니다. 진행은 설치와 같은
 * «가중치 받기(models)» 막대로 오고, 멈추기도 `cancelLocalInstall` 이 그대로 듣습니다.
 */
export async function prefetchLocalWeights(id: LocalEngineId): Promise<void> {
  assertDesktop("가중치 미리 받기를 시작");
  await ensureProgressHook();
  publish({
    installs: {
      ...snapshot.installs,
      // 자리표시 단계는 Rust 의 첫 줄(models)과 **달라야** 합니다 — 그래야 첫 줄에서 상태를 다시 읽어 «받기 멈추기» 가 뜹니다.
      [id]: { stage: "start", percent: null, message: "시작하는 중" },
    },
  });
  try {
    await invoke("local_prefetch_weights", { engine: id });
  } finally {
    const installs = { ...snapshot.installs };
    delete installs[id];
    publish({ installs });
    await listLocalEngines();
  }
}

/** `local/engines/<id>/` 만 지웁니다(Rust 가 그 안인지 확인). 가중치도 같이 사라집니다. */
export async function uninstallLocalEngine(id: LocalEngineId): Promise<void> {
  assertDesktop("엔진을 제거");
  try {
    await invoke("local_uninstall_engine", { id });
  } finally {
    await listLocalEngines();
  }
}

/** 로컬 워커를 전부 종료해 해당 프로세스가 쥔 RAM·VRAM을 해제합니다. */
export async function stopLocalWorkers(): Promise<void> {
  assertDesktop("로컬 워커를 종료");
  await invoke("local_stop_workers");
}

/* ────────────────────────── 생성 ────────────────────────── */

/** 로라 한 장. 경로는 사용자가 직접 받아 둔 `.safetensors` 입니다. */
export interface LocalLora {
  path: string;
  weight: number;
  /**
   * 이 로라를 **불러오는 말**. 프롬프트 앞에 붙여야 먹는 로라가 있습니다.
   *
   * 2026-09-18 점검에서 드러났습니다 — 이 칸이 아예 없어서 `lorasToRun` 이 돌려준
   * 트리거가 **타입 단계에서 조용히 버려지고** 있었습니다. 화면에는 「프롬프트에 넣어야
   * 먹습니다」 라고 적어 두고 정작 안 보내고 있었던 것입니다.
   *
   * 엔진에 보내는 값은 아닙니다 — 프롬프트를 짓는 쪽(`withLoraTriggers`)이 씁니다.
   */
  trigger?: string;
}

export interface LocalRunOptions {
  prompt: string;
  negative?: string;
  /**
   * 텍스트 인코더가 한 번에 읽는 토큰 수(`localTokenBudget`). 안 주면 워커가 1024 로 봅니다.
   *
   * 넘긴 말은 조용히 버려지는데 우리 프롬프트는 **칸 배치 지시가 맨 뒤**라, 넘치면 정확히 그것이
   * 날아가 시킨 것과 전혀 다른 그림이 됩니다. 화면과 워커가 **같은 숫자**를 봐야 경고와 실제가 맞습니다.
   */
  max_tokens?: number;
  seed?: number;
  steps?: number;
  guidance?: number;
  /** 그림·영상. */
  width?: number;
  height?: number;
  /** 영상·음악의 길이(초). */
  seconds?: number;
  fps?: number;
  /** 영상의 첫 프레임으로 쓸 그림 경로. 주면 I2V(H3 는 fl2va)로 돕니다. */
  image?: string;
  /**
   * 레퍼런스 — 구도잡기 영상·인물 시트·배경을 **순서대로** 물립니다(H3 의 `ref2va`).
   *
   * 로컬에서 그 일을 하는 길이 이것입니다.
   *
   * **순서가 뜻입니다.** 모델이 프롬프트에 「<Video 1>」 처럼 이름을 붙이고 공유 시계에
   * 올려 두기 때문에, 같은 것을 다른 순서로 주면 다른 요청이 됩니다.
   * 그림 9·영상 3·소리 3, 모두 합쳐 12개까지. 소리만 줄 수는 없습니다.
   */
  references?: { kind: "image" | "video" | "audio"; path: string }[];
  /** 음악 가사. 비우면 연주곡(`[inst]`). */
  lyrics?: string;
  /** 여러 개를 겹쳐 먹입니다. */
  loras?: LocalLora[];
  /**
   * **동작 기준** — 모캡에서 구운 뼈 그림들(차례가 곧 시간).
   *
   * 원본 영상이 아니라 **뼈 그림**을 주는 까닭은
   * `lib/poseFrames.ts` 머리말에 있습니다.
   *
   * `weight` 는 얼마나 꽉 따를까(0~1.5). 1 이면 그대로, 낮추면 모델이 숨 쉴 틈이 생깁니다.
   */
  control?: { kind: "pose"; frames: string[]; weight?: number };
  /**
   * **«여기는 움직인다» 마스크** — 흰 구역만 움직이고 검은 구역은 첫 프레임 그대로 붙박입니다
   * (`lib/motionMask.ts` 가 굽고, 파일 이름은 «원본_움직임_NNN»).
   *
   * 영상에만 뜻이 있습니다. 구도잡기가 뽑는 레퍼런스 영상은 배경이 정지 이미지라, 모델이 그
   * 정지 화면을 「이 구역은 안 움직인다」 로 읽어 **배경을 통째로 얼립니다**(차 안 컷의 창밖이
   * 전혀 안 바뀜). 반대로 캐릭터 스왑에서는 인물만 붙들고 배경은 풀어 두어야 하는데, 조건
   * 세기는 화면 전체에 한 덩이로 걸립니다. 구역을 가를 수단이 이것뿐입니다.
   *
   * `references` 가 아니라 **따로** 둡니다 — 레퍼런스는 «이런 그림처럼» 이고 이것은 «여기만»
   * 이라, 목록에 섞어 넣으면 모델이 검은 판을 그려야 할 그림으로 읽습니다(순서가 곧 뜻인
   * H3 에서는 특히). 받는 쪽(파이썬 워커)은 `opts["motion_mask"]` 한 칸만 보면 됩니다 —
   * `local_run` 의 `opts` 는 Rust 가 손대지 않고 그대로 넘깁니다.
   *
   * 받는 쪽은 `common.freeze_by_mask` 한 벌입니다 — 영상 엔진 셋(LTX·Wan·H3)이 mp4 로
   * 쓰기 직전에 부릅니다. **모델 안쪽을 건드리지 않고 뽑은 뒤에 섞는** 까닭은 엔진마다
   * 안이 전부 달라 한 벌로 둘 자리가 거기뿐이기 때문입니다. 마스크를 못 읽거나 전부
   * 검으면 그냥 지나갑니다(그릴 때의 실수가 영상을 정지 사진으로 만들면 안 되니까).
   */
  motion_mask?: string;
  /** 모션 캡처 — 분석할 영상 경로와 구간(초). `fps` 는 위의 것을 초당 장 수로 씁니다. */
  video?: string;
  /** SAM 3D Body의 손 전용 복원. 기본 켬이며 false면 몸만 분석합니다. */
  hands?: boolean;
  start?: number;
  end?: number;
  /**
   * **어떤 정밀도로 올릴까.** 안 주면 `auto` — 워커가 이 GPU 의 VRAM 을 보고 정합니다.
   *
   * 판단은 **워커 안에서** 합니다 — 앱이 nvidia-smi 로 읽은 값과 torch 가 보는 값이 다를 수
   * 있고(여러 장·MIG), 실제로 올리는 쪽이 torch 라서요. 여기서 못 박는 것은 자동이 틀릴 때
   * (다른 프로그램이 VRAM 을 쥐고 있을 때)를 위한 길입니다.
   *
   * 못 박은 값을 **못 하는 엔진**이 있습니다(모듈러 파이프라인). 그때는 워커가 할 수 있는
   * 것으로 내려 잡고, 무엇을 요청했고 무엇이 올라갔는지를 결과에 함께 실어 보냅니다.
   */
  precision?: LocalPrecision;
}

/** bf16 원본 · int8(품질 손실 거의 없음) · int4 nf4(눈에 띄지만 도는 것이 낫다). */
export type LocalPrecision = "auto" | "bf16" | "int8" | "int4";

export const PRECISION_LABEL: Record<LocalPrecision, string> = {
  auto: "자동 — 이 GPU 에 맞춰",
  bf16: "bf16 원본",
  int8: "int8 로 줄여",
  int4: "int4(nf4)로 줄여",
};

const PRECISION_KEY = "frameforge.localPrecision.v1";

/** 사람이 못 박아 둔 정밀도. 설정에 붙고, 없으면 «자동» 입니다. */
export function loadPrecision(): LocalPrecision {
  if (typeof window === "undefined") return "auto";
  const saved = window.localStorage.getItem(PRECISION_KEY);
  return saved === "bf16" || saved === "int8" || saved === "int4" ? saved : "auto";
}

export function savePrecision(value: LocalPrecision): void {
  try {
    window.localStorage.setItem(PRECISION_KEY, value);
  } catch {
    /* 저장 공간이 없으면 이번 판만 못 기억합니다. */
  }
}

/** 기본은 생성마다 워커를 내려 RAM·VRAM이 다음 작업까지 남지 않게 합니다. */
export interface LocalMemoryPolicy {
  mode: "release" | "adaptive" | "retain";
  ramPercent: number;
  vramPercent: number;
}
const DEFAULT_MEMORY_POLICY: LocalMemoryPolicy = Object.freeze({ mode: "release", ramPercent: 85, vramPercent: 85 });
const MEMORY_POLICY_KEY = "frameforge.localMemoryPolicy.v1";
const MEMORY_POLICY_SECTION = "localMemoryPolicy";
const memoryPolicyListeners = new Set<() => void>();
let memoryPolicyRaw: string | null | undefined;
let memoryPolicyCached = DEFAULT_MEMORY_POLICY;
function normalizeLocalMemoryPolicy(value: unknown): LocalMemoryPolicy | null {
  // 처음 시험판이 저장한 문자열도 이어 읽습니다.
  if (value === "release" || value === "retain") return { ...DEFAULT_MEMORY_POLICY, mode: value };
  if (!value || typeof value !== "object") return null;
  const policy = value as Partial<LocalMemoryPolicy>;
  const percent = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 99;
  if ((policy.mode !== "release" && policy.mode !== "adaptive" && policy.mode !== "retain") || !percent(policy.ramPercent) || !percent(policy.vramPercent)) return null;
  return { mode: policy.mode, ramPercent: policy.ramPercent, vramPercent: policy.vramPercent };
}
function readLocalMemoryPolicy(): LocalMemoryPolicy | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(MEMORY_POLICY_KEY);
    if (!saved) return null;
    return normalizeLocalMemoryPolicy(saved === "release" || saved === "retain" ? saved : JSON.parse(saved));
  } catch { return null; }
}
export function getLocalMemoryPolicy(): LocalMemoryPolicy {
  let raw: string | null = null;
  try { if (typeof window !== "undefined") raw = window.localStorage.getItem(MEMORY_POLICY_KEY); } catch { /* 기본 해제 */ }
  // useSyncExternalStore의 스냅샷 참조는 값이 같을 때도 새로 만들면 안 됩니다.
  if (raw !== memoryPolicyRaw) {
    memoryPolicyRaw = raw;
    memoryPolicyCached = Object.freeze(readLocalMemoryPolicy() ?? DEFAULT_MEMORY_POLICY);
  }
  return memoryPolicyCached;
}
function writeLocalMemoryPolicy(value: LocalMemoryPolicy): void {
  const normalized = normalizeLocalMemoryPolicy(value);
  if (!normalized) throw new Error("메모리 기준은 1~99 사이의 정수여야 합니다.");
  window.localStorage.setItem(MEMORY_POLICY_KEY, JSON.stringify(normalized));
  memoryPolicyListeners.forEach(listener => listener());
}
export function saveLocalMemoryPolicy(value: LocalMemoryPolicy): Promise<void> {
  writeLocalMemoryPolicy(value);
  return queueMirrorWriteAndConfirm(MEMORY_POLICY_SECTION, getLocalMemoryPolicy());
}
registerMirrorSection<LocalMemoryPolicy>(MEMORY_POLICY_SECTION, {
  read: readLocalMemoryPolicy,
  write: writeLocalMemoryPolicy,
});
function subscribeLocalMemoryPolicy(listener: () => void) {
  memoryPolicyListeners.add(listener);
  return () => { memoryPolicyListeners.delete(listener); };
}
export function useLocalMemoryPolicy(): LocalMemoryPolicy {
  return useSyncExternalStore(subscribeLocalMemoryPolicy, getLocalMemoryPolicy, () => DEFAULT_MEMORY_POLICY);
}

/**
 * 이 엔진을 **지금 켜면 어떻게 올라갈까** — 워커와 같은 셈을 화면에서 미리 합니다.
 *
 * «요청» 과 «실제» 를 나눠 돌려주는 까닭: 사람이 int4 를 못 박아도 그 길이 없는 엔진은
 * bf16 을 올립니다. 예전에는 못 박은 값을 그대로 화면에 적어서, 화면은 「int4 로 줄여서
 * 올립니다」 라고 하고 실제로는 원본이 올라가고 있었습니다.
 *
 * VRAM 을 못 읽었거나 정밀도를 고르지 않는 엔진(모션 캡처)이면 null — «모르면 모른다» 입니다.
 */
export interface PrecisionPlan {
  /** 사람이 고른 것. «auto» 면 이 GPU 에 맡긴 것입니다. */
  requested: LocalPrecision;
  /** 규칙이 고른 것. */
  planned: EnginePrecision;
  /** 이 엔진이 **실제로** 올릴 것. `planned` 와 다르면 그 정밀도 길이 아직 없는 엔진입니다. */
  mode: EnginePrecision;
  /** 셈에 쓴 VRAM(GB). */
  vramGb: number;
}

export function precisionPlanFor(
  engine: LocalEngineInfo,
  probe: HardwareProbe | null,
  pinned: LocalPrecision = "auto",
): PrecisionPlan | null {
  const vram = bestVramGb(probe);
  const bf16Gb = engine.needs.bf16Gb;
  if (vram == null || bf16Gb == null) return null;
  const planned = pinned === "auto" ? planPrecision(bf16Gb, vram) : pinned;
  return {
    requested: pinned,
    planned,
    mode: clampPrecision(planned, engine.precisionModes),
    vramGb: vram,
  };
}

/** 위의 것에서 «실제로 올라갈 정밀도» 하나만. 모르면 못 박은 값(또는 «auto»)을 그대로 돌려줍니다. */
export function precisionFor(
  engine: LocalEngineInfo,
  probe: HardwareProbe | null,
  pinned: LocalPrecision = "auto",
): LocalPrecision {
  return precisionPlanFor(engine, probe, pinned)?.mode ?? pinned;
}

export interface LocalRunResult {
  output: string;
  seconds: number;
  meta: Record<string, unknown>;
}

/**
 * 방금 뽑은 것이 **실제로 어떤 정밀도로 올라갔는지** — 워커가 결과에 실어 보낸 값입니다
 * (`common.precision_fields`). 미리 셈한 것이 아니라 그 자리에서 torch 가 본 값이라,
 * 「자동인데 왜 int8 이지」 의 답은 이쪽입니다.
 *
 * 옛 결과에는 이 값이 없으므로 없으면 null 입니다.
 */
export function precisionOfRun(meta: Record<string, unknown> | null | undefined): {
  requested: LocalPrecision;
  mode: EnginePrecision;
  why: string;
  vramGb: number | null;
} | null {
  const mode = meta?.precision;
  if (typeof mode !== "string" || !(PRECISION_LADDER as readonly string[]).includes(mode)) {
    return null;
  }
  const requested = meta?.precision_requested;
  const vram = meta?.vram_gb;
  return {
    requested:
      requested === "bf16" || requested === "int8" || requested === "int4" ? requested : "auto",
    mode: mode as EnginePrecision,
    why: typeof meta?.precision_why === "string" ? meta.precision_why : "",
    vramGb: typeof vram === "number" && vram > 0 ? vram : null,
  };
}

/**
 * 이 컴퓨터에서 파일 하나를 만듭니다. 그림·영상·음악이 모두 이 한 길입니다.
 *
 * `outputPath` 는 **확장자까지 있는 전체 경로**여야 합니다. 같은 이름이 이미 있으면
 * Rust 가 번호를 올려 새 파일로 놓습니다 — 생성은 늘 새 파일이라 덮어쓰지 않습니다.
 */
export async function runLocal(
  engine: LocalEngineId,
  outputPath: string,
  options: LocalRunOptions,
  hooks?: {
    onProgress?: (event: LocalProgressEvent) => void;
    timeoutSecs?: number;
  },
): Promise<LocalRunResult> {
  assertDesktop("로컬 모델로 생성");
  await whenAppSettingsReady();
  await ensureProgressHook();
  const off = hooks?.onProgress
    ? onLocalProgress(hooks.onProgress, engine)
    : () => {};
  try {
    const memoryPolicy = getLocalMemoryPolicy();
    const raw = await invoke<{
      output: string;
      seconds: number;
      meta: Record<string, unknown>;
    }>("local_run", {
      engine,
      outputPath,
      // 화면·MCP·BGM 모두 이 설정 한 곳을 따릅니다. 호출자가 별도 값으로 우회하지 않습니다.
      opts: {
        ...options,
        memory_policy: memoryPolicy.mode,
        memory_ram_percent: memoryPolicy.ramPercent,
        memory_vram_percent: memoryPolicy.vramPercent,
        keep_worker: memoryPolicy.mode === "retain",
      },
      timeoutSecs: hooks?.timeoutSecs,
    });
    return {
      output: raw.output,
      seconds: Number(raw.seconds) || 0,
      meta: raw.meta ?? {},
    };
  } finally {
    off();
  }
}

/* ────────────────────────── 로라 목록(설정) ────────────────────────── */

const LORA_KEY = "frameforge.localLoras.v1";

export interface LoraEntry {
  id: string;
  /** 화면에 보일 이름. 비면 파일 이름을 씁니다. */
  name: string;
  /** 사용자가 직접 받아 둔 `.safetensors` 의 전체 경로. */
  path: string;
  /** 0~2. 1 이 원래 세기입니다. */
  weight: number;
  /** 어느 엔진에 먹일 것인가. 엔진마다 로라 형식이 달라 섞으면 로딩이 실패합니다. */
  engine: LocalEngineId;
  /**
   * 이 로라가 **무엇을 바꾸는가**.
   *
   *
   *
   * 맞습니다 — **화풍 로라는 한 번에 하나**입니다. 둘을 겹치면 어느 쪽도 아닌 그림이 나오고,
   * 그게 로라 탓인지 프롬프트 탓인지 가려낼 수가 없습니다. 반면 «동작»·«질감» 은 화풍과
   * 겹쳐도 됩니다. 그래서 갈래를 적어 두고, 화풍이 둘 이상 켜지면 경고합니다.
   */
  style?: LoraStyle;
  /** 켜져 있는 것만 생성에 들어갑니다 — 파일을 지우지 않고 잠깐 빼려고. */
  enabled: boolean;
  /**
   * 받아 온 **소개 쪽** 주소. 「이 로라가 뭐였더라」 를 물을 데입니다.
   *
   * 파일 이름만 남으면 불러오는 말도 예시 그림도 다시 찾을 길이 없습니다.
   */
  source?: string;
  /** 만든 사람이 적어 둔 **불러오는 말**. 프롬프트에 넣어야 먹는 로라가 많습니다. */
  trigger?: string;
}

/** 로라가 바꾸는 것. «화풍» 만 서로 배타적입니다. */
export type LoraStyle = "cinematic" | "anime" | "illust" | "detail" | "motion" | "other";

export const LORA_STYLES: { id: LoraStyle; label: string; exclusive: boolean; hint: string }[] = [
  { id: "cinematic", label: "화풍 · 시네마틱", exclusive: true, hint: "실사 영화 결" },
  { id: "anime", label: "화풍 · 애니메이션", exclusive: true, hint: "셀 애니 결" },
  { id: "illust", label: "화풍 · 일러스트", exclusive: true, hint: "손그림·회화 결" },
  { id: "detail", label: "질감 · 보정", exclusive: false, hint: "선명도·피부·디테일 — 화풍과 겹쳐도 됩니다" },
  { id: "motion", label: "동작 · 카메라", exclusive: false, hint: "움직임·카메라 무빙 — 화풍과 겹쳐도 됩니다" },
  { id: "other", label: "그 밖", exclusive: false, hint: "인물·사물처럼 화풍과 무관한 것" },
];

/**
 * 로라 목록 — **설정입니다.** 프로젝트가 아니라 이 컴퓨터에 붙습니다.
 *
 * 로라 파일은 사용자가 직접 받아 어딘가에 둡니다(수 GB 짜리도 있어
 * 프로젝트 폴더에 복사하지 않습니다). 우리는 **경로와 세기만** 기억합니다.
 */
export function loadLoras(): LoraEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(LORA_KEY);
    const list = saved ? (JSON.parse(saved) as LoraEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveLoras(list: LoraEntry[]): void {
  try {
    window.localStorage.setItem(LORA_KEY, JSON.stringify(list));
  } catch {
    /* 저장 공간이 없으면 이번 판만 못 기억합니다. 생성 자체는 됩니다. */
  }
}

