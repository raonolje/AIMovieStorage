import { pickedCharacterRefs } from "@/lib/promptPayloads";
import { toast } from "sonner";
import { composeInMagnific } from "@/lib/magnificCompose";
import { safeFileName, saveProjectMediaAsset, type ProjectAssetType } from "@/lib/mediaLibrary";
import { loadPrecision, type LocalEngineId } from "@/lib/localEngines";
import { isEngineIncluded } from "@/lib/edition";
import { lorasToRun, withLoraTriggers } from "@/lib/localLoras";
import { runLocalToProject } from "@/lib/localOutput";
import { generateWithMagnific, uploadToMagnific } from "@/lib/magnificMcp";
import { fitDuration, loadMagnificModels } from "@/lib/magnificModels";
import { assertMagnificVideoInputs, findMagnificVideoModel, mediaTypeOfPath } from "@/lib/magnificVideoInputs";
import { localSize, tuneForLocal } from "@/lib/localPrompt";
import { projectFolderName } from "@/lib/localProjectStore";
import { sceneFolderName } from "@/lib/projectNames";
import { cutVideoSecondsOf, heroImageOf } from "@/lib/cutVideoPrompt";
import {
  buildStoryboardVideoPrompt,
  composeStoryboard,
  storyboardCells,
  MAX_GENERATOR_SECONDS,
  type StoryboardSwap,
} from "@/lib/storyboardSheet";
import { fileStemOf } from "@/components/ReferenceTagBar";
import { readProject, writeProject } from "@/lib/projectWrite";
import { enqueueTasks, isStopping, registerTaskRunner, setTaskResult, type NewTask } from "@/lib/taskQueue";
import type { Cut, ProjectDraft, Scene } from "@/lib/projectTypes";

/**
 * **한 번에 뽑기** — 작품 하나를 **순서대로** 끝까지 뽑습니다.
 *
 * # 순서가 곧 품질입니다
 *
 * 1. **캐릭터 시트** — 인물이 먼저 있어야 합니다. 시트 없이 컷을 뽑으면 컷마다
 * 다른 사람이 나옵니다.
 * 2. **컷 키 이미지** — 그 시트를 레퍼런스로 올리고, 구도 그림과 배경 플레이트가
 * 있으면 함께 올립니다. 뽑은 것은 그 컷의 **대표(별)** 가 됩니다.
 * 3. **스토리보드** — 대표 그림들을 한 장에 굽습니다. 영상 프롬프트도 이때 지어집니다.
 * 4. **씬 영상** — 그 시트 한 장을 레퍼런스로 올립니다.
 *
 * 줄이 하나(`media` 레인)라 **세운 차례가 곧 실행 차례**입니다. 그래서 2·3·4 번은 앞
 * 걸음이 만들어 놓은 것을 **돌아가는 순간에** 읽습니다(`readProject`) — 줄에 세울 때는
 * 아직 없는 그림들이니까요.
 *
 * # 두 길은 성격이 다릅니다
 *
 * - **마그니픽** — 레퍼런스를 올리고 생성기를 *차려 놓습니다*. 실제로 뽑는 것은 사람이
 * 그 창에서 누릅니다(우리 앱이 켠 창에만 붙을 수 있고, 결과는 후보함으로 돌아옵니다).
 * 그래서 마그니픽 쪽은 걸음마다 사람 손이 한 번씩 듭니다 — 별이 달려야 다음 걸음이
 * 그 그림을 봅니다.
 * - **로컬** — 이 컴퓨터가 **끝까지 뽑아** 파일을 프로젝트 폴더에 놓고, 그 자리에서
 * 카드에 붙이고 대표까지 세웁니다. 그래서 1→4 가 손 없이 이어집니다.
 */

export const CHARACTER_SHEET_TASK = "characterSheet";
export const CUT_IMAGE_TASK = "cutImage";
export const SCENE_BOARD_TASK = "sceneBoard";
export const SCENE_VIDEO_TASK = "sceneVideo";

/**
 * 무엇으로 뽑을까.
 *
 * - `magnific` — 마그니픽 **창**에 차려 놓기까지(«무제한» 이 적용되는 길).
 * - `magnific-mcp` — 마그니픽 **MCP** 로 끝까지 뽑기(건당 과금, 손이 안 듦).
 * - 그 밖 — 이 컴퓨터의 로컬 엔진.
 */
export type BatchEngine = "magnific" | "magnific-mcp" | LocalEngineId;

/** 차려 놓기만 하는 길인가 — 화면 문구와 걸음 안내가 이걸로 갈립니다. */
export const isSetUpOnly = (engine: BatchEngine) => engine === "magnific";

/**
 * 이 작품이 고른 **모델과 해상도**. 안 고른 칸은 아예 안 보냅니다 —
 * 빈 값을 보내면 마그니픽이 「그런 모델 없다」 로 거절합니다. 비우면 알아서 고릅니다.
 */
/** 이 작품의 화면 비율. 안 정했으면 가로(16:9). */
export function aspectOf(draft: ProjectDraft | null, kind: "image" | "video"): string {
  return (kind === "image" ? draft?.aspect?.image : draft?.aspect?.video) || "16:9";
}

