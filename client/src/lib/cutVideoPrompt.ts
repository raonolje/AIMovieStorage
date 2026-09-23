import { describeMotionMask, isMotionMaskName } from "@/lib/motionMask";
import { describeCameraMoves, cameraMovesEnd } from "@/lib/cameraMoves";
import { cameraMovesOf, timelineOf } from "@/lib/compositionEdit";
import { describeObjectSwaps, describePeople } from "@/lib/objectSwapPrompt";
import { describeHorizonRoom, horizonOverridesLocation, type CompositionState } from "@/lib/composition";
import { modelRuleOf, negativeStyleOf, speaksDialogue } from "@/lib/modelRules";
import { shapeDialogue } from "@/lib/dialogueShape";
import { plainify } from "@/lib/naturalPrompt";
import type { Cut, GeneratedImageAsset } from "@/lib/projectTypes";

/**
 * 컷 하나를 **영상으로** 뽑는 프롬프트.
 *
 * # 그림 프롬프트와 무엇이 다른가
 *
 * 그림은 **한순간**을 적습니다 — 「누가 어디에 어떤 표정으로 서 있다」. 영상은 **무엇이
 * 어떻게 변하는가**를 적어야 합니다 — 「0~2초 다가가고, 2초에 고개를 든다」. 같은 칸에
 * 섞으면 그림을 뽑을 때 동작 설명이 끼어들어 자세가 흐려집니다. 그래서 칸을 나눕니다.
 *
 * # 레퍼런스 영상이 있으면 말을 줄입니다
 *
 * 구도잡기에서 뽑은 mp4 를 레퍼런스로 올리면 **카메라 무빙은 그림으로 이미 전달됩니다**.
 * 그때 글로 또 「천천히 달리 인」 이라고 적으면 두 지시가 겹쳐 오히려 어긋납니다. 글은
 * «그 움직임을 따르되 사람과 재질은 이렇게» 쪽으로 비켜섭니다.
 */
