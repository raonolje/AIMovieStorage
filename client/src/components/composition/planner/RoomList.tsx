import { useT } from "@/lib/i18n";
import { useState } from "react";
import { Eye, EyeOff, Pencil, Plus, X } from "lucide-react";
import { NumberInput } from "@/components/composition/fields";
import type { CompositionRoom, CompositionState } from "@/lib/composition";
import {
  activeRoomOf,
  addRoomIn,
  removeRoomIn,
  renameRoomIn,
  roomsOf,
  setActiveRoomIn,
  setRoomHiddenIn,
  setRoomPlacementIn,
  type RoomKind,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import { confirmDialog } from "@/components/ConfirmDialog";

/**
 * 세워 둔 **방들** — 고르기·더하기·지우기와 활성 방의 자리.
 *
 * # 왜 방을 나누는가 — 크게 만들면 되지 않나
 *
 * 안 됩니다. **방 크기가 곧 축척**이기 때문입니다(`roomAutoGrow` 주석). 거실과 주방을
 * 하나의 큰 상자로 잡으면 벽 그림이 두 배로 늘어나고, 그 안의 1.7m 인물이 상대적으로
 * 절반이 됩니다. 실측대로 뽑은 배경에서는 그게 곧 «틀린 그림» 이에요. 방을 둘로 나눠
 * 각각 실측대로 세우고 벽을 맞대면 두 공간의 축척이 **각자** 맞습니다.
 *
 * # 자리는 밑면 한가운데입니다
 *
 * 상자의 중심이 아니라 **바닥의 한가운데**를 적습니다. 층고를 바꿔도 바닥이 안 움직여야
 * 인물의 발이 바닥 그림에서 떨어지지 않으니까요. 2층을 얹을 때만 높이(y)를 씁니다.
 */
export function RoomList({
  state,
  setState,
  renderProperties,
}: {
  state: CompositionState;
  setState: UpdateComposition;
  /**
   * 방 **아래에 펴지는 속성**. 고른 방 하나만 펴집니다 — 여럿을 동시에 펴면 어느 방을 만지는지 화면에서 사라집니다.
   */
  renderProperties?: (room: CompositionRoom) => React.ReactNode;
}) {
  const t = useT();
  const rooms = roomsOf(state);
  const active = activeRoomOf(state);
  /**
   * 속성을 펴 둔 방. 방을 누르면 그 방이 활성이 되면서 펴집니다.
   *
   * 처음에는 **지금 만지는 방**이 펴져 있습니다 — 탭을 열자마자 접힌 목록만 보이면 치수를 고치러 한 번 더 눌러야 합니다.
   */
  const [openId, setOpenId] = useState<string | null>(
    () => state.rooms?.[0]?.id ?? null,
  );
  /** 이름을 고치는 중인 방. null 이면 아무것도 안 고치는 중. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );

  const commitRename = () => {
    if (!editing) return;
    const text = editing.text.trim();
    if (text) {
      const target = editing.id;
      setState((current) => renameRoomIn(current, target, text));
    }
    setEditing(null);
  };

  /**
   * 방을 세우고 **바로 펼칩니다**.
   * 세우자마자 하는 일이 크기 맞추기라, 한 번 더 눌러야 열리면 손이 한 번 더 갑니다.
   */
  const addRoom = (kind: RoomKind) =>
    setState((current) => {
      const made = addRoomIn(current, kind);
      setOpenId(made.id);
      return made.state;
    });

  const place = (patch: {
    x?: number;
    y?: number;
    z?: number;
    rotationY?: number;
  }) => setState((current) => setRoomPlacementIn(current, active.id, patch));

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <span
          className="text-[9px] font-semibold"
          style={{ color: "oklch(0.52 0.01 265)" }}
        >
          {t("방")} {rooms.length > 1 && `(${rooms.length})`}
        </span>
        {/*
          ── 실내 · 실외 ────────────────────────────────────────────────
           세울 때 정해야 «이미지 생성» 이 전개도를 뽑을지 파노라마를 뽑을지 알 수 있습니다.
        */}
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => addRoom("indoor")}
            data-tour="env-room-add-indoor"
            // 방을 세워야 치수·가릴 면·전개도·6면 세트 칸이 생깁니다 — 튜토리얼이
            // 「먼저 «실내» 를 누르세요」 라고 가리킵니다().
            data-tour-open="env-room-size env-occlude-faces env-room-make-image env-face-sets env-room-props env-room-section"
            title={t("여섯 면을 붙일 실내 방입니다. 이미 방이 있으면 오른쪽에 벽을 맞대어 세웁니다")}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold"
            style={{ background: "oklch(0.55 0.15 200 / 26%)", color: "oklch(0.80 0.13 200)" }}
          >
            <Plus className="h-3 w-3" /> {t("실내")}
          </button>
          <button
            type="button"
            onClick={() => addRoom("outdoor")}
            data-tour-open="env-outdoor-shape env-panoramas"
            title={t("파노라마 한 장을 두르는 돔입니다. 한 변 100 m 짜리 공터로 서고, 크기는 아래 칸에서 바꿉니다")}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold"
            style={{ background: "oklch(0.72 0.16 60 / 26%)", color: "oklch(0.86 0.14 60)" }}
          >
            <Plus className="h-3 w-3" /> {t("실외")}
          </button>
          {/*
            ── 호리존 ──────────────────────────────────────────────────
             그림을 안 붙이는 방이라 색조는 무채색으로 —
            «색은 당신이 고른다» 는 뜻입니다.
          */}
          <button
            type="button"
            onClick={() => addRoom("horizon")}
            data-tour-open="env-horizon-color"
            title={t("단색 호리존 스튜디오 — 색을 고르는 방, 제품 컷용. 전개도·파노라마 없이 여섯 면이 한 가지 색으로 이어집니다")}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold"
            style={{ background: "oklch(0.80 0.02 300 / 24%)", color: "oklch(0.90 0.03 300)" }}
          >
            <Plus className="h-3 w-3" /> {t("호리존")}
          </button>
        </span>
      </div>

      <div data-tour="env-room-list" className="mt-1 space-y-1">
        {rooms.map((room) => {
          const on = room.id === active.id;
          const isEditing = editing?.id === room.id;
          return (
            <div key={room.id}>
            <div className="flex items-center gap-0.5">
              {isEditing ? (
                <input
                  autoFocus
                  value={editing.text}
                  onChange={(event) =>
                    setEditing({ id: room.id, text: event.target.value })
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
                  onClick={() => {
                    setState((current) => setActiveRoomIn(current, room.id));
                    // 누른 방이 펴집니다. 이미 펴 둔 방을 다시 누르면 접힙니다.
                    setOpenId((now) => (now === room.id ? null : room.id));
                  }}
                  onDoubleClick={() =>
                    setEditing({ id: room.id, text: room.name })
                  }
                  title={`${room.name} — ${room.width.toFixed(1)} × ${room.depth.toFixed(1)} × ${room.height.toFixed(1)}m · 두 번 누르면 이름 고치기`}
                  className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-[10px] font-semibold"
                  style={{
                    background: on
                      ? "oklch(0.55 0.15 200 / 30%)"
                      : "oklch(1 0 0 / 6%)",
                    color: on ? "oklch(0.86 0.13 200)" : "oklch(0.72 0.01 265)",
                    border: `1px solid ${on ? "oklch(0.62 0.15 200 / 60%)" : "transparent"}`,
                    opacity: room.hidden ? 0.45 : 1,
                  }}
                >
                  {/* 호리존은 이름 앞에 그 색을 작게 — 목록에서 «어느 방이 스튜디오인지» 와 «무슨 색인지» 를 한눈에. */}
                  {room.horizon && (
                    <span
                      className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
                      style={{ background: room.horizon.color, border: "1px solid oklch(1 0 0 / 25%)" }}
                    />
                  )}
                  {room.name}
                  <span
                    className="ml-1 font-normal tabular-nums"
                    style={{ color: "oklch(0.50 0.01 265)" }}
                  >
                    {room.width.toFixed(1)}×{room.depth.toFixed(1)}×
                    {room.height.toFixed(1)}
                  </span>
                </button>
              )}
              {/*
                이름 고치기 단추. 두 번 누르기만으로는 **있는 줄을 모릅니다** —
                
              */}
              {!isEditing && (
                <button
                  type="button"
                  onClick={() => setEditing({ id: room.id, text: room.name })}
                  title={t("이름 고치기")}
                  className="shrink-0 rounded p-1"
                  style={{ color: "oklch(0.58 0.01 265)" }}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
              {/* 지우지 않고 잠깐 끄기 — 옆방이 시야를 막을 때 구도를 보려고. */}
              <button
                type="button"
                onClick={() =>
                  setState((current) =>
                    setRoomHiddenIn(current, room.id, !room.hidden),
                  )
                }
                title={room.hidden ? "다시 보이게" : "잠시 숨기기"}
                className="shrink-0 rounded p-1"
                style={{ color: "oklch(0.58 0.01 265)" }}
              >
                {room.hidden ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </button>
              {/* 마지막 한 칸까지 지울 수 있습니다 — 방이 없는 것이 새 컷의 기본 상태입니다. */}
              {(
                <button
                  type="button"
                  onClick={async () => {
                    const yes = await confirmDialog({
                      title: `«${room.name}» 을 지울까요?`,
                      description: room.horizon
                        ? "고른 호리존 색이 사라집니다. 되돌리기(Ctrl+Z)로 되살릴 수 있습니다."
                        : "그 방에 붙인 여섯 면 선택이 사라집니다. 되돌리기(Ctrl+Z)로 되살릴 수 있습니다.",
                      confirmLabel: "지우기",
                      tone: "danger",
                    });
                    if (yes)
                      setState((current) => removeRoomIn(current, room.id));
                  }}
                  title={t("이 방을 지웁니다")}
                  className="shrink-0 rounded p-1"
                  style={{ color: "oklch(0.62 0.16 25)" }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {renderProperties && openId === room.id && renderProperties(room)}
            </div>
          );
        })}
      </div>

      {/*
        자리는 방이 둘 이상일 때만 보입니다. 하나뿐이면 원점에 두는 것이 늘 맞고,
        손잡이가 하나라도 늘면 「이걸 왜 만지지」 가 됩니다.
      */}
      {rooms.length > 1 && (
        <>
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {[
              { key: "x" as const, label: "가로", value: active.position.x },
              { key: "z" as const, label: "깊이", value: active.position.z },
              { key: "y" as const, label: "높이", value: active.position.y },
              {
                key: "rotationY" as const,
                label: "회전°",
                value: active.rotationY,
              },
            ].map((field) => (
              <label key={field.key} className="block">
                <span
                  className="block text-[9px]"
                  style={{ color: "oklch(0.50 0.01 265)" }}
                >
                  {t(field.label)}
                </span>
                <NumberInput
                  value={Math.round(field.value * 100) / 100}
                  step={field.key === "rotationY" ? 15 : 0.5}
                  onChange={(next) => place({ [field.key]: next })}
                />
              </label>
            ))}
          </div>
          <p
            className="mt-1 text-[9px] leading-relaxed"
            style={{ color: "oklch(0.48 0.01 265)" }}
          >
            자리는 <b>방 밑면 한가운데</b>입니다. 층고를 바꿔도 바닥이 안
            움직여요. «방 더하기» 는 지금 방 오른쪽에 <b>벽을 맞대어</b>{" "}
            놓으므로, 문으로 이어진 두 칸이 됩니다.
          </p>
        </>
      )}
    </div>
  );
}

export default RoomList;
