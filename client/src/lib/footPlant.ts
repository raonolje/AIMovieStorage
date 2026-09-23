import * as THREE from "three";
import { boneOf, setLiveBonePose } from "@/lib/rig";
import type { RetargetFrame, RetargetRig } from "@/lib/motionRetarget";

/**
 * **디딘 발 고정** — 땅에 붙어 있는 동안은 발이 그 자리에 머물게 합니다.
 *
 * # 왜 따로 사는가
 *
 * 이 파일은 `motionRetarget` 이 **켜 달라고 할 때만** 부르는 한 단계입니다. 끄면 예전 결과가
 * 그대로 나오고, 통째로 지워도 `retargetPerson` 의 한 줄만 없애면 됩니다. 새로 들여온 방식이라
 * 언제든 되돌릴 수 있게 경계를 뚜렷이 둡니다.
 *
 * # 무엇이 문제였나
 *
 * 영상에서 사람의 자리를 재는 길은 «화면 속 몸 크기로 거리를 짐작하는» 것이라, 짐작이 몇 %만
 * 흔들려도 골반이 좌우·앞뒤로 몇 cm 씩 흐릅니다. 관절 각도는 멀쩡한데 **디디고 선 발이
 * 바닥에서 미끄러집니다.** 구도잡기에서 눈에 거슬릴 뿐 아니라, 이 결과로 뽑은 뼈 그림을
 * 포즈 IC-LoRA 에 먹이면 **뽑힌 영상에서도 발이 미끄러집니다**(2026-09-18 확인).
 *
 * # 어떻게 고치나 — NVIDIA soma-retargeter 의 세 단
 *
 * 방식은 NVIDIA 의 `soma-retargeter`(Apache-2.0)에서 가져왔습니다. 그쪽은 사람 동작을 휴머노이드
 * **로봇** 관절로 옮기는 물건이라 우리와 입구도 출구도 다르지만, 발 접지를 다루는 세 단은
 * 그대로 쓸 만합니다. 코드를 옮긴 것이 아니라 **방식을 옮겼습니다**.
 *
 * 1. `contact_detection` — 속도·가속도·저크로 「닿음 ↔ 뗌」 을 상태기계로 판정
 * 2. `plant_subsegment_detector` — 닿은 구간 중 **발바닥이 평평한 구간만** 골라 냄
 * 3. `plant_correction_blender` — 그 구간의 목표를 중앙값으로 못 박고, 앞뒤 스윙 구간에는
 * 잔차를 smootherstep 으로 **감쇠시켜 퍼뜨림**(경계에서 툭 튀지 않게)
 *
 * # 발이 아니라 골반을 옮깁니다
 *
 * 저쪽은 발 목표를 고친 뒤 IK 를 다시 풉니다. 우리에겐 IK 단이 없고, 애초에 **틀린 것이
 * 골반 자리**입니다(관절 각도는 영상에서 곧바로 읽어 믿을 만합니다). 그래서 디딘 발이 흐른
 * 만큼 골반을 반대로 밀어 줍니다 — 관절은 한 도도 건드리지 않으므로 자세는 그대로고, 발은
 * 정확히 그 자리에 섭니다.
 *
 * 높이(`root.y`)는 건드리지 않습니다. 그 값은 «점프한 높이» 라 따로 재고 있어서, 여기서 함께
 * 밀면 두 계산이 서로 싸웁니다.
 */