export interface CutVideoPromptInput {
  /** 대사·연기 지시(`Cut.acting`). 있으면 효과보다 앞에 실립니다. */
  acting?: string;
  /**
   * 같은 연기 지시의 **영어**(`Cut.actingEn`) — 「프롬프트 말로」 로 받아 둔 것.
   *
   * 있으면 영문 칸에 **이것을** 씁니다. 없으면 한국어를 그대로 실어 보내는데, 그러면
   * 생성기가 그 부분을 통째로 무시하거나 글자로 그려 넣습니다.
   */
  actingEn?: string;
  /** 컷 제목·설명 — 무슨 일이 일어나는가. */
  title?: string;
  description?: string;
  /** 구도잡기 상태. 카메라 무빙과 길이를 여기서 읽습니다. */
  composition?: CompositionState;
  /** 프로젝트 인물 id → 이름. 여기 없는 사람은 엑스트라입니다. */
  characterNames?: Record<string, string>;
  /** 인물 이름 → 연기 기준 한 줄(캐릭터 특징에 적어 둔 연출 메모·성격·말투). */
  characterActing?: Record<string, string>;
  /** 배경 이름. 레퍼런스로 배경 시트를 함께 올릴 때 이름을 짚어 줍니다. */
  backgroundName?: string;
  /**
   * **배경이 원래 하고 있는 움직임**(`Cut.backgroundMotion`) — 구름·지나가는 차·물결·빗줄기.
   *
   * 효과(`vfx`)와 다른 칸인 까닭은 `projectTypes.Cut` 에 적어 두었습니다. 싣는 자리는
   * **효과보다 앞** 입니다 — 환경이 먼저 살아 있고 효과는 그 위에 얹히는 것입니다.
   */
  backgroundMotion?: string;
  /** 같은 배경 움직임 서술의 **영어**(`Cut.backgroundMotionEn`). `actingEn` 과 같은 까닭입니다. */
  backgroundMotionEn?: string;
  /**
   * 함께 올리는 **움직임 마스크**의 파일 이름(«원본_움직임_001»).
   *
   * 영어 칸이 따로 없는 까닭 — 문장을 `describeMotionMask` 가 두 말로 지어 줍니다.
   * 마스크는 «흰 구역만 움직이고 나머지는 첫 프레임 그대로» 라는 뜻이라, 사람이 적는 글이
   * 아니라 **파일이 있다는 사실**이 곧 내용입니다.
   */
  motionMaskName?: string;
  /** VFX 서술 — 비·불꽃·연기처럼 그림만으로는 안 되는 것. */
  vfx?: string;
  /** 같은 효과 서술의 **영어**(`Cut.vfxEn`). `actingEn` 과 같은 까닭입니다. */
  vfxEn?: string;
  /** 구도잡기 레퍼런스 영상을 함께 올리는가. 올리면 카메라 설명을 줄입니다. */
  hasRefVideo?: boolean;
  /** 실제로 선택한 레퍼런스 파일의 길이. 타임라인을 나중에 고쳐도 이미 뽑은 영상은 바뀌지 않습니다. */
  refVideoSeconds?: number;
  /** 실제 파일이 있는 컷 대표 그림. 개별 시트가 없는 인물에게 가짜 시트를 요구하지 않습니다. */
  hasRepresentativeImage?: boolean;
  /** 기획 단계에서 적어 둔 컷 길이(초). 구도잡기가 없을 때만 씁니다. */
  plannedSeconds?: number;
  /** 프로젝트 화면비(`"16:9"`·`"9:16"` …). 안 적으면 생성기가 제 기본값으로 갑니다. */
  aspect?: string;
  /** 이 컷에 나오는 인물 이름들 — 맨 뒤 «바꾸지 마세요» 문장에 이름으로 박습니다. */
  lockNames?: string[];
  /**
   * 연출·질감 토글의 **영어 한 줄**(`cutTogglesEnglish` + `autoRealism`).
   *
   * 사용자 2026-09-18 점검에서 드러났습니다 — 켠 토글이 **영상 프롬프트에는 아예 안
   * 실리고 있었습니다.** 키 이미지에만 붙고 영상은 그냥 지나갔습니다.
   */
  lookEn?: string;
  /**
   * 어느 모델로 보낼 것인가(`modelRules.ts` 의 id).
   *
   * 안 주면 **어느 모델에나 통하는 모양**으로
   * 짓습니다 — 여태 하던 그대로라 옛 프로젝트가 달라지지 않습니다.
   */
  modelId?: string;
}

export interface CutVideoPrompt {
  ko: string;
  en: string;
  /** 생성기에 넣을 **러닝타임**(초). 레퍼런스 영상 길이가 곧 이 값입니다. */
  seconds: number;
}

/**
 * 영상 길이 — **구도잡기 타임라인**이 정합니다.
 *
 * 무빙이 4초까지 있으면 4초짜리 컷입니다. 사람이 따로 적게 하면 구도잡기에서 4초로
 * 맞춰 놓고 생성기에는 5초를 넣는 어긋남이 반드시 생깁니다. 무빙이 없으면 타임라인
 * 전체 길이를 씁니다(고정 샷도 길이는 있어야 하니까요).
 */
export function cutVideoSeconds(
  composition?: CompositionState,
  /**
   * 구도잡기가 없을 때 기댈 값 — 「AI 로 일괄 생성」 이 컷에 적어 둔 길이(`plannedSeconds`).
   *
   * **잰 값이 적어 둔 값보다 셉니다.** 구도를 잡은 뒤에는 타임라인이 진실이고, 기획
   * 단계의 숫자는 그저 짐작이었습니다. 반대로 두면 구도를 4초로 고쳐도 생성기에는
   * 계속 옛 숫자가 들어갑니다.
   */
  planned?: number,
  referenceSeconds?: number,
): number {
  const positive = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
  // 15초 군무가 모든 모델에서 10초라고 표시됐습니다. 원본 길이는 보존하고 모델 한도는 전송 직전에 검사합니다.
  if (positive(referenceSeconds)) return referenceSeconds;
  if (!composition) return positive(planned) ? planned : 5;
  const moves = cameraMovesOf(composition);
  const end = moves.length ? cameraMovesEnd(moves) : 0;
  const span = end > 0.1 ? end : timelineOf(composition).duration;
  return positive(span) ? span : positive(planned) ? planned : 5;
}

