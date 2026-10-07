import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COMFY_WORKFLOW_TUTORIAL, RETIRED_DIRECT_GENERATION_ANCHORS } from "./comfy";
import { TUTORIALS, allSteps, stepAdvanceMode, tutorialsFor } from "./index";
import en from "@/locales/en.json";
import ja from "@/locales/ja.json";
import zh from "@/locales/zh.json";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import TutorialMenu from "@/components/tutorial/TutorialMenu";

describe("Comfy workflow user tutorial", () => {
  it("renders the existing tutorial menu in an isolated settings SSR view", () => {
    const html = renderToStaticMarkup(React.createElement(Router, { ssrPath: "/settings", children: React.createElement(TutorialMenu) }));
    expect(html).toContain("튜토리얼");
    expect(html).toContain('aria-expanded="false"');
  });
  it("is visible through the existing menu on settings, cards, cuts and BGM", () => {
    expect(TUTORIALS).toContain(COMFY_WORKFLOW_TUTORIAL);
    for (const page of ["settings", "basics", "characters", "scenes", "finish", "bgm"] as const)
      expect(tutorialsFor(page)).toContain(COMFY_WORKFLOW_TUTORIAL);
    expect(COMFY_WORKFLOW_TUTORIAL.steps).toHaveLength(15);
  });
  it("does not require generation, installation or an unreachable legacy button", () => {
    for (const step of COMFY_WORKFLOW_TUTORIAL.steps) expect(stepAdvanceMode(step)).toBe("manual");
    for (const anchor of RETIRED_DIRECT_GENERATION_ANCHORS)
      expect(allSteps().some(step => step.anchor === anchor || step.until === anchor)).toBe(false);
    const prose = allSteps().flatMap(step => [step.body, step.action, step.why]).join("\n");
    for (const retired of ["«로컬로 뽑기»", "검증된 Ref2VA Turbo · 4회", "로컬 영상은 그린 뒤 자동으로 물립니다"])
      expect(prose).not.toContain(retired);
    expect(prose).toContain("그림에 그린 화살표는 명시적 pose/depth/camera 조건이나 실제 카메라 경로 데이터와 다릅니다");
  });
  it("uses the actual V6 import and input button labels", () => {
    const library = readFileSync(new URL("../components/WorkflowLibraryPanel.tsx", import.meta.url), "utf8");
    const generate = readFileSync(new URL("../components/ComfyGenerateButton.tsx", import.meta.url), "utf8");
    const text = COMFY_WORKFLOW_TUTORIAL.steps.map(step => step.body).join("\n");
    for (const label of ["등록 entry / INDEX.json 파일 가져오기", "API JSON 고르기", "초안 검사·라이브러리 등록"])
      expect(library).toContain(label);
    for (const label of ["등록 entry / INDEX.json 파일 가져오기", "API JSON 고르기", "초안 검사·라이브러리 등록", "입력 저장", "컴피로 뽑기"])
      expect(text).toContain(label);
    expect(generate).toContain("입력 저장");
    expect(generate).toContain("컴피로 뽑기");
  });
  it("targets the existing visible workflow section", () => {
    const settings = readFileSync(new URL("../pages/SettingsPage.tsx", import.meta.url), "utf8");
    expect(settings).toContain('anchor="settings-comfy-generation"');
    expect(COMFY_WORKFLOW_TUTORIAL.steps.every(step => step.anchor === "settings-comfy-generation")).toBe(true);
  });
  it("separates candidate/contract support from actual execution and quality", () => {
    const text = COMFY_WORKFLOW_TUTORIAL.steps.map(step => step.body).join("\n");
    for (const marker of ["27후보·35등록", "exact Music3", "0회", "maskVideo", "혼합 모델", "custom TTS/SDNQ", "입출력 schema fingerprint", "같은 버전"])
      expect(text).toContain(marker);
    expect(text).toContain("대기 중지 (서버 작업 유지)");
    expect(text).toContain("Suno");
    expect(text).toContain("[end] 1회");
    expect(text).toContain("HF/Civitai 토큰");
    expect(text).toContain("수동 문장은 유지");
  });
  it("has complete translated text and preserves path/entry identifiers", () => {
    const keys = [COMFY_WORKFLOW_TUTORIAL.title, COMFY_WORKFLOW_TUTORIAL.summary,
      ...COMFY_WORKFLOW_TUTORIAL.steps.flatMap(step => [step.title, step.body, step.action!])];
    for (const dict of [en, ja, zh] as Record<string, string>[])
      for (const key of keys) expect(dict[key]?.trim(), key).toBeTruthy();
    const text = COMFY_WORKFLOW_TUTORIAL.steps.map(step => step.body).join("\n");
    expect(text).toContain("Workflows\\ComfyUI\\INDEX.json");
    expect(text).toContain("app-registration-entry.json");
    expect(text).toContain("workflow.api.json");
    expect(text).toContain("nodes/links JSON");
  });
});
