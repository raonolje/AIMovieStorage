import { describe, expect, it } from "vitest";
import { DEFAULT_COMPOSITION } from "@/lib/composition";
import { addRoomIn } from "@/lib/compositionEdit/rooms";
import { placeCharacterIn } from "@/lib/compositionEdit/characters";
import { describePeople } from "@/lib/objectSwapPrompt";
import { buildCutVideoPrompt, cutVideoSeconds, cutVideoSecondsOf, dedupePhrases } from "@/lib/cutVideoPrompt";
import { createCameraMove } from "./cameraMoves";
import { newCut } from "./projectTypes";
import { cutVideoSkeletonInput } from "./promptPayloads";

describe("영상 참조와 카메라·인물 지시의 일치", () => {
  const composition = { ...placeCharacterIn(DEFAULT_COMPOSITION, "performer"),
    cameraMoves: [{ ...createCameraMove(), duration: 7 }, { ...createCameraMove(), startTime: 7, duration: 8 }] };
  const input = { composition, characterNames: { performer: "Seoah" }, refVideoSeconds: 15 };

  it.each(["seedance-2.5", "wan2.2"])("%s: 영상이 있으면 좌표를 고정하거나 원테이크로 바꾸지 않는다", modelId => {
    const prompt = buildCutVideoPrompt({ ...input, modelId, hasRefVideo: true });
    expect(prompt.en).not.toMatch(/Screen placement|Keep these positions|One continuous shot|single unbroken scene/);
    expect(prompt.ko).not.toMatch(/화면에서의 자리|이 자리를 지키세요|한 번에 이어지는 한 컷/);
    expect(prompt.en).toContain("shot changes and their timing");
    expect(prompt.en).toContain("screen positions change with the choreography and camera");
    expect(prompt.seconds).toBe(15);
  });

  it("레퍼런스 없는 단일 샷과 그림용 배치 설명은 기존 규칙을 유지한다", () => {
    const prompt = buildCutVideoPrompt({ ...input, hasRefVideo: false, modelId: "seedance-2.5" });
    expect(prompt.en).toContain("One continuous shot");
    expect(prompt.en).toContain("Screen placement");
    expect(prompt.en).toContain("Keep these positions.");
    expect(describePeople(composition, input.characterNames).some(line => line.en.includes("Keep these positions."))).toBe(true);
  });

  it("대표 그림이 있으면 개별 시트를 있는 것으로 가정하지 않고 영상 뼈대에 외형 기준을 남긴다", () => {
    const cut = { ...newCut(1), composition, images: [{ id: "hero", name: "그룹", filePath: "group.png", isPrimary: true }],
      refVideoPath: "motion.mp4", refVideoSeconds: 15 };
    const skeleton = cutVideoSkeletonInput({ cut, characters: [], cutCharacters: [], context: null, useComposition: true, useRefVideo: true });
    expect(skeleton.hasRepresentativeImage).toBe(true);
    const prompt = buildCutVideoPrompt({ ...skeleton, characterNames: input.characterNames });
    expect(prompt.en).toContain("Individual character sheets are optional");
    expect(prompt.en).toContain("only where attached");
    expect(prompt.en).not.toContain("draw them exactly as in the attached character sheets");
    expect(prompt.en).not.toContain("people from the attached character sheets");
    const noFile = cutVideoSkeletonInput({ cut: { ...cut, images: [{ id: "none", name: "미저장 그림" }] },
      characters: [], cutCharacters: [], context: null, useComposition: true, useRefVideo: true });
    expect(noFile.hasRepresentativeImage).toBe(false);
  });
});

describe("컷 영상의 실제 길이", () => {
  const composition = { ...DEFAULT_COMPOSITION, timeline: { duration: 15, fps: 24 },
    cameraMoves: [{ ...createCameraMove(), duration: 7 }, { ...createCameraMove(), startTime: 7, duration: 8 }] };

  it("15초 카메라 무빙을 화면·한영 프롬프트에서 10초로 줄이지 않는다", () => {
    const before = JSON.stringify(composition);
    expect(cutVideoSeconds(composition, 5)).toBe(15);
    const made = buildCutVideoPrompt({ composition, modelId: "seedance-2.5", hasRefVideo: true });
    expect(made.seconds).toBe(15);
    expect(made.ko).toContain("15.0초입니다");
    expect(made.en).toContain("exactly 15.0 seconds");
    expect(JSON.stringify(composition)).toBe(before);
  });

  it("69.134초 전체 영상과 계획 길이를 모델 한도와 별개로 보존한다", () => {
    const long = { ...composition, cameraMoves: [], timeline: { duration: 69.134, fps: 24 } };
    expect(cutVideoSeconds(long)).toBe(69.134);
    expect(cutVideoSeconds(undefined, 69.134)).toBe(69.134);
    const made = buildCutVideoPrompt({ composition: long, modelId: "seedance-2.5" });
    expect(made.seconds).toBe(69.134);
    expect(made.en).toContain("exactly 69.134 seconds");
  });

  it("선택된 프레임 길이 레퍼런스는 반올림하지 않고, 끄면 현재 구도 길이를 쓴다", () => {
    const cut = { ...newCut(1), composition, refVideoPath: "ref.mp4", refVideoSeconds: 113 / 24, useRefVideo: true };
    const seconds = 113 / 24;
    expect(cutVideoSecondsOf(cut)).toBe(seconds);
    const input = cutVideoSkeletonInput({ cut, characters: [], cutCharacters: [], context: null,
      useComposition: true, useRefVideo: true });
    const made = buildCutVideoPrompt(input);
    expect(made.seconds).toBe(seconds);
    expect(made.en).toContain("exactly 4.708333 seconds");
    expect(cutVideoSecondsOf({ ...cut, useRefVideo: false })).toBe(15);
    expect(cutVideoSecondsOf({ ...cut, refVideoPath: undefined })).toBe(15);
  });
});