async function sizeOf(draft: ProjectDraft | null, kind: "image" | "video") {
  const picked = draft?.magnific ?? {};
  const model = (kind === "image" ? picked.imageModel : picked.videoModel) || undefined;
  let resolution = (kind === "image" ? picked.imageResolution : picked.videoResolution) || undefined;
  /*
    모델을 골랐는데 해상도를 안 골랐으면 **그 모델의 첫 값**으로 채웁니다.
    마그니픽은 모델을 못 박으면 해상도를 **반드시** 요구합니다(`requiredInputs`) — 빈 채로
    보내면 거절당하는데, 사람은 「모델만 골랐을 뿐」 이라 까닭을 짐작하기 어렵습니다.
  */
  if (model && !resolution) {
    const models = await loadMagnificModels(kind).catch(() => []);
    resolution = models.find((item) => item.slug === model)?.resolutions[0];
  }
  return {
    model,
    resolution,
    aspect: aspectOf(draft, kind),
    quality: kind === "image" ? picked.imageQuality || undefined : undefined,
  };
}

/** 줄에 세울 때 다 아는 것들. 나머지는 돌아가는 순간에 프로젝트에서 읽습니다. */
interface Common {
  projectId: string;
  projectName: string;
  owner: string;
  stem: string;
  engine: BatchEngine;
}

interface CharacterSheetPayload extends Common {
  characterId: string;
  name: string;
}

interface CutImagePayload extends Common {
  cutId: string;
  cutOrder: number;
}

interface SceneBoardPayload {
  projectId: string;
  projectName: string;
  sceneId: string;
  owner: string;
}

interface SceneVideoPayload extends Common {
  sceneId: string;
  sceneTitle: string;
}

/**
 * 프로젝트가 고른 생성기. 안 고른 채로 돌리면 마그니픽입니다(여태 기본값).
 *
 * 저장된 값이 **이 판에 없는 엔진**이면(비공개판에서 만든 프로젝트를 공개판에서 열었을 때 `anima`)
 * 마그니픽으로 돌립니다 — 화면 목록에 없는 엔진으로 줄을 세우면 Rust 가 「이 판에는 포함되지 않은
 * 엔진입니다」 로 컷마다 실패합니다.
 */
export function enginesOf(draft: ProjectDraft): { image: BatchEngine; video: BatchEngine } {
  const pick = (value: string | undefined): BatchEngine =>
    value && (value.startsWith("magnific") || isEngineIncluded(value)) ? (value as BatchEngine) : "magnific";
  return {
    image: pick(draft.batchEngines?.image),
    video: pick(draft.batchEngines?.video),
  };
}

/**
 * 시트를 뽑아야 하는 인물 — 프롬프트는 있는데 그림이 아직 없는 사람.
 *
 * `redo` 면 **이미 그림이 있어도** 셉니다. 모델을 바꿔 통째로 다시 뽑는 자리(「그림만 다시 뽑기」)가
 * 그것입니다 —
 * 옛 그림은 지우지 않습니다. 번호가 올라가 나란히 쌓이고, 대표는 카드에서 고릅니다.
 */
export function charactersToGenerate(draft: ProjectDraft, redo = false) {
  return draft.characters.filter(
    (item) =>
      (item.promptEn || item.promptKo || "").trim() &&
      (redo || !(item.generatedImages ?? []).length),
  );
}

/**
 * 프롬프트가 적혔고 **아직 그림이 없는** 컷.
 *
 * 「빈 컷」 을 거르는 까닭은 프롬프트 없이 보내면 생성기가 아무거나 그리기 때문이고,
 * 「그림 있는 컷」 을 거르는 까닭은 사용자 2026-09-17 의 폴더 때문입니다 — `컷1_로컬_001`
 * 부터 `_007` 까지 같은 컷이 일곱 벌 쌓여 있었습니다. 「시작」 을 누를 때마다 이미 뽑은
 * 컷을 또 뽑았던 것입니다. 한 컷을 일부러 다시 뽑고 싶으면 그 **컷 카드의 «로컬 그림»**
 * 으로 뽑습니다 — 여기는 «아직 없는 것을 채우는» 자리입니다.
 */
export function cutsToGenerate(draft: ProjectDraft, redo = false) {
  return draft.scenes.flatMap((scene, index) =>
    scene.cuts
      .filter(
        (cut) =>
          (cut.promptEn || cut.promptKo || "").trim() && (redo || !(cut.images || []).length),
      )
      .map((cut) => ({ scene, sceneIndex: index, cut })),
  );
}

/**
 * 굽고 뽑을 씬 — 컷이 있고 **아직 영상이 없는** 장면.
 *
 * 컷 그림은 앞 걸음이 채우므로 여기서는 묻지 않습니다. 영상이 이미 있으면 건너뜁니다 —
 * 씬 영상은 한 편에 몇 분씩 걸려서, 「시작」 을 다시 눌렀을 때 같은 것을 또 뽑으면
 * 저녁이 통째로 날아갑니다.
 */
export function scenesToGenerate(draft: ProjectDraft, redo = false) {
  return draft.scenes.filter(
    (scene) => scene.cuts.length && (redo || !(scene.videos || []).length),
  );
}

/**
 * 프로젝트 하나를 **순서대로** 줄에 세웁니다 — 인물 → 컷 → 스토리보드 → 씬 영상.
 *
 * 여기서는 **차례만** 정합니다. 「어떤 그림을 레퍼런스로 올릴까」 는 각자 돌아가는
 * 순간에 정합니다 — 줄에 세울 때는 아직 뽑히지 않은 그림들이니까요.
 */