/** 고르개로 뺄 만한 값들. 기본값은 soma-retargeter 의 것을 그대로 쓰되 **평평함만 넓혔습니다.** */
export interface FootPlantConfig {
  /** 이 속도 아래면 «닿았나» 후보(m/s). */
  velocityContact: number;
  /** 이 속도를 넘으면 뗀 것으로(m/s). */
  velocityUncontact: number;
  /** 뗄 낌새 — 이 속도를 넘은 시점부터 되짚어 지웁니다(m/s). */
  velocityLiftOff: number;
  /** 발이 땅에 «찍히는» 순간의 음수 저크(m/s³). */
  jerkContact: number;
  /** 저크를 본 뒤 몇 장 동안 닿음을 기다릴까. */
  jerkWindow: number;
  /** 도막 처음·끝은 미분을 못 구해 닿음이 빕니다 — 이만큼 늘려 메웁니다. */
  edgeFrames: number;
  /** 발바닥이 이만큼 안에서 수평이면 «평평하게 디뎠다»(도). */
  maxFlatnessDeg: number;
  /** 디딘 구간으로 볼 속도 상한(m/s). */
  plantSpeed: number;
  /** 디딘 동안 발 높이가 이보다 더 오르내리면 디딘 게 아닙니다(m). */
  maxHeightSpread: number;
  /** 이보다 짧은 구간은 버립니다(장). */
  minPlantFrames: number;
  /** 한두 장 튀어 조건을 벗어나도 같은 구간으로 봅니다. */
  maxGapFrames: number;
  /** 이 아래 확신이면 고정하지 않습니다(0~1). */
  minConfidence: number;
  /** 잔차를 퍼뜨릴 거리 — 옆 스윙 구간의 몇 할까지. */
  propagationRatio: number;
  /** 아무리 짧은 스윙이라도 최소 이만큼은 퍼뜨립니다(장). */
  transitionFrames: number;
}

export const FOOT_PLANT_DEFAULTS: FootPlantConfig = {
  velocityContact: 0.1,
  velocityUncontact: 0.2,
  velocityLiftOff: 0.05,
  jerkContact: -0.05,
  jerkWindow: 5,
  edgeFrames: 8,
  /*
    soma 는 25°. 우리는 **35°** 입니다 — 저쪽 입력은 정밀 모캡 장비의 BVH 이고 우리 것은 영상에서
    읽은 좌표라 발 각도가 더 거칩니다. 시험대 35편으로 재어 보니 25° 는 18편, 35° 는 24편에서
    디딘 발을 찾았고 **나빠진 영상은 없었습니다**(2026-09-18).
  */
  maxFlatnessDeg: 35,
  plantSpeed: 0.15,
  maxHeightSpread: 0.05,
  minPlantFrames: 3,
  maxGapFrames: 2,
  minConfidence: 0.5,
  propagationRatio: 0.4,
  transitionFrames: 4,
};

/** 고정하고 나서 무엇이 달라졌는지 — 창에 한 줄로 적습니다. */
export interface FootPlantReport {
  /** 고정한 구간 수. 0 이면 디딘 구간을 못 찾은 것입니다. */
  plants: number;
  /** 디딘 구간이 덮은 장의 비율(0~1). */
  coverage: number;
  /** 골반을 옮긴 거리의 평균(m). */
  movedM: number;
  /** 고정 전 디딘 발의 가로 흐름(m/장). */
  slideBeforeM: number;
  /** 고정 뒤 — 0 에 가까워야 맞습니다. */
  slideAfterM: number;
}

/** 왼발·오른발. 발바닥 방향은 «발목 → 발가락» 으로 봅니다. */
const FEET = [
  ["LeftFoot", "LeftToeBase"],
  ["RightFoot", "RightToeBase"],
] as const;

/** soma 의 quintic smootherstep — 경계에서 기울기까지 0 이라 이음매가 안 보입니다. */
const smootherstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
};

/** 이어진 `true` 덩어리들의 [시작, 끝) — soma 의 `contiguous_true_runs`. */
function runsOf(flags: boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  flags.forEach((on, i) => {
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      runs.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, flags.length]);
  return runs;
}

interface FootTrack {
  /** 발바닥 가운데의 자리(카메라 기준 미터). */
  sole: THREE.Vector3[];
  /** 발바닥이 수평에서 기운 각(도). */
  flatDeg: number[];
}

/**
 * 관절 각도를 인형에 먹여 **발이 실제로 어디 있는지** 구합니다.
 *
 * 인형은 화면이 쓰는 것과 같은 길(`setLiveBonePose`)로 세웁니다 — 다른 길로 세우면 여기서 잰
 * 발자리와 화면에 보이는 발자리가 달라져, 고쳐 놓고도 여전히 미끄러져 보입니다.
 */
