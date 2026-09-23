import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HOLDS_MOCAP, useTutorialPanel } from "@/lib/useTutorialPanel";
import { modalCard } from "@/components/modalShell";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { invoke } from "@tauri-apps/api/core";
import { Film, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { mediaOwnerName } from "@/lib/projectNames";
import { MODEL_URLS, modelTemplates } from "@/components/composition/viewport/sceneHelpers";
import type { CompositionCharacterSource, CompositionState } from "@/lib/composition";
import { addMannequinIn, applyCapturedMotionIn, uid, type UpdateComposition } from "@/lib/compositionEdit";
import { isDesktopApp } from "@/lib/llm";
import { useLocalEngines } from "@/lib/localEngines";
import { assetSrc } from "@/lib/mediaLibrary";
import {
  CAPTURE_CONNECTIONS,
  sampleNear,
  type CapturedPerson,
} from "@/lib/motionCapture";
import {
  addMocapSource,
  cancelMocap,
  enqueueMocap,
  loadMocapResult,
  patchMocapSource,
  removeMocapSource,
  repairedCapture,
  importMocapVideo,
  saveMocapVideo,
  useMocapSources,
  type MocapSource,
} from "@/lib/mocapStore";
import type { FootPlantReport } from "@/lib/footPlant";
import {
  createRetargetRig,
  placeCapturedMotion,
  retargetPerson,
  type PlacedFrame,
  type RetargetFrame,
  type RetargetRig,
} from "@/lib/motionRetarget";
import { mannequinBody } from "@/lib/rig";
import { useT } from "@/lib/i18n";
import { HAND_CONNECTIONS } from "@/lib/handCapture";

/**
 * **영상에서 모션 가져오기** 창.
 *
 * ,
 * 「관절만 추적하면 안 되고 이동이랑 몸체 회전도」, 「업스케일링처럼 모델 선택해서 분석할 수 있게」, 「뮤직비디오 같은 경우 캐릭터
 * 1개당 영상(솔로 영상) 하나를 매칭 시킬 수도 있어야 해」, 「캐릭터마다 영상 매칭 또는 한 영상에서 추적할 인물 선택해서 캐릭터에
 * 매칭이 혼합적으로 가능해야 해」.
 *
 * # 영상이 여러 개
 *
 * 왼쪽 목록에 영상을 여러 개 올립니다. 영상마다 **모델 · 구간 · 초당 장 · 튐 보정 · 타임라인 시작**을 따로 정하고, 영상 속 번호마다
 * 캐릭터를 고릅니다. 군무 영상 하나에서 셋을 뽑고 솔로 영상 둘을 다른 캐릭터에 붙이는 식으로 섞을 수 있습니다. «타임라인에 넣기»
 * 한 번에 전부 들어가고, Ctrl+Z 한 번에 전부 되돌아갑니다.
 *
 * # 올린 영상은 프로젝트 폴더에 담습니다
 *
 *
 * `<프로젝트>/mocap/<영상 이름>/` 에 원본과 분석 결과가 함께 있습니다 — 분석은 몇 분씩 걸리므로,
 * 원본이 남의 폴더에 있으면 프로젝트를 옮기는 순간 다시 분석해야 합니다.
 *
 * 폴더 이름은 파일 이름 그대로가 아니라 **다듬어서** 씁니다(`mediaOwnerName`) — 유튜브에서 받은
 * 이름에는 이모지와 해시태그가 줄줄이 붙어 폴더 이름이 200자를 넘었습니다.
 */

const PERSON_COLORS = ["#5b8dd9", "#e0728f", "#4fb3c4", "#e39358", "#7a7ee0", "#d9a13f", "#3f9d7a", "#c96fc4"];

/** 짝 선택지 — 캐릭터 id, 또는 새 마네킹 / 안 씀. */

const textColor = (lightness: number) => `oklch(${lightness} 0.01 265)`;

/**
 * 초당 몇 장을 볼지.
 *
 *
 * 분석은 영상의 **모든 장**을 볼 수 있습니다(30 fps 영상이면 30). 60 은 60 fps 로 찍은 영상에서만 뜻이 있습니다 — 30 fps 영상에
 * 60 을 주면 같은 장을 두 번 봅니다. 키도 그 간격 그대로 들어가 1/30 초 동작까지 남습니다.
 */
const FPS_OPTIONS = [10, 15, 30, 60] as const;

/** 앱 안 검출기 id — 로컬 엔진 목록과 같은 자리에 섭니다. */
const BUILTIN_ENGINE = "mediapipe";

/**
 * 목록 한 줄. **창 밖의 저장소**(`lib/mocapStore.ts`)가 들고 있습니다 — 창을 닫아도 분석이 이어지고,
 * 프로젝트마다 따로 남습니다(, 「프로젝트별로
 * 관리가 되어야지, 나중에 내가 어떤 걸 분석했는지 알지」).
 */
type VideoSource = MocapSource;

/** 지금 분석 중이거나 차례를 기다리는가. */
const busy = (source: VideoSource) => source.status === "running" || source.status === "queued";


export function MotionCaptureDialog({
  state,
  setState,
  plannerCharacters,
  projectName,
  playhead,
  openWith,
  onClose,
}: {
  state: CompositionState;
  setState: UpdateComposition;
  plannerCharacters: CompositionCharacterSource[];
  /** 분석 기록을 담을 프로젝트 — 목록도 저장 폴더도 프로젝트마다 따로입니다. */
  projectName: string;
  /** 창을 연 순간의 재생 위치 — 새 영상의 «타임라인 시작» 기본값. */
  playhead: number;
  /**
   * 타임라인 인물 줄의 **오른쪽 단추**로 열었을 때 «무엇을 하러 왔는가».
   *
   *
   * 창을 열고 줄을 다시 찾게 하면 우클릭으로 연 뜻이 없습니다 — 그 줄을 골라 두고,
   * 그 사람을 1번에 짝지어 두고, «재분석» 이면 곧바로 줄에 세웁니다.
   */
  openWith?: {
    characterId: string;
    sourceId?: string;
    reanalyze?: boolean;
  } | null;
  onClose: () => void;
}) {
  const t = useT();
  // 걸음이 이 창 밖을 가리키면 물러납니다 — 규칙은 `useTutorialPanel` 한 곳.
  useTutorialPanel({ open: true, holds: HOLDS_MOCAP, onClose });

  const sources = useMocapSources(projectName);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channels, setChannels] = useState({ position: true, rotation: true, pose: true });
  const [applying, setApplying] = useState(false);
  /** 이름을 고치는 중인 줄. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  /** 시간 표시와 스크럽 막대 — 장마다 DOM 에 바로 씁니다(setState 하면 창이 60번 다시 그려집니다). */
  const timeLabelRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  /** 지금 그리는 함수. 결과가 늦게 도착해도 이것으로 한 번 더 그립니다. */
  const drawRef = useRef<((time: number) => void) | null>(null);
  /**
   * 그리는 고리가 **늘 최신 줄**을 보게 합니다.
   *
   * 고리는 고른 줄이 바뀔 때만 다시 겁니다(`selected?.id`). 분석이 끝나 결과가 들어오는
   * 것은 같은 줄 안의 변화라 고리는 그대로인데, 그때 `selected` 를 값으로 잡아 두면
   * 옛 줄(결과 없음)을 계속 보게 됩니다.
   */
  const selectedRef = useRef<VideoSource | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 진행률은 상태로 두지 않습니다 — 장마다 setState 하면 구도잡기 전체가 다시 그려집니다(`useReferenceVideo` 와 같은 까닭).
  const { engines } = useLocalEngines();
  const desktop = isDesktopApp();

  const placed = useMemo(() => state.characters.filter((item) => !item.hidden), [state.characters]);
  const nameOf = (id: string) => plannerCharacters.find((item) => item.id === id)?.name ?? "이름 없음";
  const selected = sources.find((item) => item.id === selectedId) ?? null;
  selectedRef.current = selected;
  /** 이 영상의 초당 장수 — 못 쟀으면 30 으로 봅니다(가장 흔한 값). */
  const nativeFps = selected?.nativeFps ?? 30;
  /*
    앱을 다시 켜면 결과는 **파일로만** 남아 있습니다. 고른 줄의 것을 그때 읽어 옵니다 —
    목록을 열자마자 다 읽으면 큰 JSON 여러 개를 한꺼번에 읽게 됩니다.
  */
  useEffect(() => {
    if (selected && !selected.raw && selected.resultPath)
      void loadMocapResult(projectName, selected);
  }, [selected, projectName]);
  const anyAnalyzing = sources.some((item) => busy(item));

  /*
    ── 오른쪽 단추로 열었을 때 ────────────────────────────────────────
    한 번만 합니다(`handled`). 두 번 돌면 «재분석» 이 되풀이됩니다.
  */
  const handled = useRef(false);
  useEffect(() => {
    if (!openWith || handled.current || !sources.length) return;
    handled.current = true;
    const target =
      sources.find((item) => item.id === openWith.sourceId) ??
      // 넣은 모션이 없으면(«모션 넣기») 분석이 끝난 것 중 첫 줄을 보여 줍니다.
      sources.find((item) => item.result) ??
      sources[0];
    if (!target) return;
    setSelectedId(target.id);
    // 그 사람을 1번에 짝지어 둡니다 — 우클릭한 줄이 곧 넣을 대상입니다.
    patchMocapSource(projectName, target.id, (current) => ({
      ...current,
      assign: { ...current.assign, 1: openWith.characterId },
    }));
    if (openWith.reanalyze) enqueueMocap(projectName, target.id);
  }, [openWith, sources, projectName]);

  /** 모델 목록 — 앱 안 MediaPipe + 로컬 모션 캡처 엔진(설치된 것만 고를 수 있음). 업스케일 엔진 고르기와 같은 모양. */
  const engineOptions = useMemo(
    () => [
      { id: BUILTIN_ENGINE, label: "MediaPipe · 앱 내장", ready: true, note: "설치 없이 바로 · 가볍고 빠름 · 뒤돈 자세·가림에 약함" },
      ...engines
        .filter((engine) => engine.kind === "mocap")
        .sort((a, b) => a.priority - b.priority)
        .map((engine) => ({
          id: engine.id as string,
          label: engine.name.replace(/^모션 캡처 — /, ""),
          ready: engine.installed && desktop,
          note: !desktop
            ? "데스크톱 앱에서만"
            : engine.installed
              ? `${engine.purpose} · ${engine.license.replace(/\*\*/g, "")}`
              : "설정 → 로컬 모델에서 설치하세요",
        })),
    ],
    [engines, desktop],
  );

  const patchSource = (id: string, update: (current: VideoSource) => VideoSource) =>
    patchMocapSource(projectName, id, update);

  /*
    창을 닫아도 **분석을 멈추지 않습니다**().
    blob 주소도 저장소가 들고 있으므로 여기서 풀지 않습니다 — 풀면 다시 열었을 때 미리보기가 깨집니다.
  */
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const addSource = (name: string, path: string | null, blobUrl: string | null) => {
    const bestEngine = path
      ? engineOptions.find((option) => option.ready && option.id !== BUILTIN_ENGINE)?.id
      : undefined;
    const source: VideoSource = {
      id: uid("clip"),
      name,
      path,
      previewUrl: path ? assetSrc(path) : blobUrl ?? "",
      blobUrl,
      duration: 0,
      // 설치된 로컬 엔진이 있으면 그것을 먼저(더 정확함), 없으면 앱 내장.
      engine: bestEngine ?? BUILTIN_ENGINE,
      fps: 30,
      mirror: false,
      clipStart: 0,
      clipEnd: 0,
      repair: "normal",
      smoothing: "normal",
      raw: null,
      result: null,
      resultPath: null,
      assign: {},
      start: Math.round(playhead * 100) / 100,
      formation: true,
      status: "idle",
      percent: 0,
      message: "",
      analyzedAt: null,
    };
    addMocapSource(projectName, source);
    setSelectedId(source.id);
  };

  /** 브라우저에서 고른 파일은 **프로젝트 폴더에 넣고** 그 경로로 씁니다. */
  const addFile = async (file: File) => {
    const saved = await saveMocapVideo(projectName, file).catch(() => null);
    /*
      **화면에도 정리된 이름으로 올립니다**(). 폴더는 「춤선이 너무 예뻤던…」 인데 목록은 이모지투성이 원본 이름이면
      같은 영상인지 알 수가 없습니다. 결과 JSON 의 이름도 이것을 따릅니다.
    */
    addSource(mediaOwnerName(file.name), saved, saved ? null : URL.createObjectURL(file));
    if (saved) toast.success("영상을 프로젝트 폴더에 담았습니다.", { description: saved });
  };

  const pickVideos = async () => {
    if (desktop) {
      try {
        const paths = await invoke<string[]>("choose_video_files");
        /*
          **고른 영상을 프로젝트 폴더로 담습니다.** 여태 경로만 기억해서, 프로젝트를 통째로
          옮기면 분석 결과만 남고 원본은 남의 폴더에 있었습니다().
          담지 못하면 원래 경로로 그냥 씁니다 — 분석은 되어야 하니까요.
        */
        for (const path of paths) {
          const { path: stored, name } = await importMocapVideo(projectName, path);
          addSource(name, stored, null);
        }
        if (paths.length)
          toast.success(`영상 ${paths.length}개를 프로젝트 폴더에 담았습니다.`);
      } catch (error) {
        toast.error(`영상을 고르지 못했습니다. ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    fileRef.current?.click();
  };

  const removeSource = (id: string) => {
    cancelMocap(projectName, id);
    removeMocapSource(projectName, id);
    if (selectedId === id) setSelectedId(sources.find((item) => item.id !== id)?.id ?? null);
  };

  /*
    ── 영상의 초당 장수 재기 ────────────────────────────────────────
    브라우저는 영상의 fps 를 알려 주지 않습니다. 장이 넘어갈 때 오는 콜백에서 **미디어 시각 차**를 재면
    1/Δ 가 곧 초당 장수입니다. 손떨림이 있으니 흔한 값(24·25·30·50·60)으로 맞춰 적습니다.
  */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selected || selected.nativeFps) return;
    type WithCallback = HTMLVideoElement & {
      requestVideoFrameCallback?: (
        callback: (now: number, meta: { mediaTime: number }) => void,
      ) => number;
    };
    const rich = video as WithCallback;
    if (!rich.requestVideoFrameCallback) return;
    let previous: number | null = null;
    let done = false;
    const id = selected.id;
    const tick = (_now: number, meta: { mediaTime: number }) => {
      if (done) return;
      if (previous !== null) {
        const gap = meta.mediaTime - previous;
        if (gap > 0.001) {
          const measured = 1 / gap;
          const common = [24, 25, 30, 50, 60, 120];
          const near = common.reduce((best, value) =>
            Math.abs(value - measured) < Math.abs(best - measured) ? value : best,
          );
          done = true;
          patchMocapSource(projectName, id, (current) => ({ ...current, nativeFps: near }));
          return;
        }
      }
      previous = meta.mediaTime;
      rich.requestVideoFrameCallback?.(tick);
    };
    rich.requestVideoFrameCallback(tick);
    // 장이 한 번은 넘어가야 합니다 — 멈춰 있으면 콜백이 안 옵니다.
    void video.play().then(() => video.pause()).catch(() => undefined);
    return () => {
      done = true;
    };
  }, [selected, projectName]);

  /*
    ── 겹쳐 그리기: 지금 보는 장의 뼈대와 번호 ──────────────────────────
    **장마다 다시 그립니다.**

    예전에는 React 상태(`previewTime`)가 바뀔 때만 그렸는데, 그 상태를 채우는
    `timeupdate` 는 **초당 네 번쯤**만 옵니다. 30 fps 영상이면 일곱 장에 한 번만
    따라간 셈이라, 춤처럼 빠른 동작에서는 뼈가 늘 뒤처져 보였습니다.

    이제 `requestVideoFrameCallback`(없으면 rAF)으로 **장이 넘어갈 때마다** 그리고,
    시간 표시도 DOM 에 바로 씁니다 — 60번의 setState 는 이 무거운 창을 60번 다시 그립니다.
  */
  useEffect(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let alive = true;

    const draw = (time: number) => {
      const width = video.clientWidth;
      const height = video.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height);
      // 시간 표시는 DOM 에 바로 — 상태로 돌리면 장마다 창 전체가 다시 그려집니다.
      if (timeLabelRef.current) timeLabelRef.current.textContent = time.toFixed(2);
      if (scrubRef.current && document.activeElement !== scrubRef.current)
        scrubRef.current.value = String(time);

      const result = selectedRef.current?.result;
      if (!result) return;
      // 영상이 상자 안에 가운데 맞춰 들어가므로(object-contain) 그 자리를 계산합니다.
      const scale = Math.min(width / result.width, height / result.height);
      const offsetX = (width - result.width * scale) / 2;
      const offsetY = (height - result.height * scale) / 2;
      const mirror = result.mirrored ?? selectedRef.current?.mirror ?? false;
      const toX = (x: number) => offsetX + (mirror ? 1 - x : x) * result.width * scale;
      const toY = (y: number) => offsetY + y * result.height * scale;
      for (const person of result.persons) {
        const sample = sampleNear(person, time);
        if (!sample) continue;
        const color = PERSON_COLORS[(person.number - 1) % PERSON_COLORS.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        for (const [a, b] of CAPTURE_CONNECTIONS) {
          ctx.beginPath();
          ctx.moveTo(toX(sample.image[a].x), toY(sample.image[a].y));
          ctx.lineTo(toX(sample.image[b].x), toY(sample.image[b].y));
          ctx.stroke();
        }
        ctx.lineWidth = 1;
        for (const hand of [sample.hands?.left, sample.hands?.right]) {
          if (!hand) continue;
          for (const [a, b] of HAND_CONNECTIONS) {
            const from = hand.image[a], to = hand.image[b];
            if (!from || !to || from.v <= 0.3 || to.v <= 0.3) continue;
            ctx.beginPath(); ctx.moveTo(toX(from.x), toY(from.y)); ctx.lineTo(toX(to.x), toY(to.y)); ctx.stroke();
          }
        }
        const headX = toX(sample.image[0].x);
        const headY = toY(Math.min(sample.image[0].y, sample.image[7].y, sample.image[8].y)) - 18;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(headX, headY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(person.number), headX, headY + 0.5);
      }
    };

    drawRef.current = draw;

    type WithCallback = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    const rich = video as WithCallback;
    let frameHandle = 0;
    let rafHandle = 0;

    if (rich.requestVideoFrameCallback) {
      const tick = (_now: number, meta: { mediaTime: number }) => {
        if (!alive) return;
        draw(meta.mediaTime);
        frameHandle = rich.requestVideoFrameCallback!(tick);
      };
      frameHandle = rich.requestVideoFrameCallback(tick);
    } else {
      // 사파리 옛 판 등 — 화면 주사율로 따라갑니다. 영상 장수보다 촘촘해도 손해는 없습니다.
      const loop = () => {
        if (!alive) return;
        draw(video.currentTime);
        rafHandle = window.requestAnimationFrame(loop);
      };
      rafHandle = window.requestAnimationFrame(loop);
    }

    // 멈춰 있을 때도 한 번은 그립니다 — 콜백은 장이 넘어가야 옵니다.
    draw(video.currentTime);

    return () => {
      alive = false;
      if (frameHandle && rich.cancelVideoFrameCallback) rich.cancelVideoFrameCallback(frameHandle);
      if (rafHandle) window.cancelAnimationFrame(rafHandle);
      drawRef.current = null;
    };
  }, [selected?.id]);

  /* 고른 줄이 바뀌거나 분석이 끝나면(결과가 들어오면) 멈춘 채로도 다시 그립니다. */
  useEffect(() => {
    const video = videoRef.current;
    if (video) drawRef.current?.(video.currentTime);
  }, [selected?.result, selected?.mirror]);


  /**
   * 분석을 **줄에 세웁니다.** 여러 개를 눌러 두면 하나씩 차례로 돕니다.
   * 실제 분석은 창 밖의 저장소가 하므로 창을 닫아도 이어집니다.
   */
  const analyze = (source: VideoSource) => enqueueMocap(projectName, source.id);

  /** 성별 인형 틀 — 화면이 이미 읽어 둔 것을 쓰고, 없으면 읽습니다(같은 캐시). */
  const loadTemplate = async (gender?: string) => {
    const url = MODEL_URLS[mannequinBody(gender)];
    const cached = modelTemplates.get(url);
    if (cached) return cached;
    const gltf = await new GLTFLoader().loadAsync(url);
    modelTemplates.set(url, gltf.scene);
    return gltf.scene as THREE.Group;
  };

  /** 모든 영상의 짝 — 사람 조각을 캐릭터마다 모은 것과, 같은 시간에 한 캐릭터에 두 사람이 겹치는지. */
  const plan = useMemo(() => {
    type Piece = { source: VideoSource; key: string; persons: CapturedPerson[]; from: number; to: number };
    const pieces: Piece[] = [];
    for (const source of sources) {
      if (!source.result) continue;
      const groups = new Map<string, CapturedPerson[]>();
      for (const person of source.result.persons) {
        const choice = source.assign[person.number] ?? "skip";
        if (choice === "skip") continue;
        // 새 마네킹은 번호마다 따로 섭니다. 같은 캐릭터에 고른 번호들은 한 사람의 조각으로 봅니다(뒤돌다 끊긴 번호).
        const key = choice.startsWith("new-") ? `${choice}#${source.id}#${person.number}` : choice;
        groups.set(key, [...(groups.get(key) ?? []), person]);
      }
      for (const [key, persons] of groups) {
        const times = persons.flatMap((person) => [person.samples[0].time, person.samples[person.samples.length - 1].time]);
        const offset = source.start - source.result.start;
        pieces.push({ source, key, persons, from: Math.min(...times) + offset, to: Math.max(...times) + offset });
      }
    }
    // 같은 캐릭터가 같은 시간에 두 번 나오면 막습니다(한 캐릭터에는 한 사람). 시간이 안 겹치면 이어 넣습니다.
    const conflicts = new Set<string>();
    const byKey = new Map<string, Piece[]>();
    for (const piece of pieces) byKey.set(piece.key, [...(byKey.get(piece.key) ?? []), piece]);
    for (const [key, list] of byKey) {
      // 한 영상 안의 같은 캐릭터 조각은 사람 조각끼리 시간이 겹치는지 따로 봅니다.
      for (const piece of list) {
        const spans = piece.persons
          .map((person) => [person.samples[0].time, person.samples[person.samples.length - 1].time] as const)
          .sort((a, b) => a[0] - b[0]);
        if (spans.some((spanItem, i) => i > 0 && spanItem[0] <= spans[i - 1][1])) conflicts.add(nameOf(key));
      }
      const sorted = [...list].sort((a, b) => a.from - b.from);
      for (let i = 1; i < sorted.length; i += 1) if (sorted[i].from <= sorted[i - 1].to) conflicts.add(nameOf(key));
    }
    return { pieces, conflicts: [...conflicts] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, plannerCharacters]);

  const apply = async () => {
    if (!plan.pieces.length) {
      toast.error("짝지은 캐릭터가 없습니다.");
      return;
    }
    if (plan.conflicts.length) {
      toast.error(`${plan.conflicts.join(", ")} 에 고른 사람들이 같은 시간에 함께 나옵니다 — 한 캐릭터에는 한 사람만 넣을 수 있습니다.`);
      return;
    }
    setApplying(true);
    try {
      const rigs = new Map<string, RetargetRig>();
      /** 영상별 «디딘 발 고정» 결과 — 넣고 나서 한 줄로 알려 주려고 모읍니다. */
      const plantReports = new Map<string, FootPlantReport>();
      const freshIds = new Map<string, { id: string; gender: "male" | "female" }>();
      const jobs: { source: VideoSource; id: string; frames: RetargetFrame[] }[] = [];
      for (const piece of plan.pieces) {
        let id = piece.key;
        let gender: string | undefined;
        if (piece.key.startsWith("new-")) {
          const fresh = freshIds.get(piece.key) ?? {
            id: uid("mannequin"),
            gender: piece.key.startsWith("new-male") ? ("male" as const) : ("female" as const),
          };
          freshIds.set(piece.key, fresh);
          id = fresh.id;
          gender = fresh.gender;
        } else {
          gender = plannerCharacters.find((item) => item.id === piece.key)?.gender;
        }
        const body = mannequinBody(gender);
        if (!rigs.has(body)) rigs.set(body, createRetargetRig(await loadTemplate(gender)));
        const person = {
          number: piece.persons[0].number,
          samples: piece.persons.flatMap((item) => item.samples).sort((a, b) => a.time - b.time),
        };
        jobs.push({
          source: piece.source,
          id,
          frames: retargetPerson(rigs.get(body)!, person, piece.source.result!, {
            smoothing: piece.source.smoothing,
            footPlant: piece.source.footPlant === true,
            onPlantReport: (report) => plantReports.set(piece.source.id, report),
          }),
        });
        // 사람이 많고 길면 몇 초 걸립니다 — 사이사이 화면을 넘겨 창이 멈춘 것처럼 안 보이게.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const snapshot = sources;
      setState((current) => {
        let next = current;
        for (const fresh of freshIds.values()) next = addMannequinIn(next, fresh.gender, fresh.id);
        const placements: { characterId: string; frames: PlacedFrame[] }[] = [];
        /*
          대형은 영상마다 따로 잽니다 — 서로 다른 영상의 사람끼리는 간격을 알 수 없습니다.
          **넣는 것도 영상마다** 따로 부릅니다. 한꺼번에 넣으면 어느 트랙이 어느 모션에서
          왔는지 적을 수가 없어, 레이어에 «수화(춤선…)» 을 띄울 수 없습니다.
        */
        let built = next;
        for (const source of snapshot) {
          const own = jobs.filter((job) => job.source.id === source.id);
          if (!own.length || !source.result) continue;
          const placed = placeCapturedMotion(
            own.map((job) => {
              const character = built.characters.find((item) => item.characterId === job.id);
              return {
                characterId: job.id,
                frames: job.frames,
                position: character?.position ?? { x: 0, y: 0, z: 0 },
                rotation: character?.rotation ?? { x: 0, y: 0, z: 0 },
              };
            }),
            { start: source.start, captureStart: source.result.start, formation: source.formation },
          );
          placements.push(...placed);
          built = applyCapturedMotionIn(built, placed, channels, {
            id: source.id,
            name: source.name,
          });
        }
        return built;
      });
      const people = new Set(jobs.map((job) => job.id)).size;
      const clips = new Set(jobs.map((job) => job.source.id)).size;
      /*
        발 고정을 켰으면 **무엇이 달라졌는지** 숫자로 알려 줍니다. 「켰는데 뭐가 달라졌지?」 를
        눈으로 찾게 두면 옵션이 있으나 마나 합니다.
      */
      const planted = [...plantReports.values()].filter((report) => report.plants > 0);
      const plantLine = planted.length
        ? ` · 디딘 발 ${planted.reduce((sum, report) => sum + report.plants, 0)}곳 고정(미끄러짐 ${(
            planted.reduce((sum, report) => sum + report.slideBeforeM, 0) / planted.length
          ).toFixed(3)} → ${(
            planted.reduce((sum, report) => sum + report.slideAfterM, 0) / planted.length
          ).toFixed(3)} m)`
        : "";
      toast.success(`영상 모션을 넣었습니다 · 영상 ${clips}개 · 캐릭터 ${people}명${plantLine}`, {
        description: "이동·몸 방향·관절 키 — Ctrl+Z 로 한 번에 되돌릴 수 있습니다",
      });
      onClose();
    } catch (error) {
      toast.error(`모션을 넣지 못했습니다. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setApplying(false);
    }
  };

  const span = (person: CapturedPerson) =>
    `${person.samples[0].time.toFixed(1)}~${person.samples[person.samples.length - 1].time.toFixed(1)}초`;

  const checkbox = (label: string, checked: boolean, onChange: (value: boolean) => void, hint?: string) => (
    <label className="flex cursor-pointer items-center gap-1.5 text-[10px]" style={{ color: textColor(0.72) }} title={hint}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );

  const numberField = (value: number, onChange: (value: number) => void, step = 0.1, disabled = false) => (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      min={0}
      disabled={disabled}
      onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
      className="w-16 rounded px-1.5 py-0.5 text-[10px] tabular-nums outline-none disabled:opacity-50"
      style={{ background: "oklch(1 0 0 / 6%)", color: textColor(0.85), border: "1px solid oklch(1 0 0 / 8%)" }}
    />
  );

  const pills = <T extends string | number>(
    value: T,
    options: readonly (readonly [T, string, string])[],
    onChange: (value: T) => void,
    disabled = false,
  ) => (
    <span className="flex gap-1">
      {options.map(([id, label, hint]) => (
        <button
          key={String(id)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(id)}
          className="rounded px-1.5 py-0.5 disabled:opacity-50"
          style={{
            background: value === id ? "oklch(0.62 0.22 290 / 22%)" : "oklch(1 0 0 / 5%)",
            color: value === id ? "oklch(0.84 0.19 290)" : textColor(0.7),
          }}
          title={hint}
        >
          {label}
        </button>
      ))}
    </span>
  );

  const row = (label: string, control: ReactNode) => (
    <div className="flex items-center justify-between gap-2 text-[10px]" style={{ color: textColor(0.68) }}>
      <span className="shrink-0">{label}</span>
      {control}
    </div>
  );

  const selectedEngine = selected ? engineOptions.find((option) => option.id === selected.engine) : undefined;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-5" style={{ background: "oklch(0 0 0 / 72%)" }}>
      <div
        className={modalCard("large")}
        style={{ background: "oklch(0.15 0.01 265)", border: "1px solid oklch(1 0 0 / 10%)" }}
      >
        <div className="flex shrink-0 items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid oklch(1 0 0 / 8%)" }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: textColor(0.88) }}>
              영상에서 모션 가져오기
            </p>
            <p className="text-[10px]" style={{ color: textColor(0.52) }}>
              영상을 여러 개 올려 영상마다 모델로 분석하고, 번호마다 캐릭터를 고르세요. 군무 한 영상에서 여럿 · 솔로 영상을 캐릭터마다 섞어도 됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-tour="mocap-close"
            className="rounded-md p-1.5 hover:bg-white/10"
            style={{ color: textColor(0.62) }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(event) => {
            for (const file of Array.from(event.target.files ?? [])) void addFile(file);
            event.target.value = "";
          }}
        />

        <div className="composition-scroll grid min-h-0 flex-1 grid-cols-[190px_1fr_300px] gap-3 overflow-y-auto p-3">
          {/* ── 왼쪽: 영상 목록 ── */}
          <div data-tour="mocap-sources" className="space-y-1.5">
            <p className="text-[11px] font-bold" style={{ color: textColor(0.5) }}>
              영상 {sources.length}개
            </p>
            {sources.map((source) => {
              const count = source.result?.persons.length;
              const used = Object.values(source.assign).filter((value) => value !== "skip").length;
              return (
                <div
                  key={source.id}
                  role="button"
                  tabIndex={0}
                  data-source={source.id}
                  onClick={() => setSelectedId(source.id)}
                  onKeyDown={(event) => event.key === "Enter" && setSelectedId(source.id)}
                  className="cursor-pointer rounded-md px-2 py-1.5"
                  style={{
                    background: source.id === selectedId ? "oklch(0.62 0.22 290 / 16%)" : "oklch(1 0 0 / 4%)",
                    border: `1px solid ${source.id === selectedId ? "oklch(0.62 0.22 290 / 40%)" : "oklch(1 0 0 / 6%)"}`,
                  }}
                >
                  <div className="flex items-center gap-1">
                    <Film className="h-3 w-3 shrink-0" style={{ color: textColor(0.6) }} />
                    {/*
                      **이름은 두 번 눌러 고칩니다.** 타임라인 레이어에 «수화(춤선…)» 으로
                      뜨는 것이 이 이름이라, 「KakaoTalk_2026…」 으로는 무슨 춤인지 모릅니다.
                      파일은 그대로 두고 **부르는 이름만** 바꿉니다.
                    */}
                    {renaming === source.id ? (
                      <input
                        autoFocus
                        defaultValue={source.name}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (next) patchSource(source.id, (current) => ({ ...current, name: next }));
                          setRenaming(null);
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") setRenaming(null);
                        }}
                        className="min-w-0 flex-1 rounded px-1 py-0.5 text-[10px] outline-none"
                        style={{
                          background: "oklch(1 0 0 / 10%)",
                          color: textColor(0.92),
                          border: "1px solid oklch(0.62 0.22 290 / 50%)",
                        }}
                      />
                    ) : (
                      <span
                        className="min-w-0 flex-1 truncate text-[10px]"
                        style={{ color: textColor(0.85) }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          setRenaming(source.id);
                        }}
                        title={`${source.path ?? source.name}
두 번 누르면 이름을 고칩니다 — 타임라인 레이어에 이 이름이 뜹니다`}
                      >
                        {source.name}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeSource(source.id);
                      }}
                      className="rounded p-0.5 opacity-60 hover:bg-white/10 hover:opacity-100"
                      title="목록에서 빼기(원본 영상 파일은 그대로)"
                    >
                      <Trash2 className="h-3 w-3" style={{ color: textColor(0.6) }} />
                    </button>
                  </div>
                  <p className="mt-0.5 text-[9px]" style={{ color: source.message ? "oklch(0.75 0.14 60)" : textColor(0.48) }}>
                    {busy(source)
                      ? "분석 중…"
                      : source.message
                        ? source.message
                        : count === undefined
                          ? `${engineOptions.find((option) => option.id === source.engine)?.label ?? source.engine} · 분석 전`
                          : `${count}명 · 짝 ${used} · ${source.start.toFixed(2)}초부터`}
                  </p>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => void pickVideos()}
              data-tour="mocap-add-video"
              className="flex w-full items-center justify-center gap-1 rounded-md px-2 py-2 text-[10px] font-semibold"
              style={{ background: "oklch(0.18 0.012 265)", border: "1px dashed oklch(1 0 0 / 16%)", color: textColor(0.75) }}
            >
              <Plus className="h-3 w-3" /> 영상 추가
            </button>
            <p className="text-[9px] leading-relaxed" style={{ color: textColor(0.42) }}>
              발끝까지 보이는 전신 · 고정 카메라가 가장 정확합니다. 목록에서 빼도 원본 영상 파일은 지우지 않습니다.
            </p>
          </div>

          {/* ── 가운데: 미리보기 + 뼈대 ── */}
          <div data-tour="mocap-preview" className="min-w-0 space-y-2">
            {selected ? (
              <>
                <div className="relative overflow-hidden rounded-lg" style={{ background: "#000" }}>
                  <video
                    key={selected.id}
                    ref={videoRef}
                    src={selected.previewUrl}
                    muted
                    playsInline
                    className="block aspect-video w-full object-contain"
                    style={{ transform: selected.mirror ? "scaleX(-1)" : undefined }}
                    onLoadedMetadata={(event) => {
                      const seconds = event.currentTarget.duration || 0;
                      patchSource(selected.id, (current) => ({
                        ...current,
                        duration: seconds,
                        clipEnd: current.clipEnd > 0 ? current.clipEnd : Math.floor(seconds * 10) / 10,
                      }));
                    }}
                    /* 멈춘 채로 자리를 옮겼을 때도 뼈가 따라오게 — 장 콜백은 재생 중에만 옵니다. */
                    onSeeked={(event) => drawRef.current?.(event.currentTarget.currentTime)}
                  />
                  <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const video = videoRef.current;
                      if (!video) return;
                      if (video.paused) void video.play();
                      else video.pause();
                    }}
                    className="rounded-md px-2 py-1 text-[10px]"
                    style={{ background: "oklch(1 0 0 / 6%)", color: textColor(0.75) }}
                  >
                    재생 / 멈춤
                  </button>
                  {/*
                    막대와 시간은 **다스리지 않는 칸**입니다(`defaultValue`). 그리는 고리가
                    장마다 DOM 에 바로 써서, 60번의 setState 로 이 무거운 창을 다시 그리지
                    않습니다. 사람이 막대를 잡고 있는 동안은 고리가 건드리지 않습니다.
                  */}
                  <input
                    ref={scrubRef}
                    type="range"
                    min={0}
                    max={selected.duration || 0}
                    step={0.01}
                    defaultValue={0}
                    onChange={(event) => {
                      const time = Number(event.target.value);
                      if (videoRef.current) videoRef.current.currentTime = time;
                      drawRef.current?.(time);
                    }}
                    className="flex-1"
                  />
                  <span className="w-24 text-right text-[10px] tabular-nums" style={{ color: textColor(0.6) }}>
                    <span ref={timeLabelRef}>0.00</span> / {selected.duration.toFixed(1)}초
                  </span>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void pickVideos()}
                className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg"
                style={{ background: "oklch(0.11 0.006 265)", border: "1px dashed oklch(1 0 0 / 14%)", color: textColor(0.6) }}
              >
                <Film className="h-7 w-7" />
                <span className="text-[11px]">영상 파일 고르기 (MP4 · WebM · MOV) — 여러 개 한 번에</span>
              </button>
            )}
          </div>

          {/* ── 오른쪽: 선택한 영상의 분석 · 다듬기 · 짝짓기 ── */}
          <div className="space-y-3">
            {selected ? (
              <>
                <section data-tour="mocap-analyze" className="space-y-1.5">
                  <p className="text-[11px] font-bold" style={{ color: textColor(0.5) }}>
                    1 · 분석
                  </p>
                  <select
                    value={selected.engine}
                    disabled={busy(selected)}
                    onChange={(event) => patchSource(selected.id, (current) => ({ ...current, engine: event.target.value }))}
                    className="w-full rounded px-1.5 py-1 text-[10px] outline-none"
                    style={{ background: "oklch(1 0 0 / 6%)", color: textColor(0.85), border: "1px solid oklch(1 0 0 / 8%)" }}
                  >
                    {engineOptions.map((option) => (
                      <option key={option.id} value={option.id} disabled={!option.ready}>
                        {option.label}
                        {option.ready ? "" : " (설치 필요)"}
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] leading-relaxed" style={{ color: textColor(0.45) }}>
                    {selectedEngine?.note}
                  </p>
                  {row("구간", (
                    <span className="flex items-center gap-1">
                      {numberField(selected.clipStart, (value) => patchSource(selected.id, (current) => ({ ...current, clipStart: value })), 0.1, busy(selected))}
                      ~
                      {numberField(selected.clipEnd, (value) => patchSource(selected.id, (current) => ({ ...current, clipEnd: value })), 0.1, busy(selected))}
                      초
                    </span>
                  ))}
                  {/*
                    마지막 칸은 **영상 그대로**입니다. 영상이 24fps 면 24, 59.94fps 면 60 처럼 그 영상의 초당 장수를 씁니다.
                    한 장도 건너뛰지 않아야 빠른 동작이 살아납니다.
                  */}
                  {row(
                    "초당 장(키)",
                    pills(
                      selected.fps,
                      [
                        ...FPS_OPTIONS.map(
                          (value) =>
                            [
                              value as number,
                              String(value),
                              value >= 30
                                ? `초당 ${value}장 — 춤처럼 빠른 동작(영상이 ${value}fps 이상일 때)`
                                : `초당 ${value}장 — 느린 연기, 분석이 빠르고 키가 적음`,
                            ] as const,
                        ),
                        [
                          nativeFps,
                          `영상 그대로 (${nativeFps})`,
                          `이 영상의 초당 장수 그대로 — 한 장도 건너뛰지 않습니다`,
                        ] as const,
                      ],
                      (value) => patchSource(selected.id, (current) => ({ ...current, fps: value })),
                      busy(selected),
                    ),
                  )}
                  {checkbox(
                    "거울 영상(좌우 뒤집기)",
                    selected.mirror,
                    (value) => patchSource(selected.id, (current) => ({ ...current, mirror: value })),
                    "연습실 거울을 찍은 영상처럼 좌우가 뒤집힌 영상 — 분석 전에 정하세요",
                  )}
                  {selected.engine === "sam3dbody" && checkbox(
                    t("손가락 함께 분석"),
                    selected.hands !== false,
                    value => { if (!busy(selected)) patchSource(selected.id, current => ({ ...current, hands: value })); },
                    t("SAM 3D Body의 몸과 손 복원을 함께 실행합니다. 끄면 몸만 분석합니다."),
                  )}
                  {/*
                    분석 중에도 아래 단추를 **누를 수 있습니다.** 누르면 줄에 서고,
                    저장소가 하나씩 돌려 끝나는 대로 프로젝트 폴더에 적습니다(`lib/mocapStore.ts`).
                  */}
                  {busy(selected) ? (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "oklch(1 0 0 / 8%)" }}>
                        {/* 진행률은 **저장소**가 적어 줍니다 — 창을 닫았다 열어도 하던 자리에서 이어집니다. */}
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(0, Math.min(100, selected.percent))}%`,
                            background: "oklch(0.70 0.18 160)",
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[9px]" style={{ color: textColor(0.58) }}>
                        <span className="min-w-0 truncate tabular-nums">
                          {selected.message || "준비 중…"}
                        </span>
                        <button
                          type="button"
                          onClick={() => cancelMocap(projectName, selected.id)}
                          className="shrink-0 rounded px-1.5 py-0.5"
                          style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.70 0.14 25)" }}
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!selectedEngine?.ready}
                      onClick={() => analyze(selected)}
                      className="w-full rounded-md px-2 py-2 text-[10px] font-semibold disabled:opacity-40"
                      style={{ background: "oklch(0.18 0.012 265)", border: "1px solid oklch(0.70 0.18 160 / 50%)", color: "oklch(0.80 0.16 160)" }}
                      title={anyAnalyzing ? "지금 도는 분석이 끝나면 이어서 돕니다" : undefined}
                    >
                      {anyAnalyzing
                        ? "줄에 세우기 — 끝나는 대로 분석"
                        : selected.raw
                          ? "다시 분석"
                          : "사람 찾기 · 관절 분석"}
                    </button>
                  )}
                  {(selected.raw || selected.resultPath) && (
                    <>
                      <button type="button" disabled={busy(selected) || !desktop || !selected.path}
                        onClick={() => enqueueMocap(projectName, selected.id, "hands")}
                        className="w-full rounded-md px-2 py-2 text-[10px] font-semibold disabled:opacity-40"
                        style={{ background: "oklch(1 0 0 / 6%)", color: textColor(0.85) }}>
                        {t("손가락 추가 추적 · MediaPipe")}
                      </button>
                      <p className="text-[9px] leading-relaxed" style={{ color: textColor(0.5) }}>
                        {t("기존 몸 분석의 시각에 맞춰 손 21점을 보완합니다. 가려지거나 임자가 불분명한 손은 원래 값을 유지합니다. 완료 후 타임라인에 다시 넣어 주세요.")}
                      </p>
                    </>
                  )}
                </section>

                {selected.result && (
                  <section data-tour="mocap-cleanup" className="space-y-1.5">
                    <p className="text-[11px] font-bold" style={{ color: textColor(0.5) }}>
                      2 · 다듬기
                    </p>
                    {row(
                      "튐 보정",
                      pills(
                        selected.repair,
                        [
                          ["off", "끔", "검출기가 준 그대로"],
                          ["normal", "보통", "한두 장 튀는 팔다리·좌우 뒤바뀜·몸 방향 뒤집힘을 앞뒤로 메움(권장)"],
                          ["strong", "강", "인식이 자주 끊기는 영상 — 더 작은 튐도 메우고 더 긴 틈도 이음"],
                        ] as const,
                        (value) => patchSource(selected.id, (current) => ({ ...current, repair: value, result: repairedCapture(current.raw, value) })),
                      ),
                    )}
                    {row(
                      "떨림 줄이기",
                      pills(
                        selected.smoothing,
                        [
                          ["light", "약", "빠른 동작을 가장 살림 — 가만히 선 손도 조금 떪"],
                          ["normal", "보통", "떨림은 누르고 빠른 동작은 살림(권장)"],
                          ["strong", "강", "느린 연기용 — 빠른 동작의 끝이 무뎌짐"],
                        ] as const,
                        (value) => patchSource(selected.id, (current) => ({ ...current, smoothing: value })),
                      ),
                    )}
                    {row(
                      "디딘 발 고정",
                      checkbox(
                        "미끄러짐 없애기",
                        selected.footPlant === true,
                        (value) => patchSource(selected.id, (current) => ({ ...current, footPlant: value })),
                        "땅에 평평하게 디딘 동안 발이 그 자리에 머물게 골반을 밀어 줍니다. 관절 각도는 건드리지 않습니다. 걷기·춤처럼 발을 딛는 동작에서만 뜻이 있습니다.",
                      ),
                    )}
                    <p className="text-[9px] leading-relaxed" style={{ color: textColor(0.45) }}>
                      {(() => {
                        const totals = selected.result.persons.reduce(
                          (sum, person) => ({
                            joints: sum.joints + (person.repaired?.joints ?? 0),
                            frames: sum.frames + (person.repaired?.frames ?? 0),
                            swaps: sum.swaps + (person.repaired?.swaps ?? 0),
                          }),
                          { joints: 0, frames: 0, swaps: 0 },
                        );
                        return selected.repair === "off"
                          ? "보정하지 않았습니다."
                          : `튄 관절 ${totals.joints}곳 · 통째로 메운 장 ${totals.frames} · 좌우 뒤바뀜 ${totals.swaps}번을 고쳤습니다.`;
                      })()}
                    </p>
                  </section>
                )}

                {selected.result && (
                  <section data-tour="mocap-match" className="space-y-1.5">
                    <p className="text-[11px] font-bold" style={{ color: textColor(0.5) }}>
                      3 · 번호 ↔ 캐릭터 ({selected.result.persons.length}명)
                    </p>
                    {selected.result.persons.map((person) => (
                      <div key={person.number} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const time = person.samples[0].time;
                            if (videoRef.current) videoRef.current.currentTime = time;
                            drawRef.current?.(time);
                          }}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ background: PERSON_COLORS[(person.number - 1) % PERSON_COLORS.length] }}
                          title={`${span(person)} — 눌러서 처음 나오는 장으로`}
                        >
                          {person.number}
                        </button>
                        <select
                          value={selected.assign[person.number] ?? "skip"}
                          onChange={(event) =>
                            patchSource(selected.id, (current) => ({
                              ...current,
                              assign: { ...current.assign, [person.number]: event.target.value },
                            }))
                          }
                          className="min-w-0 flex-1 rounded px-1.5 py-1 text-[10px] outline-none"
                          style={{ background: "oklch(1 0 0 / 6%)", color: textColor(0.85), border: "1px solid oklch(1 0 0 / 8%)" }}
                        >
                          <option value="skip">안 씀</option>
                          {placed.map((character) => (
                            <option key={character.characterId} value={character.characterId}>
                              {nameOf(character.characterId)}
                            </option>
                          ))}
                          <option value="new-male">새 마네킹(남)</option>
                          <option value="new-female">새 마네킹(여)</option>
                        </select>
                        <span className="w-16 shrink-0 text-right text-[9px] tabular-nums" style={{ color: textColor(0.45) }}>
                          {span(person)}
                        </span>
                      </div>
                    ))}
                    {row(
                      "타임라인 시작",
                      <span className="flex items-center gap-1">
                        {numberField(
                          selected.start,
                          (value) => patchSource(selected.id, (current) => ({ ...current, start: Math.round(value * 100) / 100 })),
                          0.05,
                        )}
                        초
                      </span>,
                    )}
                    {checkbox(
                      "영상 속 대형 그대로",
                      selected.formation,
                      (value) => patchSource(selected.id, (current) => ({ ...current, formation: value })),
                      "이 영상에서 여러 명을 넣을 때 서로의 간격·앞뒤를 영상대로 — 끄면 캐릭터마다 지금 자리에서 움직인 만큼만",
                    )}
                  </section>
                )}
              </>
            ) : (
              <p className="text-[10px] leading-relaxed" style={{ color: textColor(0.5) }}>
                왼쪽에서 영상을 추가하세요.
              </p>
            )}
          </div>
        </div>

        {/* ── 아래: 전체 넣기 ── */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderTop: "1px solid oklch(1 0 0 / 8%)" }}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {checkbox("이동", channels.position, (value) => setChannels((current) => ({ ...current, position: value })))}
            {checkbox("몸 방향", channels.rotation, (value) => setChannels((current) => ({ ...current, rotation: value })))}
            {checkbox("관절", channels.pose, (value) => setChannels((current) => ({ ...current, pose: value })))}
            <span className="text-[9px]" style={{ color: plan.conflicts.length ? "oklch(0.75 0.14 60)" : textColor(0.45) }}>
              {plan.conflicts.length
                ? `${plan.conflicts.join(", ")} — 같은 시간에 두 사람이 들어갑니다`
                : `넣을 짝 ${plan.pieces.length}개 · 넣는 구간 안의 그 캐릭터 키는 바뀝니다 · 타임라인이 짧으면 늘어납니다`}
            </span>
          </div>
          <button
            type="button"
            disabled={
              applying || anyAnalyzing || !plan.pieces.length || plan.conflicts.length > 0 || (!channels.position && !channels.rotation && !channels.pose)
            }
            onClick={() => void apply()}
            data-tour="mocap-apply"
            className="rounded-md px-4 py-2 text-[11px] font-semibold text-white gradient-primary disabled:opacity-40"
          >
            {applying ? "넣는 중…" : "타임라인에 넣기"}
          </button>
        </div>
      </div>
    </div>
  );
}