export function enqueueProjectGeneration(
  projectId: string,
  draft: ProjectDraft,
  what: { images?: boolean; videos?: boolean; redo?: boolean } = { images: true, videos: true },
): { characters: number; cuts: number; scenes: number } {
  const projectName = projectFolderName(projectId, draft.title);
  const engines = enginesOf(draft);
  const title = draft.title || "이름 없는 작품";
  const jobs: NewTask[] = [];
  const setUp = isSetUpOnly(engines.image);

  let characters = 0;
  let cuts = 0;
  let scenes = 0;

  if (what.images !== false) {
    // ① 인물이 먼저. 시트 없이 컷을 뽑으면 컷마다 다른 사람이 나옵니다.
    charactersToGenerate(draft, what.redo).forEach((person) => {
      characters += 1;
      jobs.push({
        lane: "media",
        kind: CHARACTER_SHEET_TASK,
        projectId,
        projectTitle: title,
        label: `${person.name || "인물"} 시트 ${setUp ? "차려 놓기" : "뽑기"}`,
        dedupe: `${projectId}:character:${person.id}`,
        payload: {
          projectId,
          projectName,
          characterId: person.id,
          name: person.name || "인물",
          owner: person.name || "인물",
          stem: person.name || "인물",
          engine: engines.image,
        } satisfies CharacterSheetPayload,
      });
    });

    // ② 컷 키 이미지. 레퍼런스는 돌아갈 때 ①의 결과에서 읽습니다.
    cutsToGenerate(draft, what.redo).forEach(({ scene, sceneIndex, cut }) => {
      cuts += 1;
      const owner = sceneFolderName(scene.title, sceneIndex);
      jobs.push({
        lane: "media",
        kind: CUT_IMAGE_TASK,
        projectId,
        projectTitle: title,
        label: `컷 ${cut.order} · ${scene.title || `장면 ${sceneIndex + 1}`} ${
          setUp ? "차려 놓기" : "그림 뽑기"
        }`,
        // 같은 컷을 두 번 세우지 않습니다 — 「시작」 을 두 번 눌러도 한 번만 돕니다.
        dedupe: `${projectId}:cut:${cut.id}`,
        payload: {
          projectId,
          projectName,
          cutId: cut.id,
          cutOrder: cut.order,
          owner,
          stem: `${owner}_컷${cut.order}`,
          engine: engines.image,
        } satisfies CutImagePayload,
      });
    });
  }

  if (what.videos !== false) {
    scenesToGenerate(draft, what.redo).forEach((scene) => {
      const index = draft.scenes.indexOf(scene);
      const owner = sceneFolderName(scene.title, index);
      scenes += 1;
      // ③ 스토리보드 — 컷 대표 그림이 다 붙은 뒤에 굽습니다.
      jobs.push({
        lane: "media",
        kind: SCENE_BOARD_TASK,
        projectId,
        projectTitle: title,
        label: `${scene.title || `장면 ${index + 1}`} 스토리보드 굽기`,
        dedupe: `${projectId}:board:${scene.id}`,
        payload: {
          projectId,
          projectName,
          sceneId: scene.id,
          owner,
        } satisfies SceneBoardPayload,
      });
      // ④ 그 시트 한 장으로 씬 영상.
      jobs.push({
        lane: "media",
        kind: SCENE_VIDEO_TASK,
        projectId,
        projectTitle: title,
        label: `${scene.title || `장면 ${index + 1}`} 영상 ${
          isSetUpOnly(engines.video) ? "차려 놓기" : "뽑기"
        }`,
        dedupe: `${projectId}:scene:${scene.id}`,
        payload: {
          projectId,
          projectName,
          sceneId: scene.id,
          sceneTitle: scene.title || `장면 ${index + 1}`,
          owner,
          stem: `${owner}_씬영상`,
          engine: engines.video,
        } satisfies SceneVideoPayload,
      });
    });
  }

  const made = enqueueTasks(jobs);
  return made ? { characters, cuts, scenes } : { characters: 0, cuts: 0, scenes: 0 };
}

// ── 붙이기 ──────────────────────────────────────────────────────────────────

/*
  뽑은 것을 폴더에 놓고 **끝내면 앱은 그것을 모릅니다** — 스토리보드도 «키 이미지 없음»
  으로 굽고, 확인 탭에도 안 뜹니다. 그래서 뽑는 즉시 그 카드에 붙이고 대표(별)를
  세웁니다. 별이 하나여야 다음 걸음이 어느 것을 쓸지 압니다.
*/
const asPrimary = (filePath: string, name: string) => ({
  id: Math.random().toString(36).slice(2),
  name,
  thumb: "",
  file: null,
  filePath,
  isPrimary: true,
});

/*
  아래 셋의 갱신 함수는 **다시 돌려도 됩니다.** 닫힌 작품에 쓰다 다른 창에 지면 `writeProject`
  가 되읽은 판 위에 같은 함수를 다시 돌립니다(2026-09-21). `asPrimary` 가 안에서 만드는 그림 id
  는 시도마다 달라지지만 그 id 를 밖에서 읽는 곳이 없고, 거절된 판은 어디에도 남지 않습니다.
*/
function attachSheet(projectId: string, characterId: string, filePath: string, name: string) {
  return writeProject(projectId, (current) => ({
    characters: current.characters.map((person) =>
      person.id === characterId
        ? {
            ...person,
            generatedImages: [
              ...(person.generatedImages ?? []).map((image) => ({ ...image, isPrimary: false })),
              asPrimary(filePath, name),
            ],
          }
        : person,
    ),
  }));
}

function attachImage(projectId: string, cutId: string, filePath: string, name: string) {
  return writeProject(projectId, (current) => ({
    scenes: current.scenes.map((scene) => ({
      ...scene,
      cuts: scene.cuts.map((cut) =>
        cut.id === cutId
          ? {
              ...cut,
              images: [
                ...(cut.images || []).map((image) => ({ ...image, isPrimary: false })),
                asPrimary(filePath, name),
              ],
            }
          : cut,
      ),
    })),
  }));
}