/*
  사용자 2026-09-22 스크린샷 — 영상 프롬프트에 「natural visible pores, …, fine film grain」 이 두 번 박혀
  있었습니다. 일괄 생성이 컷의 `styleTags` 에 자동 질감 칩을 합쳐 넣고 그 위에 `autoRealism().en` 을 한 번
  더 이어 붙인 탓입니다. 모든 호출이 지나는 `buildCutVideoPrompt` 안에서 걷어 냅니다.
*/
describe("dedupePhrases", () => {
  it("쉼표로 이은 같은 구절을 한 번만 남긴다 — 대소문자·앞뒤 공백 무시", () => {
    expect(dedupePhrases("natural visible pores, fine film grain, Natural visible pores ,  fine film grain")).toBe(
      "natural visible pores, fine film grain",
    );
  });

  it("빈 조각은 버리고 순서는 처음 나온 대로", () => {
    expect(dedupePhrases("a, , b, a, c")).toBe("a, b, c");
  });
});

describe("buildCutVideoPrompt — 질감 한 줄", () => {
  it("블로킹의 손짓을 보존하며 특정 실내 조명을 모든 컷에 강제하지 않는다", () => {
    const video = buildCutVideoPrompt({ hasRefVideo: true, acting: "왼손 엄지를 든다", lookEn: "hard sunlight, warm rim light" });
    expect(video.en).toContain("3D blocking guide");
    expect(video.en).toContain("smooth plastic surfaces or blank faces");
    expect(video.en).toContain("Preserve the reference finger poses and gestures");
    expect(video.en).toContain("short contact shadows where feet or objects actually touch the floor");
    expect(video.en).toContain("Do not pin raised feet");
    expect(video.en).toContain("each person's hands and forearms");
    expect(video.en).toContain("hard sunlight");
    expect(video.en).not.toMatch(/fluorescent|loosely curled|no shadows/i);
    expect(video.ko).toContain("손가락의 자세와 제스처");
    expect(video.ko).toContain("조명·접지");
    expect(buildCutVideoPrompt({ acting: "달린다" }).en).not.toContain("3D blocking guide");
  });
  it("레퍼런스가 있을 때만 손·피부에 인형 색을 옮기지 말라고 두 언어에 적는다", () => {
    const input = { title: "손 인사", description: "손을 흔든다", plannedSeconds: 4 };
    const video = buildCutVideoPrompt({ ...input, hasRefVideo: true });
    expect(video.ko).toContain("피부·손·의상에 옮기지 말고");
    expect(video.en).toContain("Do not transfer grey or identification colors");
    expect(buildCutVideoPrompt(input).en).not.toContain("Do not transfer grey");
  });
  it("연출 토글과 자동 실사가 같은 구절을 들고 와도 영문에 한 번만 실린다", () => {
    const look = "shot on a 85mm lens, natural visible pores, fine film grain";
    const made = buildCutVideoPrompt({
      title: "골목",
      description: "서진우가 돌아선다",
      lookEn: `${look}, natural visible pores, fine film grain`,
      plannedSeconds: 4,
      aspect: "16:9",
      lockNames: ["서진우"],
    });
    expect(made.en.split("natural visible pores").length - 1).toBe(1);
    expect(made.en.split("fine film grain").length - 1).toBe(1);
    expect(made.en).toContain(look);
    expect(made.seconds).toBe(4);
  });
});

/*
  **호리존이 장소를 이깁니다** — 컷 프롬프트와 같은 규칙(`horizonOverridesLocation`). 영상 뼈대만 «장소는 첨부한 배경
  그대로» 와 «배경: 호리존 스튜디오» 를 같이 싣고 있었습니다(2026-09-22 검토) — 그림과 영상이 다른 배경을 말하면 안 됩니다.
*/
describe("buildCutVideoPrompt — 호리존이 장소를 이깁니다", () => {
  const base = { title: "제품 컷", description: "병을 천천히 돌린다", backgroundName: "카페", plannedSeconds: 4 };

  it("활성 방이 호리존이면 «장소는 첨부한 배경» 줄이 빠지고 호리존 문장만 실린다", () => {
    const studio = addRoomIn(DEFAULT_COMPOSITION, "horizon");
    const made = buildCutVideoPrompt({ ...base, composition: studio.state });
    expect(made.en).not.toContain('attached background "카페"');
    expect(made.ko).not.toContain("«카페» 배경 그대로");
    expect(made.en).toContain("cyclorama");
    expect(made.ko).toContain("호리존 스튜디오");
  });

  it("실내 방이거나 구도가 없으면 장소가 그대로 실린다", () => {
    const indoor = addRoomIn(DEFAULT_COMPOSITION, "indoor");
    const plain = buildCutVideoPrompt({ ...base, composition: indoor.state });
    expect(plain.en).toContain('attached background "카페"');
    expect(plain.en).not.toContain("cyclorama");

    // 「구도 안 씀」 이면 재료의 composition 이 비어 호리존도 없습니다 — 장소가 이깁니다.
    const off = buildCutVideoPrompt(base);
    expect(off.en).toContain('attached background "카페"');
    expect(off.en).not.toContain("cyclorama");
  });
});
