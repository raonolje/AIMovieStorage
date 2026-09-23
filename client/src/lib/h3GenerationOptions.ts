import type { LocalLora } from "./localEngines";
import type { LoraOnDisk } from "./localLoras";

export const H3_REF_PRESET = "lightx2v-ref2va-4step-v0.1" as const;
export type H3ResizeMode = "diffusers" | "match";

/** 파일 이름으로 호환성을 추정하지 않습니다. 이 조건은 해시 검사를 시작할 대상만 고릅니다. */
export function h3PresetCandidate(loras: LocalLora[], files: LoraOnDisk[]): LoraOnDisk | null {
  if (loras.length !== 1 || loras[0].weight !== 1) return null;
  return files.find(file => file.engine === "minimaxh3" && file.path === loras[0].path && file.sizeBytes > 0
    && file.fileName.endsWith(".safetensors")) ?? null;
}

export function h3GuiRunOptions(active: boolean, resize: H3ResizeMode, turbo: boolean,
  candidateKey: string, verifiedKey: string | null, verifiedPreset: string | null) {
  if (!active) return {};
  if (!turbo) return { h3_reference_resize_mode: resize };
  if (!candidateKey || verifiedKey !== candidateKey || verifiedPreset !== H3_REF_PRESET) return null;
  return { h3_reference_resize_mode: "match" as const, h3_lora_preset: H3_REF_PRESET, steps: 4 };
}