function attachVideo(projectId: string, sceneId: string, filePath: string, name: string) {
  return writeProject(projectId, (current) => ({
    scenes: current.scenes.map((scene) =>
      scene.id === sceneId
        ? {
            ...scene,
            videos: [
              ...(scene.videos || []).map((video) => ({ ...video, isPrimary: false })),
              { id: Math.random().toString(36).slice(2), name, filePath, isPrimary: true },
            ],
          }
        : scene,
    ),
  }));
}

/**
 * 뽑기는 됐는데 카드·장면에 못 붙였을 때의 말 — 까닭은 `writeProject` 가 준 것을 그대로, 파일이
 * 사라진 게 아니라는 것을 함께. 말하는 곳은 **여기(작업 서랍) 하나**입니다 — 예전에는 `writeProject`
 * 도 토스트를 띄워 같은 말이 두 번 보였고, 까닭은 여기서 «다른 창이 먼저 저장했다» 로 단정해
 * 파일 쓰기 실패일 때 틀렸습니다(2026-09-22 검토).
 */
const notAttached = (where: string, filePath: string, why: string) =>
  new Error(`뽑기는 했는데 ${where}에 못 붙였습니다 — ${why} 파일은 폴더에 있습니다: ${filePath}`);

// ── 실제로 뽑기 ─────────────────────────────────────────────────────────────

/**
 * 로컬로 그림 한 장. **뽑힌 실제 경로**를 돌려줍니다.
 *
 * 자리 잡기·번호·빈 파일 치우기는 `runLocalToProject` 한 곳이 합니다 — 여기서 따로
 * 하다가 «자리» 경로를 카드에 붙여 액박이 났습니다.
 */
async function localImage(
  payload: Common,
  prompt: string,
  assetType: ProjectAssetType,
  report: (change: { step?: string }) => void,
  /** 이 작품이 고른 로라들. 없으면 설정에서 켜 둔 것. */
  loras?: string[],
  /** 화면 비율 — 숏츠면 `9:16`. */
  aspect = "16:9",
) {
  const engine = payload.engine as LocalEngineId;
  const tuned = tuneForLocal(engine, { en: prompt, ko: "" });
  /*
    **로컬 그림 엔진은 레퍼런스를 못 뭅니다.** 넷(Qwen-Image·Z-Image·Krea 2·Anima) 다
    워커에 `image` 를 읽는 자리가 없습니다. 마그니픽으로 뽑을 때는 인물 시트가 올라가는데
    로컬은 글만 가므로, 같은 컷이라도 **컷마다 얼굴이 달라집니다.** 작업 줄에 적어 두어야
    를 여기서 찾습니다(2026-09-18 점검).
  */
  report({ step: "이 컴퓨터가 뽑는 중 · 이 엔진은 글만 받습니다(인물 시트 못 실음)" });
  const chosen = lorasToRun(engine, loras);
  return runLocalToProject({
    engine,
    extension: "png",
    kind: "image",
    projectName: payload.projectName,
    assetType,
    ownerName: payload.owner,
    stem: payload.stem,
    opts: {
      // 로라의 «불러오는 말» 을 앞에 붙입니다 — 안 붙이면 켜도 안 먹는 로라가 있습니다.
      prompt: withLoraTriggers(tuned.prompt, chosen),
      negative: tuned.negative,
      ...localSize(engine, aspect),
      loras: chosen,
      precision: loadPrecision(engine),
    },
    timeoutSecs: 1800,
    onProgress: (message) => report({ step: message || "이 컴퓨터가 뽑는 중" }),
  });
}

/**
 * 마그니픽 MCP 로 한 장·한 편. **레퍼런스는 먼저 올려 id 로 겁니다.**
 *
 * 「첨부한 인물 시트」 같은 말로는 아무것도 안 걸립니다 — 창 쪽에서 `@파일이름` 이 하던
 * 일을, API 쪽에서는 creation id 가 합니다.
 */