function trackFeet(rig: RetargetRig, frames: RetargetFrame[]): FootTrack[] {
  const tracks: FootTrack[] = FEET.map(() => ({ sole: [], flatDeg: [] }));
  const at = new THREE.Vector3();
  const toe = new THREE.Vector3();

  /*
    **«수평» 의 기준은 0° 가 아닙니다.**

    발목 뼈는 복사뼈에, 발가락 뼈는 발볼에 있어서 둘을 이은 선은 마네킹이 바닥에 **똑바로 서
    있을 때도** 앞아래로 기울어 있습니다(모델에 따라 20~35°). 그걸 모르고 「수평에서 25° 안」
    을 재면 제대로 디딘 발이 전부 걸러집니다 — 2026-09-18 첫 시험에서 36편 중 24편이 «디딘 발
    0곳» 으로 나온 까닭입니다.

    그래서 차렷 자세의 기울기를 한 번 재어 **그것을 0 으로 삼습니다.** soma 는 이 자리에서
    발바닥 평면을 따로 적어 둔 것(authored landmark model)을 쓰는데, 우리는 마네킹이 늘 같은
    뼈대라 차렷 한 번으로 갈음할 수 있습니다.
  */
  setLiveBonePose(rig.model, {});
  const restTilt = FEET.map(([footName, toeName]) => {
    const foot = boneOf(rig.model, footName);
    const tip = boneOf(rig.model, toeName);
    if (!foot || !tip) return 0;
    at.setFromMatrixPosition(foot.matrixWorld);
    toe.setFromMatrixPosition(tip.matrixWorld);
    const along = toe.clone().sub(at);
    return (Math.atan2(along.y, Math.hypot(along.x, along.z)) * 180) / Math.PI;
  });

  frames.forEach((frame) => {
    setLiveBonePose(rig.model, frame.bones);
    // 사람은 제 몸 방향(yaw)만큼 돌아 서 있습니다 — 장면에 세울 때와 같은 차례로 돌립니다.
    const cos = Math.cos(frame.yaw);
    const sin = Math.sin(frame.yaw);

    FEET.forEach(([footName, toeName], index) => {
      const foot = boneOf(rig.model, footName);
      const tip = boneOf(rig.model, toeName);
      const track = tracks[index];
      if (!foot || !tip) {
        track.sole.push(new THREE.Vector3(0, 0, 0));
        track.flatDeg.push(90);
        return;
      }
      at.setFromMatrixPosition(foot.matrixWorld);
      toe.setFromMatrixPosition(tip.matrixWorld);

      const sole = at.clone().add(toe).multiplyScalar(0.5);
      const local = sole.clone();
      track.sole.push(
        new THREE.Vector3(
          frame.root.x + local.x * cos + local.z * sin,
          frame.root.y + local.y,
          frame.root.z - local.x * sin + local.z * cos,
        ),
      );

      const along = toe.clone().sub(at);
      const flat = Math.hypot(along.x, along.z);
      const tilt = flat < 1e-6 ? 90 : (Math.atan2(along.y, flat) * 180) / Math.PI;
      track.flatDeg.push(Math.abs(tilt - restTilt[index]));
    });
  });
  return tracks;
}

/**
 * **닿음 판정** — soma `contact_detection` 의 속도·저크 상태기계.
 *
 * 속도를 두 배 간격으로 나눕니다(`/(2*dt)`). soma 가 예전 중앙차분 식을 그대로 두고 문턱값을
 * 거기에 맞춰 골라 두었기 때문입니다 — 식만 «바로잡으면» 문턱값이 전부 어긋납니다.
 */
