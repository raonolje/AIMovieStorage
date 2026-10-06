import { z } from "zod";

// ACE-Step 공식 UI의 범위만 노출합니다. 생략하면 기존 작업자 기본값을 유지합니다.
export const bgmSamplingFields = {
  seed: z.number().int().min(-1).max(2147483647).optional().describe("ACE-Step only. -1 or omitted: random; 0..2147483647: fixed seed."),
  steps: z.number().int().min(1).max(200).optional().describe("ACE-Step only. Omitted: 60 inference steps."),
  guidance: z.number().finite().min(0).max(30).optional().describe("ACE-Step only. Omitted: guidance scale 15; zero is preserved."),
};
export function validateBgmSamplingEngine(input: { engine: string; seed?: number; steps?: number; guidance?: number }) {
  if (input.engine !== "acestep" && [input.seed, input.steps, input.guidance].some(value => value !== undefined))
    throw new Error("seed/steps/guidance 음악 옵션은 ACE-Step에서만 사용할 수 있습니다.");
}

// 요청값을 실제값으로 꾸미지 않고 작업자가 반환한 생성 정보만 보존합니다.
export function bgmGenerationMetadata(meta?: Record<string, unknown>) {
  if (!meta) return {};
  const keys = ["seed", "steps", "guidance", "seconds_audio", "generate_seconds", "precision", "precision_requested", "precision_planned", "precision_why", "vram_gb"];
  return { generation: Object.fromEntries(keys.filter(key => key in meta).map(key => [key, meta[key]])) };
}