async function magnificMake(
  payload: Common,
  input: {
    kind: "image" | "video";
    prompt: string;
    references: string[];
    assetType: ProjectAssetType;
    seconds?: number;
    /** 영상의 첫 프레임. **첫 컷 그림**이 여기로 갑니다(시트가 아닙니다 — `firstFrameOf` 주석). */
    firstFrame?: string;
    /** 이 작품이 고른 모델·해상도. 안 고르면 마그니픽이 알아서 정합니다. */
    model?: string;
    resolution?: string;
    quality?: string;
    /** 화면 비율 — 숏츠면 `9:16`. */
    aspect?: string;
  },
  report: (change: { step?: string }) => void,
  stopped: () => boolean,
  taskId: string,
) {
  const ids: string[] = [];
  if (input.kind === "video") {
    const model = findMagnificVideoModel(await loadMagnificModels("video"), input.model);
    assertMagnificVideoInputs(model, {
      references: input.references.map(path => ({ type: mediaTypeOfPath(path), url: path })),
      ...(input.firstFrame ? { keyframes: { start: { type: "image", url: input.firstFrame } } } : {}),
      resolution: input.resolution,
    });
  }
  for (const [index, path] of input.references.entries()) {
    if (stopped()) throw new Error("멈췄습니다.");
    report({ step: `레퍼런스 올리는 중 ${index + 1}/${input.references.length}` });
    ids.push(await uploadToMagnific(path));
  }
  const first = input.firstFrame ? await uploadToMagnific(input.firstFrame) : undefined;

  const args: Record<string, unknown> =
    input.kind === "video"
      ? {
          prompt: input.prompt,
          duration: input.seconds ?? 5,
          aspectRatio: input.aspect || "16:9",
          // 영상 모델은 `slug`, 그림 모델은 `mode` 로 받습니다(마그니픽 도구 규약).
          ...(input.model ? { slug: input.model } : {}),
          ...(input.resolution ? { resolution: input.resolution } : {}),
          ...(first ? { keyframes: { start: { type: "image", url: first } } } : {}),
          /*
            **첫 프레임과 레퍼런스를 함께 보냅니다.**

            예전에는 첫 프레임이 있으면 레퍼런스를 통째로 버렸습니다(둘을 함께 못 받는 모델이
            있어서). 그런데 그 탓에 자동으로 뽑은 씬 영상은 인물 시트를 한 장도 못 받아,
            컷마다 얼굴이 달라졌습니다. 거절하는 모델이 있으면 그 까닭이
            작업 줄에 남습니다 — 말없이 인물을 잃는 것보다 낫습니다.
          */
          ...(ids.length
            ? { references: ids.map((identifier, index) => ({ type: mediaTypeOfPath(input.references[index]), url: identifier })) }
            : {}),
        }
      : {
          prompt: input.prompt,
          aspectRatio: input.aspect || "16:9",
          count: 1,
          ...(input.model ? { mode: input.model } : {}),
          ...(input.resolution ? { resolution: input.resolution } : {}),
          ...(input.quality ? { quality: input.quality } : {}),
          ...(ids.length
            ? { references: ids.map((identifier) => ({ type: "image", identifier })) }
            : {}),
        };

  return generateWithMagnific({
    kind: input.kind,
    args,
    projectName: payload.projectName,
    assetType: input.assetType,
    ownerName: payload.owner,
    stem: payload.stem,
    extension: input.kind === "video" ? "mp4" : "png",
    onBeat: (message) => report({ step: message }),
    stopped,
    // 접수부터 기록합니다. 기다리다 실패해도 서버의 작업 id·모델 변경 안내를 잃지 않습니다.
    onMetadata: (metadata, path) => setTaskResult(taskId, { ...(path ? { paths: [path] } : {}), data: { magnific: metadata } }),
  });
}

const tagOf = (path?: string) => (path ? `@${fileStemOf(path)}` : undefined);

/** 그 카드의 대표 그림. 합성 시트 > 별 > 첫 장 — 컷 카드가 고르는 순서와 같습니다. */
const primaryOf = (
  images: { filePath?: string; isPrimary?: boolean; isCompositeSheet?: boolean }[] | undefined,
) =>
  (images?.find((item) => item.isCompositeSheet) ??
    images?.find((item) => item.isPrimary) ??
    images?.[0])?.filePath;

// ① 캐릭터 시트 ─────────────────────────────────────────────────────────────
registerTaskRunner(CHARACTER_SHEET_TASK, async (raw, report, task) => {
  const payload = raw as CharacterSheetPayload;
  if (isStopping(task.id)) return;
  const draft = readProject(payload.projectId);
  const person = draft?.characters.find((item) => item.id === payload.characterId);
  if (!person) throw new Error("그 인물 카드를 찾지 못했습니다.");
  const prompt = (person.promptEn || person.promptKo || "").trim();
  if (!prompt) throw new Error("이 인물에 프롬프트가 없습니다.");

  if (payload.engine === "magnific") {
    report({ step: "마그니픽에 차려 놓는 중" });
    await composeInMagnific({
      kind: "image",
      prompt,
      referencePaths: (person.references ?? [])
        .map((item) => item.filePath)
        .filter((path): path is string => Boolean(path)),
      owner: { kind: "character", name: person.name || "인물" },
    });
    report({ step: "차려 두었습니다 — 그 창에서 뽑아 카드에 등록하세요" });
    return;
  }

  const refs = (person.references ?? [])
    .map((item) => item.filePath)
    .filter((path): path is string => Boolean(path));
  const made =
    payload.engine === "magnific-mcp"
      ? await magnificMake(
          payload,
          { kind: "image", prompt, references: refs, assetType: "character-generated", ...(await sizeOf(draft, "image")) },
          report,
          () => isStopping(task.id),
          task.id,
        )
      : await localImage(payload, prompt, "character-generated", report, draft?.localLoras?.[payload.engine], aspectOf(draft, "image"));
  report({ step: "카드에 붙이는 중" });
  const wrote = await attachSheet(payload.projectId, payload.characterId, made.path, made.name);
  if (!wrote.draft) throw notAttached("카드", made.path, wrote.why);
});

