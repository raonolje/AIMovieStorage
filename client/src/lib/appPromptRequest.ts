import { getTargetPlatform } from "@/components/PlatformSelect";
import { blueprintForSpace } from "@/lib/blueprint";
import { summarizeCompositionCamera } from "@/lib/composition";
import { buildCutPrompt } from "@/lib/cutPrompt";
import { buildCutVideoPrompt } from "@/lib/cutVideoPrompt";
import { cutVideoLinkInput } from "@/lib/cutVideoReferences";
import { ensureVoicePrompt } from "@/lib/characterVoice";
import { relinkContinuityTags, resolveCutContinuity } from "@/lib/cutContinuity";
import { projectContextOf } from "@/lib/projectContext";
import { relinkPromptText } from "@/lib/promptLinks";
import {
  backgroundCardDescription, characterBasics, cutLinkInput, cutLinkPaths,
  cutRequestPayload, cutVideoRequestPayload, cutVideoSkeletonInput,
  identityMarksOf, sheetReferenceSources, sheetReferenceTags, sheetRequestPayload,
  sheetRunConditions, templateMentionOf, withCutPromptResult, withPromptResult,
  withUnfoldFrame,
} from "@/lib/promptPayloads";
import type { LlmRequestOptions } from "@/lib/promptRequest";
import type { Cut, ProjectDraft } from "@/lib/projectTypes";
import { withStoryboardPrompt } from "@/lib/storyboardPromptHistory";
import { withCutVideoPrompt } from "@/lib/cutVideoPromptHistory";
import { storyboardCells } from "@/lib/storyboardSheet";
import { storyboardLockNames, storyboardRequestData, storyboardSwaps } from "@/lib/storyboardPromptRequest";

export type AppPromptTarget =
  | { kind: "character"; id: string }
  | { kind: "background"; id: string }
  | { kind: "cutImage"; sceneId: string; cutId: string }
  | { kind: "cutVideo"; sceneId: string; cutId: string }
  | { kind: "sceneVideo"; sceneId: string };

export type AppPromptResult = { ko: string; en: string; negativeKo: string; negativeEn: string };

const heightsOf = (draft: ProjectDraft) =>
  Object.fromEntries(draft.characters.map((item) => [item.id, item.heightCm ?? 170]));

const usesComposition = (cut: Cut) =>
  cut.useComposition !== false && Boolean(cut.composition || cut.guideImage || cut.guideImagePath);

/** 카드 버튼·일괄 생성과 같은 payload 함수에 현재 프로젝트의 실제 값을 넣습니다. */
export function appPromptRequest(draft: ProjectDraft, target: AppPromptTarget): LlmRequestOptions {
  const platformId = getTargetPlatform();
  const context = projectContextOf(draft);
  if (target.kind === "character" || target.kind === "background") {
    const character = target.kind === "character";
    const entity = character
      ? draft.characters.find((item) => item.id === target.id)
      : draft.backgrounds.find((item) => item.id === target.id);
    if (!entity) throw new Error("프롬프트를 작성할 카드가 없습니다.");
    const background = character ? undefined : draft.backgrounds.find((item) => item.id === target.id);
    const spaceKind = background?.spaceKind || "exterior";
    const blueprint = character ? entity.blueprint : blueprintForSpace(entity.blueprint, spaceKind);
    const references = entity.references || [];
    const basics = character ? characterBasics(draft.characters.find((item) => item.id === target.id)!) : {};
    return {
      task: character ? "characterSheet" : "backgroundSheet",
      template: character ? "character-sheet" : "background-sheet",
      modelId: entity.promptModel,
      platformId,
      data: sheetRequestPayload({
        kind: target.kind,
        name: entity.name,
        description: character ? entity.description : backgroundCardDescription(background!),
        projectFacts: context?.facts ?? null,
        entity,
        blueprint,
        spaceKind: character ? undefined : spaceKind,
        ...basics,
        identityMarks: identityMarksOf(target.kind, references, draft.imageMarks || {}),
        templateMention: character ? null : templateMentionOf(references, platformId),
        references: sheetReferenceTags(references, platformId),
      }),
      images: sheetReferenceSources(references),
    };
  }
  if (target.kind === "sceneVideo") {
    const scene = draft.scenes.find((item) => item.id === target.sceneId);
    if (!scene) throw new Error("프롬프트를 작성할 장면이 없습니다.");
    if (!scene.storyboardPath) throw new Error("먼저 앱에서 스토리보드 시트를 만들어 주세요.");
    const cells = storyboardCells(scene, draft.imageMarks || {});
    return {
      task: "cutPrompt",
      template: "storyboard-video",
      data: storyboardRequestData({
        scene, cells,
        swaps: storyboardSwaps(cells, draft.characters, draft.backgrounds),
        videoAspect: draft.aspect?.video,
        lockNames: storyboardLockNames(scene, draft.characters),
      }),
    };
  }

  const scene = draft.scenes.find((item) => item.id === target.sceneId);
  const cut = scene?.cuts.find((item) => item.id === target.cutId);
  if (!scene || !cut) throw new Error("프롬프트를 작성할 컷이 없습니다.");
  const cutCharacters = draft.characters.filter((item) => cut.characterIds.includes(item.id));
  const background = draft.backgrounds.find((item) => item.id === cut.backgroundId);
  const summary = summarizeCompositionCamera(cut.composition, { heightsCm: heightsOf(draft) });
  const useComposition = usesComposition(cut);
  if (target.kind === "cutImage") return {
    task: "cutPrompt",
    template: "cut-prompt",
    platformId,
    techniques: cut.techniques || [],
    data: cutRequestPayload({
      projectFacts: context?.facts ?? null,
      sceneSummary: scene.summary,
      cut, cutCharacters, background, summary, useComposition,
      facts: buildCutPrompt({ cut, characters: cutCharacters, background, context }).facts,
    }),
    images: cut.guideImage ? [cut.guideImage] : [],
  };
  const useRefVideo = cut.useRefVideo !== false && Boolean(cut.refVideoPath);
  const skeletonInput = cutVideoSkeletonInput({
    cut, scenes: draft.scenes, characters: draft.characters, cutCharacters, background, context,
    continuity: resolveCutContinuity(scene, cut),
    useComposition, useRefVideo, aspect: draft.aspect?.video || draft.aspect?.image,
    videoModel: draft.magnific?.videoModel,
  });
  return {
    task: "cutVideoPrompt",
    template: "cut-video-prompt",
    modelId: skeletonInput.modelId,
    platformId,
    techniques: cut.techniques || [],
    data: cutVideoRequestPayload({
      skeleton: buildCutVideoPrompt(skeletonInput), skeletonInput,
      projectFacts: context?.facts ?? null,
      sceneSummary: scene.summary, cut, cutCharacters, background, summary, useComposition,
    }),
  };
}