/** 선택을 끈 옛 레퍼런스 길이가 현재 컷을 덮지 않게 모든 컷 호출이 같은 조건을 씁니다. */
export function cutVideoSecondsOf(cut: Pick<Cut, "composition" | "plannedSeconds" | "refVideoPath" | "refVideoSeconds" | "useRefVideo">): number {
  return cutVideoSeconds(cut.composition, cut.plannedSeconds,
    cut.useRefVideo !== false && cut.refVideoPath ? cut.refVideoSeconds : undefined);
}

/** 프레임 단위 길이를 0.5초나 0.1초로 바꾸지 않습니다. 표시는 부동소수점 계산의 꼬리만 줄입니다. */
export function formatVideoSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? seconds.toFixed(1) : String(Number(seconds.toFixed(6)));
}

/**
 * 쉼표로 이은 구절에서 **같은 구절을 한 번만** 남깁니다(대소문자 무시, 앞뒤 공백 무시).
 *
 * 사용자 2026-09-22 스크린샷: 영상 프롬프트에 「natural visible pores, …, fine film grain」 이 **두 번**
 * 박혀 있었습니다. 일괄 생성이 컷의 `styleTags` 에 자동 질감 칩을 **이미 합쳐 넣고** 그 위에
 * `autoRealism().en` 을 한 번 더 이어 붙였기 때문입니다(`projectBootstrap.buildCuts`). 부르는 쪽마다
 * 고치면 또 한 곳이 남습니다 — 모든 호출이 지나는 여기서 걷어 냅니다.
 */
export function dedupePhrases(text: string): string {
  const seen = new Set<string>();
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}

