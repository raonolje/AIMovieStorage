import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { newCharacter, newCut, newProjectDraft, newScene, type ProjectDraft } from "./projectTypes";

const state = vi.hoisted(() => ({ draft: null as ProjectDraft | null }));
vi.mock("./projectControl", () => ({
  appPromptTargetSchema: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("character"), id: z.string() }),
    z.object({ kind: z.literal("background"), id: z.string() }),
    z.object({ kind: z.literal("sceneVideo"), sceneId: z.string() }),
    z.object({ kind: z.literal("cutImage"), sceneId: z.string(), cutId: z.string() }),
    z.object({ kind: z.literal("cutVideo"), sceneId: z.string(), cutId: z.string() }),
  ]),
  ProjectControlError: class ProjectControlError extends Error { constructor(public code: string, message: string) { super(message); } },
  getProjectSnapshot: async () => ({ revision: "current-revision" }),
}));
vi.mock("./projectWrite", () => ({ readProject: () => state.draft }));

describe("조종기의 전 프로젝트 프롬프트 점검", () => {
  it("인물·씬·컷 그림과 영상을 서로 다른 칸으로 세고 다음 페이지를 알려준다", async () => {
    state.draft = { ...newProjectDraft(), characters: [{ ...newCharacter(), id: "actor", name: "서아",
      promptKo: "한국어 묘사", promptEn: "English description", promptHistory: [{ ko: "한국어 묘사", en: "English description", note: "API · 프롬프트 작성" }] }],
      scenes: [{ ...newScene(), id: "scene", title: "무대", cuts: [{ ...newCut(1), id: "cut", promptKo: "", promptEn: "",
        videoPromptKo: "움직이는 무대", videoPromptEn: "Moving stage" }] }] };
    const { getProjectPromptStatus } = await import("./controlPromptStatus");
    const first = await getProjectPromptStatus({ projectId: "p", limit: 2 });
    expect(first).toMatchObject({ revision: "current-revision", total: 4, nextOffset: 2 });
    expect(first.prompts.map((item) => item.target.kind)).toEqual(["character", "sceneVideo"]);
    expect(first.prompts[0]).toMatchObject({ ko: true, en: true, historyCount: 1 });
    expect(first.prompts[1]).toMatchObject({ ready: false });
    const second = await getProjectPromptStatus({ projectId: "p", offset: 2, limit: 2, missingOnly: true });
    expect(second).toMatchObject({ total: 1, nextOffset: null, prompts: [] });
    const missing = await getProjectPromptStatus({ projectId: "p", missingOnly: true });
    expect(missing.prompts.map((item) => item.target.kind)).toEqual(["cutImage"]);
  });

  it("예전 컷 프롬프트는 목록에서 요약하고 지정한 판만 본문을 읽는다", async () => {
    state.draft = { ...newProjectDraft(), scenes: [{ ...newScene(), id: "s", cuts: [{ ...newCut(1), id: "k",
      promptHistory: [{ id: "old", createdAt: 1, ko: "이전 한국어", en: "Old English",
        negativeKo: "왜곡 없음", negativeEn: "no distortion", note: "첫 시도" }] }] }] };
    const { getProjectPromptHistory } = await import("./controlPromptStatus");
    const target = { kind: "cutImage", sceneId: "s", cutId: "k" };
    const listing = await getProjectPromptHistory({ projectId: "p", target });
    expect(listing).toMatchObject({ total: 1, entries: [{ id: "old", koChars: 6, note: "첫 시도" }] });
    expect(JSON.stringify(listing)).not.toContain("Old English");
    const full = await getProjectPromptHistory({ projectId: "p", target, entryId: "old" });
    expect(full).toMatchObject({ entry: { ko: "이전 한국어", en: "Old English", negativeKo: "왜곡 없음" } });
  });
});
