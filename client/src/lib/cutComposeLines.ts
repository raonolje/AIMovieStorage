import { objectKindEn, objectKindKo } from "@/lib/compositionLegend";
import type { CompositionObjectKind } from "@/lib/composition";

/**
 * **마그니픽 «구성» 에 함께 보내는 안내문.**
 *
 * 컷 카드가 그림 재료를 모은 뒤, 「이 그림들을 어떻게 쓰라」 를 글로 적어 주는 부분입니다.
 * 2026-09-18 에 `CutCard.tsx` 에서 떼어 냈습니다 — 화면 요소를 하나도 안 쓰는 순수
 * 문자열 조립인데, 한·영 삼항이 열한 번 되풀이되어 카드 본문을 가장 크게 불리고 있었습니다.
 *
 * # 안내문은 «누른 칸의 말» 로 씁니다
 *
 *
 * 실은 한글 프롬프트도 같이 들어가 있었지만, 위에 붙은 영어 안내문이 길어서 통째로
 * 영문으로 보였습니다. 한글 칸에서 눌렀으면 안내문도 한글이라야 읽는 사람이 무엇을
 * 보냈는지 압니다.
 */

export interface ComposeLinesInput {
  /** 「ko」 면 한국어 안내문. 누른 칸의 말입니다. */
  lang: "ko" | "en";
  /** 구도 배치도의 `@태그`. 구도를 안 쓰는 컷이면 없습니다. */
  guideTag?: string;
  /** 같은 카메라로 렌더한 배경 플레이트 경로. */
  platePath?: string;
  /** 배경 시트 경로. 플레이트가 있으면 그쪽이 이깁니다. */
  backgroundPath?: string;
  /** 경로 → `@태그`. 마그니픽은 **파일 이름**으로 그림을 부릅니다. */
  tagOf: (path: string) => string;
  /** 이 컷의 인물들과 각자의 시트. */
  swaps: { name: string; sheetPath?: string; sheetPaths: string[] }[];
  /**
   * 배치도의 색 덩어리 ↔ 진짜 물건.
   *
   * `tag` 는 구도잡기에서 그 소품에 **이어 둔 에셋 시트**의 `@태그`입니다(`swapRef`). 사용자 2026-09-21:
   * 「구성 눌러서 올릴 때 캐릭터 레퍼런스 이미지들, **소품 레퍼런스 이미지들**… 정확하게 @로 스왑되는지」.
   * 여태 소품은 이름만 적고 시트는 올리지도 부르지도 않아서, 「빨간 상자는 가방입니다」 까지만 가고
   * **어떤 가방인지**는 생성기가 지어냈습니다.
   */
  props: { color: { ko: string; en: string }; kind: CompositionObjectKind; label: string; tag?: string }[];
}