export function buildCutVideoPrompt(
  input: CutVideoPromptInput,
): CutVideoPrompt {
  const seconds = cutVideoSeconds(input.composition, input.plannedSeconds, input.hasRefVideo ? input.refVideoSeconds : undefined);
  const moves = input.composition ? cameraMovesOf(input.composition) : [];
  const camera = describeCameraMoves(moves);
  const people = input.composition
    ? describePeople(input.composition, input.characterNames ?? {}, input.characterActing ?? {}, {
      screenPlacement: !input.hasRefVideo, hasRepresentativeImage: input.hasRepresentativeImage,
    })
    : [];
  const swaps = input.composition ? describeObjectSwaps(input.composition) : [];

  const ko: string[] = [];
  const en: string[] = [];

  /*
    맨 앞에 **무슨 일이 일어나는가**. 생성기는 앞쪽을 더 무겁게 읽으므로, 배우가 무엇을
    하는지가 첫 줄이어야 합니다 — 카메라나 재질이 먼저 오면 그쪽만 지키고 연기는 흘립니다.
  */
  const what = [input.title, input.description].filter(Boolean).join(" — ");
  if (what) {
    ko.push(what);
    en.push(what);
  }

  const appearanceKo = input.hasRepresentativeImage ? "대표 그림과 실제로 첨부된 개별 인물 시트" : "인물 시트";
  const appearanceEn = input.hasRepresentativeImage ? "representative image and any individual character sheets actually attached" : "character sheets";
  if (input.hasRepresentativeImage) {
    ko.push("첨부한 대표 그림에 보이는 인물 구성·외형·의상을 유지하세요. 개별 인물 시트는 선택 사항이며, 첨부되지 않은 시트가 있다고 가정하지 마세요.");
    en.push("Preserve the visible cast, appearance and clothing in the attached representative image. Individual character sheets are optional; do not assume an unattached sheet exists.");
  }

  if (input.hasRefVideo) {
    ko.push(
      `첨부한 레퍼런스 영상은 3D 구도 안내(블로킹 가이드)입니다. 카메라 길·자리·동작·타이밍을 그대로 따르세요. ${formatVideoSeconds(seconds)}초입니다. 영상 속 인형은 자리와 동작만 알려 주는 것이니, 첨부한 ${appearanceKo}의 사람으로 바꿔 그리세요. 인형의 회색 또는 식별 색을 피부·손·의상에 옮기지 말고, 매끈한 플라스틱 표면과 빈 얼굴도 복사하지 마세요. 피부·머리카락·옷의 색과 재질은 ${appearanceKo}를 따르세요. 손가락의 자세와 제스처도 레퍼런스와 연기 지시를 유지하세요.`,
    );
    en.push(
      `The attached reference video is a 3D blocking guide. Follow its camera path, positions, action and timing exactly. It is ${formatVideoSeconds(seconds)} seconds long. The mannequins only mark position and action; replace them with the people from the attached ${appearanceEn}. Use these appearance references for skin, hair and clothing colors and materials, not the mannequins' smooth plastic surfaces or blank faces. Do not transfer grey or identification colors from the mannequins to the people. Preserve the reference finger poses and gestures together with the acting instructions.`,
    );
    // 한 방의 형광등을 모든 컷에 강제하거나, 잡아 둔 손짓을 느슨한 손으로 덮어쓰지 않습니다.
    ko.push(`각 인물의 손등·팔뚝은 그 인물의 얼굴과 같은 피부색 기준을 유지하세요. 입술 화장색을 손에 번지게 하지 말고, ${appearanceKo}에 있는 피부 특징과 조명에 따른 자연스러운 색 변화는 유지하세요.`);
    en.push(`Keep each person's hands and forearms consistent with that person's facial skin tone. Do not spread lip makeup color onto the hands; preserve the skin features in the attached ${appearanceEn} and natural color changes under the scene lighting.`);
    ko.push("조명·접지: 이 컷에서 지정한 조명이 있으면 그것을, 없으면 배경에 보이는 광원의 방향·색온도·부드러움을 따라 인물을 함께 비추세요. 발이나 물체가 바닥에 닿는 곳에는 접점이 가장 짙고 가까운 바닥으로 부드럽게 사라지는 짧은 접지 그림자를 만드세요. 떠 있는 발을 바닥에 붙이지 마세요. 긴 그림자의 유무·방향·길이는 실제 장면의 광원에 맞추고, 블로킹 가이드의 임시 조명과 그림자를 그대로 복제하지 마세요.");
    en.push("Lighting and grounding: use the lighting specified for this shot; otherwise match the direction, color temperature and softness of the sources visible in the background. Add short contact shadows where feet or objects actually touch the floor, darkest at contact and fading softly nearby. Do not pin raised feet to the floor. Any longer cast shadows must agree with the scene's light sources; do not copy the blocking guide's temporary lighting or shadows.");
  } else if (camera) {
    ko.push(`카메라: ${camera.ko}`);
    en.push(`Camera: ${camera.en}`);
  }

  for (const line of people) {
    ko.push(line.ko);
    en.push(line.en);
  }
  /*
    **호리존이 장소를 이깁니다** — 컷 프롬프트(`cutPrompt.ts`)와 같은 규칙 한 벌(`horizonOverridesLocation`).
    활성 방이 호리존이면 «장소는 첨부한 배경 그대로» 줄을 빼고 아래 호리존 문장만 싣습니다. 둘 다 실으면 생성기가
    긴 쪽(장소)을 골라 제품 컷이 카페 안에 섭니다(2026-09-22 검토 — 그림 쪽은 고쳐 두고 영상 쪽만 남아 있었습니다).
    «구도 안 씀» 이면 `composition` 이 없어 호리존도 없고, 장소가 그대로 실립니다.
  */
  if (input.backgroundName && !horizonOverridesLocation(input.composition)) {
    ko.push(
      `장소는 첨부한 «${input.backgroundName}» 배경 그대로입니다. 벽·바닥·빛을 바꾸지 마세요.`,
    );
    en.push(
      `The location is exactly the attached background "${input.backgroundName}". Do not change the walls, floor or lighting.`,
    );
  }
  // 호리존 방이면 배경은 «단색 스튜디오» 라는 사실 — 컷 프롬프트와 같은 문장(`describeHorizonRoom`, 사용자 2026-09-22).
  const horizon = describeHorizonRoom(input.composition);
  if (horizon) {
    ko.push(horizon.ko);
    en.push(horizon.en);
  }
  for (const line of swaps) {
    ko.push(line.ko);
    en.push(line.en);
  }
  /*
    대사·연기는 **효과보다 앞**에 둡니다. 생성기는 앞쪽 문장을 더 무겁게 읽는데, 이 컷에서 사람이 무엇을 하는지가
    비·연기 같은 효과보다 중요합니다().
  */
  if (input.acting?.trim()) {
    /*
      **명령형만 조용히 바로잡습니다.**

       답은 두 겹입니다 —
      뜻을 알아야 하는 것은 「프롬프트 말로」 단추가 LLM 으로 바꿔 **영어판까지 저장**하고,
      단추를 안 누른 사람을 위해 **틀릴 수 없는 것만** 여기서 말없이 고칩니다.

      말꼬리만 만지고 낱말과 순서는 그대로 둡니다. 평서문 여덟 개로 오탐 시험을 만들어
      두었습니다 — 「담배를 빼 문다」 같은 겹동사를 건드리면 안 됩니다.
    */
    const acting = plainify(input.acting.trim().split(/\s*\n+\s*/).join(" ")).text;
    /*
      **소리를 못 만드는 모델에는 대사를 보내지 않습니다**(Runway·Wan 2.2·Hailuo·
      Kling 2.5 이하). 보내 봐야 소리는 안 나고 **자막으로 박히거나 그냥 버려집니다.**
      그때는 「말하는 입 모양과 표정만」 이라고 덧붙여, 나중에 립싱크를 붙일 자리를 남깁니다.
    */
    // 영어판이 있으면 영문 칸에는 그것을 씁니다. 없으면 한국어가 그대로 갑니다.
    const actingEn = input.actingEn?.trim() || acting;
    if (modelRuleOf(input.modelId) && !speaksDialogue(modelRuleOf(input.modelId))) {
      ko.push(`연기: ${acting}`);
      ko.push("이 모델은 소리를 만들지 않습니다. 말하는 입 모양과 표정만 연기하고, 화면에 글자는 넣지 않습니다.");
      en.push(`Acting: ${actingEn}`);
      en.push(
        "Perform the mouth movements and facial expression of speaking; the shot itself is silent and carries no on-screen text.",
      );
    } else {
      ko.push(`대사·연기: ${acting}`);
      /*
        **영문은 그 모델의 대사 문법으로 고쳐 적습니다**(2026-09-18).

        규칙 표에 모델마다의 모양을 적어 두고도(`modelRules.ts` 의 `dialogue.syntax`)
        조립하는 쪽은 「소리가 나는가」 만 보고 모양은 흘려보내고 있었습니다. 그래서
        Veo 에는 자막이 박히고(따옴표를 콜론으로 바꾸는 것이 회피법입니다), H3 는
        `<d>` 태그가 없어 대사를 못 알아듣고, Kling 은 화자를 못 가렸습니다.

        한국어 칸은 손대지 않습니다 — 사람이 읽는 자리라 원문 그대로가 낫고,
        문법은 생성기에 가는 영문에서만 뜻이 있습니다.
      */
      const shaped = shapeDialogue(modelRuleOf(input.modelId), actingEn);
      en.push(`Dialogue and acting: ${shaped.lines[0] ?? actingEn}`);
      for (const line of shaped.lines.slice(1)) en.push(line);
      // 못 가렸으면 고치는 대신 **모양을 알려 줍니다** — 잘못 고치는 것보다 낫습니다.
      if (shaped.hint) ko.push(shaped.hint);
      if (shaped.speakerWarning) ko.push(shaped.speakerWarning);
    }
  }

  /*
    **배경 움직임은 효과보다 앞**입니다.

    구도잡기 레퍼런스 영상은 배경이 정지 그림이라, 영상 모델이 그 구역을 「원래 안 움직이는 것」 으로
    굳혀 버립니다 — 달리는 차 안 컷인데 창밖이 통째로 멈춥니다. 환경이 먼저 살아야 그 위에 효과가
    얹히므로, 순서도 «환경 → 효과» 로 둡니다(앞쪽 문장을 더 무겁게 읽는 생성기가 많습니다).
  */
  if (input.backgroundMotion?.trim()) {
    // 효과 칸과 마찬가지로 메모하듯 적는 자리라 명령형이 자주 섞입니다.
    const motion = plainify(input.backgroundMotion.trim()).text;
    ko.push(`배경 움직임: ${motion}`);
    en.push(`Background motion: ${input.backgroundMotionEn?.trim() || motion}`);
  }

  /*
    **어느 구역이 움직이는가.** 바로 위가 «배경이 무엇을 하는가»(환경)이고 여기는 «그것이
    화면 어디인가»(범위)입니다. 효과보다 앞에 두는 까닭 — 앞쪽을 무겁게 읽는 생성기가
    범위를 효과보다 먼저 봐야, 「폭발」 을 배경 전체에 퍼뜨리지 않습니다.
  */
  if (input.motionMaskName?.trim()) {
    const mask = describeMotionMask({ name: input.motionMaskName.trim() });
    ko.push(mask.ko);
    en.push(mask.en);
  }

  if (input.vfx?.trim()) {
    // VFX 칸은 메모하듯 적기 쉬운 자리라 명령형이 특히 자주 섞입니다.
    const vfx = plainify(input.vfx.trim()).text;
    ko.push(`효과: ${vfx}`);
    en.push(`Effects: ${input.vfxEn?.trim() || vfx}`);
  }

  // 연출·질감은 효과 뒤, 금지 앞. 화면이 «어떻게 보일지» 라 장면 서술 다음 자리입니다.
  // 같은 구절이 두 번 들어오면 한 번만 — 까닭은 `dedupePhrases`.
  if (input.lookEn?.trim()) en.push(dedupePhrases(input.lookEn));

  /*
    마지막은 **영상에서만 필요한 금지**입니다. 그림에는 없는 문제라 컷 프롬프트에는
    안 적습니다 — 장면이 도중에 갈아엎히거나, 글자가 떠오르거나, 속도가 갑자기 바뀌는 것.
  */
  /*
    금지 사항은 **모델마다 적는 자리가 다릅니다**(`modelRules.ts`). Runway 는 부정문
    자체가 안 통해서 「~하지 마세요」 를 보내면 오히려 그것이 나옵니다 — 그래서
    같은 뜻을 긍정으로 뒤집어 적습니다.
  */
  const rule = modelRuleOf(input.modelId);
  /*
    **금지는 «네거티브 칸이 있을 때만» 부정문으로 적습니다.**

     「no text, no subtitles」 를 본문에 적으면
    디퓨전 모델은 그 낱말을 **그리라는 말로** 읽는 일이 흔합니다 — 부정은 전용 칸에서만 제 구실을 합니다.
    칸이 없는 모델(`inline`·`unsupported`)에는 같은 뜻을 긍정으로 뒤집어 적습니다.
  */
  if (input.hasRefVideo) {
    // 레퍼런스 자체에 카메라 컷이 있을 수 있습니다. 원테이크를 강제하면 타임라인과 모순됩니다.
    ko.push("레퍼런스 영상의 카메라 이동·프레이밍·컷 전환과 그 시각을 따르세요. 화면 속 인물의 위치는 안무와 카메라에 따라 변합니다. 첫 화면의 좌표에 고정하지 마세요. 같은 인물과 장소의 연속성을 유지하고, 영상에 없는 카메라 컷이나 속도 변화는 추가하지 마세요. 화면은 장면의 영상으로만 채우세요.");
    en.push("Follow the reference video's camera movement, framing, shot changes and their timing. The cast's screen positions change with the choreography and camera; do not lock them to the initial frame's coordinates. Preserve cast and location continuity, without adding camera cuts or speed changes absent from the reference. Fill the frame with the scene imagery alone.");
  } else if (negativeStyleOf(rule).where !== "field") {
    ko.push(
      "한 번에 이어지는 한 컷입니다. 화면은 처음부터 끝까지 한 장면이고, 가장자리까지 **찍힌 그림만으로** 채워집니다.",
    );
    en.push(
      "One continuous shot, a single unbroken scene from start to finish, the entire frame filled edge to edge with photographed imagery alone, a clean picture with unmarked surfaces.",
    );
  } else {
    ko.push(
      "한 번에 이어지는 한 컷입니다. 중간에 다른 장면으로 바뀌지 않고, 화면이 잘리지 않으며, 글자·자막·로고가 나오지 않습니다.",
    );
    en.push(
      "One continuous shot. No cut to another scene, no split screen, no text, no subtitles, no logo, no speed ramp.",
    );
  }

  /*
    ── 형식과 잠금은 **맨 뒤** ──────────────────────────────────────────
    2026-09-18 에 공개 프롬프트 8,961개를 센 자료(vflow)를 보고 넣었습니다.

    · **길이는 46%, 화면비는 24.9%** 만 적혀 있습니다. 그런데 화면비는 «가장 안 적으면서
      없을 때 좋은 클립을 가장 자주 망치는» 항목입니다. 우리는 구도잡기가 길이를 알고
      프로젝트가 화면비를 아는데도 **글에 안 실어 보내고 있었습니다.**
    · **잠금 문장은 맨 뒤**에 둡니다 — 이미 묘사된 장면에 제약이 걸리도록. 그리고 하나만
      잠그면(15%가 그렇습니다) 「얼굴은 같은데 옷이 바뀐다」 가 됩니다. 얼굴·의상·장소를
      함께 잠급니다(우리 규칙 6 «정체성은 하나» 를 문장으로도 한 번 더 박는 것).
  */
  const format = [`${formatVideoSeconds(seconds)}초`, input.aspect && `화면비 ${input.aspect}`]
    .filter(Boolean)
    .join(" · ");
  ko.push(`형식: ${format}. 마지막 프레임까지 끊지 말고 채우세요.`);
  en.push(
    `Format: exactly ${formatVideoSeconds(seconds)} seconds${input.aspect ? `, ${input.aspect} aspect ratio` : ""}. Run to the last frame.`,
  );

  const who = (input.lockNames ?? []).filter(Boolean);
  ko.push(
    `${who.length ? `${who.join("·")} 의 ` : ""}얼굴·머리·의상, 그리고 장소와 빛을 첨부한 레퍼런스 그대로 두세요. 컷이 끝날 때까지 바뀌면 안 됩니다.`,
  );
  en.push(
    `Keep ${who.length ? `${who.join(" and ")}'s ` : "the character's "}face, hair and outfit, and the location and lighting, identical to the attached references throughout the entire shot.`,
  );

  return { ko: ko.join("\n\n"), en: en.join("\n\n"), seconds };
}

