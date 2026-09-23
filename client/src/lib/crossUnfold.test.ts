import { describe, expect, it } from "vitest";
import { assessCrossFaces, constrainCrossTrim, crossFaceTargetRatio, type CrossFaceMeasure } from "@/lib/crossUnfold";

const size = { width: 10, depth: 8, height: 3.5 };
const proper: CrossFaceMeasure[] = [
  { face: "front", width: 1000, height: 350, coverage: 0.9 },
  { face: "back", width: 1000, height: 350, coverage: 0.9 },
  { face: "left", width: 800, height: 350, coverage: 0.9 },
  { face: "right", width: 800, height: 350, coverage: 0.9 },
  { face: "top", width: 1000, height: 800, coverage: 0.9 },
  { face: "bottom", width: 1000, height: 800, coverage: 0.9 },
];

describe("전개도 6면 저장 전 검증", () => {
  it("서로 다른 방 치수를 따르는 완전한 여섯 면은 통과한다", () => {
    expect(assessCrossFaces(proper, size)).toMatchObject({ safe: true, issues: [] });
  });
  it("실측된 연습실 원본의 잘못 나뉜 오른쪽 벽을 6.6배 불일치로 잡는다", () => {
    // 원본 3840×2160에서 실제 이전 cutCrossFaces로 재현한 결과입니다. 오른쪽 폭은 trim 전에도 202px입니다.
    const measured = [[2199, 591], [552, 601], [844, 596], [202, 584], [1838, 764], [1805, 776]];
    const result = assessCrossFaces(proper.map((face, i) => ({ ...face, width: measured[i][0], height: measured[i][1] })), size);
    expect(result.safe).toBe(false);
    expect(result.issues.find((i) => i.kind === "ratio" && i.face === "right")).toMatchObject({ factor: expect.closeTo(6.6082, 3) });
  });
  it("방 치수가 없어도 후면을 임의로 쪼갠 비대칭 경계는 자동 저장하지 않는다", () => {
    const result = assessCrossFaces(proper.map((f) => f.face === "back" ? { ...f, width: 200 } : f));
    expect(result.safe).toBe(false);
    expect(result.issues).toContainEqual({ kind: "opposite", face: "front", other: "back", factor: 5 });
  });
  it("비율 1.5배와 추정 내용 70%의 경계를 지킨다", () => {
    const boundary = proper.map((f) => f.face === "front" ? { ...f, width: 1500, coverage: 0.7 } : f);
    const issues = assessCrossFaces(boundary, size).issues;
    expect(issues.some((i) => i.kind === "ratio")).toBe(true);
    expect(issues.some((i) => i.kind === "coverage")).toBe(false);
    expect(assessCrossFaces(proper.map((f) => f.face === "right" ? { ...f, coverage: 0.69 } : f), size).issues).toContainEqual({ kind: "coverage", face: "right", coverage: 0.69 });
  });
  it("여섯 파일이어도 중복 면과 누락 면이 있으면 통과하지 않는다", () => {
    expect(assessCrossFaces([...proper.slice(0, 5), proper[0]], size).safe).toBe(false);
  });
  it("실외 UV 아래쪽 자르기는 원본 정사각 비율로 검사한다", () => {
    const outdoor = { width: 50, depth: 50, height: 26.6, cropBottom: 0.468 };
    expect(crossFaceTargetRatio("right", outdoor)).toBeCloseTo(1);
    expect(assessCrossFaces(proper.map((f) => ({ ...f, width: 500, height: 500 })), outdoor).safe).toBe(true);
  });
});

describe("회색 테두리 제거 한도", () => {
  it("이음매 후처리까지 합쳐 각 변 15%를 넘지 않는다", () => {
    expect(constrainCrossTrim(1000, 600, { left: 167, right: 999, top: 101, bottom: 602 })).toEqual({ left: 150, right: 150, top: 90, bottom: 90 });
  });
  it("제거 한도를 0으로 주면 이음매도 깎지 않는다", () => {
    expect(constrainCrossTrim(1000, 600, { left: 2, right: 2, top: 2, bottom: 2 }, 0)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
  it("정상 비율 칸을 회색 벽 때문에 가로로 더 좁히지 않는다", () => {
    const crop = constrainCrossTrim(1000, 350, { left: 150, right: 150, top: 0, bottom: 0 }, 0.15, 1000 / 350);
    expect((1000 - crop.left - crop.right) / 350).toBeGreaterThanOrEqual(1000 / 350 / 1.01);
  });
  it("정상 비율 칸의 높이만 깎아 가로로 늘리는 일도 막는다", () => {
    const crop = constrainCrossTrim(1000, 350, { left: 0, right: 0, top: 52, bottom: 52 }, 0.15, 1000 / 350);
    expect(1000 / (350 - crop.top - crop.bottom)).toBeLessThanOrEqual(1000 / 350 * 1.01);
  });
  it("실제 바탕 여백을 제거해 목표 비율에 가까워지는 경우는 그대로 자른다", () => {
    const requested = { left: 50, right: 50, top: 0, bottom: 0 };
    expect(constrainCrossTrim(1100, 350, requested, 0.15, 1000 / 350)).toEqual(requested);
  });
  it("아주 좁게 잡힌 기존 칸도 비율을 더 악화시키지 않는다", () => {
    const crop = constrainCrossTrim(202, 600, { left: 30, right: 30, top: 0, bottom: 0 }, 0.15, 8 / 3.5);
    expect(crop.left + crop.right).toBe(0);
  });
});
