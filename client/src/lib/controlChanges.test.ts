import { describe, expect, it } from "vitest";
import { diffControlValues } from "./controlChanges";

describe("조종 변경값의 크기와 불변 공유", () => {
  it("공유 모캡 가지를 읽지 않고 다른 필드의 변경만 기록한다", () => {
    let reads = 0;
    const motion = { get keys() { reads += 1; throw new Error("공유 가지를 읽었습니다"); } };
    expect(diffControlValues({ motion, title: "이전" }, { motion, title: "다음" })).toEqual([{ path: "/title", before: "이전", after: "다음" }]);
    expect(reads).toBe(0);
  });

  it("큰 추가·삭제 값은 전체 직렬화 없이 한도에서 멈추고 다시 읽기를 요구한다", () => {
    let tailReads = 0;
    const huge = { first: "a".repeat(4001), get tail() { tailReads += 1; throw new Error("상한 뒤를 읽었습니다"); } };
    expect(diffControlValues(undefined, huge)).toEqual([{ path: "/", before: null, after: { omitted: true }, truncated: true }]);
    expect(diffControlValues(huge, undefined)).toEqual([{ path: "/", before: { omitted: true }, after: null, truncated: true }]);
    expect(tailReads).toBe(0);
  });

  it("작은 추가값도 로그 사본을 남겨 호출 뒤 원본 수정이 과거 이력을 고치지 않는다", () => {
    const source = { id: "새 인물", info: { title: "처음" } };
    const changes = diffControlValues([], [source]);
    source.info.title = "이후";
    expect(changes[0]).toEqual({ path: "/새 인물", before: null, after: { id: "새 인물", info: { title: "처음" } } });
    expect(changes[1]).toMatchObject({ path: "/@order" });
  });

  it("ID 순서 변경과 경로 이스케이프를 유지하고 한 번에 200항목까지만 기록한다", () => {
    expect(diffControlValues([{ id: "a/b~", name: "전" }, { id: "b", name: "둘" }], [{ id: "b", name: "둘" }, { id: "a/b~", name: "후" }])).toEqual([
      { path: "/a~1b~0/name", before: "전", after: "후" },
      { path: "/@order", before: ["a/b~", "b"], after: ["b", "a/b~"] },
    ]);
    const left = Object.fromEntries(Array.from({ length: 250 }, (_, index) => [index, 0]));
    const right = Object.fromEntries(Array.from({ length: 250 }, (_, index) => [index, 1]));
    expect(diffControlValues(left, right)).toHaveLength(200);
  });

  it("JSON에서 생략되는 undefined와 객체 키 순서만 바뀌면 변경이 아니다", () => {
    expect(diffControlValues({ title: "같음", optional: undefined }, { title: "같음" })).toEqual([]);
    expect(diffControlValues({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });
});
