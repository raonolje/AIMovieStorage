import { describe, expect, it } from "vitest";
import { buildCutVideoPrompt } from "@/lib/cutVideoPrompt";
import { summarizeCompositionCamera } from "@/lib/composition";
import { newBackground, newCharacter, newCut } from "@/lib/projectTypes";
import {
  ageEnOf,
  characterBasics,
  cutLinkInput,
  cutLinkPaths,
  cutRequestPayload,
  cutSwapPeople,
  cutVideoRequestPayload,
  cutVideoSkeletonInput,
  sheetReferenceTags,
  sheetRequestPayload,
  withCutPromptResult,
  withPromptResult,
  cutCharacterRefs,
} from "@/lib/promptPayloads";

/*
  카드 단추와 「AI 일괄 생성」 4단계가 **같은 재료**를 보내는지 — 모양(키)을 못 박습니다. 요청 문구
  (`cut-prompt.md`·`cut-video-prompt.md`)가 이 키 이름을 읽으므로, 키가 바뀌면 문구가 그 값을 못 봅니다.
*/

const jinwoo = {
  ...newCharacter(),
  id: "c1",
  name: "서진우",
  gender: "남성",
  heightCm: 178,
  build: "slim" as const,
  role: "형사",
  description: "짧게 정돈한 검은 머리",
  profile: { age: "42세", tagline: "말수가 적다", personality: "냉정", callName: "Seo Jinwoo", speech: "", habits: "", directing: "시선을 먼저 준다" },
  generatedImages: [{ id: "g1", name: "서진우_시트_001", thumb: "", file: null, filePath: "D:/저장/서진우/서진우_시트_001.png", isPrimary: true, isCompositeSheet: true }],
};
const hana = { ...newCharacter(), id: "c2", name: "서하나", gender: "여성", heightCm: 150, profile: { age: "12세", tagline: "", personality: "", callName: "", speech: "", habits: "", directing: "" } };
const highway = { ...newBackground("exterior"), id: "b1", name: "중앙고속도로", location: "터널 입구", description: "젖은 아스팔트\n시간대: 밤" };
const cut = { ...newCut(3), id: "k1", title: "터널", description: "차가 터널로 들어간다", characterIds: ["c1", "c2"], backgroundId: "b1", styleTags: ["cinematic", "skin-pores"], acting: "진우: 「가자」", vfx: "비", plannedSeconds: 4 };
const summary = summarizeCompositionCamera(undefined, {});

describe("characterBasics", () => {
  it("역할·성별·나이·키·체형을 한글과 영문으로 — 「보통」 체형은 영문에 안 적는다", () => {
    expect(characterBasics(jinwoo)).toEqual({
      basics: ["역할 형사", "성별 남성", "나이 42세", "키 178cm", "마른 편"],
      // 「42세」 의 «세» 는 영문에 못 실립니다 — 숫자만 읽어 `42 years old` 로(2026-09-22 검토).
      basicsEn: ["42 years old", "man", "178 cm tall", "slim build"],
    });
    expect(characterBasics(hana).basicsEn).toEqual(["12 years old", "woman", "150 cm tall"]);
  });

  it("나이 칸의 영문 — 세·살은 떼고, 「N대」 는 in their Ns, 못 읽는 모양은 안 싣는다", () => {
    expect(ageEnOf("42세")).toBe("42 years old");
    expect(ageEnOf(" 19살 ")).toBe("19 years old");
    expect(ageEnOf("30")).toBe("30 years old");
    expect(ageEnOf("40대 후반")).toBe("in their late 40s");
    expect(ageEnOf("20대 초반")).toBe("in their early 20s");
    expect(ageEnOf("10대")).toBe("in their teens");
    expect(ageEnOf("소녀")).toBe("");
    expect(ageEnOf(undefined)).toBe("");
  });
});

