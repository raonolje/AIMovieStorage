import { useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { HOLDS_MOCAP } from "@/lib/useTutorialPanel";
import { Eye, EyeOff, X } from "lucide-react";
import {
  AxisVectorFields,
  ChoiceRow,
  FIELD_STYLE,
  NumberInput,
  PanelSection,
  ZERO_VECTOR,
} from "@/components/composition/fields";
import { buildBlenderPrompt } from "@/lib/blenderPrompt";
import type {
  CompositionCharacterSource,
  CompositionState,
  CompositionTimeline,
  GlbTrack,
} from "@/lib/composition";
import { musicOf, removeGlbIn, removeRenderIn, type UpdateComposition } from "@/lib/compositionEdit";
import { MusicSection } from "./MusicSection";
import type { PlannerVideoRender } from "./useReferenceVideo";
import type { SectionToggles } from "./PlannerChrome";

/**
 * 타임라인 탭 — 재생 · GLB 애니메이션 · 레퍼런스 영상.
 *
 * 재생 시계와 영상 렌더 상태는 탭을 오가도 살아 있어야 해서
 * `CompositionPlanner` 의 훅(`usePlannerPlayback`·`useReferenceVideo`)에 있고,
 * 여기서는 그 결과를 받아 그립니다.
 */
export interface TimelinePanelProps extends SectionToggles {
  state: CompositionState;
  setState: UpdateComposition;
  plannerCharacters: CompositionCharacterSource[];
  timeline: CompositionTimeline;
  captureFormat: { width: number; height: number };
  video: PlannerVideoRender;
  selected: string;
  setSelected: (value: string) => void;
  updateGlb: (id: string, patch: Partial<GlbTrack>) => void;
  /** 파일 창으로 고른 GLB. 드롭과 같은 길로 넣습니다. */
  onAddGlbFile: (file: File) => void;
  /** 블렌더 지시문 창을 엽니다. 창은 패널 밖(창 전체)에 떠야 해서 위에서 그립니다. */
  onBlenderPrompt: (text: string) => void;
  /** «영상에서 모션 가져오기» 창을 엽니다(`MotionCaptureDialog`). */
  onMotionCapture: () => void;
  /** 지금 재생 머리(초) — «노래» 칸의 «여기서 자르기» 가 씁니다. */
  playhead: number;
  /** 이 컷이 지금 쓰는 레퍼런스 영상 경로 — 목록에서 어느 것이 «쓰는 것» 인지 표시합니다. */
  usedVideoPath?: string;
  /** 목록에서 고른 영상을 컷의 레퍼런스로 삼습니다. */
  onUseRender?: (path: string, seconds: number) => void;
  /** 올린 음원을 BGM 업로드 폴더에 파일링할 때 씁니다. */
  projectName?: string;
  sceneTitle?: string;
  cutOrder?: number;
}

/** 레퍼런스 영상 나눠 뽑기 길이. */
const SPLIT_OPTIONS = [
  { id: "whole", label: "통째로", seconds: null, hint: "타임라인 전체를 한 파일로 — 컷에 영상으로 적힙니다" },
  { id: "5", label: "5초", seconds: 5, hint: "5초씩 잘라 여러 파일로" },
  { id: "10", label: "10초", seconds: 10, hint: "10초씩 잘라 여러 파일로" },
  { id: "14", label: "14초", seconds: 14, hint: "AI 영상 기본 길이 — 14초씩 잘라 여러 파일로" },
  { id: "15", label: "15초", seconds: 15, hint: "15초씩 잘라 여러 파일로" },
  { id: "30", label: "30초", seconds: 30, hint: "30초씩 잘라 여러 파일로" },
  { id: "60", label: "1분", seconds: 60, hint: "1분씩 잘라 여러 파일로" },
  { id: "120", label: "2분", seconds: 120, hint: "2분씩 잘라 여러 파일로" },
] as const;

export function TimelinePanel({
  state,
  setState,
  plannerCharacters,
  timeline,
  captureFormat,
  video,
  selected,
  setSelected,
  updateGlb,
  onAddGlbFile,
  onBlenderPrompt,
  onMotionCapture,
  playhead,
  usedVideoPath,
  onUseRender,
  projectName,
  sceneTitle,
  cutOrder,
  openSections,
  toggleSection,
}: TimelinePanelProps) {
  const t = useT();
  const glbInputRef = useRef<HTMLInputElement>(null);
  /** 레퍼런스 영상을 몇 초씩 잘라 뽑을지. "whole" 이면 통째로. */
  const [split, setSplit] = useState<(typeof SPLIT_OPTIONS)[number]["id"] | "music">("whole");
  /*
    «노래 구간대로» 는 길이가 아니라 **자를 시각들**입니다.
    타임라인에 노래를 올린 컷에서만 선택지에 나옵니다.
  */
  const music = musicOf(state);
  const renders = state.renders || [];
  const sectionEdges = [
    ...new Set((music?.sections ?? []).flatMap((section) => [section.start, section.end])),
  ]
    .filter((value) => value > 0 && value < timeline.duration - 1e-6)
    .sort((a, b) => a - b);
  const splitSeconds: number | number[] | null =
    split === "music"
      ? sectionEdges
      : (SPLIT_OPTIONS.find((option) => option.id === split)?.seconds ?? null);
  const partCount = Array.isArray(splitSeconds)
    ? splitSeconds.length + 1
    : splitSeconds
      ? Math.ceil((timeline.duration - 1e-6) / splitSeconds)
      : 1;
  /*
    재생 손잡이는 이제 화면 아래 타임라인이 전부 맡습니다 — 여기서는 `playback` 을
    쓰지 않습니다. 그래도 받아 두는 까닭은 영상 렌더가 같은 시계를 봐야 해서입니다
    (`useReferenceVideo` 안에서 씁니다).
  */
  const {
    videoRendering,
    progressBarRef,
    progressTextRef,
    renderAbortRef,
    renderReference,
  } = video;

  return (
    <>
      {/*
        ── «재생» 구역은 없앴습니다 ──────────────────────────────────────
        

        같은 손잡이가 두 군데 있으면 둘 중 어느 것이 «진짜» 인지 매번 확인하게 됩니다.
        재생·처음·길이·프레임 수는 전부 화면 아래 타임라인에 있고, 거기가 시간 축 옆이라
        결과를 보면서 만질 수 있습니다.
      */}

      {/*
        ── 노래 ──────────────────────────────────────────────────────────
        
        노래가 맨 위에 있는 까닭은 뮤직비디오에서 **노래가 먼저 정해지고** 나머지(길이·구간·나눠 뽑기)가 그 뒤를 따라서입니다.
      */}
      <MusicSection
        state={state}
        setState={setState}
        playhead={playhead}
        projectName={projectName}
        sceneTitle={sceneTitle}
        cutOrder={cutOrder}
        open={openSections.music ?? false}
        onToggle={() => toggleSection("music")}
      />

      {/*
        ── 영상 모션 ─────────────────────────────────────────────────────
         결과는 인물의 이동·회전·자세 키라, GLB 처럼 따로 얹는 것이 아니라 손으로 찍은 키와 똑같이 고칩니다.
      */}
      <PanelSection
        tour="timeline-mocap"
        title={t("영상에서 모션 가져오기")}
        open={openSections.motionCapture ?? true}
        onToggle={() => toggleSection("motionCapture")}
      >
        <button
          type="button"
          onClick={onMotionCapture}
          data-tour="timeline-mocap-open"
          // 모캡 창 안의 자리들은 창이 떠야 생깁니다 — 이 단추가 그 창을 엽니다.
          data-tour-open={HOLDS_MOCAP}
          className="w-full rounded-md px-2 py-2 text-[10px] font-semibold"
          style={{
            background: "oklch(0.18 0.012 265)",
            border: "1px solid oklch(0.70 0.18 160 / 50%)",
            color: "oklch(0.80 0.16 160)",
          }}
        >
          {t("영상 올려서 캐릭터에 모션 입히기")}
        </button>
        <p className="mt-2 text-[9px] leading-relaxed" style={{ color: "oklch(0.42 0.01 265)" }}>
          {t("전신이 보이는 영상에서 사람마다 이동 · 몸 방향 · 관절을 읽어 캐릭터 키로 넣습니다. 여러 명이면 번호마다 캐릭터를 고릅니다. 고정 카메라 · 앞이나 옆에서 찍은 영상이 가장 정확합니다.")}
        </p>
      </PanelSection>

      {/* GLB 애니메이션 트랙 — 블렌더 결과물을 씬에 얹습니다. */}
      <PanelSection
        tour="timeline-glb"
        title={t("GLB 애니메이션")}
        count={(state.glbTracks || []).length}
        open={openSections.glb}
        onToggle={() => toggleSection("glb")}
      >
        {/* 만드는 쪽과 가져오는 쪽이 한자리에 있어야 흐름이 끊기지 않습니다.
            블렌더로 만들기 → GLB 내보내기 → 여기에 끌어다 놓기. */}
        <button
          type="button"
          data-tour="timeline-blender-prompt"
          onClick={() =>
            onBlenderPrompt(
              buildBlenderPrompt(
                state,
                Object.fromEntries(
                  plannerCharacters.map((character) => [
                    character.id,
                    {
                      name: character.name,
                      gender: character.gender,
                      heightCm: character.heightCm,
                    },
                  ]),
                ),
              ).text,
            )
          }
          className="mb-1.5 w-full rounded-md px-2 py-2 text-[10px] font-semibold"
          style={{
            background: "oklch(0.18 0.012 265)",
            border: "1px solid oklch(0.72 0.17 55 / 50%)",
            color: "oklch(0.84 0.16 55)",
          }}
        >
          {t("블렌더 작업 지시문 만들기")}
        </button>
        <input
          ref={glbInputRef}
          type="file"
          accept=".glb,.gltf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onAddGlbFile(file);
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => glbInputRef.current?.click()}
          className="w-full rounded-md px-2 py-2 text-[10px] font-semibold"
          style={{
            background: "oklch(0.18 0.012 265)",
            border: "1px dashed oklch(0.70 0.18 160 / 55%)",
            color: "oklch(0.78 0.16 160)",
          }}
        >
          {t("GLB 파일 추가 (.glb / .gltf)")}
        </button>

        {(state.glbTracks || []).map((track) => (
          <div
            key={track.id}
            className="mt-2 space-y-1.5 rounded-md p-2.5"
            style={{
              background: "oklch(0.13 0.01 265)",
              border: "1px solid oklch(0.70 0.18 160 / 25%)",
            }}
          >
            <div className="flex items-center gap-1">
              <span
                className="min-w-0 flex-1 truncate text-[10px] font-semibold"
                style={{ color: "oklch(0.78 0.16 160)" }}
              >
                {track.name}
              </span>
              <button
                type="button"
                onClick={() => updateGlb(track.id, { visible: !track.visible })}
                title={track.visible ? t("숨기기") : "보이기"}
                className="rounded p-0.5 hover:bg-white/10"
              >
                {track.visible ? (
                  <Eye
                    className="h-3 w-3"
                    style={{ color: "oklch(0.62 0.01 265)" }}
                  />
                ) : (
                  <EyeOff
                    className="h-3 w-3"
                    style={{ color: "oklch(0.45 0.01 265)" }}
                  />
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  setState((current) => removeGlbIn(current, track.id))
                }
                title="제거"
                className="rounded p-0.5 hover:bg-white/10"
                style={{ color: "oklch(0.55 0.14 25)" }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {(track.clips?.length ?? 0) > 1 && (
              <label
                className="block text-[10px]"
                style={{ color: "oklch(0.52 0.01 265)" }}
              >
                클립
                <select
                  value={track.clipName || track.clips?.[0] || ""}
                  onChange={(event) =>
                    updateGlb(track.id, { clipName: event.target.value })
                  }
                  className="mt-1 h-7 w-full rounded-md px-2 text-xs outline-none"
                  style={FIELD_STYLE}
                >
                  {track.clips?.map((clip) => (
                    <option key={clip} value={clip}>
                      {clip}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="grid grid-cols-3 gap-1.5">
              <label
                className="text-[10px]"
                style={{ color: "oklch(0.52 0.01 265)" }}
                title="타임라인 몇 초 지점에서 이 애니메이션이 시작할지"
              >
                시작 시각
                <NumberInput
                  value={track.startTime}
                  step={0.1}
                  min={0}
                  onChange={(startTime) => updateGlb(track.id, { startTime })}
                />
              </label>
              <label
                className="text-[10px]"
                style={{ color: "oklch(0.52 0.01 265)" }}
                title="1 = 원래 속도, 0.5 = 절반 느리게, 2 = 두 배 빠르게"
              >
                재생 속도
                <NumberInput
                  value={track.speed}
                  step={0.1}
                  min={0.05}
                  onChange={(speed) => updateGlb(track.id, { speed })}
                />
              </label>
              <label
                className="text-[10px]"
                style={{ color: "oklch(0.52 0.01 265)" }}
                title="블렌더와 단위가 다를 때 여기서 맞춥니다. 1 = 원본 크기"
              >
                크기 배율
                <NumberInput
                  value={track.scale}
                  step={0.05}
                  min={0.01}
                  onChange={(scale) => updateGlb(track.id, { scale })}
                />
              </label>
            </div>

            <label
              className="flex items-center gap-1.5 text-[10px]"
              style={{ color: "oklch(0.52 0.01 265)" }}
              title="끄면 한 번만 재생하고 마지막 프레임에서 멈춥니다."
            >
              <input
                type="checkbox"
                checked={!!track.loop}
                onChange={(event) =>
                  updateGlb(track.id, { loop: event.target.checked })
                }
                className="h-3 w-3"
              />
              컷 끝까지 반복 재생
            </label>

            {!!track.clipDuration && (
              <div
                className="rounded-md px-2 py-1.5"
                style={{
                  background: "oklch(0.70 0.18 160 / 10%)",
                  border: "1px solid oklch(0.70 0.18 160 / 25%)",
                }}
              >
                <span
                  className="text-[9px]"
                  style={{ color: "oklch(0.76 0.16 160)" }}
                >
                  클립 길이 {track.clipDuration.toFixed(2)}{t("초")}
                  {(track.speed || 1) !== 1 && (
                    <span style={{ color: "oklch(0.80 0.16 160)" }}>
                      {" "}
                      → 재생{" "}
                      {(track.clipDuration / (track.speed || 1)).toFixed(2)}{t("초")}
                    </span>
                  )}
                  <span style={{ color: "oklch(0.52 0.01 265)" }}>
                    {" "}
                    · {timeline.fps}fps 기준{" "}
                    {Math.round(track.clipDuration * timeline.fps)}프레임
                  </span>
                </span>
              </div>
            )}

            <div>
              <p
                className="mb-1 text-[10px] font-semibold"
                style={{ color: "oklch(0.45 0.01 265)" }}
              >
                위치
              </p>
              <AxisVectorFields
                value={track.position}
                zUp
                defaults={ZERO_VECTOR}
                onChange={(position) => updateGlb(track.id, { position })}
              />
            </div>
            <div>
              <p
                className="mb-1 text-[10px] font-semibold"
                style={{ color: "oklch(0.45 0.01 265)" }}
              >
                {t("회전")}
              </p>
              <AxisVectorFields
                value={track.rotation}
                zUp
                defaults={ZERO_VECTOR}
                unit="deg"
                step={15}
                onChange={(rotation) => updateGlb(track.id, { rotation })}
              />
            </div>

            <button
              type="button"
              onClick={() =>
                setSelected(
                  selected === `glb:${track.id}` ? "none" : `glb:${track.id}`,
                )
              }
              className="w-full rounded-md px-2 py-1.5 text-[10px] font-semibold"
              style={{
                background:
                  selected === `glb:${track.id}`
                    ? "oklch(0.70 0.18 160 / 22%)"
                    : "oklch(1 0 0 / 5%)",
                border: `1px solid ${selected === `glb:${track.id}` ? "oklch(0.70 0.18 160 / 50%)" : "oklch(1 0 0 / 8%)"}`,
                color:
                  selected === `glb:${track.id}`
                    ? "oklch(0.80 0.16 160)"
                    : "oklch(0.66 0.01 265)",
              }}
            >
              {selected === `glb:${track.id}`
                ? "기즈모 해제"
                : "화면에서 직접 옮기기"}
            </button>
          </div>
        ))}

        <p
          className="mt-2 text-[9px] leading-relaxed"
          style={{ color: "oklch(0.42 0.01 265)" }}
        >
          {t("블렌더에서 glTF/GLB 로 내보내면 애니메이션이 함께 들어옵니다. 3D 화면에 끌어다 놓아도 됩니다.")}
        </p>
      </PanelSection>

      <PanelSection
        tour="timeline-render"
        title={t("레퍼런스 영상")}
        open={openSections.video}
        onToggle={() => toggleSection("video")}
      >
        {/*
          영상 fps 는 화면 아래 타임라인의 «24f» 칸으로 옮겼습니다 — 길이와 프레임 수는
          한자리에 있어야 «몇 프레임짜리 컷인가» 가 한눈에 읽힙니다.
        */}
        <p className="text-[9px]" style={{ color: "oklch(0.45 0.01 265)" }}>
          {t("{width}×{height} · {frames}프레임 ({fps}fps · {seconds}초) — 길이와 fps는 아래 타임라인에서 고칩니다.", {
            width: captureFormat.width, height: captureFormat.height,
            frames: Math.round(timeline.duration * timeline.fps), fps: timeline.fps, seconds: timeline.duration,
          })}
        </p>

        {/*
           생성기는 한 번에 몇 초만 받고 연장은 비싸서, 긴 타임라인을 생성기 길이로
          미리 잘라 두면 조각마다 그대로 넣습니다. 14 초는 사용자가 말한 AI 영상 기본 길이라 따로 둡니다.
        */}
        <div data-tour="timeline-render-split" className="mt-2">
          <ChoiceRow
            value={split}
            columns={4}
            options={[
              ...SPLIT_OPTIONS.map((option) => ({
                id: option.id as (typeof SPLIT_OPTIONS)[number]["id"] | "music",
                label: t(option.label),
                hint: option.hint,
              })),
              ...(music?.sections.length
                ? [
                    {
                      id: "music" as const,
                      label: `노래 ${music.sections.length}구간`,
                      hint: "타임라인에 올린 노래의 구간 경계에서 자릅니다 — 이어 붙이면 노래와 박자가 맞습니다",
                    },
                  ]
                : []),
            ]}
            onChange={setSplit}
          />
          {splitSeconds && (
            <p className="mt-1 text-[9px]" style={{ color: "oklch(0.58 0.01 265)" }}>
              {Array.isArray(splitSeconds)
                ? `${partCount}조각 · 노래 구간 경계 ${splitSeconds
                    .map((value) => `${Math.round(value * 10) / 10}초`)
                    .join(" · ")}`
                : `${partCount}조각 · 조각마다 ${Math.round(splitSeconds * timeline.fps)}프레임${
                    partCount > 1 && timeline.duration % splitSeconds > 1e-6
                      ? ` · 마지막 조각 ${Math.round((timeline.duration % splitSeconds) * 10) / 10}초`
                      : ""
                  }`}{" "}
              — 파일 이름에 part 번호와 구간이 붙습니다
            </p>
          )}
        </div>

        {videoRendering ? (
          <div className="mt-2 space-y-1">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: "oklch(1 0 0 / 8%)" }}
            >
              <div
                ref={progressBarRef}
                className="h-full rounded-full transition-[width] duration-150"
                style={{ width: "0%", background: "oklch(0.72 0.20 25)" }}
              />
            </div>
            <div
              className="flex items-center justify-between text-[9px]"
              style={{ color: "oklch(0.58 0.01 265)" }}
            >
              <span ref={progressTextRef} className="tabular-nums">
                0 / 0 프레임
              </span>
              <button
                type="button"
                onClick={() => renderAbortRef.current?.abort()}
                className="rounded px-1.5 py-0.5"
                style={{
                  background: "oklch(1 0 0 / 6%)",
                  color: "oklch(0.70 0.14 25)",
                }}
              >
                {t("취소")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void renderReference(splitSeconds)}
            data-tour="timeline-render-run"
            className="mt-2 w-full rounded-md px-2 py-2 text-[10px] font-semibold"
            style={{
              background: "oklch(0.18 0.012 265)",
              border: "1px solid oklch(0.72 0.20 25 / 55%)",
              color: "oklch(0.82 0.17 25)",
            }}
          >
            {splitSeconds && partCount > 1
              ? t("● 레퍼런스 영상 {count}조각 만들기 (MP4)", { count: partCount })
              : t("● 레퍼런스 영상 만들기 (MP4)")}
          </button>
        )}

        {/*
          ── 뽑아 둔 영상(구도별 라이브러리) ──────────────────────────────
           목록은 **이 구도**가 들고 있어 창을 닫았다 열어도 남습니다. 누르면 컷이 쓰는 레퍼런스
          영상이 그것으로 바뀝니다 — 길이를 바꿔 여러 번 뽑아 놓고 고르는 것이 실제 작업 방식입니다.
        */}
        {renders.length > 0 && (
          <div data-tour="timeline-renders-list" className="mt-2">
            <p className="mb-1 text-[9px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
              {t("뽑아 둔 영상")} {renders.length}편 — 누르면 이 컷이 그것을 씁니다
            </p>
            <div className="composition-scroll max-h-32 space-y-1 overflow-y-auto pr-1">
              {[...renders].reverse().map((render) => {
                const picked = render.path === usedVideoPath;
                return (
                  <div key={render.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onUseRender?.(render.path, render.seconds)}
                      title={render.path}
                      className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-[9px]"
                      style={{
                        background: picked ? "oklch(0.72 0.20 25 / 22%)" : "oklch(1 0 0 / 5%)",
                        color: picked ? "oklch(0.86 0.15 25)" : "oklch(0.76 0.01 265)",
                      }}
                    >
                      {picked ? "● " : "○ "}
                      {render.seconds.toFixed(1)}{t("초")}{render.part ? ` · ${render.part}조각` : ""} ·{" "}
                      {render.path.split(/[\/]/).pop()}
                    </button>
                    <button
                      type="button"
                      onClick={() => setState((current) => removeRenderIn(current, render.id))}
                      aria-label="목록에서 빼기"
                      title="목록에서만 뺍니다 — 파일은 폴더에 남습니다"
                      className="shrink-0 rounded p-1 hover:bg-white/10"
                      style={{ color: "oklch(0.60 0.15 25)" }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p
          className="mt-2 text-[9px] leading-relaxed"
          style={{ color: "oklch(0.42 0.01 265)" }}
        >
          {t("카메라 무빙과 GLB 애니메이션이 이 시계를 함께 따릅니다. 미리보기 중에는 화면을 돌리면 해제됩니다. 영상에는 격자·이름표·경로선·앵커가 나오지 않습니다.")}
          {" "}{t("레퍼런스 영상의 인물은 회색으로 출력합니다. 편집 화면의 식별 색은 유지됩니다.")}
        </p>
      </PanelSection>
    </>
  );
}
