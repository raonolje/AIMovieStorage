import { fileStemOf } from "@/components/ReferenceTagBar";
import { objectLegend, tagCharacterNames } from "./compositionLegend";
import {
  cutCharacterRefs,
  cutSwapPeople,
  pickPrimaryPath,
  pickSheetPath,
  cutLinkInput,
} from "./promptPayloads";
import { cutVideoLinkInput, magnificCutAudioReference } from "./cutVideoReferences";
import { heroImageOf, formatVideoSeconds } from "./cutVideoPrompt";
import { relinkPromptText, splitLinkTail } from "./promptLinks";
import { cutComposeLines } from "./cutComposeLines";
import type { Background, Character, Cut } from "./projectTypes";
import type { VisualAsset } from "./visualAsset";
import type { CompositionCameraSummary } from "./composition";

/** UI가 캡처를 저장한 뒤와 외부 조종이 이미 저장된 컷을 읽을 때 같은 참조를 모읍니다. */
export function gatherStoredCutMagnificRefs(input: {
  cut: Cut;
  characters: Character[];
  backgrounds: Background[];
  background?: Background;
  sharedAssets?: VisualAsset[];
  guidePath?: string;
  platePath?: string;
}) {
  const {
    cut,
    characters,
    backgrounds,
    background,
    sharedAssets,
    guidePath,
    platePath,
  } = input;
  const backgroundPath =
    platePath ?? pickPrimaryPath(background?.generatedImages);

  /*
      ── 마그니픽 @태그로 프롬프트를 씁니다 ────────────────────────────

      마그니픽은 올린 그림을 **파일 이름**으로 부릅니다 — 프롬프트에 `@파일이름` 이라고
      적어야 칩으로 이어지고, 그래야 「이 그림을 이렇게 써라」 가 전달됩니다. 「첫 번째
      그림은…」 처럼 순서로 적으면 아무 그림도 안 걸립니다().

      그리고 구도 캡처에는 이제 **이름표가 없습니다**(생성기가 글자를 그려 버려서).
      누가 누구인지는 마네킹의 **식별 색**으로 말합니다 — 「파란 사람 = @냥이_시트_001」.
      이게 곧 «캐릭터 스왑» 이 되는 자리입니다.
    */
  const tagOf = (path: string) => `@${fileStemOf(path)}`;
  const guideTag = guidePath ? tagOf(guidePath) : "";
  /*
      ── 인물마다 **고른 레퍼런스** ─────────────────────────────────────
      구도에 놓인 인물(마네킹 엑스트라 포함), 구도가 없으면 컷에 고른 인물 — 고른 시트·별칭까지 한 벌로
      `cutSwapPeople` 이 짓습니다. 그림 «구성»·영상 «구성»·「@ 다시 잇기」·일괄 생성이 같은 목록을 봅니다.
    */
  const swaps = cutSwapPeople(cut, characters);
  /*
      본문의 이름을 태그로 올릴 때 넘기는 «사람» 목록. 그림 «구성»·영상 «구성» 이 같은 것을 쓰고,
      「@ 다시 잇기」 는 `gatherLinkInput` 을 거쳐 같은 이름·태그·별칭을 받습니다 — 한쪽만
      별칭을 모르면 영문 본문이 «구성» 에서는 칩이 서고 다시 잇기에서는 안 서는 식으로 어긋납니다.
    */
  const tagPeople = swaps.map((person) => ({
    name: person.name,
    tag: person.sheetPath ? tagOf(person.sheetPath) : undefined,
    aliases: person.aliases,
  }));
  /*
      ── 소품도 **시트로** 올립니다 ────────────────────────────────────


      구도잡기에서 소품에 에셋 카드를 이어 두면(`swapRef`) 그 시트가 «이 물건이 이렇게
      생겼다» 인데, 여태 올리는 것은 구도·배경·인물 시트뿐이었습니다. 소품은 「빨간 상자는
      가방입니다」 까지만 가고 **어떤 가방인지**는 생성기가 지어냈습니다 — 이어 둔 시트가
      있는데도요. 인물과 같은 규칙으로 시트를 올리고 `@태그` 로 부릅니다.

      에셋 카드는 세 곳에 삽니다 — 작품 공용(`sharedAssets`)·인물 소유·장소 소유.
      `swapRef.kind` 가 인물·장소면 그 시트를 씁니다(소품 자리에 사람을 세우는 경우).
    */
  const assetPool = [
    ...(sharedAssets || []),
    ...characters.flatMap((item) => item.assets || []),
    ...backgrounds.flatMap((item) => item.assets || []),
  ];
  const sheetOfSwap = (
    ref: { kind: string; id: string } | undefined,
  ): string | undefined => {
    if (!ref) return undefined;
    if (ref.kind === "asset")
      return pickSheetPath(
        assetPool.find((item) => item.id === ref.id)?.generatedImages,
      );
    if (ref.kind === "character") {
      const person = characters.find((item) => item.id === ref.id);
      return person
        ? cutCharacterRefs(cut, person.id, person.generatedImages)[0]
        : undefined;
    }
    if (ref.kind === "background")
      return pickPrimaryPath(
        backgrounds.find((item) => item.id === ref.id)?.generatedImages,
      );
    return undefined;
  };
  const props = objectLegend(cut.composition).map((prop) => {
    const sheetPath = sheetOfSwap(
      (cut.composition?.objects || []).find((item) => item.id === prop.id)
        ?.swapRef,
    );
    return {
      ...prop,
      sheetPath,
      tag: sheetPath ? tagOf(sheetPath) : undefined,
    };
  });
  const propPaths = props
    .map((prop) => prop.sheetPath)
    .filter((path): path is string => Boolean(path));
  const characterPaths = swaps.flatMap((item) => item.sheetPaths);
  // 같은 시트가 두 소품에 이어져 있어도 한 번만 올립니다 — 마그니픽은 같은 파일을 두 번 받으면 « #2» 를 붙여 태그가 어긋납니다.
  const references = [
    ...new Set([guidePath, backgroundPath, ...characterPaths, ...propPaths]),
  ].filter((path): path is string => Boolean(path));
  return {
    guidePath,
    guideTag,
    platePath,
    backgroundPath,
    tagOf,
    swaps,
    tagPeople,
    props,
    propPaths,
    characterPaths,
    references,
  };
}
export type CutMagnificRefs = ReturnType<typeof gatherStoredCutMagnificRefs>;

