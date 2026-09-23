import type { ReactNode } from "react";
import { useT } from "@/lib/i18n";
import type { Dispatch, SetStateAction } from "react";
import {
  Box,
  Eye,
  EyeOff,
  Film,
  Footprints,
  Image as ImageIcon,
  // Lock 은 브라우저 전역(Web Locks API)에 같은 이름이 있어 그대로 쓰면
  // 「Illegal constructor」 로 화면이 죽습니다. 별칭을 붙입니다.
  Move3D,
  Redo2,
  Save,
  Undo2,
  User,
  X,
} from "lucide-react";
import type { CompositionCameraSummary } from "@/lib/composition";
import { type UpdateComposition } from "@/lib/compositionEdit";
import TutorialMenu from "@/components/tutorial/TutorialMenu";

/**
 * 구도잡기 창의 틀 — 머리줄, 3D 화면 위에 떠 있는 단추 줄, 상태 표시.
 *
 * 탭 «전환» 은 `CompositionPlanner` 가 들고 있고 여기는 그리기만 합니다.
 * 패널 네 개(배치·환경·카메라·타임라인)는 각각 `*Panel.tsx` 에 있습니다.
 */

/** 오른쪽 패널의 작업 탭. */
/**
 * 작업 탭. **카메라 탭은 없앴습니다.**
 *
 *
 *
 * 탭에 숨은 손잡이는 **없는 것과 같습니다** — 「있는지 몰랐네」 가 그 증거입니다.
 * 무빙은 시간 위의 물건이라 시간 축 옆에서 만지는 것이 맞고, 무엇을 고치든 결과를
 * 바로 옆에서 볼 수 있어야 합니다. 갈래 이름은 옛 저장본의 `panelTab` 값 때문에
 * 타입에는 남겨 두되(열면 배치로 보냅니다) 목록에서만 뺍니다.
 */
export type PanelTabId = "layout" | "environment" | "camera" | "timeline";

/*
  **탭이 열어 주는 자리들.** 탭 하나가 살아 있는 동안만 그 패널을 그리므로, 다른 탭에 서
  있으면 튜토리얼이 그 자리를 못 찾습니다. 여는 쪽이 «내가 열면 이것들이 생긴다» 고 적어
  두면 안내 창이 읽어 한 번 눌러 줍니다(`TutorialOverlay`).
  
*/
const TAB_OPENS: Record<PanelTabId, string> = {
  // 카메라 탭은 없앴습니다(위 주석) — 목록에 안 뜨니 열어 줄 것도 없습니다.
  camera: "",
  layout: "layout-characters layout-character-fields layout-body-color layout-gizmo-mode layout-path layout-objects layout-object-kinds layout-object-group layout-object-swap layout-object-asset layout-attach-bone layout-light layout-wall-image layout-pose-from-image layout-joints layout-hands layout-presets layout-mocap-cleanup layout-mannequins bone-picker",
  environment: "env-room-add-indoor env-room-list env-room-size env-horizon-color env-outdoor-shape env-occlude-faces env-room-make-image env-panoramas env-face-sets env-room-props env-room-library env-display",
  timeline: "timeline-music timeline-music-pick timeline-music-sections timeline-mocap-open timeline-glb timeline-blender-prompt timeline-render timeline-render-split timeline-render-run timeline-renders-list",
};

export const PANEL_TABS: {
  id: PanelTabId;
  label: string;
  icon: typeof User;
}[] = [
  { id: "layout", label: "배치", icon: User },
  { id: "environment", label: "환경", icon: ImageIcon },
  { id: "timeline", label: "타임라인", icon: Film },
];

/**
 * 캡처 프레임 비율. 맨 앞의 «3D 배치»(id 0)는 비율 제한이 없는 자유 화면 —
 * 프레임 없이 뷰포트를 꽉 채우고, 캡처할 때만 16:9 로 굽습니다.
 */
