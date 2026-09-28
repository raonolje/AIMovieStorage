/**
 * 표시(앵커·사각형·원·자유선)를 캔버스에 그리는 **한 벌**.
 *
 * 화면(표시 창의 덮개 캔버스)과 저장본(원본 해상도로 구운 PNG)이 같은 함수를 씁니다.
 * 예전에는 화면은 SVG, 저장본은 캔버스라 저장한 파일이 화면과 다르게 나왔습니다.
 *
 *
 * 모양은 **예전 화면(SVG)의 것** 을 그대로 따릅니다 — 사용자가 그쪽을 더 좋아했습니다
 * (「원래 있던 앵커 표시가 더 마음에 드는데」). 즉
 * - 앵커: 가로 2.2%·세로 2.2% 의 반투명 타원(가로로 긴 그림에서는 납작한 «땅 위의 자리»)
 * + 가는 테두리 + 가운데 점, 끌었으면 정면 화살표
 * - 사각형·원·자유선: 가는 선
 * - 번호표: 시작점 바로 위에 작은 색 배지
 * 치수는 «긴 변 / 400» 단위라 화면 크기든 원본 크기든 비율이 같습니다. 저장본에서 번호가
 * 너무 작다고 느껴지면 여기 숫자만 키우면 화면·저장본이 같이 바뀝니다.
 */

// 움직임 구역의 «무엇을 그것으로 치는가»(`isMotionMark`)와 색은 `motionMask.ts` 한 곳에 —
// 화면 덮개·저장본·마스크 굽기가 같은 판정을 봐야 미리 본 것과 구워진 것이 같습니다.
import { MOTION_MARK_COLOR, isMotionMark } from "@/lib/motionMask";

export interface DrawableMark {
  shape: "rect" | "ellipse" | "free" | "anchor";
  /** 0~1 비율. rect·ellipse·anchor 는 두 점, free 는 지나간 점들 */
  points: { x: number; y: number }[];
  /**
   * «여기는 움직인다» 구역인가(`motionMask.ts`).
   *
   * 모양과 **따로** 둔 까닭: 사각형이든 자유선이든 그대로 쓰면서 뜻만 갈라야 합니다.
   * 새 모양으로 만들었다면 그릴 때·글로 옮길 때·시트에 얹을 때마다 「이건 어느 쪽?」 이
   * 늘고, 그중 한 곳이 빠지는 날이 옵니다.
   */
  motion?: boolean;
}

const MARK_COLORS = ["#ff5b5b", "#ffb020", "#4ade80", "#38bdf8", "#c084fc", "#f472b6"];

/** 앵커를 «끌었다» 고 보는 최소 거리(0~1 비율). 그리기와 각도 계산이 같은 값을 써야 화살표가 보이는데 각도가 null 인 일이 없습니다. */
const ANCHOR_DRAG_MIN = 0.01;

/**
 * 앵커 화살표가 가리키는 쪽. **0 이 그림의 위쪽**, 시계 방향으로 커집니다. 끌지 않은 앵커(점만)는 null.
 *
 * 예전에는 원본 카드(StepBackgrounds)만 요청 직전에 이 계산을 인라인으로 했고, 변형 창 요청에는
 * 앵커가 한 글자도 안 실렸습니다(docs/복원/10 §1). 한 함수로 두어 두 창이 같은 각도를 보냅니다.
 */
export function facingDegreesOf(mark: DrawableMark): number | null {
  if (mark.shape !== "anchor") return null;
  const first = mark.points[0];
  const last = mark.points[mark.points.length - 1];
  if (!first || !last) return null;
  if (Math.hypot(last.x - first.x, last.y - first.y) <= ANCHOR_DRAG_MIN) return null;
  return Math.round(((Math.atan2(last.x - first.x, -(last.y - first.y)) * 180) / Math.PI + 360) % 360);
}

/** LLM 요청에 싣는 표시 하나. `background-faces.md`·`background-variation.md` 가 이 꼴을 읽습니다. */
export interface LlmMark {
  /** 그림 위에 그려진 번호와 같습니다. 어긋나면 어느 자리를 말하는지 알 수 없습니다. */
  number: number;
  kind: "anchor" | "region";
  shape: DrawableMark["shape"];
  note: string | null;
  /** 시작점의 자리. 0~1 비율, 왼쪽 위가 (0,0). «지도의 어디에 서는가» 를 말로 옮길 때 씁니다. */
  position: { x: number; y: number };
  facingDegrees: number | null;
}

/** 표시 목록을 LLM 요청용으로 바꿉니다. 원본 카드의 6면 요청과 변형 창의 프롬프트 요청이 같은 것을 씁니다. */
export function describeMarksForLlm(marks: (DrawableMark & { note?: string })[]): LlmMark[] {
  return marks.map((mark, index) => {
    const first = mark.points[0] ?? { x: 0, y: 0 };
    return {
      number: index + 1,
      kind: mark.shape === "anchor" ? "anchor" : "region",
      shape: mark.shape,
      note: mark.note?.trim() || null,
      position: { x: Math.round(first.x * 100) / 100, y: Math.round(first.y * 100) / 100 },
      facingDegrees: facingDegreesOf(mark),
    };
  });
}

