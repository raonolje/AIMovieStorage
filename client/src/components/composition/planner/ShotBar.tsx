import { useState } from "react";
import { toast } from "sonner";
import { Check, Plus, Save, X } from "lucide-react";
import type { CompositionState } from "@/lib/composition";
import {
  addCameraShotIn,
  cameraShotsOf,
  goToCameraShotIn,
  removeCameraShotIn,
  renameCameraShotIn,
  saveCameraShotIn,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import { confirmDialog } from "@/components/ConfirmDialog";

/**
 * 3D 화면 **왼쪽**에 붙는 «저장해 둔 카메라» 목록.
 *
 *
 *
 * # 카메라 무빙과 무엇이 다른가
 *
 * 무빙(`cameraMoves`)은 «시간에 따라 움직이는 한 대» 이고, 이쪽은 «세워 둔 여러 대» 입니다.
 * 한 씬을 A 클로즈업·B 역각·전경으로 나눠 잡아 두고 오가는 용도라 시간 축이 없습니다.
 * 그래서 화면 아래 타임라인이 아니라 왼쪽 손잡이 줄에 둡니다.
 *
 * # 누르면 무슨 일이 일어나는가
 *
 * - **이름을 누르면** 그 구도로 카메라가 갑니다(자리·시선점·화각 전부).
 * - **저장 아이콘**은 그 구도를 지금 카메라로 덮어씁니다(재저장). 이름은 그대로 둡니다.
 * - **이름을 두 번 누르면** 고쳐 쓸 수 있습니다.
 * - **×** 는 지웁니다. 되돌릴 수 없으니 한 번 묻습니다.
 */
export function PlannerShotBar({
  state,
  setState,
}: {
  state: CompositionState;
  setState: UpdateComposition;
}) {
  const shots = cameraShotsOf(state);
  const activeId = state.activeShotId ?? null;
  /** 이름을 고치는 중인 구도. null 이면 아무것도 안 고치는 중. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );

  const commitRename = () => {
    if (!editing) return;
    const text = editing.text.trim();
    if (text) {
      const target = editing.id;
      setState((current) => renameCameraShotIn(current, target, text));
    }
    setEditing(null);
  };

  return (
    <div
      className="pointer-events-auto w-[13.5rem] rounded-lg p-2"
      style={{
        background: "oklch(0 0 0 / 72%)",
        border: "1px solid oklch(1 0 0 / 10%)",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-[9px] font-semibold"
          style={{ color: "oklch(0.52 0.01 265)" }}
        >
          저장한 카메라 {shots.length > 0 && `(${shots.length})`}
        </span>
        <button
          type="button"
          onClick={() => {
            setState((current) => addCameraShotIn(current).state);
            toast.success("지금 구도를 저장했습니다", {
              description:
                "이제 이 구도에서 출발하는 카메라 무빙을 놓을 수 있습니다. 이름은 두 번 눌러 고칩니다.",
            });
          }}
          data-tour="planner-shot-save"
          /*
            저장한 구도가 하나도 없으면 무빙 아이콘을 눌러도 «카메라를 먼저 세우세요» 로 막힙니다 —
            그래서 클립이 안 생기고, 클립이 없으면 «이동량»·«길이»·«속도 그래프» 칸도 안 그려집니다.
            이 단추가 그 줄의 **첫 문**입니다(). 안내 창이 여기부터 눌러 나갑니다.
          */
          data-tour-open="bottom-clip-amount bottom-clip-length bottom-easing bottom-free-key"
          title="지금 카메라를 새 구도로 저장합니다"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold"
          style={{
            background: "oklch(0.55 0.15 200 / 26%)",
            color: "oklch(0.80 0.13 200)",
          }}
        >
          <Plus className="h-3 w-3" /> 지금 구도 저장
        </button>
      </div>

      {/*
        같은 자리에 둘 중 하나만 섭니다 — 구도가 없으면 안내 글, 있으면 목록. 둘 다 같은 이름을
        달아야 «저장한 구도가 없는 화면» 에서도 튜토리얼이 가리킬 자리를 찾습니다.
        이름 칸은 두 번 눌러야 생겨 못 잡으므로 감싸는 목록에 답니다.
      */}
      {shots.length === 0 ? (
        <p
          data-tour="planner-shot-list"
          className="mt-1.5 text-[9px] leading-relaxed"
          style={{ color: "oklch(0.45 0.01 265)" }}
        >
          아직 없습니다. 구도를 잡고 «지금 구도 저장» 을 누르면 여기 쌓입니다 —
          눌러서 그 구도로 바로 돌아올 수 있고, <b>G</b> 는 활성 구도로 갑니다.
        </p>
      ) : (
        <div
          data-tour="planner-shot-list"
          className="composition-scroll mt-1.5 max-h-[11rem] space-y-1 overflow-y-auto pr-0.5"
        >
          {shots.map((shot) => {
            const on = shot.id === activeId;
            const isEditing = editing?.id === shot.id;
            return (
              <div key={shot.id} className="flex items-center gap-0.5">
                {isEditing ? (
                  <input
                    autoFocus
                    value={editing.text}
                    onChange={(event) =>
                      setEditing({ id: shot.id, text: event.target.value })
                    }
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRename();
                      if (event.key === "Escape") setEditing(null);
                      event.stopPropagation();
                    }}
                    className="min-w-0 flex-1 rounded px-1.5 py-1 text-[10px] outline-none"
                    style={{
                      background: "oklch(1 0 0 / 10%)",
                      color: "oklch(0.92 0.01 265)",
                      border: "1px solid oklch(0.55 0.15 200 / 50%)",
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setState((current) => goToCameraShotIn(current, shot.id))
                    }
                    onDoubleClick={() =>
                      setEditing({ id: shot.id, text: shot.name })
                    }
                    title={`${shot.name} 으로 이동 — 두 번 누르면 이름 고치기 · 화각 ${shot.fovDegrees.toFixed(0)}°`}
                    className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-[10px] font-semibold"
                    style={{
                      background: on
                        ? "oklch(0.55 0.15 200 / 30%)"
                        : "oklch(1 0 0 / 6%)",
                      color: on
                        ? "oklch(0.86 0.13 200)"
                        : "oklch(0.76 0.01 265)",
                      border: `1px solid ${on ? "oklch(0.62 0.15 200 / 60%)" : "transparent"}`,
                    }}
                  >
                    {on && <Check className="mr-1 inline h-2.5 w-2.5" />}
                    {shot.name}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setState((current) => saveCameraShotIn(current, shot.id));
                    /*
                      
                      덮어쓰기는 화면이 하나도 안 바뀌는 편집이라(카메라가 이미 그
                      자리에 있으니까) 눌렀는지 아닌지를 알 길이 없었습니다.
                    */
                    toast.success(
                      `«${shot.name}» 을 지금 구도로 저장했습니다`,
                      {
                        description:
                          "이 구도에서 출발하는 카메라 무빙도 함께 바뀝니다.",
                      },
                    );
                  }}
                  title="이 구도를 지금 카메라로 덮어씁니다(재저장)"
                  className="shrink-0 rounded p-1"
                  style={{ color: "oklch(0.66 0.13 200)" }}
                >
                  <Save className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const yes = await confirmDialog({
                      title: `«${shot.name}» 을 지울까요?`,
                      description:
                        "저장해 둔 구도가 사라집니다. 되돌릴 수 없습니다.",
                      confirmLabel: "지우기",
                      tone: "danger",
                    });
                    if (yes)
                      setState((current) =>
                        removeCameraShotIn(current, shot.id),
                      );
                  }}
                  title="이 구도를 지웁니다"
                  className="shrink-0 rounded p-1"
                  style={{ color: "oklch(0.62 0.16 25)" }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PlannerShotBar;