describe("sheetRequestPayload", () => {
  it("인물 시트 요청의 키 — basics 가 실리고 배경 전용 값은 없다", () => {
    const data = sheetRequestPayload({
      kind: "character",
      name: "서진우",
      description: "짧게 정돈한 검은 머리",
      projectFacts: null,
      entity: jinwoo,
      blueprint: jinwoo.blueprint,
      ...characterBasics(jinwoo),
      identityMarks: null,
      templateMention: null,
      references: [],
    });
    expect(Object.keys(data)).toEqual([
      "project", "name", "description", "analysis", "spaceKind", "referenceMode", "basics", "basicsEn",
      "requiredAspects", "panelCount", "panorama", "identityMarks", "references", "referenceNames",
    ]);
    expect(data.basics).toContain("키 178cm");
    expect(data.panelCount).toBeGreaterThan(0);
    expect(data.panorama).toBe("no");
  });

  it("장소 시트 요청에는 ::when 변수(frameKind·anchorKind·masterKind·viewpointNew)가 문자열로 실린다", () => {
    const data = sheetRequestPayload({
      kind: "background",
      name: "중앙고속도로",
      description: "터널 입구 — 젖은 아스팔트",
      projectFacts: null,
      entity: highway,
      blueprint: highway.blueprint,
      spaceKind: "exterior",
      identityMarks: null,
      templateMention: null,
      references: sheetReferenceTags([], "magnific"),
    }) as Record<string, unknown>;
    expect(typeof data.frameKind).toBe("string");
    expect(typeof data.anchorKind).toBe("string");
    expect(typeof data.masterKind).toBe("string");
    expect(["yes", "no"]).toContain(data.viewpointNew);
  });
});

describe("cutRequestPayload — 컷 그림", () => {
  const data = cutRequestPayload({
    projectFacts: null,
    sceneSummary: "밤의 고속도로",
    cut,
    cutCharacters: [jinwoo, hana],
    background: highway,
    summary,
    useComposition: false,
    facts: { people: ["서진우", "서하나"] },
  });

  it("키가 요청 문구가 읽는 이름 그대로다", () => {
    expect(Object.keys(data)).toEqual([
      "project", "scene", "cut", "style", "acting", "vfx", "composition", "people", "background", "facts", "draftKo", "draftEn",
    ]);
    expect(data.composition).toBeNull();
    // 토글은 **한국어 라벨**로 갑니다 — 요청 문구가 영문 촬영 용어로 옮깁니다.
    expect(data.style).toEqual(["시네마틱", "모공·솜털"]);
  });

  it("사람마다 시트 태그 또는 생김새 — 시트가 있으면 @파일이름, 없으면 생김새로 세운다", () => {
    expect(data.people[0]).toMatchObject({ 이름: "서진우", 시트: ["@서진우_시트_001"], 성별: "남성", 키cm: 178, 성격: "냉정" });
    expect(data.people[1]).toMatchObject({ 이름: "서하나", 시트: [], 생김새: "여성 / 12세 / 150cm" });
    expect(data.background).toEqual({ 이름: "중앙고속도로", 시트: [], 생김새: "젖은 아스팔트\n시간대: 밤", 장소: "터널 입구" });
  });
});

describe("cutSwapPeople · cutLinkInput — @태그 잇기 재료", () => {
  it("구도가 없으면 컷에 고른 인물 순서대로, 고른 시트와 별칭을 든다", () => {
    const swaps = cutSwapPeople(cut, [jinwoo, hana]);
    expect(swaps.map((item) => item.name)).toEqual(["서진우", "서하나"]);
    expect(swaps[0].sheetPaths).toEqual(["D:/저장/서진우/서진우_시트_001.png"]);
    expect(swaps[0].aliases).toEqual(["Seo Jinwoo"]);
    expect(swaps[0].side).toBeNull();
  });

  it("잇기 재료에는 생김새·배경 생김새가 실리고, 캡처가 없으면 구도 줄도 비어 있다", () => {
    const link = cutLinkInput({
      cut,
      characters: [jinwoo, hana],
      background: highway,
      summary,
      useComposition: false,
      ...cutLinkPaths(cut, highway, false),
    });
    expect(link.people.map((person) => person.name)).toEqual(["서진우", "서하나"]);
    expect(link.people[1].look).toBe("여성 / 12세 / 150cm");
    expect(link.background).toEqual({ name: "중앙고속도로", look: "젖은 아스팔트\n시간대: 밤" });
    expect(link.guidePath).toBeUndefined();
    expect(link.guideNote).toBe("");
  });
});