// ② 컷 키 이미지 ────────────────────────────────────────────────────────────
registerTaskRunner(CUT_IMAGE_TASK, async (raw, report, task) => {
  const payload = raw as CutImagePayload;
  if (isStopping(task.id)) return;
  const draft = readProject(payload.projectId);
  let found: { scene: Scene; cut: Cut } | undefined;
  draft?.scenes.forEach((scene) =>
    scene.cuts.forEach((cut) => {
      if (cut.id === payload.cutId) found = { scene, cut };
    }),
  );
  if (!found || !draft) throw new Error("그 컷을 찾지 못했습니다.");
  const { cut } = found;

  /*
    ── 레퍼런스는 **지금** 정합니다 ──────────────────────────────────────
    줄에 세울 때는 인물 시트가 아직 없었습니다(①이 방금 뽑았습니다). 그래서 돌아가는
    이 순간에 프로젝트를 다시 읽어 «이 컷에 나오는 사람들의 대표 시트» 를 집습니다.
    컷마다 고른 시트가 있으면 그것이 먼저입니다.
  */
  const people = cut.characterIds.map((id) => {
    // 전부 뺀 인물([])은 시트 없이 보냅니다 — 규칙은 `pickedCharacterRefs` 한 곳.
    const picked = pickedCharacterRefs(cut, id);
    const person = draft.characters.find((item) => item.id === id);
    return {
      name: person?.name || "인물",
      path: picked ? picked[0] : primaryOf(person?.generatedImages),
    };
  });
  const references = [
    cut.guideImagePath,
    cut.plateImagePath,
    ...people.map((item) => item.path),
  ].filter((path): path is string => Boolean(path));

  /*
    프롬프트에 **@태그를 이어 붙입니다.** 마그니픽은 올린 그림을 파일 이름으로만 집습니다 —
    「첨부한 인물」 이라고 적으면 아무 그림도 안 걸립니다. 컷 카드의 「@ 다시 잇기」 가
    손으로 하는 그 일을, 여기서는 보내기 직전에 자동으로 합니다. 시트가 방금 뽑혔으니
    컷에 적힌 프롬프트에는 아직 그 이름이 없습니다.
  */
  const base = (cut.promptEn || cut.promptKo || "").trim();
  const link = [
    cut.guideImagePath ? `layout ${tagOf(cut.guideImagePath)}` : "",
    ...people.map((item) => (item.path ? `${item.name} ${tagOf(item.path)}` : "")),
  ].filter(Boolean);
  const prompt = link.length ? `${base}\n\nReference images: ${link.join(" / ")}` : base;

  if (payload.engine === "magnific") {
    report({ step: `레퍼런스 ${references.length}장을 올리는 중` });
    await composeInMagnific({
      kind: "image",
      prompt,
      referencePaths: references,
      owner: { kind: "cut", name: `컷 ${payload.cutOrder}`, cutId: payload.cutId },
    });
    report({ step: "차려 두었습니다 — 그 창에서 뽑으세요" });
    return;
  }

  /*
    로컬은 `@파일이름` 을 모릅니다 — 그림은 파이프라인에 따로 실립니다. 그래서 글에는
    맨 프롬프트만 보냅니다(마그니픽용 칩을 그대로 보내면 글자가 그려집니다).
  */
  const made =
    payload.engine === "magnific-mcp"
      ? await magnificMake(
          payload,
          /*
            MCP 쪽은 `@파일이름` 이 아니라 creation id 로 겁니다. 그래서 글에는 맨
            프롬프트만 보냅니다 — 칩을 글로 적으면 생성기가 그 글자를 그립니다.
          */
          { kind: "image", prompt: base, references, assetType: "scene-cut", ...(await sizeOf(draft, "image")) },
          report,
          () => isStopping(task.id),
          task.id,
        )
      : await localImage(payload, base, "scene-cut", report, draft.localLoras?.[payload.engine], aspectOf(draft, "image"));
  report({ step: "카드에 붙이는 중" });
  const wrote = await attachImage(payload.projectId, payload.cutId, made.path, made.name);
  if (!wrote.draft) throw notAttached("카드", made.path, wrote.why);
});

// ③ 스토리보드 굽기 ─────────────────────────────────────────────────────────
registerTaskRunner(SCENE_BOARD_TASK, async (raw, report, task) => {
  const payload = raw as SceneBoardPayload;
  if (isStopping(task.id)) return;
  const draft = readProject(payload.projectId);
  const scene = draft?.scenes.find((item) => item.id === payload.sceneId);
  if (!scene || !draft) throw new Error("그 장면을 찾지 못했습니다.");

  const cells = storyboardCells(scene, draft.imageMarks);
  if (!cells.length)
    throw new Error(
      "칸에 넣을 그림이 없습니다 — 컷 그림이 아직 없습니다. 마그니픽으로 뽑는 중이면 그 창에서 뽑아 별을 달고 다시 시작해 주세요.",
    );

  report({ step: `컷 ${cells.length}칸을 한 장으로 굽는 중` });
  const { blob } = await composeStoryboard(scene, {
    imageMarks: draft.imageMarks,
    aspect: aspectOf(draft, "image"),
  });
  const stem = `${safeFileName(payload.owner)}_스토리보드`;
  const saved = await saveProjectMediaAsset(new File([blob], `${stem}.png`, { type: "image/png" }), {
    projectName: payload.projectName,
    assetType: "scene-cut",
    ownerName: payload.owner,
    stem,
  });
  if (!saved?.path) throw new Error("스토리보드를 폴더에 저장하지 못했습니다.");

  /*
    함께 올릴 시트들을 프롬프트에 적습니다 — 「수화 = @수화_001」. 칸 그림만 주면
    생성기가 인물을 제 나름대로 다시 그립니다.
  */
  const swaps: StoryboardSwap[] = [];
  const seen = new Set<string>();
  cells.forEach((cell) => {
    cell.cut.characterIds.forEach((id) => {
      if (seen.has(`c:${id}`)) return;
      seen.add(`c:${id}`);
      const person = draft.characters.find((item) => item.id === id);
      if (!person) return;
      swaps.push({
        kind: "character",
        name: person.name || "인물",
        tag: tagOf(primaryOf(person.generatedImages)),
      });
    });
    const place = draft.backgrounds.find((item) => item.id === cell.cut.backgroundId);
    if (place && !seen.has(`b:${place.id}`)) {
      seen.add(`b:${place.id}`);
      swaps.push({
        kind: "background",
        name: place.name || "장소",
        tag: tagOf(primaryOf(place.generatedImages)),
      });
    }
  });

  const prompt = buildStoryboardVideoPrompt({
    sceneTitle: scene.title,
    sceneSummary: scene.summary,
    cells,
    sheetTag: `@${fileStemOf(saved.path)}`,
    swaps,
    // 한 번에 뽑기에서도 화면비와 잠금을 싣습니다 — 손으로 만든 것과 같은 글이 되도록.
    aspect: draft?.aspect?.video || draft?.aspect?.image,
    lockNames: [...new Set(scene.cuts.flatMap((cut) => cut.characterIds || []))]
      .map((id) => draft?.characters.find((item) => item.id === id)?.name)
      .filter((name): name is string => Boolean(name)),
  });
  // 다시 돌려도 되는 갱신 함수입니다 — `saved.path`·`prompt` 는 닫힌 값이라 시도마다 같습니다.
  const wrote = await writeProject(payload.projectId, (current) => ({
    scenes: current.scenes.map((item) =>
      item.id === payload.sceneId
        ? {
            ...item,
            storyboardPath: saved.path,
            storyboardAt: new Date().toISOString(),
            storyboardPromptKo: prompt.ko,
            storyboardPromptEn: prompt.en,
          }
        : item,
    ),
  }));
  if (!wrote.draft) throw notAttached("장면", saved.path, wrote.why);
  report({ step: `컷 ${cells.length}칸 · ${prompt.seconds.toFixed(1)}초` });
});

