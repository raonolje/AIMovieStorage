import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const nativeA2VSelection = z.literal("experimental").describe("Explicit unverified native LTX-2.5 A2V QA route. Default omitted preserves existing Diffusers LTX. Conditions on the selected original audio in both stages; final master retains selected PCM through lossless ALAC. No proven lip sync or general production readiness. Requires verified resources and either existing execution authorization or explicit nativeGpuHandoff bound to this one request. Persistent execution permission is unchanged.");
export async function nativeA2VStatus() {
  return invoke<{ ready: boolean; blockers: string[]; experimental: true; gpuQaCompleted: boolean; lipSyncVerified: false }>("native_a2v_status");
}

/** 실행 직전에도 이 관문을 지나야 대기 중 바뀐 선택을 조용히 버리지 않습니다. */
export function validateNativeA2V(input: {
  engine: string; audioAssetId?: string; audioStartSeconds?: number; audioDurationSeconds?: number;
  imageAssetId?: string; endImageAssetId?: string; motionMaskAssetId?: string;
  referenceAssetIds?: string[]; loras?: unknown[]; poseSource?: unknown; structureSource?: unknown;
  options: { ltx_a2v?: "experimental"; width?: number; height?: number; [key: string]: unknown };
}) {
  if (!input.options.ltx_a2v) {
    if (input.options.ltx_a2v_checkpoint_read_backend !== undefined) throw new Error("invalid_request: 읽기 정책은 명시적 native A2V에서만 선택합니다.");
    if (input.options.ltx_a2v_offload !== undefined) throw new Error("invalid_request: 오프로딩은 명시적 native A2V에서만 선택합니다.");
    if (input.audioAssetId !== undefined || input.audioStartSeconds !== undefined || input.audioDurationSeconds !== undefined)
      throw new Error("invalid_request: 원음 입력은 명시적으로 선택한 native A2V에서만 사용할 수 있습니다.");
    return false;
  }
  if (input.engine !== "ltx25") throw new Error("model_unsupported: native A2V는 LTX 2.5에서만 제공합니다.");
  if (!input.audioAssetId || input.audioDurationSeconds === undefined)
    throw new Error("invalid_request: 원음 에셋과 선택 길이가 필요합니다.");
  if (input.endImageAssetId && !input.imageAssetId)
    throw new Error("invalid_request: native A2V 끝 그림에는 명시적인 시작 그림도 필요합니다.");
  if (input.motionMaskAssetId || input.poseSource || input.structureSource || input.referenceAssetIds?.length || input.loras?.length)
    throw new Error("unsupported_control: native A2V는 원음과 시작/끝 그림만 받습니다. 추가 로라·마스크·포즈·윤곽·참조 목록을 해제하세요.");
  if (input.options.ltx_a2v_offload === "disk" && input.options.ltx_a2v_checkpoint_read_backend === undefined) throw new Error("invalid_request: native disk 작업은 mmap 또는 pread 읽기를 명시적으로 선택해야 합니다.");
  const allowed = new Set(["prompt", "negative", "width", "height", "seed", "fps", "ltx_a2v", "ltx_a2v_offload", "ltx_a2v_checkpoint_read_backend", "local_files_only"]);
  if (input.options.ltx_a2v_checkpoint_read_backend !== undefined) {
    if (typeof input.options.ltx_a2v_checkpoint_read_backend !== "string" || !["mmap", "pread"].includes(input.options.ltx_a2v_checkpoint_read_backend)) throw new Error("unsupported_options: checkpoint 읽기는 mmap 또는 pread입니다.");
    if (input.options.ltx_a2v_offload !== "disk") throw new Error("unsupported_options: 읽기 정책은 native disk 모드에서 선택합니다.");
  }
  if (Object.keys(input.options).some(key => !allowed.has(key)))
    throw new Error("unsupported_options: native A2V는 고정 bf16·공식 두 단계 일정입니다. seconds·steps·guidance·precision·ltx_quality를 지정하지 마세요.");
  if (input.options.ltx_a2v_offload !== undefined && !["cpu","disk"].includes(String(input.options.ltx_a2v_offload))) throw new Error("unsupported_options: native 오프로딩은 cpu 또는 disk입니다.");
  if (input.options.local_files_only !== undefined && input.options.local_files_only !== true) throw new Error("invalid_request: native 실행은 항상 오프라인입니다.");
  if ([input.options.width ?? 768, input.options.height ?? 512].some(x => x % 64))
    throw new Error("invalid_request: native A2V 가로·세로는 64의 배수여야 합니다.");
  return true;
}
