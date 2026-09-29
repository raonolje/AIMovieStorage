import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProjectDraft, newCharacter, newScene, newCut, type ProjectDraft } from "@/lib/projectTypes";
import { normalizeComposition } from "./composition";

const state = vi.hoisted(() => ({ projects: new Map<string, { id: string; draft: ProjectDraft }>(), fail: false, beforeWrite: null as (() => void) | null, persistGate: null as Promise<void> | null, loads: vi.fn() }));
vi.mock("@/lib/localProjectStore", () => ({
  loadProjects: async () => { state.loads(); return [...state.projects.values()]; },
  listLocalProjects: () => [...state.projects.values()].map((item) => ({ id: item.id, title: item.draft.title })),
  getLocalProject: (id: string) => state.projects.get(id) ?? null,
  saveLocalProjectAndConfirm: async (draft: ProjectDraft, id: string) => {
    if (state.fail) return { project: { id, draft }, outcome: "error" };
    const project = { id, draft: JSON.parse(JSON.stringify(draft)) as ProjectDraft };
    state.projects.set(id, project);
    return { project, outcome: "written" };
  },
}));
vi.mock("@/lib/projectWrite", () => ({
  readProject: (id: string) => state.projects.get(id)?.draft ?? null,
  writeProjectAndConfirm: async (id: string, update: (current: ProjectDraft) => Partial<ProjectDraft>) => {
    state.beforeWrite?.();
    const item = state.projects.get(id)!;
    item.draft = { ...item.draft, ...update(item.draft) };
    const applied = item.draft;
    if (state.persistGate) await state.persistGate;
    return { draft: applied, persisted: !state.fail, outcome: state.fail ? "error" : "written", why: state.fail ? "파일 저장 실패" : undefined };
  },
}));

