import { findMotionMask } from "@/lib/motionMask";
import { buildReferenceTags, fileStemOf } from "@/components/ReferenceTagBar";
import type { ImageMark } from "@/components/ImageMarkupEditor";
import { describeMarksForLlm } from "@/lib/imageMarkDraw";
import { assetSrc } from "@/lib/mediaLibrary";
import { describeCameraMoves } from "@/lib/cameraMoves";
import { cameraMovesOf } from "@/lib/compositionEdit";
import { characterAliases, characterLegend, objectLegend } from "@/lib/compositionLegend";
import type { CompositionCameraSummary } from "@/lib/composition";
import { cutToggleLabel, cutTogglesEnglish } from "@/lib/cutStyle";
import { autoRealism, isCloseUp } from "@/lib/autoRealism";
import { buildCutPrompt } from "@/lib/cutPrompt";
import { cutVideoSeconds, dedupePhrases, type CutVideoPrompt, type CutVideoPromptInput } from "@/lib/cutVideoPrompt";
import { videoRuleIdOf } from "@/lib/modelRules";
import { appendPromptHistory, describeRunConditions } from "@/lib/promptHistory";
import type { PromptLinkInput } from "@/lib/promptLinks";
import type { PromptWorkflowState } from "@/lib/promptWorkflow";
import {
  backgroundAnchorKind,
  backgroundAspect,
  backgroundFrameKind,
  backgroundMasterKind,
  backgroundPanelCount,
  composeUnfoldPrompt,
  countKnownBlueprint,
  detailBlueprint,
  hasPanoramaChip,
  spaceForChips,
  stripUnfoldFrame,
  summarizeBlueprint,
  unfoldChipOf,
  unfoldNegativeOf,
  type BlueprintKind,
  type BlueprintRouteMark,
  type SpaceKind,
} from "@/lib/blueprint";
import type { ProjectContextSummary } from "@/lib/projectContext";
import type { Background, Character, Cut, GeneratedImageAsset, ReferenceImage } from "@/lib/projectTypes";

/**
 * **프롬프트 요청의 재료와 넣기 — 카드 단추와 「AI 일괄 생성」 이 한 벌로 씁니다.**
 *
 *
 *
 * # 왜 어제 고친 것이 안 먹었는가
 *
 * 카드마다 있는 「프롬프트 작성」 은 풍부한 요청 문구(`cut-prompt.md`·`character-sheet.md`…)를 타지만,
 * 일괄 생성은 3단계에서 **컷 예순 개의 프롬프트를 한 답(2만 토큰)에** 받고, 인물·장소 시트는 LLM 없이
 * **규칙으로 조립**해 두었습니다. 그러니 어제 요청 문구를 아무리 고쳐도 일괄 생성의 글에는 한 글자도
 * 닿지 않았습니다. 고치는 길은 하나 — 일괄 생성이 **카드 단추와 같은 재료로 같은 요청**을 카드마다
 * 따로 보내는 것입니다(4단계, `bootstrapPrompts.ts`).
 *
 * # 왜 여기(lib)인가
 *
 * 재료를 짓는 코드가 `usePromptCard.ts`(인물·장소)와 `CutCard.tsx`(컷) 안에 훅·컴포넌트 지역으로
 * 있었습니다. 일괄 생성이 그것을 쓰려면 화면 밖으로 꺼내야 하고, 꺼낼 때 **한 벌만** 둡니다(규칙 1) —
 * 두 벌이면 한쪽만 배경 생김새를 빠뜨리는 식으로 반드시 어긋나고, 그건 읽어서는 못 찾습니다.
 * 카드 쪽은 이 함수들을 부르기만 하고, 동작은 옮기기 전과 한 글자도 다르지 않습니다.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 인물 카드의 기본 정보 — 화면의 표와 요청이 같은 표를 봅니다
// ─────────────────────────────────────────────────────────────────────────────

/** 체형 — 영어. 「보통」 은 적지 않습니다(아무 정보가 아닙니다). */
export const BUILD_EN: Record<Character["build"], string> = {
  slim: "slim build",
  average: "",
  athletic: "athletic build",
  broad: "broad, heavy-set build",
};

/** 성별 — 모델이 알아듣는 말로. 적어 둔 글자가 이 셋이 아니면 그대로 보냅니다. */
export const GENDER_EN: Record<string, string> = {
  "남": "man",
  "여": "woman",
  "남자": "man",
  "여자": "woman",
  "남성": "man",
  "여성": "woman",
};

export const BUILD_LABELS: Record<Character["build"], string> = {
  slim: "마른 편",
  average: "보통",
  athletic: "다부진",
  broad: "덩치 큰",
};

/**
 * 규칙으로 조립하거나 LLM 에 요청할 때 함께 넣을 **기본 정보**. 키와 체형은 그림에서 못 읽습니다.
 *
 * **나이·부르는 이름도 여기 넣습니다.** 2026-09-18 점검에서, 캐릭터 특징에 「19세」 를
 * 적어도 그림 프롬프트 요청에는 한 글자도 안 실리는 것이 드러났습니다(요청문을 직접
 * 열어 확인). 요청문 안내는 「인종·나이·체형처럼 정체성을 정하는 값은 basics 에 적힌
 * 것만 쓴다」 고 하는데 나이가 거기 없었으니, 열아홉짜리가 서른으로 나와도 막을 길이
 * 없었습니다. 성격·말투처럼 **그림에 안 찍히는 것은 그대로 뺍니다** — 시트에 글자로
 * 찍히는 몫입니다.
 *
 * `basicsEn` 은 같은 값의 영어. 번역이 아니라 **그림 프롬프트에 쓰는 말**로 적습니다.
 */
export function characterBasics(character: Character): { basics: string[]; basicsEn: string[] } {
  return {
    basics: [
      character.role && `역할 ${character.role}`,
      character.gender && `성별 ${character.gender}`,
      character.profile?.age && `나이 ${character.profile.age}`,
      character.heightCm && `키 ${character.heightCm}cm`,
      BUILD_LABELS[character.build],
    ].filter(Boolean) as string[],
    basicsEn: [
      ageEnOf(character.profile?.age),
      character.gender && GENDER_EN[character.gender],
      character.heightCm && `${character.heightCm} cm tall`,
      BUILD_EN[character.build],
    ].filter(Boolean) as string[],
  };
}

