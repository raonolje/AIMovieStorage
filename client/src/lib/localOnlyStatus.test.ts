import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => [{
  id: "ltx25", installed: true, version: "설치 기록 diffusers 0.36",
  weights_ready: false, models_ready: true,
  readiness_evidence: {
    files: { status: "present", loadVerified: false },
    runtime: { source: "installed-distribution-metadata", diffusersVersions: ["0.40.0"], importVerified: false },
  },
}]) }));
vi.mock("./llm", () => ({ isDesktopApp: () => true }));

describe("로컬 모델 증거의 구분", () => {
  it("완료 플래그를 파일 존재 증거로 바꾸지 않는다", async () => {
    const { listLocalEngines } = await import("./localEngines");
    const ltx = (await listLocalEngines()).find(e => e.id === "ltx25")!;
    expect(ltx.prefetchCompleted).toBe(false);
    expect(ltx.weightsReady).toBe(false);
    expect(ltx.readinessEvidence?.files?.status).toBe("present");
    expect(ltx.readinessEvidence?.files?.loadVerified).toBe(false);
    expect(ltx.installationRecordVersion).toContain("0.36");
    expect(ltx.readinessEvidence?.runtime?.diffusersVersions).toEqual(["0.40.0"]);
    expect(ltx.readinessEvidence?.runtime?.importVerified).toBe(false);
  });
});