beforeEach(() => {
  vi.resetModules();
  state.projects.clear();
  state.fail = false;
  state.beforeWrite = null;
  state.persistGate = null;
  state.loads.mockClear();
  state.projects.set("p", { id: "p", draft: { ...newProjectDraft(), title: "작품" } });
});
const current = () => state.projects.get("p")!.draft;
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("프로젝트 대화 조종", () => {
  it("조종기에서 영상 프롬프트를 직접 고쳐도 앞 컷 대표영상과 끝 프레임의 @태그를 저장한다", async () => {
    const api = await import("./projectControl");
    current().scenes = [{ ...newScene(), id: "scene", cuts: [
      { ...newCut(1), id: "first", videos: [{ id: "movie", name: "앞영상", filePath: "C:/project/앞영상.mp4",
        endFramePath: "C:/project/앞영상_마지막.png", isPrimary: true }] },
      { ...newCut(2), id: "next", cutContinuity: "continue" },
    ] }];
    const first = await api.getProjectSnapshot("p");
    await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "cut.update", sceneId: "scene", id: "next", fields: {
        videoPromptKo: "앞 컷의 행동을 이어간다.", videoPromptEn: "Continue the action.",
      } },
    ] });
    expect(current().scenes[0].cuts[1].videoPromptKo).toContain("앞 컷 연결: 대표영상 @앞영상");
    expect(current().scenes[0].cuts[1].videoPromptEn).toContain("@앞영상_마지막");
  });
  it("공용 시트 배치도와 캐릭터별 이미지 채우기를 앱 저장 형식으로 나눈다", async () => {
    const api = await import("./projectControl");
    current().characters = [{ ...newCharacter(), id: "actor", name: "서아", generatedImages: [
      { id: "portrait", name: "서아_001", thumb: "", file: null, filePath: "C:/project/서아.png" },
    ] }];
    const first = await api.getProjectSnapshot("p");
    const saved = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "sheet.layout.upsert", id: "cast-sheet", name: "전신과 프로필", size: { width: 2048, height: 2048 }, placements: [
        { id: "face", kind: "image", x: 0, y: 0, width: 1024, height: 1024, label: "얼굴" },
        { id: "profile", kind: "profile", x: 1050, y: 0, width: 900, height: 1000 },
      ] },
      { type: "sheet.fill", owner: { kind: "character", id: "actor" }, layoutId: "cast-sheet", fills: { face: "portrait" } },
    ] });
    expect(saved.persisted).toBe(true);
    expect(current().sheetLayouts?.[0]).toMatchObject({ coords: "px", placements: [{ id: "face" }, { id: "profile" }] });
    expect(current().sheetLayouts?.[0].placements[0].imageId).toBeUndefined();
    expect(current().characters[0].sheetFills?.["cast-sheet"]).toEqual({ face: "portrait" });
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: saved.revision, commands: [
      { type: "sheet.fill", owner: { kind: "character", id: "actor" }, layoutId: "cast-sheet", fills: { face: "other" } },
    ] })).rejects.toMatchObject({ code: "invalid_reference" });
  });
  it("저장된 컷 구도의 방과 소품을 라이브러리에 담아 다음 컷에서 재사용한다", async () => {
    const api = await import("./projectControl");
    const composition = { ...normalizeComposition(), rooms: [{ id: "room", name: "방송 무대", kind: "indoor", width: 18, depth: 12, height: 8,
      position: { x: 0, y: 0, z: 0 }, rotation: 0 }], objects: [] };
    current().scenes = [{ ...newScene(), id: "scene", cuts: [{ ...newCut(1), id: "cut", composition }] }];
    const first = await api.getProjectSnapshot("p");
    const saved = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "room_preset.save_from_cut", sceneId: "scene", cutId: "cut", roomId: "room", name: "콘서트 무대", id: "stage" },
    ] });
    expect(saved.persisted).toBe(true);
    expect(current().roomPresets?.[0]).toMatchObject({ id: "stage", name: "콘서트 무대", room: { id: "room" } });
    const removed = await api.updateProjectControl({ projectId: "p", expectedRevision: saved.revision, commands: [
      { type: "room_preset.remove", id: "stage" },
    ] });
    expect(removed.persisted).toBe(true);
    expect(current().roomPresets).toEqual([]);
  });
  it("저장된 그림의 앵커·움직임 구역을 편집해 스토리보드와 배경 요청에 공유한다", async () => {
    const api = await import("./projectControl");
    current().characters = [{ ...newCharacter(), id: "actor", generatedImages: [
      { id: "portrait", name: "서아", thumb: "", file: null, filePath: "C:/project/서아.png" },
    ] }];
    const first = await api.getProjectSnapshot("p");
    const saved = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "image.marks", assetId: "portrait", marks: [
        { id: "stage", shape: "rect", note: "무대 뒤 LED만 움직임", points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }], motion: true },
        { id: "entry", shape: "anchor", note: "서아 진입", points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }] },
      ] },
    ] });
    expect(saved.persisted).toBe(true);
    expect(current().imageMarks?.["C:/project/서아.png"]).toHaveLength(2);
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: saved.revision, commands: [
      { type: "image.marks", assetId: "portrait", marks: [{ id: "bad", shape: "anchor", note: "잘못된 구역", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], motion: true }] },
    ] })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("생성 결과를 정체성 레퍼런스로 연결하고 순서를 조절하며 원본 파일은 보존한다", async () => {
    const api = await import("./projectControl");
    current().characters = [{ ...newCharacter(), id: "actor", name: "서아", generatedImages: [
      { id: "portrait", name: "서아_001", thumb: "", file: null, filePath: "C:/project/서아.png", isPrimary: true },
    ] }];
    const first = await api.getProjectSnapshot("p");
    const linked = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "reference.link", owner: { kind: "character", id: "actor" }, sourceAssetId: "portrait", position: "first", label: "정체성 기준" },
    ] });
    expect(current().characters[0].references[0]).toMatchObject({ filePath: "C:/project/서아.png", sharedFile: true, label: "정체성 기준" });
    const refId = current().characters[0].references[0].id;
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: linked.revision, commands: [
      { type: "reference.link", owner: { kind: "character", id: "actor" }, sourceAssetId: "portrait" },
    ] })).rejects.toMatchObject({ code: "duplicate_reference" });
    const unlinked = await api.updateProjectControl({ projectId: "p", expectedRevision: linked.revision, commands: [
      { type: "reference.unlink", owner: { kind: "character", id: "actor" }, referenceId: refId },
    ] });
    expect(unlinked.persisted).toBe(true);
    expect(current().characters[0].references).toHaveLength(0);
    expect(current().characters[0].generatedImages).toHaveLength(1);
  });
  it("작품의 장르·스타일·시대를 앱 UI와 같은 규칙으로 저장해 다음 프롬프트에 반영한다", async () => {
    const api = await import("./projectControl");
    const first = await api.getProjectSnapshot("p");
    const changed = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "project.update", fields: { genres: ["뮤직비디오"], styles: ["시네마틱 필름"], eras: ["m-modern"] } },
    ] });
    expect(current()).toMatchObject({ genre: "뮤직비디오", style: "시네마틱 필름", genres: ["뮤직비디오"], styles: ["시네마틱 필름"], eras: ["m-modern"] });
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: changed.revision, commands: [
      { type: "project.update", fields: { eras: ["invented-era"] } },
    ] })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("앱과 공유하는 추가 요청문은 수동 수정 후 오래된 판에서 생성되지 않는다", async () => {
    const api = await import("./projectControl");
    const extra = await import("./controlSupplementalPrompt");
    const natural = await import("./controlNaturalPrompt");
    current().characters = [{ ...newCharacter(), id: "actor", name: "서아", description: "무대에서 활발하게 춤춘다" }];
    const before = await api.getProjectSnapshot("p");
    const first = await extra.prepareSupplementalPrompt({ projectId: "p", expectedRevision: before.revision,
      target: { kind: "characterFirstReference", id: "actor" } });
    expect(first.structuredContent.request).toContain("무대에서 활발하게 춤춘다");
    const profile = await extra.prepareSupplementalPrompt({ projectId: "p", expectedRevision: before.revision,
      target: { kind: "characterProfile", id: "actor" } });
    expect(profile.structuredContent.request).toContain("서아");
    const prose = await natural.prepareNaturalPrompt({ projectId: "p", expectedRevision: before.revision,
      target: { kind: "characterDescription", id: "actor" } });
    expect(prose.request).toContain("무대에서 활발하게 춤춘다");
    state.projects.get("p")!.draft = { ...current(), characters: current().characters.map((item) => ({ ...item, description: "수동 수정" })) };
    await expect(extra.prepareSupplementalPrompt({ projectId: "p", expectedRevision: before.revision,
      target: { kind: "characterFirstReference", id: "actor" } })).rejects.toMatchObject({ code: "revision_conflict" });
  });
  it("프로필·분석 이력을 보존하고 컷의 인물 이미지 참조를 현재 프로젝트 안에서만 고른다", async () => {
    const api = await import("./projectControl");
    current().characters = [{ ...newCharacter(), id: "actor", name: "서아", analysis: "예전 특징",
      generatedImages: [{ id: "portrait", name: "서아_001", thumb: "", file: null, filePath: "C:/project/서아.png" }] }];
    current().scenes = [{ ...newScene(), id: "scene", cuts: [{ ...newCut(1), id: "cut", characterIds: ["actor"] }] }];
    const before = await api.getProjectSnapshot("p");
    const updated = await api.updateProjectControl({ projectId: "p", expectedRevision: before.revision, commands: [
      { type: "character.profile", id: "actor", fields: { personality: "무대에서 활발하다" } },
      { type: "character.update", id: "actor", fields: { analysis: "웃을 때 눈꼬리가 올라간다", analysisEn: "Her eyes brighten when she smiles" } },
      { type: "cut.update", sceneId: "scene", id: "cut", fields: { characterRefs: { actor: ["C:/project/서아.png"] }, styleTags: ["cinematic"], techniques: ["acting"] } },
    ] });
    expect(current().characters[0].profile?.personality).toBe("무대에서 활발하다");
    expect(current().characters[0].analysisHistory?.map((item) => item.text)).toEqual(["웃을 때 눈꼬리가 올라간다", "예전 특징"]);
    expect(current().scenes[0].cuts[0].characterRefs).toEqual({ actor: ["C:/project/서아.png"] });
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: updated.revision, commands: [
      { type: "cut.update", sceneId: "scene", id: "cut", fields: { characterRefs: { actor: ["C:/outside.png"] } } },
    ] })).rejects.toMatchObject({ code: "invalid_reference" });
  });
  it("배경 구성 칩을 조종기로 선택·수정하고 알 수 없는 칩은 거부한다", async () => {
    const api = await import("./projectControl");
    const first = await api.getProjectSnapshot("p");
    const added = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "background.add", id: "b1", fields: { name: "골목", blueprint: ["view-eye-exterior"], promptKo: "16:9 골목 화면", promptEn: "16:9 alley composition" } },
    ] });
    expect(current().backgrounds[0].blueprint).toEqual(["view-eye-exterior"]);
    const changed = await api.updateProjectControl({ projectId: "p", expectedRevision: added.revision, commands: [
      { type: "background.update", id: "b1", fields: { blueprint: ["master-birdseye"] } },
    ] });
    expect(current().backgrounds[0].blueprint).toEqual(["master-birdseye"]);
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: changed.revision, commands: [
      { type: "background.update", id: "b1", fields: { blueprint: ["nonexistent-chip"] } },
    ] })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("장소 프롬프트도 인물·컷처럼 한글과 영문을 함께 저장한다", async () => {
    const api = await import("./projectControl");
    const first = await api.getProjectSnapshot("p");
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "background.add", id: "b1", fields: { name: "골목", promptEn: "A rainy alley" } },
    ] })).rejects.toMatchObject({ code: "bilingual_prompt_required" });
    const added = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "background.add", id: "b1", fields: { name: "골목", promptKo: "비 내리는 골목", promptEn: "A rainy alley" } },
    ] });
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: added.revision, commands: [
      { type: "background.update", id: "b1", fields: { promptKo: "Rainy alley in Seoul", promptEn: "A rainy alley in Seoul" } },
    ] })).rejects.toMatchObject({ code: "korean_prompt_required" });
    expect(current().backgrounds[0].promptKo).toBe("비 내리는 골목");
  });
  it("선택한 이미지·영상 모델을 앱 카드와 프로젝트 설정에 저장한다", async () => {
    const api = await import("./projectControl");
    current().characters = [{ ...newCharacter(), id: "c1", name: "서아" }];
    const first = await api.getProjectSnapshot("p");
    const result = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "project.update", fields: { videoModel: "seedance-2.5" } },
      { type: "character.update", id: "c1", fields: { promptModel: "gpt-image" } },
      { type: "background.add", id: "b1", fields: { name: "무대", promptModel: "nano-banana" } },
    ] });
    expect(result.persisted).toBe(true);
    expect(current().magnific?.videoModel).toBe("seedance-2.5");
    expect(current().characters[0].promptModel).toBe("gpt-image");
    expect(current().backgrounds[0].promptModel).toBe("nano-banana");
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: result.revision, commands: [
      { type: "character.update", id: "c1", fields: { promptModel: "unknown-image" } },
    ] })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("앱 요청문으로 받은 답을 조종기로 적용하면 이전 판과 새 판을 같은 이력에 남긴다", async () => {
    const api = await import("./projectControl");
    current().characters = [{ ...newCharacter(), id: "c1", name: "서진우", promptKo: "기존 한글 프롬프트", promptEn: "previous English prompt" }];
    const first = await api.getProjectSnapshot("p");
    await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{
      type: "prompt.apply", target: { kind: "character", id: "c1" },
      result: { ko: "새로운 한국어 인물 시트", en: "A new English character sheet", negativeKo: "오류 없음", negativeEn: "no defects" },
    }] });
    const character = current().characters[0];
    expect(character.promptKo).toContain("새로운 한국어 인물 시트");
    expect(character.promptHistory?.[0].ko).toContain("새로운 한국어 인물 시트");
    expect(character.promptHistory?.[1].ko).toBe("기존 한글 프롬프트");
    const latest = await api.getProjectSnapshot("p", "summary");
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: latest.revision, commands: [{
      type: "prompt.apply", target: { kind: "character", id: "c1" },
      result: { ko: "새로운 한국어 인물 시트", en: "A new English character sheet",
        negativeKo: "plastic skin, broken hands", negativeEn: "plastic skin, broken hands" },
    }] })).rejects.toMatchObject({ code: "korean_prompt_required" });
    expect(current().characters[0].negativeKo).toBe("오류 없음");
  });

  it("씬을 다시 요청해도 스토리보드 프롬프트 이력이 남는다", async () => {
    const api = await import("./projectControl");
    current().scenes = [{ ...newScene(), id: "s1", storyboardPromptKo: "오래된 한국어 장면", storyboardPromptEn: "Old English scene", cuts: [] }];
    const first = await api.getProjectSnapshot("p");
    await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{
      type: "prompt.apply", target: { kind: "sceneVideo", sceneId: "s1" },
      result: { ko: "새로운 한국어 장면", en: "A new English scene", negativeKo: "", negativeEn: "" },
    }] });
    expect(current().scenes[0].storyboardPromptHistory?.map((entry) => entry.ko)).toEqual([
      "새로운 한국어 장면", "오래된 한국어 장면",
    ]);
  });
  it("새 컷에 인물 목록이 빠지면 얼굴 참조 없이 저장하지 않는다", async () => {
    const api = await import("./projectControl");
    current().scenes = [{ ...newScene(), id: "s1", cuts: [] }];
    const first = await api.getProjectSnapshot("p");
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "cut.add", sceneId: "s1", fields: { title: "서진우가 들어온다" } },
    ] })).rejects.toMatchObject({ code: "invalid_request" });
    expect(current().scenes[0].cuts).toEqual([]);
  });

  it("조종기가 인물 ID와 프롬프트를 함께 보내면 대표 시트 @참조까지 저장한다", async () => {
    const api = await import("./projectControl");
    current().characters = [{ ...newCharacter(), id: "c1", name: "서진우", generatedImages: [{
      id: "g1", name: "서진우_001", thumb: "", file: null, filePath: "C:/작품/서진우_001.png", isPrimary: true,
    }] }];
    current().scenes = [{ ...newScene(), id: "s1", cuts: [] }];
    const first = await api.getProjectSnapshot("p");
    await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "cut.add", sceneId: "s1", fields: { characterIds: ["c1"], promptKo: "서진우가 명단을 연다", promptEn: "Seo Jinwoo opens the list", videoPromptKo: "서진우가 카메라를 본다", videoPromptEn: "Seo Jinwoo turns to camera" } },
    ] });
    const cut = current().scenes[0].cuts[0];
    expect(cut.characterIds).toEqual(["c1"]);
    expect(cut.promptEn).toContain("@서진우_001");
    expect(cut.promptKo).toContain("@서진우_001");
    expect(cut.videoPromptEn).toContain("@서진우_001");
    expect(cut.videoPromptKo).toContain("@서진우_001");
  });

  it("조종기가 영문만 보낸 새 컷과 기존 컷을 거절하고 한글 보완은 허용한다", async () => {
    const api = await import("./projectControl");
    current().scenes = [{ ...newScene(), id: "s1", cuts: [{ ...newCut(1), id: "k1", promptEn: "A close-up" }] }];
    const first = await api.getProjectSnapshot("p");
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "cut.add", sceneId: "s1", fields: { characterIds: [], promptEn: "A wide shot" } },
    ] })).rejects.toMatchObject({ code: "bilingual_prompt_required" });
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "cut.update", sceneId: "s1", id: "k1", fields: { promptEn: "A new close-up" } },
    ] })).rejects.toMatchObject({ code: "bilingual_prompt_required" });
    await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "cut.update", sceneId: "s1", id: "k1", fields: { promptKo: "인물 클로즈업" } },
    ] });
    expect(current().scenes[0].cuts[0].promptKo).toBe("인물 클로즈업");
  });

  it("조종기가 한글 칸에 영문 본문을 넣으면 장면·컷에서 거절한다", async () => {
    const api = await import("./projectControl");
    current().scenes = [{ ...newScene(), id: "s1", cuts: [] }];
    const first = await api.getProjectSnapshot("p");
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "scene.update", id: "s1", fields: { storyboardPromptKo: "Korean theatrical political thriller. 인물 서진우.", storyboardPromptEn: "A political thriller" } },
    ] })).rejects.toMatchObject({ code: "korean_prompt_required" });
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "cut.add", sceneId: "s1", fields: { characterIds: [], promptKo: "A wide shot of 서울 at night", promptEn: "A wide shot of Seoul at night" } },
    ] })).rejects.toMatchObject({ code: "korean_prompt_required" });
    expect(current().scenes[0].cuts).toEqual([]);
    await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "scene.update", id: "s1", fields: { storyboardPromptKo: "서울의 밤거리를 따라 카메라가 이동한다.", storyboardPromptEn: "The camera moves along a street in Seoul at night." } },
    ] });
    expect(current().scenes[0].storyboardPromptKo).toContain("서울의 밤거리");
  });

  it("조종기가 만든 캐릭터는 한글·영문과 선택한 레퍼런스 시트 칸을 함께 저장한다", async () => {
    const api = await import("./projectControl");
    const first = await api.getProjectSnapshot("p");
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "character.add", id: "c1", fields: { name: "아이샤", promptEn: "Aisha in a teal blazer" } },
    ] })).rejects.toMatchObject({ code: "bilingual_prompt_required" });
    const saved = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "character.add", id: "c1", fields: { name: "아이샤", promptKo: "청록색 재킷을 입은 아이샤", promptEn: "Aisha in a teal blazer", blueprint: ["body-front", "face-front", "face-eyes"] } },
    ] });
    const character = current().characters[0];
    expect(character.blueprint).toEqual(["body-front", "face-front", "face-eyes"]);
    expect(character.promptKo).toContain("캐릭터 레퍼런스 구성: 3칸");
    expect(character.promptKo).toContain("눈·시선");
    expect(character.promptEn).toContain("Character reference blueprint: 3 panels");
    expect(character.promptEn).toContain("eye shape");
    await api.updateProjectControl({ projectId: "p", expectedRevision: saved.revision, commands: [
      { type: "character.update", id: "c1", fields: { blueprint: ["body-front", "body-back"] } },
    ] });
    expect(current().characters[0].promptEn).toContain("Character reference blueprint: 2 panels");
    expect(current().characters[0].promptEn).not.toContain("eye shape");
  });

  it("5인 긴 구도는 요약 조회·수정에서 키를 줄이되 원본 키와 전체 리비전 검사를 유지한다", async () => {
    const api = await import("./projectControl");
    const composition = normalizeComposition();
    composition.motionTracks = Array.from({ length: 5 }, (_, person) => ({ id: `track-${person}`, targetId: `actor-${person}`, channel: "pose" as const,
      keys: Array.from({ length: 1983 }, (_, frame) => ({ id: `key-${person}-${frame}`, time: frame / 30, value: { x: 0, y: 0, z: 0 } })) }));
    current().characters = Array.from({ length: 5 }, (_, person) => ({ ...newCharacter(), id: `actor-${person}`, name: `인물 ${person}` }));
    current().scenes = [{ ...newScene(), id: "s", cuts: [{ ...newCut(1), id: "k", composition, guideImage: `data:image/png;base64,${"A".repeat(100_000)}` }] }];
    const first = await api.getProjectSnapshot("p", "summary");
    expect(first.draft.characters.map(actor => actor.id)).toEqual(current().characters.map(actor => actor.id));
    expect(first.draft.scenes[0]).toMatchObject({ id: "s", cuts: [{ id: "k", guideImage: "" }] });
    expect(first.draft.scenes[0].cuts[0].composition?.motionTracks).toHaveLength(5);
    expect(first.draft.scenes[0].cuts[0].composition?.motionTracks?.[0]).toMatchObject({ keys: [], keyCount: 1983, keyTimeRange: [0, 1982 / 30] });
    expect(first.projection.truncated).toBe(true);
    expect(JSON.stringify(first).length).toBeLessThan(50_000);
    const changed = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "cut.update", sceneId: "s", id: "k", fields: { promptKo: "새 프롬프트", promptEn: "new prompt" } }] });
    expect(changed.projection.detail).toBe("summary");
    expect(current().scenes[0].cuts[0].composition?.motionTracks?.[0].keys).toHaveLength(1983);
    // 실제 구도·컷 저장처럼 바뀐 경로를 새 객체로 올립니다. 이전 판의 모캡은 불변입니다.
    state.projects.get("p")!.draft = { ...current(), scenes: current().scenes.map(scene => ({ ...scene, cuts: scene.cuts.map(cut => ({ ...cut,
      composition: { ...cut.composition!, motionTracks: cut.composition!.motionTracks!.map((track, index) => index !== 4 ? track : { ...track,
        keys: track.keys.map((key, index) => index !== 1982 ? key : { ...key, value: { ...key.value, x: 7 } }) }) },
    })) })) };
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: changed.revision, commands: [{ type: "project.update", fields: { title: "오래된 요청" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: "previous-session" });
    expect(changes.fullSnapshotRequired).toBe(true);
    expect(changes.snapshot?.projection.detail).toBe("summary");
    expect(JSON.stringify(changes).length).toBeLessThan(50_000);
    const full = await api.getProjectSnapshot("p", "full");
    expect(full.draft.scenes[0].cuts[0].composition?.motionTracks?.[4].keys[1982].value.x).toBe(7);
    expect(full.revision).toBe(changes.revision);
  });

  it.each([false, true])("저장 중 수동 수정과 조회 뒤에는 과거 적용판으로 변경 이력을 되감지 않는다 (저장 실패: %s)", async (fail) => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    const wait = gate(); state.persistGate = wait.promise;
    let completed = false;
    const writing = api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { title: "조종기가 바꾼 제목" } }] });
    const result = writing.then((value) => { completed = true; return { value }; }, (error: unknown) => { completed = true; return { error }; });
    await tick();
    state.projects.get("p")!.draft = { ...current(), logline: "사람이 쓴 줄거리" };
    const during = await api.getProjectSnapshot("p");
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(changes.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/title", before: "작품", after: "조종기가 바꾼 제목", source: "controller" }),
      expect.objectContaining({ path: "/logline", after: "사람이 쓴 줄거리", source: "app" }),
    ]));
    expect(completed).toBe(false);
    state.fail = fail; wait.resolve();
    const settled = await result;
    if (fail) expect(settled).toMatchObject({ error: { code: "save_failed", details: { applied: true } } });
    else expect(settled).toMatchObject({ value: { persisted: true, revision: during.revision, draft: { logline: "사람이 쓴 줄거리" } } });
    expect(await api.getProjectChanges({ projectId: "p", sinceRevision: during.revision })).toMatchObject({ revision: during.revision, changes: [] });
  });

  it("조종기 적용 뒤 같은 칸을 수동으로 덮었으면 최종 순변경의 주체는 앱이다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    const wait = gate(); state.persistGate = wait.promise;
    const writing = api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { title: "중간 제목" } }] });
    await tick();
    state.projects.get("p")!.draft = { ...current(), title: "사람의 최종 제목" };
    const during = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(during.changes).toEqual([expect.objectContaining({ path: "/title", before: "작품", after: "사람의 최종 제목", source: "app" })]);
    wait.resolve(); await writing;
    expect(await api.getProjectChanges({ projectId: "p", sinceRevision: during.revision })).toMatchObject({ changes: [] });
  });

  it("사람의 수정은 다음 조회의 새 revision과 변경 경로로 보인다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    current().logline = "사람이 고친 줄거리";
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(changes.revision).not.toBe(first.revision);
    expect(changes.fullSnapshotRequired).toBe(false);
    expect(changes.changes).toContainEqual(expect.objectContaining({ source: "app", path: "/logline", before: null, after: "사람이 고친 줄거리" }));
    expect(state.loads).toHaveBeenCalledTimes(1);
  });

  it("오래된 상태를 읽은 조종기는 사람의 변경을 덮지 못한다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    current().logline = "사람의 결정";
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { logline: "오래된 결정" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
    expect(current().logline).toBe("사람의 결정");
  });

  it("같은 묶음에서 만든 인물과 장소를 새 컷에서 안정된 ID로 참조한다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    const result = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "character.add", id: "c1", fields: { name: "주인공", promptKo: "여행자", promptEn: "a traveler" } },
      { type: "background.add", id: "b1", fields: { name: "숲" } },
      { type: "scene.add", id: "s1", fields: { title: "등장" } },
      { type: "cut.add", id: "k1", sceneId: "s1", fields: { title: "걸어온다", characterIds: ["c1"], backgroundId: "b1", promptKo: "숲 속을 걷는 여행자", promptEn: "A traveler walks through a forest" } },
    ] });
    expect(result.persisted).toBe(true);
    expect(current().characters[0]).toMatchObject({ id: "c1", generatedImages: [] });
    expect(current().characters[0].promptEn).toContain("a traveler");
    expect(current().scenes[0].cuts).toHaveLength(1);
    expect(current().scenes[0].cuts[0]).toMatchObject({ id: "k1", characterIds: ["c1"], backgroundId: "b1" });
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(changes.changes.every((item) => item.source === "controller")).toBe(true);
  });

  it("장면과 컷의 순서를 바꾸면 컷 번호를 다시 매기고 내용과 미디어를 보존한다", async () => {
    const api = await import("@/lib/projectControl");
    const firstCut = { ...newCut(1), id: "k1", title: "첫 컷", videos: [{ id: "v1", name: "영상", filePath: "p/video.mp4", createdAt: "now" }] };
    current().scenes = [
      { ...newScene(), id: "s1", title: "첫 장면", cuts: [firstCut, { ...newCut(2), id: "k2", title: "둘째 컷" }] },
      { ...newScene(), id: "s2", title: "둘째 장면", cuts: [] },
    ];
    const first = await api.getProjectSnapshot("p");
    const result = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "scene.move", id: "s2", position: 0 },
      { type: "cut.move", sceneId: "s1", id: "k2", position: 0 },
    ] });
    expect(result.persisted).toBe(true);
    expect(current().scenes.map((scene) => scene.id)).toEqual(["s2", "s1"]);
    expect(current().scenes[1].cuts.map((cut) => [cut.id, cut.order])).toEqual([["k2", 1], ["k1", 2]]);
    expect(current().scenes[1].cuts[1].videos).toEqual(firstCut.videos);
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: result.revision, commands: [
      { type: "cut.move", sceneId: "s1", id: "k1", position: 2 },
    ] })).rejects.toMatchObject({ code: "invalid_position" });
  });

  it("ID를 생략해도 새 카드 ID를 반환하고 다음 편집에 그대로 쓴다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    const made = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "character.add", fields: { name: "주인공" } }] });
    const id = made.created[0].id;
    expect(id).toBeTruthy();
    await api.updateProjectControl({ projectId: "p", expectedRevision: made.revision, commands: [{ type: "character.update", id, fields: { description: "조용한 여행자" } }] });
    expect(current().characters).toHaveLength(1);
    expect(current().characters[0].description).toBe("조용한 여행자");
  });

  it("잘못된 참조가 묶음 뒤에 있으면 앞의 변경도 적용하지 않는다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "scene.add", id: "s1", fields: { title: "새 장면" } },
      { type: "cut.add", id: "k1", sceneId: "s1", fields: { characterIds: ["없는 인물"] } },
    ] })).rejects.toMatchObject({ code: "invalid_reference" });
    expect(current().scenes).toHaveLength(0);
  });

  it("적용 직전 수동 변경도 React 계산 중 예외 없이 보존한다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    state.beforeWrite = () => { current().logline = "직전 수정"; };
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { title: "조종기 제목" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
    expect(current().title).toBe("작품");
    expect(current().logline).toBe("직전 수정");
  });

  it("저장 실패는 적용과 구분해 반환하고 전체 성공으로 알리지 않는다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    state.fail = true;
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { title: "변경" } }] })).rejects.toMatchObject({ code: "save_failed", details: { applied: true } });
  });

  it("모르는 revision이면 전체 상태가 필요하다고 알린다", async () => {
    const api = await import("@/lib/projectControl");
    expect(await api.getProjectChanges({ projectId: "p", sinceRevision: "이전 앱 세션" })).toMatchObject({ fullSnapshotRequired: true, snapshot: { draft: { title: "작품" } } });
  });

  it("같은 생성 요청을 다시 보내도 새 프로젝트를 만들지 않는다", async () => {
    const api = await import("@/lib/projectControl");
    const input = { title: "새 작품", synopsis: "여행", operationId: "create-once" };
    const first = await api.createProjectControl(input);
    const repeated = await api.createProjectControl(input);
    expect(repeated.projectId).toBe(first.projectId);
    expect(repeated.reused).toBe(true);
    expect(state.projects.size).toBe(2);
    await expect(api.createProjectControl({ ...input, title: "다른 작품" })).rejects.toMatchObject({ code: "operation_conflict" });
  });

  it("인물 ID로 된 변경 경로는 배열 순서와 관계없이 유지된다", async () => {
    const api = await import("@/lib/projectControl");
    current().characters = [{ ...newCharacter(), id: "c1", name: "처음" }, { ...newCharacter(), id: "c2", name: "둘째" }];
    const first = await api.getProjectSnapshot("p");
    state.projects.get("p")!.draft = { ...current(), characters: [...current().characters].reverse().map(item =>
      item.id === "c1" ? { ...item, description: "수동 편집" } : item) };
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(changes.changes).toContainEqual(expect.objectContaining({ path: "/characters/c1/description", after: "수동 편집" }));
  });

  it("프로젝트 열기는 등록된 앱 라우터를 쓴다", async () => {
    const api = await import("@/lib/projectControl");
    const navigate = vi.fn();
    const off = api.registerProjectNavigation(navigate);
    expect(await api.openProjectControl("p")).toMatchObject({ opened: true });
    expect(navigate).toHaveBeenCalledWith("p");
    off();
    await expect(api.openProjectControl("p")).rejects.toMatchObject({ code: "navigation_unavailable" });
  });

  it("기존 미디어·구도는 텍스트 변경으로 사라지지 않는다", async () => {
    const api = await import("@/lib/projectControl");
    const cut = { ...newCut(1), id: "k", guideImagePath: "p/guide.png", videos: [{ id: "v", name: "영상", filePath: "p/video.mp4", createdAt: "now" }] };
    current().scenes = [{ ...newScene(), id: "s", cuts: [cut] }];
    const first = await api.getProjectSnapshot("p");
    await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "cut.update", sceneId: "s", id: "k", fields: { promptKo: "새 프롬프트", promptEn: "new prompt" } }] });
    expect(current().scenes[0].cuts[0]).toMatchObject({ guideImagePath: "p/guide.png", videos: cut.videos, promptEn: "new prompt" });
  });

  it("5인 공유 모캡은 요약 조회·텍스트 편집·변경 대기에서 관절값을 다시 복제하거나 읽지 않는다", async () => {
    const api = await import("./projectControl");
    let keyReads = 0;
    const keys = Array.from({ length: 1936 }, (_, frame) => ({ id: `key-${frame}`, time: frame / 30,
      get value() { keyReads += 1; return { x: frame, y: 0, z: 0 }; },
      bones: Object.fromEntries(Array.from({ length: 60 }, (_, bone) => [`bone-${bone}`, { x: .1, y: .2, z: .3 }])),
    }));
    const composition = { ...normalizeComposition(), motionTracks: Array.from({ length: 5 }, (_, actor) => ({
      id: `track-${actor}`, targetId: `actor-${actor}`, channel: "pose" as const, keys,
    })) };
    current().scenes = [{ ...newScene(), id: "s", cuts: [{ ...newCut(1), id: "k", composition }] }];
    const first = await api.getProjectSnapshot("p", "summary");
    const again = await api.getProjectSnapshot("p", "summary");
    expect(again.revision).toBe(first.revision);
    const updated = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision,
      commands: [{ type: "cut.update", sceneId: "s", id: "k", fields: { promptKo: "카메라 프롬프트 수정", promptEn: "Camera prompt edit" } }] });
    expect(current().scenes[0].cuts[0].composition).toBe(composition);
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(changes.changes).toContainEqual(expect.objectContaining({ path: "/scenes/s/cuts/k/promptKo", after: "카메라 프롬프트 수정", source: "controller" }));
    expect(changes.changes).toContainEqual(expect.objectContaining({ path: "/scenes/s/cuts/k/promptEn", after: "Camera prompt edit", source: "controller" }));
    expect(await api.getProjectChanges({ projectId: "p", sinceRevision: updated.revision })).toMatchObject({ changes: [] });
    expect(keyReads).toBe(0);
    // 조종기 응답을 수정해도 앱 상태와 다음 리비전은 오염되지 않습니다.
    updated.draft.title = "호출자가 응답 사본을 수정";
    expect(current().title).toBe("작품");
    expect((await api.getProjectSnapshot("p", "summary")).revision).toBe(updated.revision);
  });

  it("새 root와 컷 경로를 반환하는 실제 편집 형태의 변경은 공유 모캡을 보존하며 오래된 요청을 막는다", async () => {
    const api = await import("./projectControl");
    const { cutCompositionPatch } = await import("./cutCompositionSave");
    const composition = normalizeComposition();
    current().scenes = [{ ...newScene(), id: "s", cuts: [{ ...newCut(1), id: "k", composition }] }];
    const first = await api.getProjectSnapshot("p", "summary");
    const moved = { ...composition, camera: { ...composition.camera, fovDegrees: 42 } };
    const before = current();
    state.projects.get("p")!.draft = { ...before, ...cutCompositionPatch(before, "k", moved) };
    expect(before.scenes[0].cuts[0].composition).toBe(composition);
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(changes.changes).toContainEqual(expect.objectContaining({ path: "/scenes/s/cuts/k/composition/camera/fovDegrees", after: 42, source: "app" }));
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { title: "낡은 요청" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
  });

  it("한 판의 변경 로그 크기와 64판의 이력 한도를 넘으면 전체 재조회를 요구한다", async () => {
    const api = await import("./projectControl");
    current().characters = Array.from({ length: 40 }, (_, index) => ({ ...newCharacter(), id: `c${index}`, name: `인물${index}`, description: "a".repeat(3000) }));
    const first = await api.getProjectSnapshot("p", "summary");
    state.projects.get("p")!.draft = { ...current(), characters: current().characters.map(item => ({ ...item, description: "b".repeat(3000) })) };
    const large = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(large).toMatchObject({ fullSnapshotRequired: true, changes: [], snapshot: { projection: { detail: "summary" } } });
    for (let index = 0; index < 65; index += 1) {
      state.projects.get("p")!.draft = { ...current(), title: `제목${index}` };
      await api.getProjectSnapshot("p", "summary");
    }
    expect(await api.getProjectChanges({ projectId: "p", sinceRevision: large.revision })).toMatchObject({ fullSnapshotRequired: true });
  });
});
