/**
 * **분석 결과를 구도잡기에 실제로 먹여 보는** 시험대(브라우저에서 돕니다).
 *
 * 앱이 «모션 넣기» 를 누를 때 지나는 길을 그대로 지납니다 —
 * 결과 JSON → `assembleCapture` → `repairPerson` → `createRetargetRig`(인형 GLB) → `retargetPerson`
 * → `placeCapturedMotion` → `applyCapturedMotionIn`.
 * 그리고 들어간 트랙에서 **눈으로 보는 것과 같은 것**을 숫자로 잽니다.
 *
 * · 사람 수 / 프레임 수 / 들어간 키 수
 * · 떨림 — 관절 각도의 프레임 간 2차 차분 평균(클수록 덜덜거림)
 * · 발 미끄러짐 — 디딘 발이 바닥에서 가로로 움직인 양(클수록 미끄러짐)
 * · 키 흔들림 — 골반 높이의 표준편차(클수록 위아래로 출렁임)
 *
 * 이 파일은 `scripts/runRetargetBench.mjs` 가 esbuild 로 묶어 헤드리스 크롬에서 돌립니다.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  assembleCapture,
  captureVideo,
  type CaptureResult,
  type PoseDetector,
} from "@/lib/motionCapture";
import { FilesetResolver, ObjectDetector, PoseLandmarker } from "@mediapipe/tasks-vision";
import { repairPerson } from "@/lib/motionRepair";
import { inspectFootPlant, type FootPlantReport } from "@/lib/footPlant";
import {
  createRetargetRig,
  placeCapturedMotion,
  retargetPerson,
} from "@/lib/motionRetarget";
import {
  addMannequinIn,
  applyCapturedMotionIn,
  motionTracksOf,
} from "@/lib/compositionEdit";
import { normalizeComposition } from "@/lib/composition";

declare global {
  interface Window {
    __benchDone?: string;
  }
}

const MODEL_URL = "/models/female.glb";

function loadTemplate(url: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (error) => reject(error),
    );
  });
}

/** 관절 각도의 **2차 차분** 평균(도). 손떨림처럼 프레임마다 방향이 바뀌는 것을 잡습니다. */
function jitterOf(frames: { bones: Record<string, { x: number; y: number; z: number }> }[]) {
  if (frames.length < 3) return 0;
  const names = Object.keys(frames[0].bones);
  let total = 0;
  let count = 0;
  for (const name of names) {
    for (let index = 2; index < frames.length; index += 1) {
      const a = frames[index - 2].bones[name];
      const b = frames[index - 1].bones[name];
      const c = frames[index].bones[name];
      if (!a || !b || !c) continue;
      const dx = c.x - 2 * b.x + a.x;
      const dy = c.y - 2 * b.y + a.y;
      const dz = c.z - 2 * b.z + a.z;
      total += (Math.hypot(dx, dy, dz) * 180) / Math.PI;
      count += 1;
    }
  }
  return count ? total / count : 0;
}

/** 골반 자리의 가로 이동량 평균(m/프레임) — 디딘 발이 미끄러지면 함께 커집니다. */
function slideOf(frames: { position: { x: number; y: number; z: number } }[]) {
  if (frames.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const a = frames[index - 1].position;
    const b = frames[index].position;
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total / (frames.length - 1);
}

/** 골반 높이의 표준편차(m). 사람이 위아래로 출렁이는 정도. */
function bobOf(frames: { position: { y: number } }[]) {
  if (!frames.length) return 0;
  const values = frames.map((frame) => frame.position.y);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * **앱 안 검출기**(MediaPipe)를 같은 조건으로 만듭니다.
 *
 * 앱은 `lib/poseLandmarker.ts` 가 Vite 의 `?url` 로 wasm 을 들여오는데, 이 시험대는 esbuild 로 묶어서 그 길을 못 씁니다.
 * 그래서 **같은 파일**을 정적 서버에서 읽어 같은 설정으로 만듭니다(모델·문턱값 전부 그대로).
 */
async function builtinDetector(): Promise<PoseDetector & { close: () => void }> {
  const fileset = await FilesetResolver.forVisionTasks("/mpwasm");
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "/models/pose_landmarker_full.task", delegate: "CPU" },
    runningMode: "IMAGE",
    numPoses: 1,
    minPoseDetectionConfidence: 0.3,
    minPosePresenceConfidence: 0.3,
  });
  const people = await ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "/models/efficientdet_lite0.tflite", delegate: "CPU" },
    runningMode: "IMAGE",
    categoryAllowlist: ["person"],
    scoreThreshold: 0.3,
    maxResults: 10,
  });
  return {
    people: (frame: HTMLCanvasElement) =>
      people.detect(frame).detections.flatMap((detection) =>
        detection.boundingBox
          ? [
              {
                x: detection.boundingBox.originX,
                y: detection.boundingBox.originY,
                width: detection.boundingBox.width,
                height: detection.boundingBox.height,
                score: detection.categories[0]?.score ?? 0,
              },
            ]
          : [],
      ),
    pose: (crop: HTMLCanvasElement) => landmarker.detect(crop),
    close: () => {
      landmarker.close();
      people.close();
    },
  } as PoseDetector & { close: () => void };
}

