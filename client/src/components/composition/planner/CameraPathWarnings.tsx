import { useMemo } from "react";
import { type CompositionState } from "@/lib/composition";
import { diagnoseCameraPath } from "@/lib/cameraPathDiagnostics";
import { SHOT_PRESETS } from "@/lib/cameraMoves";
import { useT } from "@/lib/i18n";

/** 경고를 눌러 해당 시각을 확인합니다. 카메라·클립 길이는 사람이 정한 그대로 둡니다. */
export function CameraPathWarnings({ state, duration, onSeek, onSelectMove }: {
  state: CompositionState;
  duration: number;
  onSeek: (time: number) => void;
  onSelectMove: (id: string | null) => void;
}) {
  const t = useT();
  // 재생 머리·인물 편집 때문에 같은 카메라 경로를 매 프레임 다시 검사하지 않습니다.
  const report = useMemo(() => diagnoseCameraPath(state, duration), [
    state.camera, state.cameraMoves, state.cameraShots, state.activeShotId,
    state.rooms, state.backgroundOn, state.lockAnchors, duration,
  ]);
  const gap = report.coverage.gaps[0];
  const clip = report.coverage.clipped[0];
  if (!gap && !clip && !report.crossings.length && !report.startsOutside && !report.unresolvedMoveIds.length) return null;
  const label = (id: string | null) => {
    const move = state.cameraMoves?.find((item) => item.id === id);
    return t(SHOT_PRESETS.find((preset) => preset.id === move?.shotId)?.label ?? "카메라");
  };
  const seek = (time: number, id: string | null = null) => {
    if (id) onSelectMove(id);
    onSeek(Math.min(duration, Math.max(0, time)));
  };
  return (
    <div data-tour="camera-path-warnings" className="mb-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] leading-relaxed text-amber-200">
      {gap && <button type="button" className="block text-left hover:underline" onClick={() => seek(gap.start)}>
        {t("카메라 클립 없는 구간: {start}–{end}초. 그동안 마지막 구도를 유지합니다.", { start: gap.start.toFixed(1), end: gap.end.toFixed(1) })}
      </button>}
      {clip && <button type="button" className="block text-left hover:underline" onClick={() => seek(duration, clip.moveId)}>
        {t("{name}: 끝 {seconds}초가 타임라인 밖이라 내보내기에 포함되지 않습니다.", { name: label(clip.moveId), seconds: clip.seconds.toFixed(1) })}
      </button>}
      {report.startsOutside && <button type="button" className="block text-left hover:underline" onClick={() => seek(0)}>
        {t("카메라 출발점이 표시된 상자 방 밖에 있습니다.")}
      </button>}
      {report.crossings.slice(0, 2).map((crossing) => <button type="button" key={`${crossing.moveId}:${crossing.roomId}`} className="block text-left hover:underline" onClick={() => seek(crossing.time, crossing.moveId)}>
        {t("{name}: 약 {seconds}초에 «{room}» 경계를 지납니다. 눌러서 확인하세요.", { name: label(crossing.moveId), seconds: crossing.time.toFixed(2), room: state.rooms?.find((room) => room.id === crossing.roomId)?.name ?? crossing.roomId })}
      </button>)}
      {report.unresolvedMoveIds.length > 0 && <p>{t("대상 따라가기 앵커는 실제 재생으로 경계를 확인하세요. 이 경로 검사는 미완료입니다.")}</p>}
      {report.crossings.length > 2 && <p>{t("경계를 지나는 다른 구간이 {count}개 더 있습니다.", { count: report.crossings.length - 2 })}</p>}
      {(report.crossings.length > 0 || report.startsOutside) && <p className="opacity-75">{t("표본 경로와 상자 방 경계 기준입니다. 이동량은 자동으로 바꾸지 않습니다.")}</p>}
    </div>
  );
}
