import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import StepFinish from "./StepFinish";
import { newCut, newProjectDraft, newScene } from "@/lib/projectTypes";
import { setLocale, type Locale } from "@/lib/i18n";

vi.mock("@/lib/batchRun", () => ({
  charactersToGenerate: () => [{}], cutsToGenerate: () => [], scenesToGenerate: () => [],
  startProjectGeneration: vi.fn(),
}));
vi.mock("@/lib/taskQueue", () => ({ useTaskQueue: () => [], stopProjectTasks: vi.fn() }));
vi.mock("@/components/project/SheetPreview", () => ({ default: () => null }));
afterEach(() => setLocale("ko"));

describe("확인 단계의 고정 문구와 사용자 이름", () => {
  it.each([
    ["en", "Generate now", "Import video", "1 shot videos"],
    ["ja", "今すぐ生成", "動画を読み込む", "カット動画1件"],
    ["zh", "立即生成", "导入视频", "1 个镜头视频"],
  ] as const)("%s에서도 장면명·영상명은 번역하지 않습니다", (locale, generate, upload, count) => {
    setLocale(locale as Locale);
    const draft = newProjectDraft();
    const scene = newScene();
    // 사전에도 있는 단어를 이름으로 씁니다. 사용자 문자열에 t()를 붙이면 이 검증이 깨집니다.
    scene.title = "저장";
    scene.videos = [{ id: "scene-video", name: "폴더 열기", filePath: "" }];
    const cut = newCut(1);
    cut.videos = [{ id: "cut-video", name: "계속 편집", filePath: "" }];
    scene.cuts = [cut];
    draft.scenes = [scene];
    const html = renderToStaticMarkup(createElement(StepFinish, { draft, projectId: "test", onChange: () => {} }));
    expect(html).toContain(generate);
    expect(html).toContain(upload);
    expect(html).toContain(count);
    expect(html).toContain("1. 저장");
    expect(html).toContain(">폴더 열기</p>");
    expect(html).toContain(">계속 편집</span>");
    expect(html).not.toContain("아직 시트를 굽지 않았습니다");
    expect(html).not.toContain("남은 일");
  });
});
