import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  AxisVectorFields,
  TransformRowHeader,
  ZERO_VECTOR,
} from "@/components/composition/fields";
import type { CharacterComposition } from "@/lib/composition";

/**
 * 고른 인물의 **자리와 방향 수치**. 소품의 `ObjectFields` 와 같은 모양으로, **접힌 채로** 뜹니다.
 *
 *
 * 평소에는 화면에서 끌어 맞추고, 숫자로 딱 맞춰야 할 때만 폅니다.
 *
 * 크기 칸은 없습니다 — 인물의 크기는 **키(cm)** 가 정합니다(위 칸).
 */
export function CharacterFields({
  placement,
  onChange,
}: {
  placement: CharacterComposition;
  onChange: (patch: Partial<CharacterComposition>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((now) => !now)}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] font-semibold"
        style={{ color: "oklch(0.52 0.01 265)" }}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        위치 · 회전 숫자
      </button>

      {open && (
        <div className="mt-1 space-y-2">
          <div>
            <TransformRowHeader label="위치" />
            <AxisVectorFields
              value={placement.position}
              zUp
              defaults={ZERO_VECTOR}
              onChange={(position) => onChange({ position })}
            />
          </div>
          <div>
            <TransformRowHeader label="회전" />
            <AxisVectorFields
              zUp
              value={
                placement.rotation || { x: 0, y: placement.rotationY || 0, z: 0 }
              }
              defaults={ZERO_VECTOR}
              unit="deg"
              step={15}
              onChange={(rotation) =>
                onChange({ rotation, rotationY: rotation.y })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default CharacterFields;
