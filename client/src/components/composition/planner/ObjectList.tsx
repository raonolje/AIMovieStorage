import { useState } from "react";
import { Boxes, Eye, EyeOff, X } from "lucide-react";
import {
  groupObjectsIn,
  removeObjectIn,
  updateObjectIn,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import type { CompositionState, ObjectComposition } from "@/lib/composition";
import { GroupRows } from "./ObjectGroupPanel";

/**
 * 세워 둔 소품 목록 — **한 줄에 하나**, 묶은 것은 덩어리 한 줄로.
 *
 * 배치 탭(캐릭터 소품)과 환경 탭(그 방의 배경 소품)이 같이 씁니다. 목록에 무엇을 낼지는 부르는 쪽이 정합니다
 * (`objects`) —
 *
 * 이름은 **두 번 눌러** 고칩니다.
 * 아래쪽 속성 칸에 이름 입력칸을 따로 두면, 덩어리를 골랐을 때도 남아 무엇의 이름인지 헷갈립니다.
 */
export function ObjectList({
  state,
  setState,
  objects,
  selected,
  setSelected,
  emptyNote,
}: {
  state: CompositionState;
  setState: UpdateComposition;
  /** 이 목록에 낼 소품들(묶인 것 포함 — 묶인 것은 덩어리 줄로 올라갑니다). */
  objects: ObjectComposition[];
  selected: string;
  setSelected: (value: string) => void;
  emptyNote?: string;
}) {
  /** Ctrl 로 함께 잡아 둔 것. 묶고 나면 비웁니다. */
  const [picked, setPicked] = useState<string[]>([]);
  /** 이름을 고치는 중인 소품. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const ids = objects.map((item) => item.id);

  const commitRename = () => {
    if (!editing) return;
    const text = editing.text.trim();
    if (text) {
      const target = editing.id;
      setState((current) => updateObjectIn(current, target, { label: text }));
    }
    setEditing(null);
  };

  const toggle = (id: string) =>
    setPicked((now) => (now.includes(id) ? now.filter((item) => item !== id) : [...now, id]));

  return (
    <div className="space-y-1">
      <GroupRows
        state={state}
        setState={setState}
        selected={selected}
        setSelected={setSelected}
        only={ids}
        picked={picked}
        togglePick={toggle}
      />

      {objects.map((item) => {
        // 묶인 소품은 위의 덩어리 줄에 들어 있으므로 여기서는 감춥니다.
        if (item.groupId) return null;
        const on = selected === `object:${item.id}`;
        const renaming = editing?.id === item.id;
        return (
          <div key={item.id} className="flex items-center gap-1">
            {renaming ? (
              <input
                autoFocus
                value={editing.text}
                onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename();
                  if (event.key === "Escape") setEditing(null);
                  event.stopPropagation();
                }}
                className="min-w-0 flex-1 rounded px-2 py-1.5 text-[11px] outline-none"
                style={{
                  background: "oklch(1 0 0 / 10%)",
                  color: "oklch(0.92 0.01 265)",
                  border: "1px solid oklch(0.62 0.22 290 / 50%)",
                }}
              />
            ) : (
              <button
                type="button"
                // 소품을 골라야 조명·시트로 바꿔 그리기·관절에 붙이기·에셋 만들기 칸이 생깁니다.
                data-tour-switch="layout-light layout-object-swap layout-object-asset layout-attach-bone layout-object-group"
                onClick={(event) => {
                  /*
                    Ctrl(맥은 ⌘) 로 누르면 **함께 잡습니다** — 둘 이상이면 아래에 «묶기» 가 뜹니다.
                    
                    체크칸은 한 줄에 늘 붙어 있어 자리를 먹는데, 실제로 쓰는 건 묶을 때뿐입니다.
                  */
                  if (event.ctrlKey || event.metaKey) {
                    // 조명은 묶을 수 없습니다(`groupObjectsIn`) — 잡히지도 않게 둡니다.
                    if (item.kind !== "light") toggle(item.id);
                    return;
                  }
                  setPicked([]);
                  setSelected(on ? "none" : `object:${item.id}`);
                }}
                onDoubleClick={() => setEditing({ id: item.id, text: item.label })}
                title={`${item.label} · 두 번 누르면 이름 고치기 · Ctrl 을 누르고 누르면 여럿을 함께`}
                className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-[11px]"
                style={{
                  background: on
                    ? "oklch(0.62 0.22 290 / 22%)"
                    : picked.includes(item.id)
                      ? "oklch(0.72 0.16 60 / 18%)"
                      : "oklch(1 0 0 / 5%)",
                  border: `1px solid ${picked.includes(item.id) ? "oklch(0.72 0.16 60 / 55%)" : "transparent"}`,
                  color: on ? "oklch(0.84 0.10 290)" : "oklch(0.66 0.01 265)",
                  opacity: item.visible ? 1 : 0.5,
                }}
              >
                {item.label}
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setState((current) =>
                  updateObjectIn(current, item.id, { visible: !item.visible }),
                )
              }
              title={item.visible ? "잠시 숨기기" : "다시 보이게"}
              className="shrink-0 rounded p-1 hover:bg-white/10"
            >
              {item.visible ? (
                <Eye className="h-3 w-3" style={{ color: "oklch(0.62 0.01 265)" }} />
              ) : (
                <EyeOff className="h-3 w-3" style={{ color: "oklch(0.45 0.01 265)" }} />
              )}
            </button>
            <button
              type="button"
              onClick={() => setState((current) => removeObjectIn(current, item.id))}
              title="이 소품을 지웁니다"
              className="shrink-0 rounded p-1 hover:bg-white/10"
              style={{ color: "oklch(0.55 0.14 25)" }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      {objects.length === 0 && emptyNote && (
        <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
          {emptyNote}
        </p>
      )}

      {/* 묶기는 **목록 안에** 둡니다 — 고르는 자리와 묶는 자리가 떨어져 있으면 무엇을 골랐는지 잊습니다. */}
      {picked.length >= 2 && (
        <button
          type="button"
          data-tour="layout-object-group"
          onClick={() =>
            setState((current) => {
              const made = groupObjectsIn(current, picked);
              if (made.id) setPicked([]);
              return made.state;
            })
          }
          className="flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-[9px] font-semibold"
          style={{
            background: "oklch(0.62 0.22 290 / 24%)",
            border: "1px solid oklch(0.62 0.22 290 / 45%)",
            color: "oklch(0.86 0.17 290)",
          }}
        >
          <Boxes className="h-2.5 w-2.5" /> 함께 잡은 {picked.length}개를 한 덩어리로
        </button>
      )}
    </div>
  );
}

export default ObjectList;
