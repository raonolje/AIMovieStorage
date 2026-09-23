import { useState } from "react";
import { assetSrc } from "@/lib/mediaLibrary";
import { useT } from "@/lib/i18n";

export type H3ReferenceRange = "first5s" | "full";

function VideoLength({ path, selection }: { path: string; selection: H3ReferenceRange | "" }) {
  const t = useT();
  const [duration, setDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const name = path.split(/[\\/]/).pop() || path;
  const selected = duration === null ? null : selection === "first5s" ? Math.min(5, duration) : duration;
  return <div className="truncate text-[10px] text-muted-foreground" title={name}>
    <video hidden preload="metadata" src={assetSrc(path)}
      onLoadedMetadata={event => {
        const value = event.currentTarget.duration;
        if (Number.isFinite(value) && value > 0) setDuration(value);
        else setFailed(true);
      }} onError={() => setFailed(true)} />
    {name} · {duration === null
      ? t(failed ? "원본 길이를 확인하지 못했습니다." : "원본 길이를 읽는 중…")
      : t("원본 {seconds}초", { seconds: duration.toFixed(2) })}
    {selection && selected !== null && <> · {t("선택 {seconds}초", { seconds: selected.toFixed(2) })}</>}
  </div>;
}

/** 긴 영상 입력을 사람 몰래 줄이지 않도록, 파일마다 길이를 보고 직접 고릅니다. */
export default function H3ReferenceRangePicker({ paths, value, onChange, disabled }: {
  paths: string[]; value: H3ReferenceRange | ""; onChange: (value: H3ReferenceRange) => void; disabled: boolean;
}) {
  const t = useT();
  return <div className="w-full max-w-xl rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-left">
    <label className="flex items-center justify-between gap-2 text-[10px]">
      <span>{t("H3 영상 레퍼런스 구간")}</span>
      <select value={value} disabled={disabled} onChange={event => onChange(event.target.value as H3ReferenceRange)}
        className="rounded border border-white/10 bg-background px-2 py-1">
        <option value="" disabled>{t("구간을 선택하세요")}</option>
        <option value="first5s">{t("앞 5초만 (최대)")}</option>
        <option value="full">{t("전체 영상")}</option>
      </select>
    </label>
    {paths.map((path, index) => <VideoLength key={`${index}:${path}`} path={path} selection={value} />)}
    <p className="mt-1 text-[10px] text-muted-foreground">{t("선택은 모든 영상 레퍼런스에 적용됩니다. 원본 파일은 바뀌지 않습니다. H3는 생성 길이까지만 참조하며 실제 입력 길이는 작업 결과에 기록됩니다.")}</p>
    <p className="mt-1 text-[10px] text-amber-200/80">{t("긴 레퍼런스는 처리량을 늘립니다. RTX PRO 6000 96GB에서 15초 레퍼런스와 14초 출력의 한 실측은 79분 뒤 중단했습니다. 예상 완료시간이나 앞 5초의 속도를 보장하는 수치는 아닙니다.")}</p>
  </div>;
}
