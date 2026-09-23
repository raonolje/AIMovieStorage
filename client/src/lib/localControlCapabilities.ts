import { t } from "@/lib/i18n";

/** 영상 레퍼런스와 뼈 프레임 제어는 다른 입력입니다. 실제 워커가 읽는 경로만 표시합니다. */
export function localControlCapabilities(engineId: string) {
  return {
    poseFrames: engineId === "ltx25",
    referenceVideo: engineId === "minimaxh3",
    firstFrame: ["minimaxh3", "wanvideo", "ltx25"].includes(engineId),
    poseMethod: engineId === "ltx25" ? "ic-lora" as const : null,
  };
}

type ControlValidation = { ok: true } | { ok: false; code: "unsupported_control" | "invalid_control" | "unsupported_reference" | "invalid_reference_range"; message: string };

/** 모델 전환 뒤 남은 모캡 선택을 조용히 버리지 않고 시작 전에 알립니다. */
export function validateLocalControlOptions(engineId: string, options: { control?: unknown; references?: unknown; reference_video_range?: unknown }): ControlValidation {
  const capability = localControlCapabilities(engineId);
  if (options.control !== undefined && options.control !== null) {
    if (!capability.poseFrames) return { ok: false, code: "unsupported_control", message: t("이 엔진은 모캡 뼈 프레임을 받지 않습니다. LTX 2.5를 고르거나 동작 기준을 해제하세요.") };
    const control = options.control as { kind?: unknown; frames?: unknown; weight?: unknown; fps?: unknown };
    const validNumber = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
    if (!control || typeof control !== "object" || Array.isArray(control) || control.kind !== "pose"
      || !Array.isArray(control.frames) || control.frames.length < 1 || control.frames.length > 4096
      || control.frames.some((path) => typeof path !== "string" || !path.trim())
      || (control.weight !== undefined && !validNumber(control.weight, 0, 1.5))
      || (control.fps !== undefined && !validNumber(control.fps, 0.1, 240))) {
      return { ok: false, code: "invalid_control", message: t("동작 기준의 뼈 프레임·초당 프레임 수·세기를 확인해 주세요.") };
    }
  }
  if (Array.isArray(options.references) && options.references.length > 0 && !capability.referenceVideo) {
    return { ok: false, code: "unsupported_reference", message: t("이 엔진은 레퍼런스 목록을 받지 않습니다. 첫 장면 그림 또는 지원되는 동작 기준으로 연결해 주세요.") };
  }
  const hasVideo = Array.isArray(options.references) && options.references.some(item => item?.kind === "video");
  const range = options.reference_video_range;
  if (hasVideo && engineId === "minimaxh3" && range !== "first5s" && range !== "full") {
    return { ok: false, code: "invalid_reference_range", message: t("H3 영상 레퍼런스의 앞 5초 또는 전체를 선택해 주세요.") };
  }
  if (range !== undefined && range !== null && (engineId !== "minimaxh3" || !hasVideo)) {
    return { ok: false, code: "invalid_reference_range", message: t("레퍼런스 구간은 H3 영상 레퍼런스가 있을 때만 선택할 수 있습니다.") };
  }
  return { ok: true };
}
