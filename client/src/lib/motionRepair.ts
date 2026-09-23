import { LM, type CapturePoint, type CaptureSample, type CapturedPerson } from "@/lib/motionCapture";

/**
 * **튐 보정** — 검출기가 한두 장 사람을 잘못 봐서 팔다리가 확 튀었다 돌아오는 곳을 찾아 앞뒤로 메웁니다.
 *
 *
 *
 * 떨림 줄이기(One Euro, `smoothSamples`)는 **작은 떨림**을 누르는 것이라 이런 곳을 못 고칩니다 — 한 장이 30 cm 튀면 필터가
 * 그것을 «빠른 동작» 으로 보고 오히려 따라갑니다. 그래서 거르기 **전에** 다음을 차례로 봅니다.
 *
 * 1. **왼쪽·오른쪽 뒤바뀜** — 사람이 옆으로 돌 때 검출기가 왼다리·오른다리 이름을 한 장만 바꿔 붙이는 일이 흔합니다
 * (캐릭터 다리가 한 장 꼬였다 풀림). 앞 장과 견줘 «바꿔 붙이면 훨씬 가까운» 팔·다리는 되돌립니다.
 * 2. **뼈 길이** — 사람의 위팔·정강이 길이는 변하지 않습니다. 그 사람의 중앙값에서 크게 벗어난 장의 끝 관절은 잘못 본 것입니다.
 * 3. **튀었다 돌아옴** — 들어오는 움직임과 나가는 움직임이 둘 다 크고 방향이 반대인데, 앞 장과 뒤 장은 가까운 점.
 * 진짜 빠른 동작(팔을 뻗었다 거둠)은 여러 장에 걸쳐 이어지므로 한두 장짜리 튐만 걸립니다.
 * 4. **보이지 않는데 멀리 간 점** — 보이는 정도(v)가 낮으면서 앞뒤 0.2 초의 중앙값에서 멀리 떨어진 점.
 * 5. **몸 방향이 한 장만 뒤집힘** — 앞뒤를 헷갈려 한 장만 180° 돈 것.
 *
 * 걸린 관절은 앞뒤의 멀쩡한 장 사이를 이어 채웁니다(0.8 초 안). 몸통이 걸리거나 관절 절반이 걸린 장은 통째로 이어 채웁니다.
 * 원본을 바꾸지 않고 새 배열을 돌려줍니다 — 다시 분석하지 않고 세기를 바꿔 볼 수 있게.
 */

export type RepairLevel = "off" | "normal" | "strong";

/** 보정 세기마다의 문턱. 강하게 할수록 «튐» 으로 보는 기준이 낮아집니다. */
const LEVELS: Record<Exclude<RepairLevel, "off">, { spike: number; bone: number; hampel: number; fill: number }> = {
  normal: { spike: 1, bone: 0.4, hampel: 1, fill: 0.8 },
  strong: { spike: 0.7, bone: 0.3, hampel: 0.7, fill: 1.2 },
};

/** 팔·다리 좌우 짝(이미지·미터 좌표 모두 같은 번호). */
const LIMB_PAIRS: { left: number[]; right: number[] }[] = [
  { left: [13, 15, 17, 19, 21], right: [14, 16, 18, 20, 22] },
  { left: [25, 27, 29, 31], right: [26, 28, 30, 32] },
];

/** 뼈 — [부모, 자식, 자식에 딸린 끝 점들]. 뼈 길이가 틀리면 자식과 그 아래를 «잘못 봄» 으로 칩니다. */
const BONES: [number, number, number[]][] = [
  [LM.leftShoulder, LM.leftElbow, [LM.leftWrist, 17, 19, 21]],
  [LM.leftElbow, LM.leftWrist, [17, 19, 21]],
  [LM.rightShoulder, LM.rightElbow, [LM.rightWrist, 18, 20, 22]],
  [LM.rightElbow, LM.rightWrist, [18, 20, 22]],
  [LM.leftHip, LM.leftKnee, [LM.leftAnkle, 29, 31]],
  [LM.leftKnee, LM.leftAnkle, [29, 31]],
  [LM.rightHip, LM.rightKnee, [LM.rightAnkle, 30, 32]],
  [LM.rightKnee, LM.rightAnkle, [30, 32]],
];

