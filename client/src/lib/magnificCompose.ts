import { rememberMagnificSend, type MagnificOwnerHint } from "@/lib/magnificBridge";
import { composeMagnificAuto } from "@/lib/mediaLibrary";
import { loadMagnificModels } from "@/lib/magnificModels";
import { assertMagnificVideoInputs, findMagnificVideoModel, mediaTypeOfPath } from "@/lib/magnificVideoInputs";
import { t } from "@/lib/i18n";
import { assertVideoDuration } from "./videoDuration";

/**
 * 마그니픽 캔버스에 «레퍼런스 그림 → 이미지 생성기(프롬프트 + @칩)» 를 «구성» 한 번으로 만듭니다.
 *
 * 실제 일은 Rust `magnific_compose_auto` 가 마그니픽 데스크톱을 CDP 로 조종해 합니다(2026-09-08):
 * 그림 붙여넣기 → 새 노드 감지 → 페이지 안 Ctrl+C 로 업로드 id 읽기 → 방금 올린 노드만 Delete →
 * 그림 사본 + 생성기 JSON(마그니픽 복사 형식) 붙여넣기. 조건은 마그니픽을 우리 앱에서 켜는 것 —
 * 안 켜져 있으면 Rust 가 켜 주고, 밖에서 켜져 있으면 닫고 다시 누르라고 알립니다.
 *
 * 왜 이 모양인지: 같이 붙여넣은 요소끼리만 확실히 이어지고, 붙여넣을 때 칩 id 를 고쳐 주는 건
 * 생성기 prompt 칸뿐이라 프롬프트를 생성기에 넣습니다. 스포트라이트로 생성기를 만드는 검색어는
 * 셋 다 안 맞아 접었습니다.
 */

/** 사용자 보드의 생성기가 쓰던 모델 슬러그(2026-09-07, 화면 이름 «Nano Banana Pro»). 마그니픽에서 바꿔도 됩니다. */
export const MAGNIFIC_IMAGE_MODEL = "imagen-nano-banana-2";

/**
 * 영상 생성기의 기본 모델.
 *
 * 레퍼런스 영상을 받아 그 움직임을 따르는 일이라 «영상→영상» 을 잘하는 쪽이 필요합니다.
 * 마그니픽에서 바꿔도 됩니다 — 여기 값은 노드를 놓을 때의 첫 자리일 뿐입니다.
 */
export const MAGNIFIC_VIDEO_MODEL = "seedance-2-5-pro";
export type MagnificVideoResolution = "720p" | "1080p";

export async function composeInMagnific(input: {
  prompt: string;
  /** 보낼 레퍼런스 그림의 파일 경로. 프롬프트에 태그로 쓰인 것만 주는 게 좋습니다. */
  referencePaths: string[];
  owner?: MagnificOwnerHint;
  aspectRatio?: string;
  count?: number;
  model?: string;
  /** 프롬프트에서 고른 모델. 데스크톱 mode 대응이 없으면 다른 기본 모델로 바꾸지 않습니다. */
  requestedVideoModel?: string;
  /** 그림이 아니라 **영상** 생성기를 놓습니다. */
  kind?: "image" | "video";
  /** 영상일 때 러닝타임(초). 구도잡기 타임라인이 정한 값을 그대로 넘깁니다. */
  seconds?: number;
  /** 로컬 생성 옵션과 분리합니다. 생략한 기존 호출은 1080p로 구성합니다. */
  videoResolution?: MagnificVideoResolution;
  onStatus?: (message: string) => void;
}): Promise<string> {
  const say = input.onStatus ?? (() => undefined);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("보낼 프롬프트가 없습니다.");
  const paths = [...new Set(input.referencePaths.filter((path) => path && path.trim()))];
  const resolution = input.videoResolution ?? "1080p";
  if (input.kind === "video" && input.requestedVideoModel && !input.model) {
    throw new Error(t("선택한 영상 모델의 Magnific 데스크톱 연결값을 확인하지 못했습니다. 기본 모델로 바꾸지 않았습니다. Magnific에서 모델을 직접 고르거나 MCP 생성 목록을 사용하세요."));
  }
  if (input.kind === "video") assertVideoDuration(input.seconds ?? 5, input.requestedVideoModel ?? input.model ?? MAGNIFIC_VIDEO_MODEL);
  if (input.kind === "video" && paths.some(path => mediaTypeOfPath(path) === "video")) {
    const model = findMagnificVideoModel(await loadMagnificModels("video"), input.model ?? MAGNIFIC_VIDEO_MODEL);
    assertVideoDuration(input.seconds ?? 5, input.requestedVideoModel ?? input.model ?? MAGNIFIC_VIDEO_MODEL, model);
    assertMagnificVideoInputs(model, {
      references: paths.map(path => ({ type: mediaTypeOfPath(path), url: path })),
      // 검사한 해상도와 실제 캔버스 생성기에 넣는 값이 달라지면 안 됩니다.
      resolution,
    });
    say(t("영상 입력 지원을 확인했습니다. Magnific에서 영상 노드가 레퍼런스로 연결됐는지 확인한 뒤 생성하세요."));
  }
  if (input.owner) rememberMagnificSend(input.owner, prompt);
  // 그림이 없어도 됩니다 — 프롬프트만 든 생성기를 놓습니다(에셋·아직 그림 없는 인물).
  const what = input.kind === "video" ? "영상" : "이미지";
  say(
    paths.length
      ? `레퍼런스 ${paths.length}개를 올리고 ${what} 생성기까지 자동으로 구성하는 중…`
      : `프롬프트만 든 ${what} 생성기를 붙여넣는 중…`,
  );
  return composeMagnificAuto({
    paths,
    prompt,
    kind: input.kind ?? "image",
    durationSeconds: input.seconds,
    resolution: input.kind === "video" ? resolution : undefined,
    model:
      input.model ??
      (input.kind === "video" ? MAGNIFIC_VIDEO_MODEL : MAGNIFIC_IMAGE_MODEL),
    aspectRatio: input.aspectRatio ?? "16:9",
    count: input.count ?? 1,
    onQueued: () => say("앞의 «구성» 이 끝나면 이어서 시작합니다. 같은 캔버스와 클립보드를 쓰므로 한 번에 하나씩 돕니다."),
  });
}