/** 영상 참조·대표 그림·소품 문구를 화면과 조종기에서 따로 만들지 않습니다. */
export function buildCutVideoMagnificPrompt(input: {
  cut: Cut;
  characters: Character[];
  background?: Background;
  summary: CompositionCameraSummary;
  useComposition: boolean;
  useRefVideo: boolean;
  musicEnabled?: boolean;
  videoSeconds: number;
  prompt: string;
  lang: "ko" | "en";
  refs: CutMagnificRefs;
}): string {
  const {
    cut,
    characters,
    background,
    summary,
    useComposition,
    useRefVideo,
    musicEnabled,
    videoSeconds,
    prompt,
    lang,
  } = input;
  const { guidePath, backgroundPath, guideTag, swaps, props, tagOf } =
    input.refs;
  const ko = lang === "ko";
  const lines: string[] = [];
  if (useRefVideo && cut.refVideoPath)
    lines.push(
      ko
        ? `${tagOf(cut.refVideoPath)} 는 이 컷의 카메라 움직임과 타이밍을 그대로 담은 레퍼런스 영상입니다(${formatVideoSeconds(videoSeconds)}초). 그 움직임·길이·프레이밍을 그대로 따르세요.`
        : `${tagOf(cut.refVideoPath)} is the reference video holding this shot's exact camera motion and timing (${formatVideoSeconds(videoSeconds)}s). Follow its movement, length and framing exactly.`,
    );
  else if (guideTag)
    lines.push(
      ko
        ? `${guideTag} 는 이 컷의 3D 배치도입니다. 카메라 각도·화각·인물이 선 자리를 그대로 맞추세요.`
        : `${guideTag} is a 3D block-out of this shot. Match its camera angle, lens and figure placement exactly.`,
    );
  const audioPath = magnificCutAudioReference(cut, useRefVideo, Boolean(musicEnabled));
  if (audioPath)
    lines.push(
      ko
        ? `${tagOf(audioPath)} 는 ${tagOf(cut.refVideoPath!)} 와 같은 구간의 음원 레퍼런스입니다. 음악의 박자에 동작을 맞추고 영상의 카메라·동선을 따르세요.`
        : `${tagOf(audioPath)} is the audio reference for the same time range as ${tagOf(cut.refVideoPath!)}. Match the choreography to its rhythm and follow the video's camera motion and blocking.`,
    );
  const heroPath = heroImageOf(cut)?.filePath;
  if (heroPath)
    lines.push(
      ko
        ? `${tagOf(heroPath)} 는 이 컷의 대표 그림입니다. 여기에 보이는 인물 구성·외형·의상을 기준으로 유지하세요.${useRefVideo && cut.refVideoPath ? " 움직임과 카메라 타이밍은 레퍼런스 영상을 따르세요." : ""}`
        : `${tagOf(heroPath)} is this shot's representative image. Preserve its cast, appearance and clothing.${useRefVideo && cut.refVideoPath ? " Use the reference video for motion and camera timing." : ""}`,
    );
  if (swaps.some((person) => person.sheetPath))
    lines.push(
      ko
        ? "본문에서 @태그로 부르는 인물은 그 시트만 보고 그리세요 — 얼굴·머리·체형·의상은 시트 그대로입니다. 회색 마네킹·민무늬 덩어리는 결과에 하나도 남으면 안 됩니다."
        : "Every person tagged @ below must be drawn from that sheet alone - face, hair, body and clothing exactly as the sheet. No grey mannequin or plain block may survive in the result.",
    );
  // 소품 시트도 영상에 같이 올라갑니다(`gatherCutRefs`) — 그림 «구성» 과 같은 규칙, 같은 줄.
  for (const prop of props.filter((item) => item.tag))
    lines.push(
      ko
        ? `${prop.tag} 은 이 컷의 소품 «${prop.label}» 입니다(배치도의 ${prop.color.ko} 덩어리 자리). 모양·재질·색을 그 시트 그대로 그리세요.`
        : `${prop.tag} is the prop "${prop.label}" of this shot (the ${prop.color.en} block in the layout). Draw it exactly as that sheet - shape, material, colour.`,
    );
  // 새 대표 그림이 생기면 옛 «아직 없음» 꼬리도 갱신합니다. 사용자 본문은 유지합니다.
  const body = relinkPromptText(
    prompt.trim(),
    cutVideoLinkInput(
      cut,
      cutLinkInput({
        cut,
        characters,
        background,
        summary,
        useComposition,
        guidePath,
        backgroundPath,
      }),
    ),
    lang,
  );
  return [lines.join("\n"), body].filter(Boolean).join("\n\n");
}

/** 이미지 구성의 기존 본문·꼬리 분리 규칙도 같은 입력에서 재사용합니다. */
export function buildCutImageMagnificPrompt(
  prompt: string,
  lang: "ko" | "en",
  refs: CutMagnificRefs,
): string {
  const lines = cutComposeLines({ lang, ...refs });
  const split = splitLinkTail(prompt.trim());
  const body = [tagCharacterNames(split.body, refs.tagPeople), split.tail]
    .filter(Boolean)
    .join("\n\n");
  return `${lines.join("\n")}\n\n${body}`;
}