/**
 * **씬 영상의 첫 프레임은 «첫 컷 그림» 입니다.**
 *
 * 2026-09-18 실측에서 잡힌 것입니다. 여태 스토리보드 시트를 첫 프레임으로 줬는데,
 * 생성기는 그것을 «칸 순서표» 로 읽지 않고 **그림 한 장으로** 읽습니다. 그래서 뽑힌 영상의
 * 첫 2초가 「컷 2 · 천 사이로 들어서는 단이 / 길이 5.0초 / 카메라 고정」 이라는 한국어 표가
 * 화면에 찍힌 채 움직이는 장면이었습니다. 게다가 시트는 가로로 긴 판이라 첫 프레임이 모양을
 * 정하는 모델에서는 **작품 비율(9:16)이 통째로 무시**되었습니다(결과 1486×618).
 *
 * 칸 순서는 프롬프트(`storyboardPromptEn`)가 이미 글로 들고 있습니다. 시트는 첫 프레임이
 * 아니라 **레퍼런스**로 함께 올립니다 — 그림의 모양을 정하지 않으면서 순서는 알려 줍니다.
 */
function firstFrameOf(scene: Scene): string | undefined {
  for (const cut of scene.cuts) {
    const hero = heroImageOf(cut);
    if (hero?.filePath) return hero.filePath;
  }
  // 컷 그림이 하나도 없으면 시트라도 줍니다 — 없는 것보다는 낫습니다.
  return scene.storyboardPath || undefined;
}

/**
 * 씬 영상과 함께 올릴 것들 — 스토리보드 시트와 **이 장면에 나오는 인물 시트**.
 *
 * 여태 `references: []` 였습니다. 그래서 자동으로 뽑은 씬 영상은 인물이 누구인지 모른 채
 * 글만 보고 그렸습니다().
 * 컷 단위 「영상 생성기로 보내기」 는 이미 시트를 싣고 있었는데 자동 쪽만 빠져 있었습니다.
 */
function sceneVideoRefs(draft: ProjectDraft | null, scene: Scene): string[] {
  const paths: string[] = [];
  if (scene.storyboardPath) paths.push(scene.storyboardPath);
  const seen = new Set<string>();
  scene.cuts.forEach((cut) => {
    cut.characterIds.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const person = draft?.characters.find((item) => item.id === id);
      const sheet = person ? primaryOf(person.generatedImages) : null;
      if (sheet) paths.push(sheet);
    });
  });
  // 마그니픽은 레퍼런스를 넉넉히 받지만, 앞쪽을 더 무겁게 읽습니다. 여섯 장이면 충분합니다.
  return paths.slice(0, 6);
}

