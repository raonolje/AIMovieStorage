import type { SpaceKind } from "@/lib/blueprint";
import type { CrossFaceIssue } from "@/lib/crossUnfold";
import { faceLabel } from "@/lib/faceSets";
import { t } from "@/lib/i18n";

/** 자동 커팅 알림과 수동 자르기 창이 같은 판정 이유를 보여 줍니다. */
export function crossUnfoldWarning(issue: CrossFaceIssue, spaceKind?: SpaceKind | null): string {
  const face = faceLabel(issue.face, spaceKind);
  if (issue.kind === "ratio") return t("{face}: 방에 필요한 비율과 {factor}배 다릅니다. 문·창이 늘어질 수 있습니다.", { face, factor: issue.factor.toFixed(1) });
  if (issue.kind === "coverage") return t("{face}: 회색 바탕과 구분되는 영역이 약 {percent}%입니다. 칸이 덜 그려졌는지 확인하세요.", { face, percent: Math.round(issue.coverage * 100) });
  return t("{face}·{other}: 마주 보는 면의 비율이 {factor}배 다릅니다. 빠진 면이나 잘못된 경계가 있는지 확인하세요.", { face, other: faceLabel(issue.other, spaceKind), factor: issue.factor.toFixed(1) });
}
