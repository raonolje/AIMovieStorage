import { describe, expect, it } from "vitest";
import { copyJsonWithinLimit, sameImmutableJson } from "./immutableJson";

describe("불변 JSON 상태의 제한된 비교와 복사", () => {
  it("같은 모캡 하위 참조는 관절을 다시 읽지 않고 비교하며 작은 변경은 찾는다", () => {
    const shared = { get huge() { throw Error("공유 하위 트리를 읽었습니다"); } };
    expect(sameImmutableJson({ motion: shared, fov: 40 }, { fov: 40, motion: shared })).toBe(true);
    expect(sameImmutableJson({ motion: shared, fov: 40 }, { fov: 41, motion: shared })).toBe(false);
    expect(sameImmutableJson({ missing: undefined }, {})).toBe(true);
    expect(sameImmutableJson([undefined], [null])).toBe(true);
    expect(sameImmutableJson(Array(1), [3])).toBe(false);
  });

  it("큰 추가·삭제 본문은 전체 배열을 복제하거나 뒤쪽 getter를 읽기 전에 중단한다", () => {
    const values = Array.from({ length: 1000 }, () => "x".repeat(100));
    Object.defineProperty(values, 20, { get() { throw Error("예산 뒤쪽을 읽었습니다"); } });
    expect(copyJsonWithinLimit({ after: values }, 300)).toEqual({ exceeded: true });
    expect(copyJsonWithinLimit("x".repeat(300), 50)).toEqual({ exceeded: true });
  });

  it("작은 로그는 분리된 사본이며 JSON 키와 escaping을 보존한다", () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"parts":["\\n\\\"",{"x":1}],"missing":null}');
    const copied = copyJsonWithinLimit(value, 500);
    expect(copied.exceeded).toBe(false);
    expect(JSON.stringify(copied.value)).toBe(JSON.stringify(value));
    (copied.value as typeof value).parts[1].x = 2;
    expect(value.parts[1].x).toBe(1);
    expect(Object.getPrototypeOf(copied.value)).toBe(Object.prototype);
  });
});