function detectContacts(times: number[], sole: THREE.Vector3[], config: FootPlantConfig) {
  const count = sole.length;
  const speed = new Array<number>(count).fill(0);
  const accel = new Array<number>(count).fill(0);
  const jerk = new Array<number>(count).fill(0);
  const step = (i: number) => Math.max(1e-3, times[i] - times[i - 1]);

  const velocity = sole.map((point, i) =>
    i === 0 ? new THREE.Vector3() : point.clone().sub(sole[i - 1]).divideScalar(2 * step(i)),
  );
  velocity.forEach((value, i) => (speed[i] = value.length()));
  for (let i = 2; i < count; i += 1) accel[i] = velocity[i].distanceTo(velocity[i - 1]) / step(i);
  for (let i = 3; i < count; i += 1) jerk[i] = (accel[i] - accel[i - 1]) / step(i);

  const contact = new Array<boolean>(count).fill(false);
  let inContact = false;
  let contactFrom = -1;
  let liftFrom = -1;
  let jerkLeft = 0;

  for (let i = 0; i < count; i += 1) {
    const next = speed[Math.min(i + 1, count - 1)];
    if (!inContact && (jerk[i] < 0 || jerkLeft > 0)) {
      if (jerk[i] < config.jerkContact) jerkLeft = jerkLeft === 0 ? config.jerkWindow : jerkLeft - 1;
      if (speed[i] < config.velocityContact) {
        inContact = true;
        contactFrom = i;
      }
    }
    if (inContact) {
      if (speed[i] >= config.velocityLiftOff) {
        if (liftFrom === -1) liftFrom = i;
      } else liftFrom = -1;

      if (speed[i] > config.velocityUncontact && next > config.velocityUncontact) {
        // 뗄 낌새가 먼저 있었으면 **그 시점까지 되짚어** 지웁니다 — 발은 이미 뜨는 중이었습니다.
        if (liftFrom - contactFrom > 0) for (let k = liftFrom; k < i; k += 1) contact[k] = false;
        inContact = false;
        liftFrom = -1;
        jerkLeft = 0;
      }
    }
    if (inContact) contact[i] = true;
  }

  /*
    도막의 처음 세 장과 마지막은 속도·가속도·저크를 구할 수 없어 무조건 «뗌» 으로 나옵니다.
    느리게 서 있는 장이면 닿음을 바깥으로 늘려 메웁니다 — 안 그러면 영상 첫머리가 늘 흐릅니다.
  */
  if (config.edgeFrames > 0) {
    const first = contact.indexOf(true);
    if (first > 0)
      for (let i = Math.max(0, first - config.edgeFrames); i < first; i += 1)
        if (speed[i] < config.velocityContact) contact[i] = true;
    const last = contact.lastIndexOf(true);
    if (last >= 0 && last < count - 1)
      for (let i = last + 1; i < Math.min(count, last + 1 + config.edgeFrames); i += 1)
        if (speed[i] < config.velocityContact) contact[i] = true;
  }
  return { contact, speed };
}

interface Plant {
  from: number;
  /** 하나 지난 자리. */
  to: number;
  anchor: THREE.Vector3;
  confidence: number;
}

/**
 * **평평하게 디딘 구간 고르기** — soma `plant_subsegment_detector`.
 *
 * 닿았다고 다 못 박으면 안 됩니다. 발끝만 걸친 순간, 뒤꿈치를 떼는 순간까지 붙잡으면 발이
 * 부자연스럽게 끌립니다. 그래서 닿은 구간 **안에서** «발바닥이 수평이고 · 거의 안 움직이고 ·
 * 높이가 일정한» 토막만 골라 냅니다.
 */
function plantsIn(
  contact: boolean[],
  speed: number[],
  track: FootTrack,
  config: FootPlantConfig,
): Plant[] {
  const plants: Plant[] = [];

  runsOf(contact).forEach(([runStart, runEnd]) => {
    const good: boolean[] = [];
    for (let i = runStart; i < runEnd; i += 1)
      good.push(track.flatDeg[i] <= config.maxFlatnessDeg && speed[i] <= config.plantSpeed);

    // 한두 장 튄 것은 이어 붙입니다 — 검출기 잡음 한 장에 구간이 둘로 갈리면 둘 다 짧아 버려집니다.
    for (let i = 0; i < good.length; i += 1) {
      if (good[i]) continue;
      const before = good.slice(0, i).lastIndexOf(true);
      const after = good.indexOf(true, i);
      if (before >= 0 && after >= 0 && after - before - 1 <= config.maxGapFrames)
        for (let k = before + 1; k < after; k += 1) good[k] = true;
    }

    runsOf(good).forEach(([from, to]) => {
      const start = runStart + from;
      const end = runStart + to;
      if (end - start < config.minPlantFrames) return;

      const slice = track.sole.slice(start, end);
      const ys = slice.map((point) => point.y);
      const spread = Math.max(...ys) - Math.min(...ys);
      if (spread > config.maxHeightSpread) return;

      const anchor = new THREE.Vector3(
        median(slice.map((point) => point.x)),
        median(ys),
        median(slice.map((point) => point.z)),
      );

      /*
        확신 — 「얼마나 평평한가」 와 「얼마나 안 움직이는가」 중 **못한 쪽**을 씁니다. 하나만
        좋아도 괜찮다고 보면, 발끝으로 선 채 가만히 있는 장면을 디딘 것으로 잘못 붙잡습니다.
      */
      const flatScore =
        1 -
        slice.reduce((sum, _, i) => sum + track.flatDeg[start + i], 0) /
          slice.length /
          config.maxFlatnessDeg;
      const speedScore =
        1 -
        speed.slice(start, end).reduce((sum, value) => sum + value, 0) /
          slice.length /
          config.plantSpeed;
      const confidence = Math.min(1, Math.max(0, Math.min(flatScore, speedScore)));
      if (confidence < config.minConfidence) return;

      plants.push({ from: start, to: end, anchor, confidence });
    });
  });
  return plants;
}