/**
 * 나이 칸을 **그림 프롬프트에 쓰는 영어**로. 「42세」·「42살」·「42」 → `42 years old`, 「40대 후반」 → `in their late 40s`,
 * 「10대」 → `in their teens`.
 *
 * 예전에는 칸 값을 그대로 `${age} years old` 로 이어서 «42세 years old» 가 영문 요청에 실렸습니다(2026-09-22 검토).
 * 영문에 한글이 섞이면 생성기가 그 부분을 통째로 버리거나 글자로 그려 넣습니다 — 못 읽는 모양이면 안 싣습니다
 * (`summarizeProjectContext` 의 «모르면 빈 글자» 와 같은 규칙).
 */
export function ageEnOf(age?: string): string {
  const text = (age || "").trim();
  const exact = text.match(/^(\d+)\s*(세|살)?$/);
  if (exact) return `${exact[1]} years old`;
  const decade = text.match(/^(\d+)\s*대(?:\s*(초반|중반|후반))?$/);
  if (!decade) return "";
  const part = { 초반: "early ", 중반: "mid-", 후반: "late " }[decade[2] as "초반" | "중반" | "후반"] ?? "";
  return `in their ${part}${decade[1] === "10" ? "teens" : `${decade[1]}s`}`;
}

/** 장소 카드가 요청에 싣는 설명 — 위치와 설명을 한 줄로(`StepBackgrounds` 와 일괄 생성이 같은 것). */
export function backgroundCardDescription(background: Pick<Background, "location" | "description">): string {
  return [background.location, background.description].filter(Boolean).join(" — ");
}

/**
 * **그림이 없을 때 그 사람을 세우는 한 줄.**
 *
 * 이름은 우리끼리 쓰는 말이라
 * 생성기에는 아무 뜻이 없습니다. 그림이 아직 없으면 이 글이 그 사람을 대신합니다.
 *
 * 요청(`cutRequestPayload`)과 프롬프트 꼬리(`cutLinkInput`) **두 곳이 같이 씁니다**(규칙 1) —
 * 한쪽만 고치면 화면에 보이는 글과 API 로 가는 글이 다른 사람을 말하게 됩니다.
 */
export const lookOf = (person: {
  description?: string;
  gender?: string;
  heightCm?: number;
  profile?: { age?: string; tagline?: string; personality?: string };
}): string =>
  [
    person.description,
    person.gender,
    person.profile?.age,
    person.heightCm ? `${person.heightCm}cm` : "",
    person.profile?.tagline,
  ]
    .map((text) => (text || "").trim())
    .filter(Boolean)
    .join(" / ");

// ─────────────────────────────────────────────────────────────────────────────
// 인물·장소·에셋 시트 — 「프롬프트 작성」 이 보내는 재료
// ─────────────────────────────────────────────────────────────────────────────

/** 요청에 싣는 레퍼런스 한 장 — `sheetReferenceTags` 가 만드는 꼴. */
export interface SheetReferenceTag {
  order: number;
  tag: string;
  name: string;
  role: string;
  isIdentity: boolean;
}

/** 전개도 틀로 넣은 레퍼런스인가 — 꼬리표로 알아봅니다(`usePromptCard.ensureUnfoldTemplate`). */
export function isUnfoldTemplateReference(image: ReferenceImage | undefined): boolean {
  return Boolean(image?.label?.startsWith("전개도 틀"));
}

/**
 * 그림에 붙은 태그를 요청에 함께 싣습니다.
 *
 * 「추가 외형 묘사」 에 "@정체성 에서 헤어는 @ref_1 의 헤어로" 라고 적어도,
 * LLM 이 @ref_1 이 몇 번째 그림인지 모르면 소용이 없습니다. 보내는 그림
 * 순서와 같은 순서로 태그를 적어 주면 짝이 맞습니다.
 *
 * `sheetReferenceSources` 와 **같은 4장으로 자릅니다.** 자르는 수가 어긋나면
 * 태그가 없는 그림이 생겨서 엉뚱한 것을 가리킵니다.
 *
 * 마그니픽은 파일 이름으로 그림을 부릅니다. tag 도 name 도 파일 이름으로 보내야
 * LLM 이 `@정체성` 같은 표시 이름을 쓰지 않습니다.
 */
export function sheetReferenceTags(list: ReferenceImage[], platform: string): SheetReferenceTag[] {
  /*
    요청에는 앞 네 장만 싣습니다. 전개도 틀은 늘 **맨 뒤에** 붙으므로 레퍼런스가 다섯 장을 넘으면 틀이 잘려 나가
    프롬프트가 부를 태그가 사라집니다 — 그때는 넷째 자리를 틀에 내줍니다(틀 없이 뽑으면 칸이 제멋대로라서).
  */
  const templateAt = list.findIndex(isUnfoldTemplateReference);
  const shown = templateAt >= 4 ? [...list.slice(0, 3), list[templateAt]] : list.slice(0, 4);
  return buildReferenceTags(shown, platform).map((tag, order) => ({
    order: order + 1,
    tag: tag.mention,
    name: platform === "magnific" && tag.fileStem ? tag.fileStem : tag.name,
    role: isUnfoldTemplateReference(shown[order])
      ? "전개도 틀 — 회색 칸 자리대로 그림을 넣게 하는 틀. en 맨 앞 칩 문장이 이 태그를 부릅니다"
      : tag.isIdentity
        ? "정체성 기준 — 이 인물이 누구인지"
        : "참고용",
    isIdentity: tag.isIdentity,
  }));
}

/** 레퍼런스 가운데 전개도 틀의 태그. 없으면 null. */
export function templateMentionOf(list: ReferenceImage[], platform: string): string | null {
  return sheetReferenceTags(list, platform).find((tag) => tag.role.startsWith("전개도 틀"))?.tag ?? null;
}

/**
 * LLM 에 올릴 그림들. 넉 장까지만 씁니다 — 더 보내면 각각을 더 작게 봅니다.
 * 화면에 띄우는 주소와 같은 순서 — **저장된 파일이 먼저입니다.** blob 은 앱을 닫으면 죽습니다.
 */
export function sheetReferenceSources(list: ReferenceImage[]): string[] {
  return list
    .slice(0, 4)
    .map((image) => assetSrc(image.filePath) || image.thumb || "")
    .filter(Boolean);
}

/**
 * 정체성 그림(첫 번째 레퍼런스) 위의 표시. 배경일 때만 — 인물 그림의 표시는 앵커가 아닙니다.
 * `buildReferenceTags` 가 «첫 번째 = 정체성» 으로 세므로 같은 규칙으로 고릅니다.
 */
export function identityMarksOf(
  kind: BlueprintKind,
  references: ReferenceImage[],
  imageMarks: Record<string, ImageMark[]>,
): BlueprintRouteMark[] | null {
  if (kind !== "background") return null;
  const identity = references[0];
  const marks = identity?.filePath ? imageMarks[identity.filePath] : undefined;
  return marks?.length ? describeMarksForLlm(marks) : null;
}

