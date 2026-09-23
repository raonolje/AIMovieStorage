import { describe, expect, it, vi } from "vitest";
import { createProjectSerializer } from "./projectSerialization";

describe("프로젝트 저장 스냅샷", () => {
  it("File/blob을 빼고 날짜·비유한 수·빈 배열 항목의 JSON 의미를 유지한다", () => {
    const file = new File(["사진"], "사진.png");
    const draft = { title: "작품", image: { file, thumb: "blob:preview", path: "인물/사진.png" },
      unused: undefined, when: new Date("2026-01-01T00:00:00.000Z"),
      values: [undefined, , file, "blob:video", NaN, Infinity, -Infinity, null, false, 0] };
    const saved = createProjectSerializer()(draft);
    expect(saved).toEqual({ title: "작품", image: { path: "인물/사진.png" },
      when: "2026-01-01T00:00:00.000Z", values: [null, null, null, null, null, null, null, null, false, 0] });
    expect(draft.image.file).toBe(file);
    expect(draft.image.thumb).toBe("blob:preview");
  });

  it("다음 함수형 편집은 같은 대형 관절 분기를 읽지 않고 이전 스냅샷을 보존한다", () => {
    const serialize = createProjectSerializer();
    const read = vi.fn(() => ({ Head: { x: 0, y: 1, z: 0 } }));
    const keys = Array.from({ length: 1500 }, (_, time) => ({ time, get bones() { return read(); } }));
    const motion = { keys };
    const first = serialize({ title: "처음", motion, camera: { fov: 35 } });
    expect(read).toHaveBeenCalledTimes(1500);
    read.mockImplementation(() => { throw new Error("같은 관절 분기를 다시 읽었습니다"); });
    const second = serialize({ title: "다음", motion, camera: { fov: 50 } });
    expect(second.motion).toBe(first.motion);
    expect(second.camera).toEqual({ fov: 50 });
    expect(first.camera).toEqual({ fov: 35 });
    expect(first.title).toBe("처음");
    expect(first.motion === motion).toBe(false);
    expect((first.motion as { keys: unknown[] }).keys === keys).toBe(false);
  });

  it("순환 참조는 실패하고 다음 정상 저장에 미완성 스냅샷을 남기지 않는다", () => {
    const serialize = createProjectSerializer();
    const broken: Record<string, unknown> = { title: "순환" };
    broken.self = broken;
    expect(() => serialize(broken)).toThrow("순환 참조");
    expect(serialize({ title: "정상", a: { value: 1 } })).toEqual({ title: "정상", a: { value: 1 } });
    expect(() => serialize({ number: 1n })).toThrow("BigInt");
  });
});