/** Codex·Claude가 쓴 JSON을 카드 버튼과 같은 이력·@태그·전개도 틀 처리로 적용합니다. */
export function applyAppPromptResult(draft: ProjectDraft, target: AppPromptTarget, result: AppPromptResult): ProjectDraft {
  const platform = getTargetPlatform();
  if (target.kind === "character") return {
    ...draft,
    characters: draft.characters.map((item) => item.id === target.id
      ? { ...item, ...withPromptResult(item, result, "대화 조종기 · 프롬프트 작성") } : item),
  };
  if (target.kind === "background") return {
    ...draft,
    backgrounds: draft.backgrounds.map((item) => item.id === target.id
      ? { ...item, ...withPromptResult(item, withUnfoldFrame(result, {
          kind: "background", blueprint: blueprintForSpace(item.blueprint, item.spaceKind || "exterior"),
          entity: item, references: item.references || [], platform,
        }), sheetRunConditions({
          kind: "background", blueprint: item.blueprint, spaceKind: item.spaceKind,
          referenceCount: item.references?.length || 0, hasAnalysis: Boolean(item.analysis?.trim()),
          model: item.promptModel, extra: "대화 조종기 · 프롬프트 작성",
        })) } : item),
  };
  if (target.kind === "sceneVideo") return {
    ...draft,
    scenes: draft.scenes.map((scene) => scene.id === target.sceneId
      ? { ...scene, ...withStoryboardPrompt(scene, result, "대화 조종기 · 프롬프트 작성") } : scene),
  };
  return {
    ...draft,
    scenes: draft.scenes.map((scene) => scene.id !== target.sceneId ? scene : {
      ...scene,
      cuts: scene.cuts.map((cut) => {
        if (cut.id !== target.cutId) return cut;
        const background = draft.backgrounds.find((item) => item.id === cut.backgroundId);
        const useComposition = usesComposition(cut);
        const link = cutLinkInput({
          cut, characters: draft.characters, background,
          summary: summarizeCompositionCamera(cut.composition, { heightsCm: heightsOf(draft) }),
          useComposition, ...cutLinkPaths(cut, background, useComposition),
        });
        if (target.kind === "cutVideo") {
          const continuity = resolveCutContinuity(scene, cut);
          const videoLink = cutVideoLinkInput(cut, link, continuity, draft.characters);
          const source = (text: string) => continuity ? relinkContinuityTags(text, continuity.sourceCut, continuity.video) : text;
          return { ...cut, ...withCutVideoPrompt(cut, {
            ko: ensureVoicePrompt(relinkPromptText(source(result.ko), videoLink, "ko"), { cut, scenes: draft.scenes, characters: draft.characters, lang: "ko" }),
            en: ensureVoicePrompt(relinkPromptText(source(result.en), videoLink, "en"), { cut, scenes: draft.scenes, characters: draft.characters, lang: "en" }),
          }, "대화 조종기 · 프롬프트 작성") };
        }
        const linked = {
          ko: relinkPromptText(result.ko, link, "ko"),
          en: relinkPromptText(result.en, link, "en"),
        };
        return { ...cut, ...withCutPromptResult(cut, result, linked,
          "대화 조종기 · 프롬프트 작성", "앱 요청문 · 인물·장소·구도 연결") };
      }),
    }),
  };
}