export interface SheetRequestInput {
  kind: BlueprintKind;
  name: string;
  description: string;
  projectFacts: ProjectContextSummary["facts"] | null;
  entity: Pick<PromptWorkflowState, "analysis" | "referenceMode" | "panoramaSpace" | "exteriorSpace">;
  /** 요청에 싣는 구성 칩 — 배경은 옛 칩을 실내·실외로 읽은 뒤의 목록(`blueprintForSpace`). */
  blueprint: string[];
  spaceKind?: SpaceKind;
  basics?: string[];
  basicsEn?: string[];
  /** 정체성 그림 위의 앵커(위치·화살표 각도·메모). 배경일 때만, 없으면 null. */
  identityMarks: BlueprintRouteMark[] | null;
  /** 전개도 틀 그림의 태그. 배경일 때만, 없으면 null. */
  templateMention: string | null;
  references: SheetReferenceTag[];
}

/**
 * 시트 프롬프트 작성 요청에 싣는 데이터 — **한 벌**.
 *
 * 예전에는 `runPrompt` 와 「LLM 요청문」 단추(`promptRequestData`)가 같은 것을 따로 조립했고,
 * 앵커를 한쪽에만 넣으면 창에 보이는 요청문과 실제로 보낸 것이 달라집니다. 한 함수로 둡니다.
 * 2026-09-22 부터는 「AI 일괄 생성」 4단계도 이 함수로 짓습니다.
 */
export function sheetRequestPayload(input: SheetRequestInput) {
  const { kind, blueprint, entity } = input;
  const space = kind === "background" ? spaceForChips(blueprint, entity.panoramaSpace, entity.exteriorSpace) : null;
  return {
    project: input.projectFacts,
    name: input.name,
    description: input.description,
    analysis: entity.analysis || null,
    spaceKind: input.spaceKind ?? null,
    referenceMode: entity.referenceMode ?? null,
    /*
      **기본 정보를 LLM 요청에도 싣습니다.**

      사용자 2026-09-18 점검에서 드러났습니다 — 「나이 19 · 키 162cm · 마른 편」 이 요청에
      한 글자도 안 갔습니다. 그런데 요청문은 「정체성을 정하는 값은 basics 에 적힌 것만
      쓴다」 고 안내하고 있었습니다. 그 값이 없었으니 열아홉이 서른으로 나와도 막을 길이
      없었습니다.
    */
    basics: input.basics ?? null,
    basicsEn: input.basicsEn ?? null,
    // id 만 보내면 LLM 이 칸을 짐작합니다. 영문 설명까지 실어야 좌우가 안 헷갈립니다.
    // 실내·실외에 따라 파노라마 문장이 다르므로 spaceKind 도 같이.
    // 배경의 «도면 + 동선» 칩은 그림 위 표시를 문장으로 옮겨 넣습니다(자리표가 남으면 그림에 글자로 그려짐).
    requiredAspects: detailBlueprint(
      kind,
      blueprint,
      input.spaceKind,
      input.identityMarks,
      space,
      kind === "background" ? input.templateMention : null,
    ),
    /*
      칸 수.

      예전에는 `entity.blueprint.length` 였습니다. 그러면 옛 프로젝트에 남은 지운 칩 id 까지
      세어 «7칸» 이 되고, 배경에서는 마스터 + 표시 + 빛이 전부 칸으로 세어졌습니다.
      배경은 세트 칩만 칸을 만들고(그 수는 칩 문장 안에 있음), 나머지는 한 장입니다.
    */
    panelCount:
      kind === "background"
        ? backgroundPanelCount(blueprint)
        : countKnownBlueprint(kind, blueprint),
    // `::when panorama=yes` 문단을 고르는 값. 문자열이어야 ::when 변수가 됩니다.
    // 등장방형·원통 둘 다 «구도를 베끼지 마라» 규칙이 같아서 한 값으로 묶습니다.
    panorama: hasPanoramaChip(blueprint) ? "yes" : "no",
    /*
      ::when 은 **문자열 완전일치**만 봅니다(`llmRequestText.ts`). 그래서 분기마다 값을 하나씩 싣습니다.
      frameKind  — panorama / single / set / none. «칸으로 나눌지» 가 여기서 갈립니다.
      anchorKind — equirect / cylindrical / direction / guide / none. 2차 칩의 종류.
      masterKind — map / view / none. 지도형 마스터라야 나침반·축척을 얹을 수 있습니다.
      viewpointNew — yes / no. «시점을 새로 잡는가».
    */
    ...(kind === "background"
      ? {
          frameKind: backgroundFrameKind(blueprint),
          anchorKind: backgroundAnchorKind(blueprint),
          masterKind: backgroundMasterKind(blueprint),
          aspect: backgroundAspect(blueprint),
          /*
            «구도잡기 렌더 다시 칠하기»(guide) 만 예외입니다.

            이 칩도 한 장이라 frameKind 는 "single" 인데, 변형 템플릿의
            `::when frameKind=single` 은 「구도를 베끼지 마세요 … same composition 을 쓰지
            마세요」 이고, 같은 요청의 `::when anchorKind=guide` 는 「카메라·구도를 한 치도
            바꾸지 않습니다 … keep the exact camera, framing 을 en 에 넣으세요」 입니다.
            두 문단이 나란히 나가서 정면으로 부딪혔습니다. 시점 문단은 이 값으로 가릅니다.
          */
          viewpointNew:
            backgroundFrameKind(blueprint) === "single" &&
            backgroundAnchorKind(blueprint) !== "guide"
              ? "yes"
              : "no",
        }
      : {}),
    // 정체성 그림 위의 앵커(위치·화살표 각도·메모). 파노라마 프롬프트의 «앵커 대장» 재료입니다.
    identityMarks: input.identityMarks,
    // 태그 ↔ 그림 대응표. 분석에는 실리고 있었는데 **프롬프트 작성에는
    // 안 실려서** 「@ref_1 의 헤어로」 라고 적어도 LLM 이 몇 번째 그림인지
    // 몰랐습니다. 변형 템플릿이 referenceNames 로 태그를 걸라고 하는데
    // 그 값이 없었던 것입니다. (지시 242·244·246)
    references: input.references,
    referenceNames: input.references.map((tag) => tag.name),
  };
}

/** 시트 프롬프트 이력의 조건 한 줄 — 카드의 `conditions()` 와 일괄 생성이 같은 글을 적습니다. */
export function sheetRunConditions(input: {
  kind: BlueprintKind;
  blueprint: string[];
  spaceKind?: SpaceKind;
  referenceCount: number;
  hasAnalysis: boolean;
  model?: string;
  extra?: string;
}): string {
  return describeRunConditions({
    extra: input.extra,
    aspects: summarizeBlueprint(input.kind, input.blueprint, input.spaceKind),
    referenceCount: input.referenceCount,
    hasAnalysis: input.hasAnalysis,
    model: input.model,
  });
}