// ④ 씬 영상 ────────────────────────────────────────────────────────────────
registerTaskRunner(SCENE_VIDEO_TASK, async (raw, report, task) => {
  const payload = raw as SceneVideoPayload;
  if (isStopping(task.id)) return;
  const draft = readProject(payload.projectId);
  const scene = draft?.scenes.find((item) => item.id === payload.sceneId);
  if (!scene) throw new Error("그 장면을 찾지 못했습니다.");
  if (!scene.storyboardPath || !scene.storyboardPromptEn)
    throw new Error("스토리보드가 아직 없습니다 — 앞 걸음(스토리보드 굽기)이 끝나야 합니다.");

  /*
    ── 러닝타임은 **씬이 정합니다** ──────────────────────────────────────
    

    컷 길이의 합이 그 씬의 길이입니다. 예전에는 여기서 10초로 못 박아 잘랐는데, 그러면
    20초를 받는 모델을 골라도 10초짜리가 나옵니다. MCP 쪽은 이제 **모델에게 물어** 맞춥니다
    (`fitDuration`) — 모자란 것보다 넘치는 쪽을 고릅니다. 컷이 잘리면 이야기가 끊깁니다.

    마그니픽 **창**과 로컬은 받아 주는 길이를 물어볼 데가 없어서 여태 한계를 그대로 씁니다.
  */
  const wanted = Math.max(
    1,
    Math.round(
      scene.cuts.reduce(
        (total, cut) => total + cutVideoSecondsOf(cut),
        0,
      ) * 2,
    ) / 2,
  );
  const prompt = scene.storyboardPromptEn.trim();

  if (payload.engine === "magnific") {
    report({ step: "마그니픽에 스토리보드를 올리는 중" });
    await composeInMagnific({
      kind: "video",
      seconds: Math.min(MAX_GENERATOR_SECONDS, wanted),
      prompt,
      referencePaths: [firstFrameOf(scene), scene.storyboardPath].filter(
        (path): path is string => Boolean(path),
      ),
      owner: { kind: "scene", name: payload.sceneTitle, sceneId: payload.sceneId },
    });
    report({ step: "차려 두었습니다 — 그 창에서 뽑으세요" });
    return;
  }

  if (payload.engine === "magnific-mcp") {
    /*
      이 모델이 받아 주는 길이로 맞춥니다. 목록을 못 받으면 씬이 정한 길이를 그대로
      보냅니다 — 우리가 임의로 자르는 것보다 마그니픽이 거절하는 편이 낫습니다.
      거절은 작업 줄에 까닭과 함께 남고, 자르기는 아무 말 없이 이야기를 끊습니다.
    */
    const models = await loadMagnificModels("video").catch(() => []);
    const seconds = fitDuration(models, draft?.magnific?.videoModel, wanted);
    report({ step: `러닝타임 ${seconds}초 · 컷 길이의 합 ${wanted}초` });
    const made = await magnificMake(
      payload,
      {
        kind: "video",
        prompt,
        references: sceneVideoRefs(draft, scene),
        assetType: "scene-video",
        firstFrame: firstFrameOf(scene),
        seconds,
        ...(await sizeOf(draft, "video")),
      },
      report,
      () => isStopping(task.id),
      task.id,
    );
    report({ step: "장면에 붙이는 중" });
    const wrote = await attachVideo(payload.projectId, payload.sceneId, made.path, made.name);
    if (!wrote.draft) throw notAttached("장면", made.path, wrote.why);
    return;
  }

  const seconds = Math.min(MAX_GENERATOR_SECONDS, wanted);
  const engine = payload.engine as LocalEngineId;
  const tuned = tuneForLocal(engine, { en: prompt, ko: "" });
  report({ step: `이 컴퓨터가 ${seconds}초를 뽑는 중` });
  const videoLoras = lorasToRun(engine, draft?.localLoras?.[engine]);
  const made = await runLocalToProject({
    engine,
    extension: "mp4",
    kind: "video",
    projectName: payload.projectName,
    assetType: "scene-video",
    ownerName: payload.owner,
    stem: payload.stem,
    opts: {
      // 영상 쪽도 같습니다 — 트리거를 안 붙이면 켠 로라가 안 먹습니다.
      prompt: withLoraTriggers(tuned.prompt, videoLoras),
      negative: tuned.negative,
      seconds,
      fps: 24,
      // 첫 컷 그림이 첫 프레임입니다(I2V) — 글만 주면 인물이 달라집니다.
      image: firstFrameOf(scene),
      ...localSize(engine, aspectOf(draft, "video")),
      loras: videoLoras,
      precision: loadPrecision(engine),
    },
    timeoutSecs: 7200,
    onProgress: (message) => report({ step: message || `이 컴퓨터가 ${seconds}초를 뽑는 중` }),
  });
  report({ step: "장면에 붙이는 중" });
  const wrote = await attachVideo(payload.projectId, payload.sceneId, made.path, made.name);
  if (!wrote.draft) throw notAttached("장면", made.path, wrote.why);
});

/** 줄에 세우고 사람에게 알립니다. 판과 일괄 생성이 같이 씁니다(공통 규칙 1). */
export function startProjectGeneration(
  projectId: string,
  draft: ProjectDraft,
  what?: { images?: boolean; videos?: boolean; redo?: boolean },
) {
  const made = enqueueProjectGeneration(projectId, draft, what);
  const total = made.characters + made.cuts + made.scenes * 2;
  if (!total) {
    toast.error("돌릴 것이 없습니다.", {
      description: what?.redo
        ? "프롬프트가 적힌 카드가 없습니다. (이미 줄에 서 있는 것은 다시 세우지 않습니다)"
        : "캐릭터·컷 프롬프트를 먼저 채워 주세요. (이미 줄에 서 있는 것은 다시 세우지 않습니다)",
    });
    return 0;
  }
  const engines = enginesOf(draft);
  const bySetup = isSetUpOnly(engines.image) && isSetUpOnly(engines.video);
  toast.success(
    `인물 ${made.characters} · 컷 ${made.cuts} · 장면 ${made.scenes} 을 순서대로 줄에 세웠습니다.`,
    {
      description: bySetup
        ? "인물 시트 → 컷 그림 → 스토리보드 → 씬 영상 차례입니다. 마그니픽은 차려 놓기까지라 중간중간 그 창에서 뽑아 별을 달아 주세요. 위쪽 «작업» 단추로 진행을 봅니다."
        : "인물 시트 → 컷 그림 → 스토리보드 → 씬 영상까지 손 없이 이어집니다. 파일은 프로젝트 폴더에 놓이고 카드에 대표로 붙습니다. 위쪽 «작업» 단추로 진행을 봅니다.",
      duration: 12000,
    },
  );
  return total;
}