export function cutComposeLines(input: ComposeLinesInput): string[] {
  const { guideTag, platePath, backgroundPath, tagOf, swaps, props } = input;
  const ko = input.lang === "ko";
  const lines: string[] = [];

  // 구도를 안 쓰는 컷에는 «@배치도대로» 문장이 통째로 빠집니다 — 없는 그림을 가리키면 생성기가 제멋대로 지어냅니다.
  if (guideTag)
    lines.push(
      ko
        ? `${guideTag} 는 이 컷의 3D 배치도입니다 — 카메라 각도와 화각, 각 인물이 선 자리와 화면에서의 크기, 뒤에 무엇이 있는지. 이 프레이밍·배치·크기를 그대로 맞추세요. 안에 있는 것은 전부 자리 표시라, 회색 마네킹·민무늬 덩어리·평평한 음영은 절대 그리지 마세요.`
        : `${guideTag} is a rough 3D block-out of this shot: camera angle, lens, where each figure stands, how large it is in frame and what is behind it. Match that framing, placement and scale exactly. Everything in it is a placeholder — never draw its grey mannequins, plain blocks or flat shading.`,
    );

  if (platePath)
    lines.push(
      ko
        ? `${tagOf(platePath)} 은 같은 카메라로 이미 렌더한 이 컷의 배경입니다. 배치·지평선·빛·색을 그대로 두세요. 다시 프레이밍하지 말고 장소를 새로 지어내지도 마세요 — 사진처럼 만들기만 하면 됩니다.`
        : `${tagOf(platePath)} is the background of this exact shot, already rendered from this camera. Keep its layout, horizon, light and colour. Do not re-frame it and do not re-invent the place; only make it photographic.`,
    );
  else if (backgroundPath)
    lines.push(
      ko
        ? `${tagOf(backgroundPath)} 은 이 장소의 정체성입니다. 지형·나무·땅·빛·색을 그대로 두세요.`
        : `${tagOf(backgroundPath)} is the identity of this place. Keep its structures, ground, light and colour.`,
    );

  /*
    인물은 **본문 안에서** 시트에 잇습니다 — 「여울은 화면 중앙에」 가 「@여울_시트_001은
    화면 중앙에」 로. 예전에는 「분홍 인물(화면 왼쪽)은 여울입니다 — 시트는 @…」 를
    줄마다 덧붙였는데,  본문의
    문장이 곧 «이 사람을 여기 이렇게» 라, 거기 칩이 서 있으면 됩니다.
  */
  if (swaps.some((person) => person.sheetPath)) {
    lines.push(
      ko
        ? guideTag
          ? `본문에서 @태그로 부르는 인물은 그 시트만 보고 그리세요 — 얼굴·머리·체형·의상은 시트 그대로, 자리·자세·방향·크기는 ${guideTag} 대로.`
          : "본문에서 @태그로 부르는 인물은 그 시트만 보고 그리세요 — 얼굴·머리·체형·의상은 시트 그대로입니다. 자리·자세는 아래 글대로 잡으세요."
        : guideTag
          ? `Every person tagged @ in the text below must be drawn from that sheet alone — face, hair, body and clothing exactly as the sheet; position, pose, orientation and size exactly as ${guideTag}.`
          : "Every person tagged @ in the text below must be drawn from that sheet alone - face, hair, body and clothing exactly as the sheet. Take position and pose from the text below.",
    );
    /*
      인물마다 시트를 **여러 장** 올릴 수 있습니다(전신 + 클로즈업). 그때는 «같은 사람의 다른 그림» 이라고 못 박아야
      생성기가 둘을 다른 인물로 읽고 둘 다 화면에 세우지 않습니다.
    */
    const multi = swaps.filter((person) => person.sheetPaths.length > 1);
    for (const person of multi)
      lines.push(
        ko
          ? `${person.sheetPaths.map(tagOf).join(" · ")} 는 모두 같은 사람(${person.name})의 다른 그림입니다 — 한 명으로 그리세요.`
          : `${person.sheetPaths.map(tagOf).join(" and ")} are different pictures of the same person (${person.name}) - draw one person, not several.`,
      );
  }

  if (props.length) {
    lines.push(
      ko
        ? `소품 — ${guideTag} 의 색 덩어리는 자리 표시입니다. 같은 자리·크기·방향에 진짜 물건으로 바꾸세요.`
        : `Objects — the coloured blocks in ${guideTag} are stand-ins. Replace each with the real thing at the same place, size and orientation:`,
    );
    props.forEach((prop) => {
      // 시트가 이어져 있으면 **그 시트대로** — 이름만 주면 «어떤 가방인지» 는 생성기가 지어냅니다.
      lines.push(
        ko
          ? prop.tag
            ? `- ${prop.color.ko} ${objectKindKo(prop.kind)}는 ${prop.label} 입니다 — ${prop.tag} 시트의 그 물건 그대로(모양·재질·색).`
            : `- ${prop.color.ko} ${objectKindKo(prop.kind)}는 ${prop.label} 입니다.`
          : prop.tag
            ? `- the ${prop.color.en} ${objectKindEn(prop.kind)} is ${prop.label} — exactly the object in ${prop.tag} (shape, material, colour).`
            : `- the ${prop.color.en} ${objectKindEn(prop.kind)} is ${prop.label}.`,
      );
    });
  }

  /*
    마지막 줄이 **시트를 그려 버리는 사고**를 막습니다.

    사용자 2026-09-10 실측: 캐릭터 시트를 레퍼런스로 올렸더니 생성기가 시트를 «그려야 할
    그림» 으로 알아듣고, 결과에 여러 칸짜리 시트를 그대로 붙여 놓았습니다. 시트는
    «이 사람이 이렇게 생겼다» 를 보여 주는 자료지 화면에 나올 물건이 아니라는 말을
    한 번 더 못 박아야 합니다.
  */
  lines.push(
    ko
      ? "이 순간을 **사진 한 장**으로 완성해 주세요. 시트·격자·여러 칸·콜라주는 안 됩니다 — 캐릭터 시트는 생김새를 보는 자료일 뿐이라, 시트의 칸·흰 바탕·나란히 선 포즈가 결과에 나오면 안 됩니다. 회색이거나 평평하거나 색으로 표시된 것도 하나도 남으면 안 됩니다."
      : "Output exactly one finished photographic frame of this moment. Never a sheet, grid, contact sheet, collage or multi-panel image — the character sheets are reference only, so their panels, their plain backdrop and their side-by-side poses must not appear in the result. Nothing grey, flat-shaded or colour-coded may survive either.",
  );

  return lines;
}