/**
 * 네 칸을 채우고 이력에 쌓습니다 — **둘이 늘 같이 일어나야 합니다.** `patch((current) => …)` 안에서 씁니다.
 *
 * 덮어쓰기 전 네 칸도 남깁니다 — 손으로 다듬은 판은 이력에 없어서 새 답이 오면 사라졌습니다.
 * `appendPromptHistory` 가 맨 앞 항목과 같으면 안 넣으니 API 답을 그대로 둔 경우는 겹치지 않습니다.
 */
export function withPromptResult<T extends PromptWorkflowState>(
  current: T,
  result: { ko: string; en: string; negativeKo: string; negativeEn: string },
  label: string,
): Partial<T> {
  const hasCurrent = [current.promptKo, current.promptEn].some((value) => value?.trim());
  const kept = hasCurrent
    ? appendPromptHistory(current.promptHistory, {
        ko: current.promptKo || "",
        en: current.promptEn || "",
        negativeKo: current.negativeKo || "",
        negativeEn: current.negativeEn || "",
        note: "덮어쓰기 전",
        blueprint: current.blueprint,
      })
    : current.promptHistory;
  return {
    promptKo: result.ko,
    promptEn: result.en,
    negativeKo: result.negativeKo,
    negativeEn: result.negativeEn,
    promptLoading: false,
    promptHistory: appendPromptHistory(kept, {
      ...result,
      // 조건은 note 로 — «이 판의 이름» 칸은 사람 몫으로 비워 둡니다.
      note: label,
      // 프롬프트와 조건은 한 벌입니다. 되돌릴 때 고른 칸도 같이 돌아갑니다.
      blueprint: current.blueprint,
    }),
  } as Partial<T>;
}

/**
 * **전개도 칩이면 LLM 답을 틀·칸·카메라 문장 안에 끼워 완결 프롬프트로 만듭니다.**
 *
 * 전개도 칩일 때 LLM 답(en·ko)은 **장소 묘사**입니다(요청 템플릿 `::when anchorKind=unfold`) — 앱이 틀 문장에
 * 끼워야 프롬프트가 됩니다(까닭은 `composeUnfoldPrompt` 주석). 금지 칸에는 항공 시점 금지를 더합니다.
 * 전개도 칩이 아니면 답을 그대로 돌려줍니다.
 *
 * 카드(`usePromptCard.runPrompt`)와 「AI 일괄 생성」 4단계(`bootstrapPrompts.writeSheet`)가 **같이** 씁니다 —
 * 훅 안에만 있었을 때 일괄 생성이 이것을 건너뛰어, 같은 요청의 답이 카드에서는 완결 프롬프트로, 일괄 생성에서는
 * 틀 문장 없는 장소 묘사로 들어갔습니다(2026-09-22 검토). `references` 는 **요청에 실은 그 목록**이어야 합니다 —
 * 답 속의 @태그가 그 차례를 가리킵니다.
 */