export const CAPTURE_FORMATS = [
  { id: 1, label: "1:1", width: 1440, height: 1440 },
  { id: 4 / 3, label: "4:3", width: 1600, height: 1200 },
  { id: 3 / 4, label: "3:4", width: 1200, height: 1600 },
  { id: 16 / 9, label: "16:9", width: 1920, height: 1080 },
  { id: 9 / 16, label: "9:16", width: 1080, height: 1920 },
  { id: 21 / 9, label: "21:9", width: 2520, height: 1080 },
];
/** 자유 화면(3D 배치)일 때 캡처에 쓰는 판 */
export const FREE_CAPTURE_FORMAT = CAPTURE_FORMATS[3];

/**
 * 「9:16」 같은 글자를 프레임 비율 숫자로. 못 알아들으면 16:9 입니다.
 *
 * 작품이 정한 비율을 구도잡기 프레임으로 옮기는 데 씁니다(2026-09-18 점검: 숏츠 작품인데
 * 구도는 가로 프레임에서 잡고 있었습니다).
 */
export function aspectNumberOf(aspect?: string): number {
  const [w, h] = (aspect || "").split(":").map((part) => Number(part.trim()));
  if (!(w > 0) || !(h > 0)) return 16 / 9;
  const ratio = w / h;
  const known = CAPTURE_FORMATS.find((item) => Math.abs(item.id - ratio) < 0.01);
  return known ? known.id : 16 / 9;
}

/** captureAspect 0 = «3D 배치» 자유 화면. 프레임 없이 꽉 채우고 캡처만 16:9. */
export const captureFormatFor = (captureAspect: number) =>
  CAPTURE_FORMATS.find((item) => Math.abs(item.id - captureAspect) < 0.01) ??
  FREE_CAPTURE_FORMAT;

