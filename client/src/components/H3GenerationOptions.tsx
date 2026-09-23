import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "@/lib/i18n";
import { H3_REF_PRESET, h3GuiRunOptions, h3PresetCandidate, type H3ResizeMode } from "@/lib/h3GenerationOptions";
import type { LocalLora } from "@/lib/localEngines";
import type { LoraOnDisk } from "@/lib/localLoras";

export function useH3GenerationOptions(active: boolean, loras: LocalLora[], files: LoraOnDisk[]) {
  const candidate = active ? h3PresetCandidate(loras, files) : null;
  const key = candidate ? JSON.stringify([candidate.path, candidate.fileName, candidate.sizeBytes]) : "";
  const selection = useMemo(() => ({ key }), [key]);
  const [resize, setResize] = useState<H3ResizeMode>("diffusers");
  const [turboKey, setTurboKey] = useState<object | null>(null);
  const [verified, setVerified] = useState<{ selection: object; key: string; preset: string | null; error?: string } | null>(null);
  useEffect(() => {
    if (!candidate || !key) return;
    let current = true;
    void invoke<string | null>("lora_verify_h3_preset", { fileName: candidate.fileName }).then(
      preset => { if (current) setVerified({ selection, key, preset }); },
      error => { if (current) setVerified({ selection, key, preset: null, error: String(error) }); },
    );
    return () => { current = false; };
    // 파일·선택 세기·참조 여부가 바뀌면 이전 비동기 결과는 버립니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);
  const checked = !!key && verified?.selection === selection;
  const ready = checked && verified.preset === H3_REF_PRESET;
  const turbo = ready && turboKey === selection;
  return {
    active, resize, setResize, ready, turbo,
    setTurbo: (enabled: boolean) => setTurboKey(enabled && ready ? selection : null),
    checking: !!key && !checked,
    error: checked ? verified.error : undefined,
    hasCandidate: !!key,
    options: h3GuiRunOptions(active, resize, turbo, key, checked ? verified.key : null, checked ? verified.preset : null),
  };
}

export default function H3GenerationOptions({ value, disabled }: {
  value: ReturnType<typeof useH3GenerationOptions>; disabled: boolean;
}) {
  const t = useT();
  if (!value.active) return null;
  return <div className="flex max-w-xl flex-wrap items-center justify-end gap-1.5 text-[10px]">
    <label className="flex items-center gap-1" title={t("출력에 맞춤은 참조 그림을 출력 면적 안으로 줄이고 작은 그림을 확대하지 않습니다. 영상 시각은 그대로입니다.")}>
      <span>{t("H3 참조 그림 크기")}</span>
      <select aria-label={t("H3 참조 그림 크기")} value={value.turbo ? "match" : value.resize}
        disabled={disabled || value.turbo} onChange={event => value.setResize(event.target.value as H3ResizeMode)}
        className="rounded-md border border-white/10 bg-black/20 px-1.5 py-1">
        <option value="diffusers">{t("기존 처리 (짧은 변 2048)")}</option>
        <option value="match">{t("출력에 맞춤 (확대 안 함)")}</option>
      </select>
    </label>
    <label className="flex items-center gap-1">
      <span>{t("H3 생성 방식")}</span>
      <select aria-label={t("H3 생성 방식")} value={value.turbo ? "turbo" : "normal"}
        disabled={disabled} onChange={event => value.setTurbo(event.target.value === "turbo")}
        className="rounded-md border border-white/10 bg-black/20 px-1.5 py-1">
        <option value="normal">{t("일반 (기본)")}</option>
        {value.ready && <option value="turbo">{t("검증된 Ref2VA Turbo · 4회")}</option>}
      </select>
    </label>
    <span role="status" className="w-full text-right text-muted-foreground">
      {value.checking ? t("선택한 LoRA의 파일 해시를 확인하는 중…")
        : value.turbo ? t("참조 그림 맞춤 · 4회 평가 · LoRA 세기 1. 실행 직전 파일을 다시 검증합니다.")
        : value.ready ? t("선택한 LoRA의 Ref2VA 프리셋을 확인했습니다. 필요할 때 4회 방식을 고르세요.")
        : t("Ref2VA Turbo 파일 하나를 세기 1로 선택하고 검증되면 4회 방식이 나타납니다. 다른 LoRA에는 적용하지 않습니다.")}
    </span>
    {value.error && <span role="alert" className="w-full text-right text-red-300">{t("LoRA 검증 실패")}: {value.error}</span>}
  </div>;
}
