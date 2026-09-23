import { toast } from "sonner";
import { HOLDS_CROPPER } from "@/lib/useTutorialPanel";
import { Copy, FolderOpen, Scissors, X, Send, Star } from "lucide-react";
import { copyImageWithNotice, revealFile, sendImagesToMagnific } from "@/lib/mediaLibrary";

/**
 * 썸네일 위에 얹는 버튼들.
 *
 * 자리를 한 곳에서 정합니다. 예전에는 화면마다 버튼 위치가 달라서, 지우려다
 * 복사를 누르는 일이 생겼습니다. 같은 일을 하는 버튼은 어느 화면에서든 같은
 * 모서리에 있어야 손이 기억합니다.
 *
 * 왼쪽 위 — 이미지 복사 (LLM 창에 붙여넣기)
 * 오른쪽 위 — 목록에서 빼기
 * 왼쪽 아래 — 저장된 폴더 열기
 * 오른쪽 아래 — 칸 잘라내기
 * 아래 가운데 — 마그니픽 캔버스로 (폴더에 저장된 그림만)
 * 위 가운데 — 이 그림을 정체성 기준으로 (변형 창의 레퍼런스에서만)
 *
 * 복사와 잘라내기는 원본 파일이 있어야 제대로 됩니다. 화면에 띄운 썸네일만으로도
 * 되기는 하지만 화질이 떨어지므로, 경로가 없으면 폴더 열기는 아예 감춥니다.
 *
 * 오른쪽 가운데에 있던 «업스케일 ▾» 은 뺐습니다(2026-09-09). 키우기는 이제 가위로 여는
 * 편집 창(`SheetPanelCropper`)의 «업스케일해서 저장»·«지금 그림 업스케일» 한 곳에서만 합니다 —
 * 두 곳에 두면 목표 크기·엔진 규칙이 갈립니다. 여섯 장을 한 번에 하는 6면 세트 카드
 * (`FaceSetCard` 의 «세트 업스케일»)만 예외로 남겼습니다.
 */

export interface ImageActionTarget {
  name?: string;
  label?: string;
  thumb?: string;
  filePath?: string;
}

/** 네 모서리 자리. 어느 화면에서든 이 값을 그대로 씁니다. */
const CORNER = {
  copy: "left-1 top-1",
  remove: "right-1 top-1",
  reveal: "left-1 bottom-1",
  crop: "right-1 bottom-1",
  magnific: "left-1/2 -translate-x-1/2 bottom-1",
  identity: "left-1/2 -translate-x-1/2 top-1",
} as const;

function ActionButton({
  corner,
  label,
  tone,
  tour,
  opens,
  onClick,
  children,
}: {
  corner: keyof typeof CORNER;
  label: string;
  tone?: "danger";
  /** 튜토리얼 말풍선이 잡을 `data-tour` 이름(`tutorials/ANCHORS.md`). */
  tour?: string;
  /** 이 단추가 열어 주는 창 안의 자리들 — 튜토리얼이 「먼저 이것을 누르세요」 라고 가리킵니다. */
  opens?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={event => { event.stopPropagation(); onClick(); }}
      data-tour={tour}
      data-tour-open={opens}
      aria-label={label}
      title={label}
      className={`absolute ${CORNER[corner]} z-10 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100`}
      style={{
        background: "oklch(0 0 0 / 72%)",
        color: tone === "danger" ? "oklch(0.78 0.16 25)" : "white",
      }}
    >
      {children}
    </button>
  );
}

export default function ImageActions({
  image,
  onRemove,
  onCrop,
  onMakeIdentity,
  alwaysVisible,
}: {
  image: ImageActionTarget;
  /** 주면 오른쪽 위에 X 가 붙습니다. */
  onRemove?: () => void;
  /** 주면 오른쪽 아래에 가위가 붙습니다. 업스케일도 이 가위로 여는 편집 창 안에 있습니다. */
  onCrop?: () => void;
  /**
   * 주면 위 가운데에 별이 붙습니다 — 이 그림을 정체성 기준으로.
   *
   * 정체성 기준(부모 시트)을 잘라 다듬은 그림으로 바꾸고 싶을 때. 기준을 «빼는» 것은
   * 여전히 안 되고(규칙 6) «다른 그림으로 바꾸는» 것만 됩니다.
   */
  onMakeIdentity?: () => void;
  /** 마우스를 올리지 않아도 보이게 합니다. */
  alwaysVisible?: boolean;
}) {
  const name = image.name || image.label || "이미지";
  const visible = alwaysVisible ? "opacity-100" : "";

  return (
    /*
      앵커는 **바깥 상자**에 답니다. 안쪽 묶음은 `display: contents` 라 제 상자가 없어
      `getBoundingClientRect()` 가 0×0 으로 나옵니다 — 튜토리얼은 크기가 0 이면 «없다» 로 보므로
      영영 못 찾습니다().
    */
    <div data-tour="image-actions" className={`pointer-events-none absolute inset-0 ${visible}`}>
      <div className="pointer-events-auto contents">
        <ActionButton corner="copy" label={`${name} 복사 — LLM 창에 붙여넣기`} onClick={() => void copyImageWithNotice(image)}>
          <Copy className="h-3 w-3" />
        </ActionButton>

        {onRemove && (
          <ActionButton corner="remove" label={`${name} 빼기`} tone="danger" onClick={onRemove}>
            <X className="h-3 w-3" />
          </ActionButton>
        )}

        {image.filePath && (
          <ActionButton corner="reveal" label={`${name} 폴더 열기`} onClick={() => void revealFile(image.filePath)}>
            <FolderOpen className="h-3 w-3" />
          </ActionButton>
        )}

        {image.filePath && (
          <ActionButton
            corner="magnific"
            label={`${name} 을 마그니픽 캔버스에 붙여넣기`}
            onClick={() =>
              void sendImagesToMagnific([image.filePath!])
                .then((message) => toast.success(message))
                .catch((error) => toast.error(String(error)))
            }
          >
            <Send className="h-3 w-3" />
          </ActionButton>
        )}

        {onCrop && (
          <ActionButton corner="crop" tour="card-image-crop" opens={HOLDS_CROPPER} label={`${name} 에서 칸 잘라내기`} onClick={onCrop}>
            <Scissors className="h-3 w-3" />
          </ActionButton>
        )}

        {onMakeIdentity && (
          <ActionButton corner="identity" label={`${name} 을 정체성 기준으로`} onClick={onMakeIdentity}>
            <Star className="h-3 w-3" />
          </ActionButton>
        )}

      </div>
    </div>
  );
}
