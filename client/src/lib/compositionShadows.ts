import type { CompositionState } from "@/lib/composition";

export interface CompositionShadows {
  mode: "auto" | "contact" | "directional" | "off";
  strength: number;
  softness: number;
}

export const DEFAULT_SHADOWS: CompositionShadows = { mode: "auto", strength: 0.32, softness: 0.65 };

/** 격자를 숨겨 그림자도 끈 옛 저장본의 의도만 이행하고, 그 뒤 두 설정은 독립됩니다. */
export function normalizeShadows(value?: Partial<CompositionShadows>, legacyShowFloor = true): CompositionShadows {
  const unit = (n: unknown, fallback: number) => typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.min(1, n)) : fallback;
  return {
    mode: value && ["auto", "contact", "directional", "off"].includes(value.mode ?? "")
      ? value.mode! : !value && !legacyShowFloor ? "off" : "auto",
    strength: unit(value?.strength, DEFAULT_SHADOWS.strength),
    softness: unit(value?.softness, DEFAULT_SHADOWS.softness),
  };
}

/** 사진 자체에 빛이 구워져 있으므로 사진 방에서는 별도 방향광 그림자를 기본으로 얹지 않습니다. */
export function shadowsOf(composition: Pick<CompositionState, "shadows" | "showFloor" | "rooms" | "backgroundOn">) {
  const settings = normalizeShadows(composition.shadows, composition.showFloor);
  const photoRoom = composition.backgroundOn !== false && (composition.rooms ?? []).some(room =>
    !room.hidden && !(room.outdoor && room.outdoorShape !== "box") && Object.values(room.faces ?? {}).some(Boolean),
  );
  const mode = settings.strength === 0 ? "off" : settings.mode === "auto"
    ? photoRoom ? "contact" : "directional" : settings.mode;
  return { ...settings, resolvedMode: mode };
}

/** 발이 올라가면 그늘도 옅어져야 점프 중에도 바닥에 붙은 것처럼 보이지 않습니다. */
export function contactOpacity(height: number, strength: number) {
  return Math.max(0, Math.min(1, strength)) * Math.max(0, 1 - Math.max(0, height - 0.08) / 0.5);
}
