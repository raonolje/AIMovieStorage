import { t } from "./i18n";
import { videoClipLimitOf } from "./modelRules";
import type { MagnificModel } from "./magnificCatalog";

/** 길이를 줄이거나 가까운 허용값으로 바꾸면 안무·카메라·프롬프트가 어긋나므로 원래 요청을 거절합니다. */
export function assertVideoDuration(seconds: number, modelId?: string, catalog?: MagnificModel): void {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(t("영상 길이는 0보다 큰 초 단위 숫자여야 합니다."));
  const choices = catalog?.durations.filter(value => Number.isFinite(value) && value > 0) ?? [];
  const rule = videoClipLimitOf(modelId);
  const max = choices.length ? Math.max(...choices) : rule?.maxSeconds;
  const model = catalog?.name ?? rule?.label ?? modelId ?? t("선택한 모델");
  if (max !== undefined && seconds > max + 1e-6) {
    throw new Error(t("{model}: 요청한 {seconds}초는 최대 {max}초를 넘습니다. 타임라인에서 구간을 나눠 레퍼런스를 다시 내보내거나 더 긴 영상을 지원하는 모델을 고르세요. 원본 길이는 바꾸지 않았습니다.", { model, seconds, max }));
  }
  if (choices.length && !choices.some(value => Math.abs(value - seconds) < 1e-6)) {
    throw new Error(t("{model}: 요청한 {seconds}초를 그대로 생성할 수 없습니다. 지원 길이는 {choices}초입니다. 원하는 구간을 명시적으로 다시 내보내세요. 길이를 자동으로 맞추지 않았습니다.", { model, seconds, choices: choices.join(", ") }));
  }
}