describe("cutVideoRequestPayload — 컷 영상", () => {
  const skeletonInput = cutVideoSkeletonInput({
    cut,
    characters: [jinwoo, hana],
    cutCharacters: [jinwoo, hana],
    background: highway,
    context: null,
    useComposition: false,
    useRefVideo: false,
    aspect: "9:16",
    videoModel: "seedance-2-5-pro",
  });
  const skeleton = buildCutVideoPrompt(skeletonInput);
  const data = cutVideoRequestPayload({
    skeleton,
    skeletonInput,
    projectFacts: null,
    sceneSummary: "밤의 고속도로",
    cut,
    cutCharacters: [jinwoo, hana],
    background: highway,
    summary,
    useComposition: false,
  });

  it("뼈대(draftKo/draftEn)와 사실(초·화면비·모델)이 실린다", () => {
    expect(Object.keys(data)).toEqual([
      "project", "scene", "cut", "acting", "actingEn", "vfx", "vfxEn", "seconds", "aspect", "modelId", "hasRefVideo", "hasRepresentativeImage",
      "style", "lookEn", "composition", "people", "background", "draftKo", "draftEn",
    ]);
    expect(data.draftEn).toBe(skeleton.en);
    expect(data.draftEn).toContain("9:16");
    expect(data.seconds).toBe(4);
    // 마그니픽 슬러그(`seedance-2-5-pro`)도 우리 id 로 되짚힙니다 — 옛 작품이 모델을 잃지 않게.
    expect(data.modelId).toBe("seedance-2.5");
    expect(data.hasRefVideo).toBe("no");
  });

  it("요청의 lookEn 도 같은 구절이 한 번만 — 뼈대와 같은 재료에서 걷어 낸다", () => {
    // 토글 «모공·솜털» 과 자동 실사가 같은 피부 구절을 들고 옵니다 — 재료를 짓는 자리에서 한 번만.
    const phrases = (data.lookEn || "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
    expect(new Set(phrases).size).toBe(phrases.length);
    expect(data.lookEn).toBe(skeletonInput.lookEn);
  });

  it("사람마다 시트·생김새·별칭·연기 기준", () => {
    expect(data.people[0]).toMatchObject({ 이름: "서진우", 별칭: ["Seo Jinwoo"], 시트: ["@서진우_시트_001"] });
    expect(data.people[0].연기기준).toContain("시선을 먼저 준다");
    expect(data.people[1]).toMatchObject({ 이름: "서하나", 시트: [], 생김새: "여성 / 12세 / 150cm", 연기기준: null });
  });
});

describe("넣기 — 이력까지 한 벌", () => {
  it("withPromptResult 는 덮어쓰기 전 판을 남기고 새 판을 맨 앞에 쌓는다", () => {
    const before = { ...jinwoo, promptKo: "옛 한글", promptEn: "old en", promptHistory: [] };
    const next = withPromptResult(before, { ko: "새 한글", en: "new en", negativeKo: "", negativeEn: "" }, "AI 일괄 생성 · 프롬프트 작성");
    expect(next.promptKo).toBe("새 한글");
    expect(next.promptHistory?.map((entry) => entry.note)).toEqual(["AI 일괄 생성 · 프롬프트 작성", "덮어쓰기 전"]);
    expect(next.promptLoading).toBe(false);
  });

  it("withCutPromptResult 는 태그 이어진 글을 칸과 이력에 같이 넣는다", () => {
    const made = { ko: "한글", en: "en", negativeKo: "n-ko", negativeEn: "n-en" };
    const next = withCutPromptResult(cut, made, { ko: "한글\n\n아직 그림 없음: 서하나", en: "en" }, "프롬프트 작성", "구도 없음");
    expect(next.promptKo).toContain("아직 그림 없음");
    expect(next.promptHistory?.[0]).toMatchObject({ ko: "한글\n\n아직 그림 없음: 서하나", label: "프롬프트 작성", note: "구도 없음", negativeEn: "n-en" });
  });
});

describe("pickedCharacterRefs — «안 골랐다» 와 «전부 뺐다» ()", () => {
  const sheet = { filePath: "D:/저장/서진우/서진우_001.png", isPrimary: true } as unknown as NonNullable<Parameters<typeof cutCharacterRefs>[2]>[number];
  it("칸이 없으면 자동 시트로 물러서고, 칸이 비어 있으면 그림 없이 이름만", () => {
    const noChoice = { characterRefs: {} } as unknown as Parameters<typeof cutCharacterRefs>[0];
    const cleared = { characterRefs: { c1: [] } } as unknown as Parameters<typeof cutCharacterRefs>[0];
    expect(cutCharacterRefs(noChoice, "c1", [sheet])).toEqual([sheet.filePath]);
    expect(cutCharacterRefs(cleared, "c1", [sheet])).toEqual([]);
  });
});
