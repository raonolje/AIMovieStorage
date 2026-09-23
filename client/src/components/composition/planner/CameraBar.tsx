import {
  CAMERA_FOV_MAX,
  CAMERA_FOV_MIN,
  CAMERA_SPEED_MAX,
  CAMERA_SPEED_MIN,
  type CompositionState,
} from "@/lib/composition";
import {
  orbitSpeedOf,
  setCameraFovIn,
  setCameraSpeedIn,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import PlannerRange from "@/components/composition/planner/PlannerRange";

/**
 * 3D 화면 **왼쪽 위**에 붙는 카메라 손잡이 — 샷 크기(렌즈 화각)와 조작 속도.
 *
 *
 *
 * 둘 다 **화면을 보면서 돌리는** 값입니다. 오른쪽 패널에 있으면 탭을 «카메라» 로 바꿔야 손이
 * 닿는데, 그러면 배치를 만지다 화각을 조금 바꾸는 일에도 탭을 오가야 했습니다. 비율 칩과 같은
 * 줄(왼쪽 위)에 두면 화면에서 눈을 떼지 않고 만질 수 있습니다.
 *
 * 접어 둘 수 있게 하지 않은 까닭: 둘 다 한 줄짜리라 접는 손잡이가 값보다 큽니다.
 */
export function PlannerCameraBar({
  state,
  setState,
  setStateRaw,
  mark,
}: {
  state: CompositionState;
  setState: UpdateComposition;
  /** 되돌리기에 **안 쌓는** 갱신 — 손잡이를 끄는 동안 씁니다. 까닭은 `PlannerRange`. */
  setStateRaw: UpdateComposition;
  mark: () => void;
}) {
  const fov = state.camera.fovDegrees;
  /*
    35mm 판 환산 초점거리. 「40도」 보다 「35mm 렌즈」 가 훨씬 잘 읽힙니다.
    세로 24mm 판 기준: f = 12 / tan(세로화각/2).
  */
  const lensMm = Math.round(12 / Math.tan((fov * Math.PI) / 360));
  const speed = orbitSpeedOf(state);

  const chip = (on: boolean) => ({
    background: on ? "oklch(0.55 0.15 200 / 30%)" : "oklch(1 0 0 / 6%)",
    color: "oklch(0.78 0.12 200)",
  });

  return (
    <div
      className="pointer-events-auto w-[13.5rem] rounded-lg p-2"
      style={{
        background: "oklch(0 0 0 / 72%)",
        border: "1px solid oklch(1 0 0 / 10%)",
      }}
    >
      {/*
        샷 크기 — 렌즈 화각.

        «구도를 유지한 채 원거리·근거리» 의 정답입니다. 화각을 바꾸면 인물도 배경도 화면
        크기가 똑같이 1/tan(화각/2) 에 비례해 변해서 둘의 비율이 한 치도 안 틀립니다.
        카메라를 앞뒤로 빼는 것(달리)은 그 비율 자체를 바꾸는 조작입니다.
      */}
      <div
        data-tour="planner-camera-fov"
        className="flex items-center justify-between text-[9px]"
        style={{ color: "oklch(0.52 0.01 265)" }}
      >
        <span>샷 크기 — 렌즈 화각</span>
        <span
          className="tabular-nums"
          style={{ color: "oklch(0.72 0.15 200)" }}
        >
          {fov.toFixed(0)}° · {lensMm}mm
        </span>
      </div>
      <PlannerRange
        min={CAMERA_FOV_MIN}
        max={CAMERA_FOV_MAX}
        step={1}
        value={fov}
        mark={mark}
        onChange={(next) => setStateRaw((current) => setCameraFovIn(current, next))}
        className="mt-1 w-full"
      />
      <div className="mt-1 flex gap-0.5">
        {[
          {
            value: 18,
            label: "망원",
            hint: "약 75mm — 배경이 크게 밀려옵니다",
          },
          { value: 28, label: "준망원", hint: "약 48mm" },
          { value: 40, label: "표준", hint: "약 33mm — 기본값" },
          { value: 60, label: "광각", hint: "약 21mm" },
          { value: 80, label: "초광각", hint: "약 14mm — 배경이 멀어집니다" },
        ].map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() =>
              setState((current) => setCameraFovIn(current, preset.value))
            }
            title={preset.hint}
            className="flex-1 rounded px-0.5 py-0.5 text-[8px] font-semibold"
            style={chip(Math.abs(fov - preset.value) < 0.5)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/*
        카메라 조작 속도. 회전 감도는 화각으로 자동으로 잡히고(`orbitRotateSpeed`) 여기서
        정한 배수가 그 위에 곱해집니다 — 회전·걷기·줌이 한 덩어리로 움직입니다.
      */}
      <div
        data-tour="planner-camera-speed"
        className="mt-2 flex items-center justify-between border-t pt-2 text-[9px]"
        style={{
          color: "oklch(0.52 0.01 265)",
          borderColor: "oklch(1 0 0 / 8%)",
        }}
      >
        <span>조작 속도 — 회전·이동·줌</span>
        <span
          className="tabular-nums"
          style={{ color: "oklch(0.72 0.15 200)" }}
        >
          ×{speed.toFixed(2)}
        </span>
      </div>
      <PlannerRange
        min={CAMERA_SPEED_MIN}
        max={CAMERA_SPEED_MAX}
        step={0.05}
        value={speed}
        mark={mark}
        onChange={(next) => setStateRaw((current) => setCameraSpeedIn(current, next))}
        className="mt-1 w-full"
      />
      <div className="mt-1 flex gap-0.5">
        {[0.3, 0.5, 1, 2].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() =>
              setState((current) => setCameraSpeedIn(current, preset))
            }
            title="Shift 를 누르면 걸음이 0.3배(정밀), Alt 면 3배입니다"
            className="flex-1 rounded px-0.5 py-0.5 text-[8px] font-semibold"
            style={chip(Math.abs(speed - preset) < 0.001)}
          >
            ×{preset}
          </button>
        ))}
      </div>
    </div>
  );
}

export default PlannerCameraBar;
