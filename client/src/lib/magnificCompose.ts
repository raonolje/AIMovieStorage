import { rememberMagnificSend, type MagnificOwnerHint } from "@/lib/magnificBridge";
import { composeMagnificAuto } from "@/lib/mediaLibrary";

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
 *
 *
 * 레퍼런스 영상을 받아 그 움직임을 따르는 일이라 «영상→영상» 을 잘하는 쪽이 필요합니다.
 * 마그니픽에서 바꿔도 됩니다 — 여기 값은 노드를 놓을 때의 첫 자리일 뿐입니다.
 */
export const MAGNIFIC_VIDEO_MODEL = "seedance-2-5-pro";

export async function composeInMagnific(input: {
  prompt: string;
  /** 보낼 레퍼런스 그림의 파일 경로. 프롬프트에 태그로 쓰인 것만 주는 게 좋습니다. */
  referencePaths: string[];
  owner?: MagnificOwnerHint;
  aspectRatio?: string;
  count?: number;
  model?: string;
  /** 그림이 아니라 **영상** 생성기를 놓습니다. */
  kind?: "image" | "video";
  /** 영상일 때 러닝타임(초). 구도잡기 타임라인이 정한 값을 그대로 넘깁니다. */
  seconds?: number;
  onStatus?: (message: string) => void;
}): Promise<string> {
  const say = input.onStatus ?? (() => undefined);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("보낼 프롬프트가 없습니다.");
  if (input.owner) rememberMagnificSend(input.owner, prompt);
  const paths = [...new Set(input.referencePaths.filter((path) => path && path.trim()))];
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
    model:
      input.model ??
      (input.kind === "video" ? MAGNIFIC_VIDEO_MODEL : MAGNIFIC_IMAGE_MODEL),
    aspectRatio: input.aspectRatio ?? "16:9",
    count: input.count ?? 1,
    onQueued: () => say("앞의 «구성» 이 끝나면 이어서 시작합니다. 같은 캔버스와 클립보드를 쓰므로 한 번에 하나씩 돕니다."),
  });
}
