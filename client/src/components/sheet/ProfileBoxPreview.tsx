import { useEffect, useRef } from "react";
import { drawProfileBox } from "@/lib/sheetCompose";
import type { CharacterProfile } from "@/lib/characterProfile";

/**
 * 시트 창 안 프로필 글상자의 미리보기.
 *
 * 구운 시트와 **같은 함수**(`drawProfileBox`)를 축소해서 그립니다. 예전 미리보기는
 * 이름 + 한 줄 요약 두 줄을 9px 고정으로 찍었습니다 —
 * 구운 결과에는 전 항목이 있었는데 화면이 다르게 보여 준 것이라, 그리는 코드를
 * 하나로 합쳐 화면 = 결과가 되게 합니다. 글자 크기를 바꾸면 여기서도 바로 바뀝니다.
 */
export default function ProfileBoxPreview({
  width,
  height,
  scale,
  fontSize,
  basics,
  profile,
}: {
  /** 시트 px 기준 상자 크기(규격의 실제 px) */
  width: number;
  height: number;
  /** 시트 px → 화면 px 배율 */
  scale: number;
  /** 시트 px 의 절대 글자 크기. 구울 때도 이 값 그대로입니다 */
  fontSize: number;
  basics: { label: string; value: string }[];
  profile?: CharacterProfile;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // basics 는 부르는 쪽이 렌더마다 새 배열로 만듭니다. 내용이 같으면 다시 그리지 않게 글자로 견줍니다 —
  // 칸을 끄는 동안 매 프레임 표를 다시 그리면 끌기가 버벅입니다.
  const contentKey = JSON.stringify({ basics, profile });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, width * scale);
    const cssHeight = Math.max(1, height * scale);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale * dpr, scale * dpr);
    drawProfileBox(ctx, { x: 0, y: 0, width, height }, fontSize, basics, profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, scale, fontSize, contentKey]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full"
      style={{ width: width * scale, height: height * scale }}
    />
  );
}
