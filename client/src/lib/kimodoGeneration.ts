import { invoke } from "@tauri-apps/api/core";
import { listLocalEngines, runLocal } from "./localEngines";
import { importKimodoMotion, mocapSourcesOf } from "./mocapStore";

export const KIMODO_MODELS = ["Kimodo-SOMA-RP-v1.1", "Kimodo-SOMA-SEED-v1.1"] as const;
export interface KimodoGenerationInput {
  projectName: string;
  operationId: string;
  prompt: string;
  model: typeof KIMODO_MODELS[number];
  seconds: number;
  steps: number;
  seed: number;
  textEncoderDevice: "cuda" | "cpu";
}

/** Both UI and MCP use the same engine, BVH import and persisted generation provenance. */
export async function generateKimodoMotion(input: KimodoGenerationInput, onProgress?: (message: string) => void) {
  const existing = mocapSourcesOf(input.projectName).find(source => source.kimodoGeneration?.operationId === input.operationId);
  if (existing) return existing;
  if (!(await listLocalEngines()).find(engine => engine.id === "kimodo")?.installed)
    throw new Error("설정 → 로컬 모델에서 KIMODO를 먼저 설치하세요.");
  const name = `kimodo-${crypto.randomUUID()}`;
  const path = await invoke<string>("motion_capture_output", { name, extension: "bvh" });
  const generated = await runLocal("kimodo", path, {
    prompt: input.prompt, motion_model: input.model, seconds: input.seconds,
    steps: input.steps, seed: input.seed, text_encoder_device: input.textEncoderDevice,
  }, { timeoutSecs: 24 * 60 * 60, onProgress: event => onProgress?.(event.message || event.stage) });
  const text = await invoke<string>("read_motion_capture", { path: generated.output });
  return importKimodoMotion(input.projectName, new File([text], `${name}.bvh`, { type: "text/plain" }), {
    operationId: input.operationId, prompt: input.prompt, model: input.model,
    seconds: input.seconds, steps: input.steps, seed: input.seed,
    textEncoderDevice: input.textEncoderDevice, createdAt: new Date().toISOString(),
  });
}