/** 디딘 발이 한 장에 가로로 흐른 평균 거리 — 고치기 전후를 같은 자로 잽니다. */
function slideOf(plants: Plant[], sole: THREE.Vector3[]) {
  let total = 0;
  let count = 0;
  plants.forEach((plant) => {
    for (let i = plant.from + 1; i < plant.to; i += 1) {
      total += Math.hypot(sole[i].x - sole[i - 1].x, sole[i].z - sole[i - 1].z);
      count += 1;
    }
  });
  return count ? total / count : 0;
}

/**
 * **왜 못 잡았는지 들여다보기** — 시험대(`__retargetBench`)가 문턱값을 고를 때 씁니다.
 *
 * 「디딘 발 0곳」 만 보고는 발이 정말 안 멈춘 건지, 문턱이 빡빡한 건지 알 수 없습니다.
 * 어느 관문에서 걸렸는지 숫자로 봐야 고칠 수 있어서 따로 냅니다.
 */
export function inspectFootPlant(
  rig: RetargetRig,
  frames: RetargetFrame[],
  config: FootPlantConfig = FOOT_PLANT_DEFAULTS,
) {
  const times = frames.map((frame) => frame.time);
  return trackFeet(rig, frames).map((track) => {
    const { contact, speed } = detectContacts(times, track.sole, config);
    const flatOk = track.flatDeg.filter((value) => value <= config.maxFlatnessDeg).length;
    const slowOk = speed.filter((value) => value <= config.plantSpeed).length;
    return {
      frames: frames.length,
      contactFrames: contact.filter(Boolean).length,
      flatFrames: flatOk,
      slowFrames: slowOk,
      bothFrames: speed.filter((value, i) => value <= config.plantSpeed && track.flatDeg[i] <= config.maxFlatnessDeg).length,
      medianSpeed: Number(median(speed).toFixed(3)),
      medianFlatDeg: Number(median(track.flatDeg).toFixed(1)),
    };
  });
}

/**
 * **디딘 발을 그 자리에 고정합니다.**
 *
 * 켤 때만 부릅니다. 결과는 새 배열이고 원본은 건드리지 않습니다 — 창이 옵션을 껐다 켰다 할 때
 * 예전 결과로 정확히 되돌아가야 하기 때문입니다.
 */