/** 머리줄 — 제목, 구도 요약, 되돌리기·다시 실행, 닫기. */
export function PlannerHeader({
  summary,
  onUndo,
  onRedo,
  onClose,
}: {
  summary: CompositionCameraSummary;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
}) {
  return (
    <div
      data-tour="planner-header"
      className="flex shrink-0 items-center gap-2 px-4 py-2.5"
      style={{ borderBottom: "1px solid oklch(1 0 0 / 8%)" }}
    >
      <Move3D
        className="h-4 w-4 shrink-0"
        style={{ color: "oklch(0.78 0.18 290)" }}
      />
      <p className="shrink-0 text-sm font-semibold">구도 잡기</p>
      <p
        className="min-w-0 flex-1 truncate text-[11px]"
        style={{ color: "oklch(0.52 0.01 265)" }}
      >
        {summary.hasComposition
          ? summary.ko
          : "인물을 세우면 샷·앵글·거리가 여기 나옵니다"}
      </p>

      {/*
        구도잡기 갈래는 **여기서만** 엽니다. 위 띠는 창에 가려 손이 닿지 않고, 창이 닫힌 채로
        열면 가리킬 자리가 없습니다(). 목록은 «지금 화면» 으로 고르는데, 창이 열려 있는 동안은 그것이
        `planner` 입니다 — `CompositionPlanner` 가 알립니다.
      */}
      <TutorialMenu />

      <button
        type="button"
        onClick={onUndo}
        data-tour="planner-undo"
        title="되돌리기 (Ctrl+Z)"
        className="shrink-0 rounded p-1.5 hover:bg-white/10"
        style={{ color: "oklch(0.62 0.01 265)" }}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        title="다시 실행 (Ctrl+Shift+Z)"
        className="shrink-0 rounded p-1.5 hover:bg-white/10"
        style={{ color: "oklch(0.62 0.01 265)" }}
      >
        <Redo2 className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="shrink-0 rounded p-1.5 hover:bg-white/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * 좌상단 — 화면 비율 줄만. [3D 배치]와 비율 칩.
 *
 * 작업 탭(배치·환경·카메라·타임라인)은 예전에 이 바로 아래에 있었는데,
 * **오른쪽 도구줄 아래로 옮겼습니다**(`PlannerActionBar`, 사용자 2026-09-09 그림).
 * 탭이 바꾸는 것은 오른쪽 패널이라, 바꾸는 단추도 그 옆에 있는 편이 손이 짧습니다.
 * 왼쪽 위에는 «화면 자체를 다루는 것»(비율)만 남깁니다.
 */
export function PlannerViewBar({
  captureAspect,
  setCaptureAspect,
  children,
}: {
  captureAspect: number;
  setCaptureAspect: (aspect: number) => void;
  /** 비율 칩 아래에 쌓이는 것 — 지금은 카메라 손잡이(샷 크기·조작 속도). */
  children?: ReactNode;
}) {
  const freeView = !captureAspect;
  return (
    // 아주 좁을 때는 비율 칩도 아랫줄로 접힙니다(`flex-wrap`) — 그래야 오른쪽 도구줄과 안 겹칩니다.
    <div className="absolute left-6 top-6 z-10 flex max-w-[calc(100%-3rem)] flex-col items-start gap-1.5">
      <div
        data-tour="planner-ratio-chips"
        className="flex flex-wrap items-center gap-0.5 rounded-lg p-1"
        style={{
          background: "oklch(0 0 0 / 72%)",
          border: "1px solid oklch(1 0 0 / 10%)",
        }}
      >
        <button
          type="button"
          onClick={() => setCaptureAspect(0)}
          title="비율 제한 없는 자유 화면"
          className="rounded px-1.5 py-1 text-[9px] font-semibold"
          style={{
            background: freeView ? "oklch(0.62 0.22 290 / 26%)" : "transparent",
            color: freeView ? "oklch(0.85 0.18 290)" : "oklch(0.52 0.01 265)",
          }}
        >
          3D 배치
        </button>
        {CAPTURE_FORMATS.map((format) => {
          const on = Math.abs(format.id - captureAspect) < 0.01;
          return (
            <button
              key={format.label}
              type="button"
              onClick={() => setCaptureAspect(format.id)}
              className="rounded px-1.5 py-1 text-[9px] font-semibold"
              style={{
                background: on ? "oklch(0.55 0.15 200 / 24%)" : "transparent",
                color: on ? "oklch(0.80 0.14 200)" : "oklch(0.52 0.01 265)",
              }}
            >
              {format.label}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/**
 * 오른쪽 패널을 고르는 작업 탭 줄. 도구줄 바로 아래에 붙습니다.
 *
 * 도구줄과 **같은 줄에 넣지 않은** 까닭: 도구줄이 이미 여섯 덩어리라, 한 줄에
 * 합치면 좁은 창에서 줄바꿈이 일어나며 «바닥에 세우기» 가 화면 한가운데로
 * 밀려납니다. 아래 줄로 두면 도구줄 자리는 그대로고, 탭은 자기가 바꾸는
 * 오른쪽 패널 바로 옆에 섭니다.
 */
export function PlannerTabBar({
  panelTab,
  setPanelTab,
  characterCount,
}: {
  panelTab: PanelTabId;
  setPanelTab: (tab: PanelTabId) => void;
  /** 배치 탭에 붙는 인물 수 배지 */
  characterCount: number;
}) {
  return (
    <div
      data-tour="planner-tabs"
      className="pointer-events-auto flex flex-wrap items-center justify-end gap-0.5 rounded-lg p-1"
      style={{
        background: "oklch(0 0 0 / 72%)",
        border: "1px solid oklch(1 0 0 / 10%)",
      }}
    >
      {PANEL_TABS.map((tab) => {
        const on = panelTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPanelTab(tab.id)}
            data-tour-switch={TAB_OPENS[tab.id]}
            title={tab.label}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold"
            style={{
              background: on ? "oklch(0.62 0.22 290 / 24%)" : "transparent",
              color: on ? "oklch(0.86 0.18 290)" : "oklch(0.58 0.01 265)",
            }}
          >
            <tab.icon className="h-3 w-3" />
            {tab.label}
            {tab.id === "layout" && characterCount > 0 && (
              <span
                className="rounded px-1 text-[8px] font-bold"
                style={{ background: "oklch(1 0 0 / 10%)" }}
              >
                {characterCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 도구줄이 «방» 에 대해 알아야 하는 것 — 이제 한 변 하나뿐입니다. */
export interface PlannerRoomStatus {
  /** 방 한 변 S(m) */
  size: number;
}

/**
 * 우상단 — 바닥에 세우기 · 배경 고정/방/함께 · 바닥면 · 구도 캡처 · 구도 저장,
 * 그리고 그 아래 **작업 탭 줄**(2026-09-09 에 왼쪽 위에서 옮겨 왔습니다).
 */
export function PlannerActionBar({
  backgroundOn,
  room,
  showFloor,
  groundPlacing,
  setGroundPlacing,
  panelTab,
  setPanelTab,
  characterCount,
  setState,
  onSave,
  saving = false,
}: {
  /** 배경을 붙였는지, 빈 방에서 구도만 잡는지 */
  backgroundOn: boolean;
  /** «방» 한 변 */
  room: PlannerRoomStatus;
  showFloor: boolean;
  /** «바닥에 세우기» 모드 — 화면을 찍은 자리로 인물을 옮깁니다 */
  groundPlacing: boolean;
  setGroundPlacing: BooleanSetter;
  /** 오른쪽 패널의 작업 탭 — 줄이 여기로 옮겨 와서 함께 받습니다 */
  panelTab: PanelTabId;
  setPanelTab: (tab: PanelTabId) => void;
  characterCount: number;
  setState: UpdateComposition;
  onSave: () => void;
  saving?: boolean;
}) {
  const t = useT();
  return (
    /*
      껍데기는 클릭을 통과시킵니다(`pointer-events-none`).

      단추 줄 아래에 안내 문단이 붙으면서 껍데기가 3D 화면 오른쪽 위를 26rem 넓이로
      덮었습니다. 문단에만 `pointer-events-none` 을 걸어도 **껍데기가 클릭을 먹어**
      그 자리에서는 궤도를 못 돌립니다 — 하필 사람들이 화면을 돌릴 때 자주 잡는
      자리입니다. 그래서 껍데기는 통과, 단추 줄만 되돌려 받습니다
      (같은 파일의 `CameraHelpHint` 와 같은 방식).
    */
    /*
      너비를 «화면 − 18rem»(288px) 으로 묶습니다. 왼쪽 비율 줄은 left-6(24px)에서
      시작해 폭이 **232px**(3D 배치 + 비율 칩 6개, 실측)이라 오른쪽 끝이 256px 이고,
      여기에 오른쪽 여백 24px 을 더한 값입니다. 17rem(272px)이던 때는 이 줄의 왼쪽
      끝이 248px 이라 처음부터 8px 파고들어, 특정 폭(셀 650·730px 등)에서 첫 줄
      맨 왼쪽 단추가 «21:9» 칩을 실제로 덮고 그만큼은 눌리지도 않았습니다
      (실측: scratchpad/cube-check/ux-bars-render.mjs).
    */
    <div className="pointer-events-none absolute right-6 top-6 z-10 flex max-w-[calc(100%-18rem)] flex-col items-end gap-1">
      {/*
        좁은 창에서는 단추가 여러 줄로 접힙니다 — 안 그러면 왼쪽 비율 줄과 겹칩니다.

        **줄 자체는 클릭을 통과시킵니다.** 접히면 이 줄은 최대 폭까지 늘어난 채
        `justify-end` 로 오른쪽에 붙으므로 첫 줄 왼쪽에 빈 구멍이 남는데, 그 구멍이
        `pointer-events-auto` 면 3D 화면 위에서 클릭을 먹어 그 자리에서는 궤도를 못
        돌립니다(실측: 셀 폭 640px 에서 258×104px, 접히는 경계는 약 918px).
        위 껍데기 주석의 그 문제와 같은 것이라, 되돌려 받는 것은 단추와 묶음뿐입니다.
      */}
      <div className="pointer-events-none flex flex-wrap items-center justify-end gap-1.5">
        {/*
          바닥에 세우기.

          기즈모로 x·z 를 하나씩 끄는 것보다 «저 잔디밭 저쯤» 을 짚는 편이 훨씬
          빠릅니다. 배경과 인물의 축척을 맞추려면 인물을 앞뒤로 여러 번 옮겨 보게
          되는데, 그때마다 기즈모를 잡는 건 손이 많이 갑니다. (2026-09-09)
        */}
        <button
          type="button"
          onClick={() => setGroundPlacing((current) => !current)}
          data-tour="planner-ground-place"
          title={
            groundPlacing
              ? "지금은 화면을 찍으면 인물이 그 자리로 갑니다. 누르면 끕니다"
              : "켜고 바닥을 찍으면 고른 인물이 그 자리로 갑니다"
          }
          className="pointer-events-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{
            background: groundPlacing
              ? "oklch(0.72 0.18 145 / 26%)"
              : "oklch(0 0 0 / 72%)",
            border: `1px solid ${groundPlacing ? "oklch(0.72 0.18 145 / 45%)" : "oklch(1 0 0 / 10%)"}`,
            color: groundPlacing
              ? "oklch(0.85 0.16 145)"
              : "oklch(0.60 0.01 265)",
          }}
        >
          <Footprints className="h-3 w-3" /> 바닥에 세우기
        </button>

        {/*
          방 — 한 변이 곧 축척입니다. 갈래를 고르는 단추는 2026-09-11 에 없앴습니다
          . 크기를 바꾸는 자리는
          환경 탭 한 곳뿐이라, 여기서는 지금 값만 보여 줍니다.
        */}
        <span
          className="pointer-events-none flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{
            background: "oklch(0 0 0 / 72%)",
            border: "1px solid oklch(1 0 0 / 10%)",
            color: "oklch(0.72 0.15 200)",
          }}
          title="방 한 변 — 줄이면 인물이 방에서 차지하는 비율이 커져 배경보다 커 보입니다. 크기는 환경 탭에서"
        >
          <Box className="h-3 w-3" />
          {backgroundOn ? (
            <>
              방 <span className="tabular-nums">{room.size.toFixed(1)}m</span>
            </>
          ) : (
            "구도만"
          )}
        </span>
        <button
          type="button"
          onClick={() =>
            setState((current) => ({
              ...current,
              showFloor: !current.showFloor,
            }))
          }
          data-tour="planner-floor-toggle"
          title={
            showFloor
              ? "바닥면과 그림자를 숨깁니다 (캡처에도 반영)"
              : "바닥면과 그림자를 표시합니다"
          }
          className="pointer-events-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{
            background: showFloor
              ? "oklch(0.62 0.22 290 / 26%)"
              : "oklch(0 0 0 / 72%)",
            border: `1px solid ${showFloor ? "oklch(0.62 0.22 290 / 40%)" : "oklch(1 0 0 / 10%)"}`,
            color: showFloor ? "oklch(0.85 0.18 290)" : "oklch(0.60 0.01 265)",
          }}
        >
          {showFloor ? (
            <Eye className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3" />
          )}{" "}
          바닥면
        </button>
        {/*
          **«다시 찍기» 를 걷어냈습니다.** 맞습니다. «구도 저장» 이 찍으면서
          저장하므로(2026-09-10), 이 단추는 «창을 닫지 않고 지금 화면만 다시 넘기기» 라는
          아주 좁은 쓸모뿐이었습니다. 단추 이름만 봐서는 둘의 차이를 알 수 없어,
          «찍는 것과 저장하는 것이 다른가» 하는 오해만 남겼습니다.
        */}
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          data-tour="planner-save"
          className="pointer-events-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white gradient-primary"
        >
          <Save className="h-3 w-3" /> {saving ? t("저장 중…") : t("구도 저장")}
        </button>
      </div>

      {/* 작업 탭 — 도구줄 바로 아래, 자기가 바꾸는 오른쪽 패널 옆. */}
      <PlannerTabBar
        panelTab={panelTab}
        setPanelTab={setPanelTab}
        characterCount={characterCount}
      />

      {/* 방의 밑면이 곧 우리 바닥이라, 이 한 줄만 남깁니다. «구도만» 에는 방이 없습니다. */}
      {backgroundOn && (
        <p
          className="pointer-events-none max-w-[26rem] rounded px-2 py-1 text-right text-[9px] leading-relaxed"
          style={{
            background: "oklch(0 0 0 / 62%)",
            color: "oklch(0.68 0.10 200)",
          }}
        >
          밑면이 바닥(y=0)이라 <b>인물이 뜨지 않습니다.</b> 층고를 줄이면 인물이
          방에서 차지하는 비율이 커져 배경보다 커 보입니다 —{" "}
          <b>방 크기가 곧 축척</b>이에요. 층고는 환경 탭에서, 가로·깊이는 여섯
          면 그림 비율에서 자동입니다.
        </p>
      )}
    </div>
  );
}

/**
 * 미리보기 중에는 카메라를 타임라인이 몰기 때문에 마우스 조작이 막힙니다.
 * 왜 안 돌아가는지 알 수 있도록 상태를 표시합니다.
 */
export function PreviewBadge({
  playing,
  playhead,
}: {
  playing: boolean;
  playhead: number;
}) {
  return (
    <div
      /*
        타임라인 왼쪽 위가 아니라 **3D 화면 왼쪽 위**에 붙습니다. 아래에 두었더니 타임라인
        머리글과 샷 아이콘을 덮었습니다(). 미리보기 중임을 알리는 배지라 화면 쪽이 제자리이기도 합니다.
      */
      className="pointer-events-none absolute left-2 top-2 z-20 flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold"
      style={{
        background: "oklch(0.12 0.01 265 / 88%)",
        border: "1px solid oklch(0.62 0.22 290 / 45%)",
        color: "oklch(0.84 0.19 290)",
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: playing ? "oklch(0.72 0.20 25)" : "oklch(0.78 0.18 290)",
        }}
      />
      카메라 무빙 미리보기 {playing ? "재생 중" : `${playhead.toFixed(2)}s`}
      <span style={{ color: "oklch(0.58 0.01 265)" }}>
        · 화면을 돌리면 해제됩니다
      </span>
    </div>
  );
}

/** 파일을 끌고 들어왔을 때 덮는 안내. */
export function DropHint() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-lg"
      style={{
        background: "oklch(0.62 0.22 290 / 18%)",
        border: "2px dashed oklch(0.78 0.18 290)",
      }}
    >
      <p
        className="rounded-md px-3 py-2 text-xs font-semibold"
        style={{
          background: "oklch(0.12 0.01 265 / 90%)",
          color: "oklch(0.84 0.19 290)",
        }}
      >
        놓으면 등록합니다 · 이미지는 배경, .hdr/.exr 은 HDRI, .glb 는 애니메이션
      </p>
    </div>
  );
}

/**
 * «바닥에 세우기» 가 켜졌을 때의 안내.
 *
 * 누구를 옮기는지 이름으로 알려 줍니다. 인물이 여럿일 때 「고른 인물」 이라고만
 * 하면 엉뚱한 사람을 옮겨 놓고도 모릅니다.
 */
export function GroundPlaceHint({ targetName }: { targetName: string | null }) {
  return (
    <div
      className="pointer-events-none absolute bottom-12 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md px-2.5 py-1 text-[10px] font-semibold"
      style={{
        background: "oklch(0.12 0.01 265 / 90%)",
        border: "1px solid oklch(0.72 0.18 145 / 45%)",
        color: "oklch(0.85 0.16 145)",
      }}
    >
      <Footprints className="mr-1 inline h-3 w-3" />
      {targetName ? (
        <>
          바닥을 찍으면 «{targetName}» 이 그 자리로 갑니다
          {/* 지평선에 가까울수록 d = h/tan θ 가 발산해 격자 밖 수 km 로 날아갑니다 — 그래서 격자 안까지만 받습니다. */}
          <span style={{ color: "oklch(0.58 0.01 265)" }}>
            {" "}
            · 지평선 위·격자 밖은 안 됩니다 · Ctrl+Z 로 되돌립니다
          </span>
        </>
      ) : (
        <>배치 탭에서 인물을 먼저 넣어 주세요</>
      )}
    </div>
  );
}

/**
 * 하단 — 카메라 조작 도움말.
 *
 * **F 를 반드시 적습니다.** 회전 중심은 눈에 보이지 않아서, 「축이 어디로 잡혀
 * 있는지 모르겠다」는 안내가 없으면 고쳐도 그대로 남습니다.
 * Shift·Alt 도 같은 이유 — 있는 줄 모르면 없는 것과 같습니다.
 * 좁은 창에서는 줄바꿈합니다(`whitespace-nowrap` 을 뺀 까닭) — 한 줄로 버티면
 * 글이 3D 화면 밖으로 삐져나갑니다.
 */
export function CameraHelpHint() {
  return (
    <p
      data-tour="planner-camera-hint"
      className="pointer-events-none mx-auto mb-1.5 max-w-[92%] text-balance rounded-md px-2.5 py-1 text-center text-[9px] leading-relaxed"
      style={{
        background: "oklch(0 0 0 / 55%)",
        color: "oklch(0.55 0.01 265)",
      }}
    >
      화면에서 눌러 고르기 · 왼쪽 끌기 회전 · 오른쪽(또는 가운데) 끌기 이동 · 휠
      줌 · <b style={{ color: "oklch(0.72 0.01 265)" }}>더블클릭</b>이나{" "}
      <b style={{ color: "oklch(0.72 0.01 265)" }}>F</b> 로 회전 중심 옮기기(
      <b style={{ color: "oklch(0.72 0.01 265)" }}>Ctrl+F</b> 화면 한가운데로) ·{" "}
      <b style={{ color: "oklch(0.72 0.01 265)" }}>M</b> 고른 것 앞으로 카메라 ·{" "}
      <b style={{ color: "oklch(0.72 0.01 265)" }}>K</b> 키 찍기(
      <b style={{ color: "oklch(0.72 0.01 265)" }}>Shift+K</b> 자세) ·{" "}
      <b style={{ color: "oklch(0.72 0.01 265)" }}>G</b> 처음 자리로 ·{" "}
      <b style={{ color: "oklch(0.72 0.01 265)" }}>Tab</b> 관절 고르기 ·{" "}
      <b style={{ color: "oklch(0.72 0.01 265)" }}>1·2·3</b> 이동·회전·크기(
      <b style={{ color: "oklch(0.72 0.01 265)" }}>Ctrl</b> 과 함께면
      자유·바닥·높이) · W/A/S/D·Q/E 로 이동(
      <b style={{ color: "oklch(0.72 0.01 265)" }}>Shift</b> 정밀,{" "}
      <b style={{ color: "oklch(0.72 0.01 265)" }}>Alt</b> 성큼)
    </p>
  );
}

/** 패널 섹션 접힘 상태를 여러 탭이 같이 씁니다. 탭을 오가도 접힌 상태가 남아야 해서 껍데기가 들고 있습니다. */
export type SectionToggles = {
  openSections: Record<string, boolean>;
  toggleSection: (key: string) => void;
};

export type BooleanSetter = Dispatch<SetStateAction<boolean>>;