/** 캐릭터에 쓰는 점(얼굴 잔점·손가락 끝 일부는 뺍니다 — 그것까지 세면 «절반이 틀림» 이 너무 쉽게 걸립니다). */
const MAIN_JOINTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28, 31, 32];
const TORSO: number[] = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
/** 튐으로 볼 최소 이동(미터) — 몸통은 작게, 손발은 크게(원래 많이 움직입니다). */
const minJump = (joint: number) => (TORSO.includes(joint) ? 0.08 : joint <= 10 ? 0.1 : 0.16);

const dist = (a: CapturePoint, b: CapturePoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
};

/** 몸이 향하는 쪽(미터 좌표) — `motionRetarget.yawOf` 와 같은 식. */
const yawOfWorld = (world: CapturePoint[]) => {
  const x = world[LM.leftHip].x - world[LM.rightHip].x + world[LM.leftShoulder].x - world[LM.rightShoulder].x;
  const z = -(world[LM.leftHip].z - world[LM.rightHip].z + world[LM.leftShoulder].z - world[LM.rightShoulder].z);
  return Math.atan2(-z, x);
};

export function repairPerson(person: CapturedPerson, level: RepairLevel = "normal"): CapturedPerson {
  if (level === "off" || person.samples.length < 5) return { ...person, repaired: { joints: 0, frames: 0, swaps: 0 } };
  const rule = LEVELS[level];
  // 깊은 복사 — 원본(분석 결과)은 그대로 둡니다.
  const samples: CaptureSample[] = person.samples.map((s) => ({
    time: s.time,
    image: s.image.map((p) => ({ ...p })),
    world: s.world.map((p) => ({ ...p })),
    root: s.root ? { ...s.root } : undefined,
  }));
  const count = samples.length;
  const jointCount = samples[0].world.length;
  const bad: boolean[][] = samples.map(() => new Array(jointCount).fill(false));
  let swaps = 0;

  // ── 1) 왼쪽·오른쪽 뒤바뀜 ──
  const torsoPixels = (s: CaptureSample) =>
    Math.max(
      0.02,
      Math.hypot(
        (s.image[LM.leftShoulder].x + s.image[LM.rightShoulder].x - s.image[LM.leftHip].x - s.image[LM.rightHip].x) / 2,
        (s.image[LM.leftShoulder].y + s.image[LM.rightShoulder].y - s.image[LM.leftHip].y - s.image[LM.rightHip].y) / 2,
      ),
    );
  for (let i = 1; i < count; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    if (current.time - previous.time > 0.2) continue;
    const scale = torsoPixels(current);
    for (const pair of LIMB_PAIRS) {
      const gap = (a: number, b: number) =>
        Math.hypot(current.image[a].x - previous.image[b].x, current.image[a].y - previous.image[b].y);
      const same = pair.left.reduce((sum, j, k) => sum + gap(j, j) + gap(pair.right[k], pair.right[k]), 0);
      const crossed = pair.left.reduce((sum, j, k) => sum + gap(j, pair.right[k]) + gap(pair.right[k], j), 0);
      // 원래 붙은 쪽이 몸통 길이의 40 % 넘게 어긋나고, 바꿔 붙이면 절반 밑으로 줄 때만.
      if (same > scale * 0.4 * pair.left.length && crossed < same * 0.5) {
        pair.left.forEach((j, k) => {
          const r = pair.right[k];
          [current.image[j], current.image[r]] = [current.image[r], current.image[j]];
          [current.world[j], current.world[r]] = [current.world[r], current.world[j]];
        });
        swaps += 1;
      }
    }
  }

  // ── 2) 뼈 길이 ──
  for (const [parent, child, tail] of BONES) {
    const lengths = samples
      .filter((s) => Math.min(s.world[parent].v, s.world[child].v, s.image[parent].v, s.image[child].v) > 0.6)
      .map((s) => dist(s.world[parent], s.world[child]));
    const normal = median(lengths);
    if (normal <= 0.05) continue;
    samples.forEach((s, i) => {
      const ratio = dist(s.world[parent], s.world[child]) / normal;
      if (ratio < 1 - rule.bone || ratio > 1 + rule.bone * 1.25) {
        bad[i][child] = true;
        for (const j of tail) bad[i][j] = true;
      }
    });
  }

  // ── 3) 튀었다 돌아옴 · 4) 안 보이는데 멀리 간 점 ──
  const window = 0.2;
  for (let j = 0; j < jointCount; j += 1) {
    const jump = minJump(j) * rule.spike;
    for (let i = 1; i < count - 1; i += 1) {
      const a = samples[i - 1].world[j];
      const b = samples[i].world[j];
      const c = samples[i + 1].world[j];
      if (samples[i + 1].time - samples[i - 1].time > 0.25) continue;
      const into = dist(a, b);
      const out = dist(b, c);
      const across = dist(a, c);
      if (into > jump && out > jump && across < Math.min(into, out) * 0.5) bad[i][j] = true;
    }
    // 두세 장 이어진 튐: 앞뒤 0.2 초 중앙값에서 멀리 떨어졌는데 잘 안 보이는 점.
    for (let i = 0; i < count; i += 1) {
      const point = samples[i].world[j];
      if (point.v >= 0.6 && samples[i].image[j].v >= 0.6) continue;
      const near = samples.filter((s) => Math.abs(s.time - samples[i].time) <= window);
      if (near.length < 5) continue;
      const mx = median(near.map((s) => s.world[j].x));
      const my = median(near.map((s) => s.world[j].y));
      const mz = median(near.map((s) => s.world[j].z));
      if (Math.hypot(point.x - mx, point.y - my, point.z - mz) > minJump(j) * 1.5 * rule.hampel) bad[i][j] = true;
    }
  }

  // ── 5) 몸 방향이 한 장만 뒤집힘 → 그 장 통째로 ──
  const frameBad = new Array(count).fill(false);
  const yaws = samples.map((s) => yawOfWorld(s.world));
  const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (let i = 1; i < count - 1; i += 1) {
    if (turn(yaws[i], yaws[i - 1]) > 2.0 && turn(yaws[i], yaws[i + 1]) > 2.0 && turn(yaws[i - 1], yaws[i + 1]) < 1.0)
      frameBad[i] = true;
  }
  samples.forEach((_, i) => {
    const mainBad = MAIN_JOINTS.filter((j) => bad[i][j]).length;
    if (frameBad[i] || TORSO.some((j) => bad[i][j]) || mainBad >= MAIN_JOINTS.length / 2) frameBad[i] = true;
    if (frameBad[i]) bad[i].fill(true);
  });

  // ── 채우기: 관절마다 앞뒤의 멀쩡한 장 사이를 잇습니다 ──
  let joints = 0;
  const keep: boolean[] = new Array(count).fill(true);
  for (let j = 0; j < jointCount; j += 1) {
    for (let i = 0; i < count; i += 1) {
      if (!bad[i][j]) continue;
      let before = i - 1;
      while (before >= 0 && bad[before][j]) before -= 1;
      let after = i + 1;
      while (after < count && bad[after][j]) after += 1;
      const time = samples[i].time;
      const hasBefore = before >= 0 && time - samples[before].time <= rule.fill;
      const hasAfter = after < count && samples[after].time - time <= rule.fill;
      const lerp = (pick: (s: CaptureSample) => CapturePoint[]) => {
        if (hasBefore && hasAfter) {
          const t = (time - samples[before].time) / Math.max(1e-6, samples[after].time - samples[before].time);
          const p = pick(samples[before])[j];
          const q = pick(samples[after])[j];
          return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t, v: Math.min(p.v, q.v, 0.5) };
        }
        const source = hasBefore ? samples[before] : hasAfter ? samples[after] : null;
        return source ? { ...pick(source)[j], v: Math.min(pick(source)[j].v, 0.4) } : null;
      };
      const image = lerp((s) => s.image);
      const world = lerp((s) => s.world);
      if (image && world) {
        samples[i].image[j] = image;
        samples[i].world[j] = world;
        joints += 1;
      } else if (frameBad[i]) {
        // 앞뒤 어디에도 멀쩡한 장이 없는 긴 헛장은 버립니다 — 키를 비워 두면 타임라인이 앞뒤 키를 잇습니다.
        keep[i] = false;
      } else {
        samples[i].image[j] = { ...samples[i].image[j], v: 0.05 };
        samples[i].world[j] = { ...samples[i].world[j], v: 0.05 };
      }
    }
  }
  const frames = frameBad.filter(Boolean).length;
  return {
    ...person,
    samples: samples.filter((_, i) => keep[i]),
    repaired: { joints, frames, swaps },
  };
}