export function lockFootPlants(
  rig: RetargetRig,
  frames: RetargetFrame[],
  config: FootPlantConfig = FOOT_PLANT_DEFAULTS,
): { frames: RetargetFrame[]; report: FootPlantReport } {
  const empty: FootPlantReport = {
    plants: 0,
    coverage: 0,
    movedM: 0,
    slideBeforeM: 0,
    slideAfterM: 0,
  };
  if (frames.length < 4) return { frames, report: empty };

  const times = frames.map((frame) => frame.time);
  const tracks = trackFeet(rig, frames);
  const found = tracks.map((track) => {
    const { contact, speed } = detectContacts(times, track.sole, config);
    return { track, plants: plantsIn(contact, speed, track, config) };
  });
  if (!found.some((foot) => foot.plants.length)) return { frames, report: empty };

  /*
    **잔차를 모읍니다.** 두 발이 동시에 디딘 장에서는 둘이 서로 다른 곳으로 밀자고 할 수 있어,
    확신을 무게로 삼아 평균을 냅니다(soma 도 같은 방식). 한쪽만 디뎠으면 그쪽 말대로입니다.
  */
  const shiftX = new Array<number>(frames.length).fill(0);
  const shiftZ = new Array<number>(frames.length).fill(0);
  const weight = new Array<number>(frames.length).fill(0);

  const add = (index: number, x: number, z: number, w: number) => {
    shiftX[index] += x * w;
    shiftZ[index] += z * w;
    weight[index] += w;
  };

  found.forEach(({ track, plants }) => {
    plants.forEach((plant, order) => {
      // 못 박힌 동안 — 흐른 만큼 그대로 되돌립니다.
      for (let i = plant.from; i < plant.to; i += 1)
        add(
          i,
          (plant.anchor.x - track.sole[i].x) * plant.confidence,
          (plant.anchor.z - track.sole[i].z) * plant.confidence,
          plant.confidence,
        );

      /*
        **스윙 구간으로 감쇠 전파.** 디딘 구간만 고치고 손을 떼면 그 경계에서 골반이 툭 튑니다.
        그래서 경계의 잔차를 옆으로 들고 나가되 smootherstep 으로 스르르 0 이 되게 합니다 —
        스윙의 원래 모양은 그대로 두고 살짝 밀어 주는 셈입니다.
      */
      const before = order > 0 ? plants[order - 1].to : 0;
      const after = order + 1 < plants.length ? plants[order + 1].from : frames.length;
      const leftRes = {
        x: (plant.anchor.x - track.sole[plant.from].x) * plant.confidence,
        z: (plant.anchor.z - track.sole[plant.from].z) * plant.confidence,
      };
      const rightRes = {
        x: (plant.anchor.x - track.sole[plant.to - 1].x) * plant.confidence,
        z: (plant.anchor.z - track.sole[plant.to - 1].z) * plant.confidence,
      };
      const windowOf = (free: number) =>
        free <= 0 ? 0 : Math.max(config.transitionFrames, Math.round(free * config.propagationRatio));

      const leftWindow = Math.min(windowOf(plant.from - before), plant.from - before);
      for (let i = plant.from - leftWindow; i < plant.from; i += 1) {
        const decay = 1 - smootherstep((plant.from - i) / (leftWindow + 1));
        if (decay > 1e-6) add(i, leftRes.x, leftRes.z, plant.confidence * decay);
      }
      const rightWindow = Math.min(windowOf(after - plant.to), after - plant.to);
      for (let i = plant.to; i < plant.to + rightWindow; i += 1) {
        const decay = 1 - smootherstep((i - plant.to + 1) / (rightWindow + 1));
        if (decay > 1e-6) add(i, rightRes.x, rightRes.z, plant.confidence * decay);
      }
    });
  });

  let moved = 0;
  let movedCount = 0;
  const fixed = frames.map((frame, i) => {
    if (weight[i] <= 1e-6) return frame;
    const dx = shiftX[i] / weight[i];
    const dz = shiftZ[i] / weight[i];
    moved += Math.hypot(dx, dz);
    movedCount += 1;
    return { ...frame, root: { x: frame.root.x + dx, y: frame.root.y, z: frame.root.z + dz } };
  });

  const plants = found.flatMap((foot) => foot.plants);
  const before = found.reduce((sum, foot) => sum + slideOf(foot.plants, foot.track.sole), 0) / found.length;
  const after = found.reduce((sum, foot) => {
    const moved2 = foot.track.sole.map(
      (point, i) =>
        new THREE.Vector3(
          point.x + (weight[i] > 1e-6 ? shiftX[i] / weight[i] : 0),
          point.y,
          point.z + (weight[i] > 1e-6 ? shiftZ[i] / weight[i] : 0),
        ),
    );
    return sum + slideOf(foot.plants, moved2);
  }, 0) / found.length;

  const covered = plants.reduce((sum, plant) => sum + (plant.to - plant.from), 0);
  return {
    frames: fixed,
    report: {
      plants: plants.length,
      coverage: covered / (frames.length * FEET.length),
      movedM: movedCount ? moved / movedCount : 0,
      slideBeforeM: before,
      slideAfterM: after,
    },
  };
}