/**
 * «창» 으로 읽을 이름. 「창고」·「창작」 이 걸리지 않게 낱말을 짚어 둡니다 —
 * 홑낱말 「창」 은 앞뒤가 한글이 아닐 때만 셉니다.
 */
const WINDOW_NAME = /(^|[^가-힣])창([^가-힣]|$)|창문|창가|창밖|차창|유리창|windshield|window/i;

/**
 * 배경 움직임 칸이 비었을 때 보여 줄 **보기 한 줄**(한국어 원문 — 부르는 쪽이 `t()` 로 감쌉니다).
 *
 * # 왜 «거들기» 까지만인가
 *
 * 값을 지어 넣지 않습니다. 없는 움직임을 적어 두면 생성기는 그것을 **그립니다** — 멈춰 있어야 할
 * 배경이 출렁입니다. 사람이 적는 칸입니다.
 *
 * 다만 창밖이 얼어붙는 사고는 «바깥이 보이는 컷» 에서만 납니다. 그래서 구도에 실외 방이 있거나
 * «창» 소품이 서 있을 때만 「이런 걸 적는 칸입니다」 하고 자리글을 바꿔 줍니다. 없으면 `undefined` —
 * 부르는 쪽이 일반 자리글로 물러섭니다.
 */
export function backgroundMotionHint(composition?: CompositionState | null): string | undefined {
  if (!composition) return undefined;
  // 숨긴 방은 화면에 없으니 배경도 아닙니다(`describeHorizonRoom` 과 같은 잣대).
  const rooms = (composition.rooms ?? []).filter((room) => !room.hidden);
  if (rooms.some((room) => room.outdoor)) {
    return "예) 멀리 구름이 천천히 흐르고, 나뭇가지가 바람에 흔들린다";
  }
  /*
    실내여도 «창» 이 있으면 창밖이 보입니다 — 차 안·기차 안이 꼭 그렇습니다.
    소품 이름과 묶음의 «실제로는 무엇인가» 를 같이 봅니다(둘 중 한 곳에만 적는 사람이 있습니다).
  */
  const named = [
    ...(composition.objects ?? []).filter((item) => item.visible !== false).map((item) => item.label),
    ...(composition.objectGroups ?? []).flatMap((group) => [group.name, group.describeAs ?? ""]),
  ];
  if (named.some((name) => WINDOW_NAME.test(name || ""))) {
    return "예) 창밖으로 가로등이 뒤로 흐르고, 맞은편 차선의 불빛이 스쳐 지나간다";
  }
  return undefined;
}