/** n 번째 표시의 색. 번호표·목록·구도잡기 안내가 같은 색을 씁니다 */
export function markColor(index: number): string {
  return MARK_COLORS[index % MARK_COLORS.length];
}

/**
 * `width × height` 크기의 캔버스 좌표계에 표시를 그립니다. 그림 자체는 그리지 않습니다.
 * 화면에서는 CSS px 크기를, 저장할 때는 원본 px 크기를 넘기면 됩니다.
 */
export function drawImageMarks(
  context: CanvasRenderingContext2D,
  marks: DrawableMark[],
  width: number,
  height: number,
) {
  const unit = Math.max(width, height) / 400;
  // 예전 SVG 의 «non-scaling 0.5px» 선. 큰 원본에서는 그 비율만큼만 굵어집니다.
  const thin = Math.max(1, unit * 0.3);
  const badgeFont = Math.max(10, unit * 2.4);

  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";

  marks.forEach((mark, index) => {
    /*
      «움직임 구역» 은 **색·점선·반투명 채우기** 셋으로 갈라집니다. 색 하나로만 가르면 번호 색
      여섯과 헷갈리고, 색각 차이가 있는 사람에게는 아무 표도 아닙니다.
    */
    const motion = isMotionMark(mark);
    const color = motion ? MOTION_MARK_COLOR : markColor(index);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = 1;
    context.lineWidth = motion ? thin * 1.6 : thin;
    context.setLineDash(motion ? [thin * 5, thin * 4] : []);

    const first = mark.points[0];
    const last = mark.points[mark.points.length - 1];
    if (!first || !last) return;
    const x1 = first.x * width;
    const y1 = first.y * height;
    const x2 = last.x * width;
    const y2 = last.y * height;

    context.beginPath();
    if (mark.shape === "anchor") {
      // 예전 SVG(viewBox 0~100 을 늘려 그림)와 같은 타원 — 가로·세로 각각 2.2%.
      const rx = width * 0.022;
      const ry = height * 0.022;
      context.globalAlpha = 0.3;
      context.ellipse(x1, y1, rx, ry, 0, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      context.beginPath();
      context.ellipse(x1, y1, rx, ry, 0, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.ellipse(x1, y1, width * 0.005, height * 0.005, 0, 0, Math.PI * 2);
      context.fill();

      // 끌어 놓은 쪽이 정면 — 짧은 화살표.
      const dragged = Math.hypot(last.x - first.x, last.y - first.y) > 0.01;
      if (dragged) {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        context.lineWidth = thin * 1.2;
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
        const head = Math.max(4, unit * 2.4);
        context.beginPath();
        context.moveTo(x2, y2);
        context.lineTo(x2 - Math.cos(angle - 0.45) * head, y2 - Math.sin(angle - 0.45) * head);
        context.lineTo(x2 - Math.cos(angle + 0.45) * head, y2 - Math.sin(angle + 0.45) * head);
        context.closePath();
        context.fill();
      }
    } else {
      if (mark.shape === "rect") {
        context.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      } else if (mark.shape === "ellipse") {
        context.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      } else {
        mark.points.forEach((point, pointIndex) => {
          const x = point.x * width;
          const y = point.y * height;
          if (pointIndex === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
      }
      /*
        움직임 구역만 안쪽을 옅게 채웁니다 — 마스크에서 **흰색이 될 자리**가 그대로 보여야
        굽기 전에 「여기가 맞나」 를 눈으로 셀 수 있습니다. 자유선은 `fill` 이 길을 알아서
        닫아 칠하는데, 마스크 굽기(`paintMotionMask`)도 같은 규칙이라 둘이 어긋나지 않습니다.
      */
      if (motion) {
        context.globalAlpha = 0.18;
        context.fill();
        context.globalAlpha = 1;
      }
      context.stroke();
    }

    // 번호표는 늘 실선입니다 — 위에서 건 점선이 배지 테두리까지 따라가면 안 됩니다.
    context.setLineDash([]);

    // 번호표 — 예전 DOM 배지(10px 굵은 글자, 좌우 4px, 시작점 바로 위)와 같은 자리·크기.
    context.font = `bold ${badgeFont}px sans-serif`;
    context.textBaseline = "middle";
    const label = String(index + 1);
    const padX = badgeFont * 0.4;
    const badgeWidth = context.measureText(label).width + padX * 2;
    const badgeHeight = badgeFont * 1.5;
    const badgeX = x1 - unit * 0.4;
    const badgeY = y1 - badgeHeight * 1.1;
    const radius = Math.min(badgeFont * 0.3, badgeHeight / 2);
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, radius);
    context.fill();
    context.fillStyle = "#ffffff";
    context.fillText(label, badgeX + padX, badgeY + badgeHeight / 2);
  });
  context.restore();
}