/** 영상 하나를 앱 안 검출기로 분석합니다(로컬 엔진 시험과 같은 4초·15장). */
async function captureBuiltin(name: string, detector: PoseDetector): Promise<CaptureResult> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("영상을 열지 못했습니다")), { once: true });
    video.src = `/videos/${encodeURIComponent(name)}`;
  });
  try {
    return await captureVideo(video, detector, { fps: 15, start: 0, end: 4, mirror: false });
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

/** 리타깃 → 구도 넣기까지 해 보고 숫자를 냅니다. 엔진 결과와 앱 안 검출기가 **같은 길**을 지납니다. */
function measure(
  engine: string,
  file: string,
  raw: CaptureResult,
  template: THREE.Object3D,
): Record<string, unknown> {
  const persons = raw.persons.map((person) => repairPerson(person, "normal"));
  if (!persons.length) return { engine, file, ok: false, note: "사람 없음" };
  const person = persons.slice().sort((a, b) => b.samples.length - a.samples.length)[0];
  const rig = createRetargetRig(template);
  const frames = retargetPerson(rig, person, raw, { smoothing: "normal" });
  if (!frames.length) return { engine, file, ok: false, note: "리타깃 결과 없음" };
  /*
    **디딘 발 고정을 켠 판도 같이 잽니다**. 옵션이라 기본은 꺼짐인데, 켜면
    실제로 나아지는지는 숫자로만 알 수 있습니다 — 같은 영상·같은 사람으로 두 번 돌려 나란히 둡니다.
  */
  let plantReport: FootPlantReport | null = null;
  const plantedFrames = retargetPerson(rig, person, raw, {
    smoothing: "normal",
    footPlant: true,
    onPlantReport: (report) => (plantReport = report),
  });
  const place = (source: typeof frames) =>
    placeCapturedMotion(
      [
        {
          characterId: "bench",
          // 키를 넣기 전 인형이 선 자리·방향 — 원점에서 정면을 봅니다.
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          frames: source,
        },
      ],
      { start: 0, captureStart: raw.start ?? 0, formation: true },
    );
  const placed = place(frames);
  const placedPlanted = place(plantedFrames);
  // 마네킹 하나를 세우고 그 인물에 먹입니다(앱에서 «새 마네킹에 넣기» 를 고른 것과 같습니다).
  let state = addMannequinIn(normalizeComposition({}), "female");
  const target = state.characters[state.characters.length - 1].characterId;
  state = applyCapturedMotionIn(
    state,
    placed.map((item) => ({ ...item, characterId: target })),
    { position: true, rotation: true, pose: true },
  );
  const tracks = motionTracksOf(state).filter((track) => track.targetId === target);
  return {
    engine,
    file,
    ok: true,
    persons: persons.length,
    samples: person.samples.length,
    frames: frames.length,
    tracks: tracks.length,
    keys: tracks.reduce((sum, track) => sum + track.keys.length, 0),
    seconds: Number(((frames[frames.length - 1]?.time ?? 0) - (frames[0]?.time ?? 0)).toFixed(2)),
    jitterDeg: Number(jitterOf(frames).toFixed(2)),
    slideM: Number(slideOf(placed[0]?.frames ?? []).toFixed(4)),
    bobM: Number(bobOf(placed[0]?.frames ?? []).toFixed(4)),
    // 발 고정을 켠 판 — 골반 흐름(slide)과, 고정 단이 스스로 잰 디딘 발의 흐름.
    plantSlideM: Number(slideOf(placedPlanted[0]?.frames ?? []).toFixed(4)),
    plants: plantReport ? (plantReport as FootPlantReport).plants : 0,
    plantCoverage: plantReport ? Number((plantReport as FootPlantReport).coverage.toFixed(2)) : 0,
    footBeforeM: plantReport ? Number((plantReport as FootPlantReport).slideBeforeM.toFixed(4)) : 0,
    footAfterM: plantReport ? Number((plantReport as FootPlantReport).slideAfterM.toFixed(4)) : 0,
    // 못 잡았을 때 어느 관문에서 걸렸는지 — 문턱값을 고르려고 봅니다.
    look: inspectFootPlant(rig, frames),
  };
}

/**
 * 결과 하나를 **구도 상태 그대로** 내보냅니다 — 프로젝트 파일의 컷에 그대로 넣을 수 있게.
 *
 * 앱에서 «모션 넣기» 를 누른 것과
 * 같은 상태(마네킹 + 이동·회전·자세 트랙)를 만들어 JSON 으로 돌려줍니다.
 */
async function exportComposition(file: string, template: THREE.Object3D) {
  const raw = assembleCapture({
    ...(await (await fetch(`/results/${encodeURIComponent(file)}`)).json()),
    mirror: false,
  });
  const person = raw.persons
    .map((item) => repairPerson(item, "normal"))
    .slice()
    .sort((a, b) => b.samples.length - a.samples.length)[0];
  const rig = createRetargetRig(template);
  const frames = retargetPerson(rig, person, raw, { smoothing: "normal" });
  const placed = placeCapturedMotion(
    [
      {
        characterId: "bench",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        frames,
      },
    ],
    { start: 0, captureStart: raw.start ?? 0, formation: true },
  );
  let state = addMannequinIn(normalizeComposition({}), "female");
  const target = state.characters[state.characters.length - 1].characterId;
  state = applyCapturedMotionIn(
    state,
    placed.map((item) => ({ ...item, characterId: target })),
    { position: true, rotation: true, pose: true },
  );
  return state;
}

async function main() {
  // «구도 상태 내보내기» 로 부를 수도 있습니다 — `?export=<결과 파일>`.
  const wanted = new URLSearchParams(location.search).get("export");
  if (wanted) {
    const template = await loadTemplate(MODEL_URL);
    const state = await exportComposition(wanted, template);
    const text = JSON.stringify(state);
    document.getElementById("out")!.textContent = `구도 상태 ${text.length} 글자`;
    await fetch("/done", { method: "POST", body: text });
    return;
  }

  const listed = (await (await fetch("/results/index.json")).json()) as string[];
  const videos = (await (await fetch("/videos/index.json")).json()) as string[];
  const template = await loadTemplate(MODEL_URL);
  const rows: Record<string, unknown>[] = [];

  // 1) 로컬 엔진이 뽑아 둔 결과들
  for (const name of listed) {
    const engine = name.split("__")[0];
    try {
      const file = await (await fetch(`/results/${encodeURIComponent(name)}`)).json();
      rows.push(measure(engine, name, assembleCapture({ ...file, mirror: false }), template));
    } catch (error) {
      rows.push({ engine, file: name, ok: false, note: `결과를 읽지 못함: ${error}` });
    }
  }

  // 2) 앱 안 검출기(MediaPipe) — 같은 영상, 같은 4초·15장
  let detector: (PoseDetector & { close: () => void }) | null = null;
  try {
    detector = await builtinDetector();
  } catch (error) {
    rows.push({ engine: "mediapipe", file: "-", ok: false, note: `검출기를 만들지 못함: ${error}` });
  }
  if (detector) {
    for (const name of videos) {
      try {
        const raw = await captureBuiltin(name, detector);
        rows.push(measure("mediapipe", `mediapipe__${name}`, raw, template));
      } catch (error) {
        rows.push({ engine: "mediapipe", file: name, ok: false, note: String(error) });
      }
    }
    detector.close();
  }

  const text = JSON.stringify(rows, null, 2);
  document.getElementById("out")!.textContent = text;
  window.__benchDone = text;
  // 끝났다고 **서버에 알립니다** — 헤드리스의 가상 시간은 CPU 일을 기다려 주지 않아서,
  // 화면을 긁는 방식으로는 다 끝나기 전에 찍혀 버립니다.
  await fetch("/done", { method: "POST", body: text });
}

void main().catch(async (error) => {
  const text = JSON.stringify([{ ok: false, note: String(error) }]);
  document.getElementById("out")!.textContent = text;
  window.__benchDone = text;
  await fetch("/done", { method: "POST", body: text });
});
