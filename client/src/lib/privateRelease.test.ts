import { describe, expect, it } from "vitest";
import { MANIFEST_URL, packageUrl, privateManifest } from "../../../scripts/private-release.mjs";

describe("GitLab 원본판 업데이트 명세", () => {
  it("설치본은 버전 고정 GitLab 주소와 실제 서명을 사용한다", () => {
    const manifest = privateManifest("0.3.7", "v0.3.7", "AIMovieStorage_0.3.7_x64-setup.exe", "signed-value\n");
    const win = manifest.platforms["windows-x86_64"];
    expect(win.url).toBe(packageUrl("v0.3.7", "AIMovieStorage_0.3.7_x64-setup.exe"));
    expect(win.url).not.toContain("github.com");
    expect(win.signature).toBe("signed-value");
    expect(MANIFEST_URL).toContain("/repository/files/aimoviestorage-private-latest.json/raw?ref=main");
  });

  it("잘못된 태그와 빈 서명을 게시하지 않는다", () => {
    expect(() => privateManifest("0.3.7", "v0.3.6", "setup.exe", "sig")).toThrow("어긋납니다");
    expect(() => privateManifest("0.3.7", "v0.3.7", "setup.exe", " ")).toThrow("서명");
  });

  it("큰 설치본은 GitLab 패키지 저장소의 버전 고정 경로에 둔다", () => {
    expect(packageUrl("v0.3.7", "AIMovieStorage_0.3.7_x64-setup.exe"))
      .toContain("/packages/generic/aimoviestorage-private/v0.3.7/AIMovieStorage_0.3.7_x64-setup.exe");
  });
});
