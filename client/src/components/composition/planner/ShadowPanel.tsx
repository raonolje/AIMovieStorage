import { useT } from "@/lib/i18n";
import type { CompositionState } from "@/lib/composition";
import { normalizeShadows, type CompositionShadows } from "@/lib/compositionShadows";
import type { UpdateComposition } from "@/lib/compositionEdit";
import PlannerRange from "./PlannerRange";

export default function ShadowPanel({ state, setState, setStateRaw, mark }: {
  state: CompositionState; setState: UpdateComposition; setStateRaw: UpdateComposition; mark: () => void;
}) {
  const t = useT();
  const settings = normalizeShadows(state.shadows, state.showFloor);
  const patch = (value: Partial<CompositionShadows>, raw = false) => (raw ? setStateRaw : setState)(current => ({
    ...current, shadows: normalizeShadows({ ...normalizeShadows(current.shadows, current.showFloor), ...value }),
  }));
  return (
    <section data-tour="env-shadows" className="space-y-2 rounded-md border border-white/10 p-2 text-[10px]">
      <div className="font-semibold">{t("그림자 · 바닥 격자와 별도")}</div>
      <div className="grid grid-cols-4 gap-1">
        {([
          ["auto", "자동"], ["contact", "접지 그늘"], ["directional", "방향광"], ["off", "끄기"],
        ] as const).map(([mode, label]) => (
          <button key={mode} type="button" onClick={() => patch({ mode })} aria-pressed={settings.mode === mode}
            className={`rounded px-1 py-1 ${settings.mode === mode ? "bg-cyan-500/20 text-cyan-200" : "bg-white/5 text-white/60"}`}>
            {t(label)}
          </button>
        ))}
      </div>
      {([ ["strength", "그림자 세기"], ["softness", "그림자 부드러움"] ] as const).map(([key, label]) => (
        <label key={key} className="flex items-center gap-2">
          <span className="w-24 shrink-0">{t(label)}</span>
          <PlannerRange value={settings[key]} min={0} max={1} step={0.01} mark={mark}
            onChange={value => patch({ [key]: value }, true)} title={t(label)} className="min-w-0 flex-1" />
          <span className="w-8 text-right tabular-nums">{Math.round(settings[key] * 100)}%</span>
        </label>
      ))}
      <p className="text-[9px] leading-relaxed text-white/50">
        {t("자동은 사진을 붙인 방에서 인물 발밑의 접지 그늘을, 그 밖에는 방향광 그림자를 씁니다. 바닥 격자를 꺼도 그림자는 유지됩니다.")}
      </p>
      <p className="text-[9px] leading-relaxed text-white/50">
        {t("접지 그늘은 수평 바닥의 발 위치를 따르는 근사 표시입니다. 실제 조명과 재질은 영상 프롬프트에서 배경에 맞춥니다.")}
      </p>
    </section>
  );
}
