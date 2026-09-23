import { useState } from "react";
import { assetSrc } from "@/lib/mediaLibrary";
import { useT } from "@/lib/i18n";
import type { LocalStructureControl } from "@/lib/localStructureControl";

function SourceLength({ path }: { path: string }) {
  const t = useT();
  const [duration, setDuration] = useState<number | null>(null);
  return <span>
    <video hidden preload="metadata" src={assetSrc(path)} onLoadedMetadata={event => {
      const seconds = event.currentTarget.duration;
      if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds);
    }} />
    {duration === null ? t("원본 길이는 실행 전에 다시 확인합니다.") : t("원본 {seconds}초", { seconds: duration.toFixed(3) })}
  </span>;
}

/** 원본 영상에서 무엇을 얼마만큼 읽는지 생성 전에 보이게 합니다. */
export default function StructureControlPicker({ paths, value, onChange, disabled, seconds }: {
  paths: string[]; value: LocalStructureControl | null; onChange: (value: LocalStructureControl | null) => void;
  disabled: boolean; seconds?: number;
}) {
  const t = useT();
  const patch = (next: Partial<LocalStructureControl>) => { if (value) onChange({ ...value, ...next }); };
  const field = "w-20 rounded border border-white/10 bg-background px-1 py-0.5";
  return <div className="w-full max-w-xl rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-1.5 text-left text-[10px]">
    <label className="flex items-center justify-between gap-2">
      <span>{t("구도잡기 레퍼런스 · 윤곽 구조 제어")}</span>
      <select aria-label={t("윤곽 기준 영상")} value={value?.path ?? ""} disabled={disabled}
        className="max-w-[65%] rounded border border-white/10 bg-background px-1 py-1"
        onChange={event => onChange(event.target.value ? {
          kind: "canny", path: event.target.value, sourceStartSeconds: 0,
          durationSeconds: Math.min(5, Math.max(1, seconds ?? 5)), weight: 1,
        } : null)}>
        <option value="">{t("사용 안 함")}</option>
        {paths.map(path => <option key={path} value={path}>{path.split(/[\\/]/).pop()}</option>)}
      </select>
    </label>
    {!paths.length && <p className="mt-1 text-muted-foreground">{t("구도 레퍼런스 영상을 저장하고 «레퍼런스 영상 쓰기»를 켜세요.")}</p>}
    {value && <>
      <div className="mt-1 flex flex-wrap gap-2">
        <label>{t("원본 시작(초)")} <input className={field} aria-label={t("원본 시작(초)")} type="number" min={0} max={86400} step={0.001}
          value={value.sourceStartSeconds} disabled={disabled} onChange={event => patch({ sourceStartSeconds: Number(event.target.value) })} /></label>
        <label>{t("사용·생성 길이(초)")} <input className={field} aria-label={t("사용·생성 길이(초)")} type="number" min={1} max={60} step={0.001}
          value={value.durationSeconds} disabled={disabled} onChange={event => patch({ durationSeconds: Number(event.target.value) })} /></label>
        <label>{t("윤곽 세기")} <input className={field} aria-label={t("윤곽 세기")} type="number" min={0} max={1} step={0.05}
          value={value.weight} disabled={disabled} onChange={event => patch({ weight: Number(event.target.value) })} /></label>
      </div>
      <details className="mt-1">
        <summary>{t("윤곽 임계값")}</summary>
        {(["low", "high"] as const).map((key, index) => <label key={key} className="mr-2">
          {t(index ? "높은 임계값" : "낮은 임계값")} <input className={field} type="number" min={0} max={255} step={1}
            aria-label={t(index ? "높은 임계값" : "낮은 임계값")} disabled={disabled} value={value.thresholds?.[key] ?? (index ? 200 : 92)}
            onChange={event => patch({ thresholds: { low: 92, high: 200, ...value.thresholds, [key]: Number(event.target.value) } })} />
        </label>)}
      </details>
      <p className="mt-1 text-muted-foreground"><SourceLength key={value.path} path={value.path} /></p>
      <p className="mt-1 text-muted-foreground">{t("타임라인 카메라와 군무를 렌더한 영상을 고르세요. 카메라·인물 윤곽의 기준으로 쓰며, 움직임의 정확한 복제를 보장하지 않습니다.")}</p>
      <p className="mt-1 text-muted-foreground">{t("선택 구간의 윤곽을 출력 FPS에 맞춰 전달합니다. 포즈와 함께 쓸 수 없으며, 길이를 늘이거나 마지막 장으로 채우지 않습니다. 실제 출력은 모델의 프레임 규칙에 맞춰 짧아질 수 있습니다.")}</p>
    </>}
  </div>;
}
