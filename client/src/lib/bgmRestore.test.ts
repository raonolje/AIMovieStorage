import { describe, expect, it } from "vitest";
import { createBgmProject, createBgmTrack } from "./bgmProjects";
import { reconcileBgmDeletedFolders } from "./bgmRestore";

describe("BGM 폴더 재읽기", () => {
  it("삭제된 곡 폴더의 프로젝트는 걷고, 파일이 아직 없는 기획 프로젝트는 남긴다", () => {
    const gone = { ...createBgmProject("TEST"), id: "gone", tracks: [
      { ...createBgmTrack(), resultPaths: ["D:\\storage\\BGM\\곡\\TEST\\TEST_곡_001.wav"] },
    ] };
    const draft = { ...createBgmProject("기획 중"), id: "draft" };
    const present = { ...createBgmProject("현재"), id: "present", tracks: [
      { ...createBgmTrack(), resultPaths: ["D:/storage/BGM/곡/현재/현재_곡_001.wav"] },
    ] };
    const result = reconcileBgmDeletedFolders([gone, draft, present], [{ name: "현재", files: ["D:/storage/BGM/곡/현재/현재_곡_001.wav"] }]);
    expect(result.kept.map((item) => item.id)).toEqual(["draft", "present"]);
    expect([...result.removedIds]).toEqual(["gone"]);
  });
});