export function withUnfoldFrame(
  result: { ko: string; en: string; negativeKo: string; negativeEn: string },
  input: {
    kind: BlueprintKind;
    blueprint: string[];
    entity: Pick<PromptWorkflowState, "panoramaSpace" | "exteriorSpace">;
    references: ReferenceImage[];
    platform: string;
  },
): { ko: string; en: string; negativeKo: string; negativeEn: string } {
  const { kind, blueprint, entity, references, platform } = input;
  const chip = kind === "background" ? unfoldChipOf(blueprint) : null;
  if (!chip) return result;
  /*
    LLM 이 템플릿을 어기고 «same location as the reference, preserve layout…», «panel 1: …», 칸·카메라 문장을
    장소 자리에 또 넣는 일이 있습니다(2026-09-15 실제). 그대로 끼우면 틀 문장과 싸우고 항공 구도를 끌어오므로 걷습니다.
  */
  const scrub = (text: string) =>
    text
      .replace(/same location as the reference,?\s*/gi, "")
      .replace(/preserve (the )?(layout|composition)( and architecture)?,?\s*/gi, "")
      .replace(/unchanged original[^,.]*[,.]?\s*/gi, "")
      .replace(/\bpanel \d+:\s*/gi, "")
      .replace(/(와|과) 같은 장소를 유지한[^.。]*[.。]\s*/g, "$1 같은 장소. ")
      .trim();
  const space = spaceForChips(blueprint, entity.panoramaSpace, entity.exteriorSpace);
  const mention = templateMentionOf(references, platform);
  /*
    전개도에는 **틀 말고 다른 그림의 태그를 남기지 않습니다** — «구성» 은 프롬프트에 태그로 불린 그림만 올립니다.
    2026-09-16 MCP 실측: 드론 사진인 정체성 그림을 함께 올리면 «항공 시점 금지» 를 몇 겹으로 적어도 네 장 중 두세 장이 항공
    시점이었고, 같은 문장에서 그 그림만 빼자 네 장 모두 눈높이·작은 달·50 m 공터 축척으로 나왔습니다. 장소의 내용은 LLM 이
    글로 옮겨 적은 것(식생·지형·색·달)으로 충분했습니다.
  */
  const others = sheetReferenceTags(references, platform)
    .map((tag) => tag.tag)
    .filter((tag) => tag && tag !== mention);
  const dropOthers = (text: string) =>
    others.reduce(
      (acc, tag) =>
        acc
          .split(`the same place as ${tag}`).join("this place")
          .split(`The same place as ${tag}`).join("This place")
          .split(`${tag}와 같은 장소`).join("이 장소")
          .split(`${tag}과 같은 장소`).join("이 장소")
          .split(`${tag} 와 같은 장소`).join("이 장소")
          .split(tag).join("the place"),
      text,
    );
  const placeOf = (text: string) => dropOthers(scrub(stripUnfoldFrame(text, chip, space, mention)));
  const framed = composeUnfoldPrompt(chip, space, mention, { en: placeOf(result.en), ko: placeOf(result.ko) });
  const join = (a: string, b: string) => [a, b].filter((text) => text.trim()).join(", ");
  return {
    ko: framed.ko,
    en: framed.en,
    negativeKo: join(result.negativeKo, unfoldNegativeOf(chip).ko),
    negativeEn: join(result.negativeEn, unfoldNegativeOf(chip).en),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 컷 — 인물마다 어느 그림을 올리는가
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 인물은 **캐릭터 시트**를 먼저 고릅니다(). 시트 한 장에 정면·측면·표정이 다 들어
 * 있어서, 낱장 한 컷보다 다른 각도로 세울 때 훨씬 잘 버팁니다. 시트가 아직
 * 없는 인물만 대표 그림으로 물러섭니다.
 */
export const pickSheetPath = (images: GeneratedImageAsset[] | undefined) =>
  (
    images?.find((item) => item.isCompositeSheet) ??
    images?.find((item) => item.isPrimary) ??
    images?.[0]
  )?.filePath;

export const pickPrimaryPath = (images: GeneratedImageAsset[] | undefined) =>
  (images?.find((item) => item.isPrimary) ?? images?.[0])?.filePath;

/**
 * 인물마다 **고른 레퍼런스**.
 *
 * 고른 것이 있으면 **고른 순서 그대로** 올리고, 안 골랐으면 지금까지처럼
 * 시트 한 장을 자동으로 고릅니다(옛 컷이 갑자기 레퍼런스를 잃지 않게).
 */
/**
 * 컷에서 **사람이 고른** 시트 — «안 골랐다» 와 «전부 뺐다» 를 가릅니다.
 *
 * 「풀리지도 않고」.
 * 여태는 마지막 그림을 빼면 칸을 지워 «안 골랐다» 와 같게 봤고, 그러면 자동 시트로 물러서서 태그가 그대로였습니다.
 * 이제 칸이 없으면(null) 자동 시트로 물러서고, 칸이 비어 있으면([]) 「이 컷에서는 그림을 안 쓴다 — 이름만」 입니다.
 * 고르기·«구성»·스토리보드·일괄 뽑기·「@ 다시 잇기」 가 전부 이 하나를 봅니다(규칙 1).
 */
export function pickedCharacterRefs(cut: Pick<Cut, "characterRefs">, characterId: string): string[] | null {
  const picked = cut.characterRefs?.[characterId];
  return picked === undefined ? null : picked.filter(Boolean);
}

export function cutCharacterRefs(cut: Cut, characterId: string, images: GeneratedImageAsset[] | undefined): string[] {
  const picked = pickedCharacterRefs(cut, characterId);
  if (picked) return picked;
  const sheet = pickSheetPath(images);
  return sheet ? [sheet] : [];
}

/**
 * 프롬프트 **요청**에 적는 인물의 시트 태그. 고른 것이 있으면 그것, 없으면 합성 시트 → 대표 한 장.
 *
 * `cutCharacterRefs` 와 달리 «아무 첫 장» 으로는 물러서지 않습니다 — 요청에는 «이 사람이 이렇게 생겼다» 고
 * 못 박을 만한 그림만 태그로 부릅니다. 옮기기 전(`CutCard.cutRequestData`)과 같은 규칙입니다.
 */
export function cutSheetPathsForRequest(cut: Cut, person: Character): string[] {
  const picked = pickedCharacterRefs(cut, person.id);
  if (picked) return picked;
  const auto = (person.generatedImages ?? []).find((item) => item.isCompositeSheet)
    ?? (person.generatedImages ?? []).find((item) => item.isPrimary);
  return auto?.filePath ? [auto.filePath] : [];
}

/** 구도에 선(또는 컷에 고른) 사람 하나 — 색·자리·고른 시트·별칭. «구성» 과 「@ 다시 잇기」 가 같은 것을 봅니다. */
export interface CutSwapPerson {
  characterId: string;
  hex: string;
  color: { ko: string; en: string };
  index: number;
  name: string;
  /** 구도를 끈 컷에는 자리가 없습니다 — 색 이름(«파란 사람»)은 구도 그림이 있어야 뜻이 있으니 구도 쪽에만 있습니다. */
  side: "왼쪽" | "가운데" | "오른쪽" | null;
  sheetPath?: string;
  sheetPaths: string[];
  aliases: string[];
}

/**
 * 이 컷의 «사람 목록» — 구도에 놓인 인물(마네킹 엑스트라 포함), 구도가 없으면 컷에 고른 인물.
 *
 * 그림 «구성»·영상 «구성»·「@ 다시 잇기」·「프롬프트 작성」·일괄 생성이 **이 한 벌**을 씁니다 —
 * 한쪽만 별칭을 모르면 영문 본문이 «구성» 에서는 칩이 서고 다시 잇기에서는 안 서는 식으로 어긋납니다.
 */
export function cutSwapPeople(cut: Cut, characters: Character[]): CutSwapPerson[] {
  const cutCharacters = characters.filter((item) => cut.characterIds.includes(item.id));
  const people = characterLegend(cut.composition, (id) => {
    const source = characters.find((item) => item.id === id);
    if (source) return { name: source.name, gender: source.gender };
    const mannequin = (cut.composition?.mannequins || []).find((item) => item.id === id);
    return mannequin ? { name: mannequin.name, gender: mannequin.gender } : undefined;
  });
  /*
    구도를 끈 컷에는 «구도에 놓인 인물» 이 없습니다. 그때는 컷에 고른 인물을 그대로 씁니다 —
    색 이름(«파란 사람»)은 구도 그림이 있어야 뜻이 있으니 구도 쪽에만 있습니다.
  */
  const base: Omit<CutSwapPerson, "sheetPath" | "sheetPaths" | "aliases">[] = people.length
    ? people
    : cutCharacters.map((item, index) => ({
        characterId: item.id,
        hex: "",
        color: { ko: "", en: "" },
        index,
        name: item.name || `인물 ${index + 1}`,
        side: null,
      }));
  return base.map((person) => {
    const source = characters.find((item) => item.id === person.characterId);
    const sheetPaths = source ? cutCharacterRefs(cut, source.id, source.generatedImages) : [];
    // 별칭(«부르는 이름»)은 여기서 한 번만 뽑습니다 — «구성» 의 `tagPeople` 과 「@ 다시 잇기」 가 같은 것을 씁니다.
    return { ...person, sheetPath: sheetPaths[0], sheetPaths, aliases: characterAliases(source) };
  });
}

/**
 * **@태그를 잇는 재료 한 벌** — 사람(고른 시트·생김새·별칭)·배경·구도.
 *
 * 여태 「@ 다시 잇기」 만 이 재료를 알았습니다. 그래서 「영상 프롬프트」 나 「프롬프트 작성」 으로
 * 프롬프트를 새로 만들면 @태그와 꼬리 줄이 **전부 풀렸습니다**(2026-09-21 실측) — 이어 둔 것을
 * 새 글이 덮어쓰고, 다시 잇기를 또 눌러야 했습니다. 이제 새로 만드는 자리들과 다시 잇기, 그리고
 * 일괄 생성 4단계가 **이 한 벌**을 같이 씁니다(규칙 1) — 따로 모으면 한 곳만 배경 생김새를
 * 빠뜨리는 식으로 반드시 어긋납니다.
 *
 * 캡처를 폴더에 내려놓는 일은 여기서 하지 않습니다(그건 화면의 `gatherCutRefs`). 경로만 받습니다 —
 * 그래서 일괄 생성처럼 화면 밖에서도 부를 수 있습니다.
 */
export function cutLinkInput(input: {
  cut: Cut;
  characters: Character[];
  background?: Background;
  summary: CompositionCameraSummary;
  useComposition: boolean;
  guidePath?: string;
  backgroundPath?: string;
}): PromptLinkInput {
  const { cut, characters, background, summary, useComposition } = input;
  return {
    people: cutSwapPeople(cut, characters).map((person) => {
      const source = characters.find((item) => item.id === person.characterId);
      return {
        name: person.name,
        paths: person.sheetPaths.filter(Boolean),
        // 그림이 없는 사람은 이 글이 자리를 지킵니다(`promptLinks` 의 «아직 그림 없음» 줄).
        look: source ? lookOf(source) : "",
        // 영문 본문의 로마자 이름 — «구성» 의 `tagPeople` 과 같은 목록입니다.
        aliases: person.aliases,
      };
    }),
    guidePath: input.guidePath,
    backgroundPath: input.backgroundPath,
    background: background
      ? { name: background.name, look: (background.description || "").trim() }
      : undefined,
    // 구도를 켜 두고 아직 캡처가 없을 때 — 글로라도 자리를 잡아 둡니다. 영문 칸에는 영문 요약을.
    guideNote: useComposition && summary.hasComposition ? summary.ko : "",
    guideNoteEn: useComposition && summary.hasComposition ? summary.en : "",
  };
}

/**
 * 화면 밖(일괄 생성)에서 잇기 재료에 넣을 **경로** — 캡처를 새로 만들지 않고 이미 저장된 것만 봅니다.
 *
 * 구도를 끈 컷은 구도 그림·배경 플레이트를 **아예 안 씁니다**(`gatherCutRefs` 와 같은 규칙).
 * 배경은 파노라마 원본이 아니라 **플레이트**가 먼저, 없으면 장소의 대표 그림.
 */
export function cutLinkPaths(cut: Cut, background: Background | undefined, useComposition: boolean) {
  const guidePath = useComposition ? cut.guideImagePath : undefined;
  const platePath = useComposition ? cut.plateImagePath : undefined;
  return { guidePath, backgroundPath: platePath ?? pickPrimaryPath(background?.generatedImages) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 컷 키 이미지 — 「프롬프트 작성」 이 보내는 재료
// ─────────────────────────────────────────────────────────────────────────────

export interface CutRequestInput {
  projectFacts: ProjectContextSummary["facts"] | null;
  sceneSummary: string;
  cut: Cut;
  /** 이 컷에 나오는 인물들(`cut.characterIds` 순이 아니라 프로젝트 목록 순). */
  cutCharacters: Character[];
  background?: Background;
  summary: CompositionCameraSummary;
  useComposition: boolean;
  /** 규칙이 만든 사실(`buildCutPrompt(...).facts`). 바꾸지 말라고 못을 박습니다. */
  facts: Record<string, unknown>;
}

/**
 * 컷 키 이미지 프롬프트를 받을 때 LLM 에 넘기는 **재료 한 벌**.
 *
 *
 *
 * 여태 여기로 간 것은 «씬 요약 · 컷 설명 · 연출 토글 · VFX» 뿐이었습니다. 구도는 그림만
 * 올라가고 **글로는 한 마디도 안 갔고**, 고른 시트도, 대사·연기 지시도 안 갔습니다.
 * 그래서 프롬프트가 「그 컷이 무엇인지」 를 반쯤만 알고 쓰였습니다.
 */
export function cutRequestPayload(input: CutRequestInput) {
  const { cut, cutCharacters, background, summary, useComposition } = input;
  const tags = cut.styleTags || [];
  return {
    project: input.projectFacts,
    /** 배경과 상황의 바탕 —  */
    scene: input.sceneSummary,
    cut: cut.description,
    style: tags.map(cutToggleLabel),
    /** 대사와 연기 지시. 키 이미지에서는 **표정과 몸짓**으로 옮겨야 합니다. */
    acting: cut.acting || null,
    vfx: cut.vfx || null,
    /*
      ── 저장한 구도 ──────────────────────────────────────────────────
      그림은 따로 올라가지만(`images`), **글로도** 보냅니다. 그림만 주면 모델이 샷 크기와
      렌즈를 눈대중으로 다시 정해, 컷마다 화각이 흔들립니다.
    */
    composition: useComposition && summary.hasComposition
      ? {
          요약: summary.ko,
          카메라: summary.facts,
          인물자리: summary.subjects,
          소품: objectLegend(cut.composition).map((item) => ({
            색: item.color.ko,
            이름: item.label,
          })),
        }
      : null,
    /*
      ── 인물마다 **고른 시트** ────────────────────────────────────────
      사용자 2026-09-16 에 컷마다 시트를 고를 수 있게 해 두었는데(`cut.characterRefs`), 그 선택이
      프롬프트 요청에는 안 갔습니다. 마그니픽은 올린 그림을 **파일 이름**으로 부르므로,
      이름(@태그)을 함께 줘야 「이 인물은 이 시트대로」 가 문장에 박힙니다.
    */
    people: cutCharacters.map((person) => ({
      이름: person.name,
      시트: cutSheetPathsForRequest(cut, person).map((path) => `@${fileStemOf(path)}`),
      /*
        ── 생김새 ────────────────────────────────────────────────────
        , 「그림은 아직 안뽑았으니까 없는거고」.

        여태 **이름과 시트 태그만** 보냈습니다. 그래서 그림이 아직 없는 인물은
        프롬프트에 「서진우가 운전대를 쥔다」 로만 남고, 생성기는 그게 누구인지
        알 길이 없어 **아무나 그립니다.** 이름은 우리끼리 쓰는 말이지 생성기에는
        아무 뜻이 없습니다.

        그래서 카드에 적어 둔 생김새를 함께 보냅니다. 시트가 있으면 태그가 이기고,
        없으면 이 글이 그 사람을 세웁니다. 묘사가 풍부해지는 효과도 같이 납니다 —
        여태 인물의 외형이 프롬프트에 **한 글자도** 안 들어가고 있었습니다.
      */
      생김새: lookOf(person) || null,
      성별: person.gender || null,
      키cm: person.heightCm ?? null,
      // 연기 기준 — 이 사람이 어떻게 반응하는가. 표정·몸짓을 쓸 때 재료가 됩니다.
      성격: (person.profile?.personality || "").trim() || null,
      // 구도를 쓴 컷이면 «파란 사람 = 누구» 로 이어 줍니다.
      색: summary.hasComposition
        ? characterLegend(cut.composition, (id) =>
            id === person.id ? { name: person.name, gender: person.gender } : undefined,
          ).find((entry) => entry.characterId === person.id)?.color.ko ?? null
        : null,
    })),
    /*
      ── 배경도 인물과 **같은 대우** ───────────────────────────────────
      

      여태 배경은 `scene` 요약 안에 녹아 있을 뿐, **장소 카드 자체는 한 글자도** 안
      갔습니다. 그래서 「중앙고속도로 터널 입구」 라는 이름만 프롬프트에 남고 그곳이
      어떤 곳인지는 생성기가 지어냈습니다 — 컷마다 다른 터널이 나오는 까닭입니다.

      인물과 같은 규칙으로 보냅니다: 판(시트)이 있으면 태그가 이기고, 없으면 글이 섭니다.
    */
    background: background
      ? {
          이름: background.name,
          시트: (() => {
            // 저장해 둔 배경 플레이트가 먼저, 없으면 장소 카드의 대표 그림.
            const images = background.generatedImages;
            const plate =
              cut.plateImagePath ??
              (images?.find((item) => item.isPrimary) ?? images?.[0])?.filePath;
            return plate ? [`@${fileStemOf(plate)}`] : [];
          })(),
          생김새: (background.description || "").trim() || null,
          장소: (background.location || "").trim() || null,
        }
      : null,
    // 이 값들은 사실입니다. 바꾸지 말라고 못을 박습니다.
    facts: input.facts,
    draftKo: cut.promptKo || "",
    draftEn: cut.promptEn || "",
  };
}

/**
 * 컷 프롬프트 이력에 적는 조건 한 줄.
 *
 *
 *
 * 「무엇이 체크되었나」 는 컷에서 **연출 토글·기법·구도를 쓰는지**입니다. 그 조건이
 * 적혀 있어야 「아까 판이 더 나았다」 를 되짚을 수 있습니다.
 */
export function cutPromptNote(input: {
  how: string;
  useComposition: boolean;
  hasComposition: boolean;
  tags: string[];
  techniques: string[];
  peopleCount: number;
}): string {
  return describeRunConditions({
    extra: input.how,
    aspects: [
      input.useComposition && input.hasComposition ? "구도 씀" : "구도 없음",
      ...input.tags.map(cutToggleLabel),
      ...input.techniques,
    ]
      .filter(Boolean)
      .join(", "),
    referenceCount: input.peopleCount,
  });
}

/**
 * 받은 컷 프롬프트를 **칸에 넣고 기록에도 남깁니다.** `patchCut((current) => …)` 안에서 씁니다.
 *
 * `ko`·`en` 은 이미 @태그를 이은 글입니다 — 기록에는 칸에 들어간 그대로(태그 이어진 글) 남겨야
 * 되돌릴 때 태그까지 같이 돌아옵니다.
 */
export function withCutPromptResult(
  current: Cut,
  made: { ko: string; en: string; negativeKo: string; negativeEn: string },
  linked: { ko: string; en: string },
  how: string,
  note: string,
): Partial<Cut> {
  return {
    promptKo: linked.ko,
    promptEn: linked.en,
    negativeKo: made.negativeKo,
    negativeEn: made.negativeEn,
    promptHistory: appendPromptHistory(current.promptHistory, {
      ...made,
      ko: linked.ko,
      en: linked.en,
      label: how,
      note,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 컷 영상 — 규칙 뼈대와, 그 위에 LLM 이 살을 붙일 재료
// ─────────────────────────────────────────────────────────────────────────────

/** 프로젝트 인물 id → 이름. 여기 없는 사람은 구도잡기에서 세운 엑스트라입니다. */
export function characterNamesOf(characters: Character[]): Record<string, string> {
  return Object.fromEntries(characters.map((item) => [item.id, item.name])) as Record<string, string>;
}

/**
 * 인물 이름 → **연기 기준** 한 줄. 캐릭터 특징에 적어 둔 것을 영상 프롬프트로 나릅니다.
 *
 * 2026-09-18 점검에서, 그 칸의 안내가 「영상 프롬프트에서 이 인물의 연기 기준이 됩니다」
 * 인데 실제로는 시트에 글자만 찍고 끝이라는 것이 드러났습니다. 연출 메모를 앞에 둡니다 —
 * 「클로즈업에서 시선을 먼저 준다」 처럼 **찍을 수 있는 말**이 거기 적히기 때문입니다.
 */
export function characterActingOf(characters: Character[]): Record<string, string> {
  const out: Record<string, string> = {};
  characters.forEach((item) => {
    const profile = item.profile;
    if (!profile || !item.name) return;
    const note = [profile.directing, profile.personality, profile.speech]
      .map((part) => (part || "").trim())
      .filter(Boolean)
      .join(" ");
    if (note) out[item.name] = note;
  });
  return out;
}

export interface CutVideoSkeletonInput {
  cut: Cut;
  /** 프로젝트 인물 전부 — 구도에 선 사람을 이름으로 부르는 데 씁니다. */
  characters: Character[];
  /** 이 컷에 나오는 인물들. */
  cutCharacters: Character[];
  background?: Background;
  context: ProjectContextSummary | null;
  useComposition: boolean;
  useRefVideo: boolean;
  /** 영상 화면비 — 없으면 그림 화면비(`videoAspect || projectAspect`). */
  aspect?: string;
  /** 이 작품의 영상 모델(마그니픽에서 고른 것). */
  videoModel?: string;
}

/**
 * 컷 카드의 「영상 프롬프트」 단추가 `buildCutVideoPrompt` 에 넘기는 **재료** — 일괄 생성도 같은 것을 넘깁니다.
 */
export function cutVideoSkeletonInput(input: CutVideoSkeletonInput): CutVideoPromptInput {
  const { cut, characters, cutCharacters, background, context } = input;
  const tags = cut.styleTags || [];
  /*
    영상에도 **알아서 켜 주는 실사 기본값**을 넣습니다. 영상은 컷 그림보다 더 자주
    플라스틱 얼굴이 나옵니다 — 프레임마다 다시 그리면서 고주파 질감이 깎이기 때문입니다.
  */
  const facts = buildCutPrompt({ cut, characters: cutCharacters, background, context }).facts;
  const videoAuto = autoRealism({
    styles: context?.facts.styles ?? [],
    hasPeople: cutCharacters.length > 0,
    closeUp: ((facts.subjects as { shot?: string }[] | undefined) ?? []).some((item) => isCloseUp(item.shot)),
    manual: tags,
  });
  return {
    title: cut.title,
    description: cut.description,
    // 구도를 끄면 카메라·자리도 글에서 뺍니다 — 안 올린 배치도를 설명해 봐야 생성기가 맞출 것이 없습니다.
    composition: input.useComposition ? cut.composition : undefined,
    characterNames: characterNamesOf(characters),
    characterActing: characterActingOf(characters),
    backgroundName: background?.name,
    // 배경이 스스로 하는 움직임. 효과보다 앞에 실립니다 — 까닭은 `cutVideoPrompt.ts`.
    backgroundMotion: cut.backgroundMotion,
    backgroundMotionEn: cut.backgroundMotionEn,
    /*
      「여기만 움직인다」 마스크를 그려 두었으면 **글에도 한 줄** 싣습니다.

      마스크는 뽑은 뒤에 섞는 판이라 모델은 그 존재를 모릅니다. 말해 주지 않으면 모델이
      배경까지 크게 흔들어 놓고, 그걸 첫 장면으로 되돌리면 잘린 자국이 남습니다.
      그림 선반에서 **자동으로** 찾습니다 — 한 번 더 고르게 하면 그려 놓고 안 실리는
      경우가 생깁니다(일괄 생성과 카드가 같은 이 길을 씁니다).
    */
    motionMaskName: findMotionMask(cut.images)?.name,
    vfx: cut.vfx,
    vfxEn: cut.vfxEn,
    acting: cut.acting,
    actingEn: cut.actingEn,
    hasRefVideo: input.useRefVideo,
    plannedSeconds: cut.plannedSeconds,
    // 화면비와 «바꾸지 마세요» 에 박을 이름 — 둘 다 없으면 생성기가 제멋대로 정합니다.
    aspect: input.aspect,
    /*
      켠 연출 토글과 자동 실사 기본값을 영상에도 싣습니다. 같은 구절은 여기서 한 번만 — 일괄 생성이 `styleTags` 에 자동
      질감 칩을 이미 합쳐 넣어 두 줄이 같은 구절을 들고 옵니다(`dedupePhrases` 주석). 뼈대(`buildCutVideoPrompt`)만이
      아니라 LLM 요청의 `lookEn` 도 이 값을 그대로 싣기 때문에 **재료를 짓는 자리**에서 걷어 냅니다(2026-09-22 검토).
    */
    lookEn: dedupePhrases([cutTogglesEnglish(tags), videoAuto.en].filter(Boolean).join(", ")),
    modelId: cutVideoModelId(input.videoModel),
    lockNames: cutCharacters.map((item) => item.name).filter(Boolean),
  };
}

/**
 * 고른 모델 → 규칙 id. `targetModelOf` 가 먼저인 까닭: 이제 우리 id(`seedance-2.5`)를
 * 저장하는데, MCP 로 고른 옛 값은 마그니픽 슬러그(`seedance-2-5-pro`)입니다.
 * 둘 다 받아야 예전 작품이 안 깨집니다.
 */
export function cutVideoModelId(videoModel?: string): string | undefined {
  return videoRuleIdOf(videoModel);
}

/**
 * **컷 영상 프롬프트를 LLM 에 부탁할 때** 싣는 재료 — 규칙이 지은 뼈대(`draftKo`/`draftEn`) 위에
 * 상황·환경·동작·표정을 채우게 합니다(요청 문구 `cut-video-prompt.md`).
 *
 * 여태 영상 프롬프트는 **규칙 조립뿐**이라(`buildCutVideoPrompt`) 무슨 일이 어떻게
 * 일어나는지를 한 문장으로만 적었습니다 — 규칙은 상황을 지어낼 수 없습니다.
 *
 * 뼈대의 @태그·화면 자리·대사 문법·형식·잠금 줄은 **고정**입니다(문구가 그렇게 말합니다). LLM 은 그 사이를
 * 채웁니다.
 */
export function cutVideoRequestPayload(input: {
  skeleton: CutVideoPrompt;
  skeletonInput: CutVideoPromptInput;
  projectFacts: ProjectContextSummary["facts"] | null;
  sceneSummary: string;
  cut: Cut;
  cutCharacters: Character[];
  background?: Background;
  summary: CompositionCameraSummary;
  useComposition: boolean;
}) {
  const { cut, cutCharacters, background, summary, useComposition, skeleton, skeletonInput } = input;
  const tags = cut.styleTags || [];
  const composition = useComposition ? cut.composition : undefined;
  const moves = composition ? describeCameraMoves(cameraMovesOf(composition)) : null;
  const acting = skeletonInput.characterActing ?? {};
  return {
    project: input.projectFacts,
    scene: input.sceneSummary,
    cut: { 제목: cut.title, 설명: cut.description },
    acting: cut.acting || null,
    actingEn: cut.actingEn || null,
    vfx: cut.vfx || null,
    vfxEn: cut.vfxEn || null,
    seconds: skeleton.seconds,
    aspect: skeletonInput.aspect ?? null,
    modelId: skeletonInput.modelId ?? null,
    hasRefVideo: skeletonInput.hasRefVideo ? "yes" : "no",
    style: tags.map(cutToggleLabel),
    lookEn: skeletonInput.lookEn || null,
    composition: composition && summary.hasComposition
      ? {
          요약: summary.ko,
          카메라: summary.facts,
          인물자리: summary.subjects,
          무빙: moves ? { ko: moves.ko, en: moves.en } : null,
          타임라인초: composition.timeline?.duration ?? null,
          음악: composition.timeline?.music?.name ?? null,
          소품: objectLegend(composition).map((item) => ({ 색: item.color.ko, 이름: item.label })),
        }
      : null,
    people: cutCharacters.map((person) => ({
      이름: person.name,
      별칭: characterAliases(person),
      시트: cutSheetPathsForRequest(cut, person).map((path) => `@${fileStemOf(path)}`),
      생김새: lookOf(person) || null,
      성별: person.gender || null,
      키cm: person.heightCm ?? null,
      성격: (person.profile?.personality || "").trim() || null,
      연기기준: acting[person.name] || null,
    })),
    background: background
      ? {
          이름: background.name,
          생김새: (background.description || "").trim() || null,
          장소: (background.location || "").trim() || null,
        }
      : null,
    draftKo: skeleton.ko,
    draftEn: skeleton.en,
  };
}

/** 이 컷의 러닝타임 — 카드와 일괄 생성이 같은 계산(`cutVideoSeconds`). */
export const cutSecondsOf = (cut: Cut) => cutVideoSeconds(cut.composition, cut.plannedSeconds);