/**
 * 이 컷의 **대표 그림** — 스토리보드에 실릴 한 장.
 *
 * 대표 표시는 **그림 선반의 별(`isPrimary`)** 하나만 씁니다. 컷에만 따로 «대표 id» 를
 * 두려다 말았습니다 — 캐릭터·배경·에셋이 이미 별로 대표를 정하는데 컷만 다른 길을 쓰면,
 * 별을 눌러도 스토리보드가 안 바뀌는 «두 개의 대표» 가 생깁니다(공통 규칙 1).
 *
 * 첫 장을 기본으로 두는 까닭: 선반은 **처음 들어온 그림에 자동으로 별을 답니다.**
 * 옛 컷이나 손으로 별을 지운 경우만 여기서 첫 장으로 물러섭니다.
 */
export function heroImageOf(cut: Cut): GeneratedImageAsset | null {
  if (!cut.images.length) return null;
  /*
    **움직임 마스크는 대표가 될 수 없습니다 — 물러서는 길에서도.**

    마스크는 새까만 판입니다. 대표가 되면 스토리보드 칸에 들어가고, 로컬 영상의
    **첫 프레임**으로도 들어갑니다. 한때 「걸러 내고 아무것도 안 남으면 원래 목록으로
    물러선다」 로 두었는데, 그러면 **마스크 한 장만 남은 컷**에서 그대로 새까만 판이
    첫 프레임이 됩니다. 마스크를 그린 뒤 원본 그림을 지우면 실제로 그 상태가 됩니다
    (2026-09-23 검토 — 시험도 그 동작을 «정상» 으로 적어 두고 있었습니다).

    그래서 마스크는 **어느 경우에도** 빼고, 쓸 것이 없으면 `null` 을 돌려줍니다.
    부르는 쪽은 「대표 그림이 없다」 를 이미 다룰 줄 압니다(글만으로 뽑기 · 안내 문구).

    합성 시트(격자)는 조금 다릅니다 — 그림이긴 해서, 그것뿐이면 없는 것보다 낫습니다.
  */
  const masks = (image: GeneratedImageAsset) =>
    isMotionMaskName(image.name || image.filePath || "");
  const pictures = cut.images.filter((image) => !masks(image));
  if (!pictures.length) return null;
  const usable = pictures.filter((image) => !image.isCompositeSheet);
  const pool = usable.length ? usable : pictures;
  return pool.find((image) => image.isPrimary) ?? pool[0];
}
