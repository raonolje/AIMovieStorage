import { t } from "./i18n";
import type { CaptureResult } from "./motionCapture";

export function handTrackingSummary(raw: CaptureResult): string {
  const stats = raw.handTracking;
  if (!stats) return t("손가락 추가 추적을 마쳤습니다. 타임라인에 넣기를 눌러 적용하세요.");
  if (stats.appliedHands === 0) return t("추가로 적용한 손이 없습니다. 기존 손 데이터를 유지했습니다.");
  return t("손 {applied}회 적용 · 확대 보완 {roi}회 · 검출 {detected}회. 타임라인에 넣기를 눌러 적용하세요.", {
    applied: stats.appliedHands, roi: stats.roiAppliedHands, detected: stats.detectedHands,
  });
}
