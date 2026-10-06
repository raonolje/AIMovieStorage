import { describe, expect, it } from "vitest";
import { DEFAULT_COMPOSITION } from "./composition";
import { moveMusicStartIn, splitMusicByDetectedBarsIn } from "./compositionEdit";
import { applyDanceChoreographyIn } from "./musicChoreography";
import type { RetargetFrame } from "./motionRetarget";

describe("음악에 맞춘 군무", () => {
  it("노래 레이어를 옮기면 구간이 함께 이동하고 음원 시작점은 그대로다", () => {
    const original = { ...DEFAULT_COMPOSITION, timeline: { duration: 20, fps: 24,
      music: { path: "song.wav", name: "song", seconds: 8, offset: 1, sections: [
        { id: "verse", label: "후렴", start: 1, end: 5 },
      ] } } };
    const next = moveMusicStartIn(original, 3.47);
    expect(next.timeline?.music).toMatchObject({ startTime: 3.45, offset: 1,
      sections: [{ start: 4.45, end: 8.45 }] });
    expect(original.timeline.music.sections[0].start).toBe(1);
  });

  it("늦게 시작하는 음원에서 감지한 박자도 타임라인 위치로 옮긴다", () => {
    const original = { ...DEFAULT_COMPOSITION, timeline: { duration: 12, fps: 24,
      music: { path: "song.wav", name: "song", seconds: 10, startTime: 3, offset: 1,
        beatTimes: Array.from({ length: 20 }, (_, index) => 2 + index * 0.5),
        downbeatIndex: 1, sections: [] } } };
    const next = splitMusicByDetectedBarsIn(original, 2);
    expect(next.timeline?.music?.sections.map(section => [section.start, section.end]))
      .toEqual([[3, 4.5], [4.5, 8.5], [8.5, 12]]);
  });
  it("음원 첫 박과 타임라인 오프셋으로 구간을 나눈다", () => {
    const original = { ...DEFAULT_COMPOSITION, timeline: {
      duration: 12, fps: 24,
      music: { path: "song.wav", name: "song", seconds: 14, offset: 1,
        bpm: 120, beatTimes: Array.from({ length: 24 }, (_, index) => 2 + index * 0.5),
        downbeatIndex: 1, sections: [] },
    } };
    const next = splitMusicByDetectedBarsIn(original, 2);
    expect(next.timeline?.music?.sections.map(section => [section.start, section.end])).toEqual([
      [0, 1.5], [1.5, 5.5], [5.5, 9.5], [9.5, 12],
    ]);
    expect(original.timeline.music.sections).toEqual([]);
  });

  it("두 캐릭터의 기존 배치·이동·카메라를 보존하고 자세 키만 적용한다", () => {
    const original = { ...DEFAULT_COMPOSITION,
      characters: ["a", "b"].map((characterId, index) => ({ characterId,
        position: { x: index * 2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, pose: "stand" as const })),
      motionTracks: [{ id: "existing", targetId: "a", channel: "position" as const,
        keys: [{ id: "position", time: 1, value: { x: 3, y: 0, z: 0 } }] }],
    };
    const frames: RetargetFrame[] = [0, 1].map(time => ({ time,
      root: { x: time, y: 0, z: 0 }, yaw: 0,
      bones: { LeftArm: { x: time, y: 0, z: 0 } },
    }));
    const next = applyDanceChoreographyIn(original, ["a", "b"], frames,
      [{ start: 2, end: 4 }, { start: 6, end: 8 }], { id: "dance", name: "dance" });
    expect(next.characters).toEqual(original.characters);
    expect(next.camera).toEqual(original.camera);
    expect(next.motionTracks?.find(track => track.id === "existing")).toEqual(original.motionTracks[0]);
    for (const id of ["a", "b"]) {
      expect(next.motionTracks?.find(track => track.targetId === id && track.channel === "pose")?.keys.map(key => key.time))
        .toEqual([2, 3, 4, 6, 7, 8]);
    }
    expect(original.motionTracks).toHaveLength(1);
  });

  it("5인 군무를 같은 시각에 배치하고 각자의 무대 위치를 유지한다", () => {
    const original = { ...DEFAULT_COMPOSITION,
      characters: Array.from({ length: 5 }, (_, index) => ({
        characterId: `member-${index + 1}`,
        position: { x: index - 2, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        pose: "stand" as const,
      })),
    };
    const frames: RetargetFrame[] = [0, 0.5, 1].map(time => ({
      time, root: { x: 0, y: 0, z: 0 }, yaw: 0, bones: {},
    }));
    const next = applyDanceChoreographyIn(original,
      original.characters.map(character => character.characterId), frames,
      [{ start: 0, end: 4 }, { start: 4, end: 8 }], { id: "dance", name: "dance" });
    expect(next.motionTracks?.filter(track => track.channel === "pose")).toHaveLength(5);
    expect(next.motionTracks?.filter(track => track.channel === "pose").map(track => track.keys.length))
      .toEqual([17, 17, 17, 17, 17]);
    expect(next.characters.map(character => character.position))
      .toEqual(original.characters.map(character => character.position));
  });
});
