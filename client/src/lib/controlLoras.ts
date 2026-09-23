import { z } from "zod";
import { LOCAL_ENGINE_IDS, type LocalEngineId, type LocalLora } from "./localEngines";
import { readLoraFiles, loraItems, LORA_WEIGHT_RANGE, type LoraItem } from "./localLoras";

export const controlLorasListSchema = z.object({
  engine: z.enum(LOCAL_ENGINE_IDS as [LocalEngineId, ...LocalEngineId[]]).optional(),
}).strict();

export const controlLoraSelectionSchema = z.array(z.object({
  id: z.string().regex(/^lora-[0-9a-f]{64}$/),
  weight: z.number().min(LORA_WEIGHT_RANGE.min).max(LORA_WEIGHT_RANGE.max).default(1),
}).strict()).max(16).refine(items => new Set(items.map(item => item.id)).size === items.length,
  "같은 로라를 두 번 지정할 수 없습니다.");
export type ControlLoraSelection = z.infer<typeof controlLoraSelectionSchema>;

async function opaqueId(item: LoraItem): Promise<string> {
  // 파일 내용의 호환성 검사가 아닙니다. 같은 엔진/이름/크기는 재시작 후에도 같은 ID입니다.
  const identity = JSON.stringify([item.engine, item.fileName.normalize("NFC"), item.sizeBytes]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return `lora-${[...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("")}`;
}

async function readCatalog(engine?: LocalEngineId) {
  const files = await readLoraFiles();
  const supported = new Set<string>(LOCAL_ENGINE_IDS);
  // 현 로더는 safetensors만 읽습니다. 폴더에 놓인 README/부분 파일/빈 파일은 생성 대상으로 삼지 않습니다.
  const items = loraItems(files.filter(file => supported.has(file.engine)
    && /\.safetensors$/i.test(file.fileName) && Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0), engine);
  return Promise.all(items.map(async item => ({ id: await opaqueId(item), item })));
}

export async function listControlLoras(raw: unknown = {}) {
  const { engine } = controlLorasListSchema.parse(raw);
  const entries = await readCatalog(engine);
  return { loras: entries.map(({ id, item }) => ({ id, engine: item.engine, name: item.name,
    sizeBytes: item.sizeBytes, defaultWeight: item.weight, trigger: item.trigger ?? "" })),
    compatibility: "Files are grouped by engine folder; base-model generation, workflow, license and tensor compatibility are not certified by this list." };
}

export async function resolveControlLoras(engine: LocalEngineId, selected?: ControlLoraSelection): Promise<LocalLora[]> {
  const selection = controlLoraSelectionSchema.parse(selected ?? []);
  if (!LOCAL_ENGINE_IDS.includes(engine)) throw new Error("이 빌드에서 사용할 수 없는 로라 엔진입니다.");
  if (!selection.length) return [];
  const catalog = await readCatalog(engine);
  return selection.map(({ id, weight }) => {
    const matches = catalog.filter(entry => entry.id === id);
    if (matches.length !== 1) throw new Error("현재 엔진 폴더에서 로라 ID를 확인하지 못했습니다. loras_list 목록을 다시 읽어 주세요.");
    const { item } = matches[0];
    return { path: item.path, weight, trigger: item.trigger };
  });
}
