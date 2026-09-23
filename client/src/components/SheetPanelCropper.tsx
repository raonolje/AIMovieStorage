import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { sizeLabel } from "@/lib/useImageSize";
import { HOLDS_CROPPER } from "@/lib/useTutorialPanel";
import {
  Globe2,
  Grid2x2,
  MapPin,
  PenLine,
  Eraser,
  RefreshCw,
  Save,
  Scissors,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { MotionLinesEditor } from "@/components/MotionLines";
import ImageMarkupEditor, {
  type ImageMark,
} from "@/components/ImageMarkupEditor";
import CrossUnfoldWorkbench from "@/components/CrossUnfoldWorkbench";
import PanoramaWorkbench, {
} from "@/components/PanoramaWorkbench";
import {
  getBlueprintGroups,
  type BlueprintKind,
  type SpaceKind,
} from "@/lib/blueprint";
import {
  editedStem,
  type ProjectAssetType,
} from "@/lib/mediaLibrary";
import {
  isStretchedTarget,
  upscaleReachNote,
} from "@/lib/upscale";
import { useUndoStack } from "@/lib/useUndoStack";
import { useCropperSave } from "@/components/sheet/useCropperSave";
import { buildCleanCanvas } from "@/lib/cropClean";
import { toBlob } from "@/lib/canvasBlob";
import {
  ERASE_COLOR,
  PREVIEW_CROP_SIZE,
  PREVIEW_DEBOUNCE_MS,
  boxRect,
  pixelRect,
  type BoxMode,
  type CropBox,
  type CropperSavedFile,
  type PreviewResult,
} from "@/lib/cropBoxes";
import CropperSurface from "@/components/sheet/CropperSurface";
import CropperBoxList from "@/components/sheet/CropperBoxList";
import CropperSavePanel from "@/components/sheet/CropperSavePanel";

export type { CropperSavedFile } from "@/lib/cropBoxes";
import { isTypingTarget } from "@/lib/isTypingTarget";

/**
 * 시트에서 칸 하나를 잘라 이름 붙은 레퍼런스 파일로 저장합니다.
 *
 * 시트 한 장에는 전신·얼굴·색상이 함께 들어 있습니다. 그런데 다음 시트를 뽑을 때
 * 이 시트를 통째로 넘기면 두 가지 손해를 봅니다.
 *
 * 하나, 모델은 받은 이미지를 정해진 크기로 줄여서 봅니다. 큰 시트를 넣으면 그 안의
 * 얼굴 칸도 같이 줄어들어, 정작 봐야 할 얼굴이 흐려집니다. 얼굴 칸만 잘라 넣으면
 * 줄어들 것이 없어 원래 화질 그대로 들어갑니다.
 *
 * 둘, 여러 칸이 한 장에 있으면 모델이 어느 칸을 기준 삼아야 할지 스스로 고릅니다.
 * 여러 칸을 뭉뚱그려 평균 내기도 합니다. 한 칸만 주면 고를 여지가 없습니다.
 *
 * 좌표는 0~1 비율로 다루고 자를 때만 원본 크기로 환산합니다. 화면에서 어떤 크기로
 * 보고 있든 잘리는 자리는 같아야 하기 때문입니다.
 *
 * # 미리보고 저장합니다
 *
 * 예전에는 단추 하나가 굽기와 저장을 같이 해서, 지운 자리가 어색해도 파일이
 * 먼저 생기고 나서야 알았습니다. 지금은 상자를 그리면 잠시 뒤 지운 판과 잘라낼 칸을
 * 미리 만들어 보여 주고, **«저장» 을 눌렀을 때만** 파일이 생깁니다.
 *
 * # 업스케일도 여기서 합니다
 *
 * 시트 6000px 에서 얼굴 칸을 떠내면
 * 700px 이 되므로, **키우는 자리는 자른 직후**가 가장 자연스럽습니다. 그래서
 *
 * - 미리보기 상태에서 «업스케일해서 저장» 을 켜면 저장한 파일을 그 자리에서 키웁니다.
 * - 편집하지 않고 그림만 키우고 싶으면 «지금 그림 업스케일»(원본 옆에 새 파일).
 *
 * 그림 타일마다 있던 «업스케일 ▾»(ImageActions)은 없앴습니다 — 같은 일을 두 곳에 두면 규칙이
 * 갈립니다. 여섯 장을 한 번에 하는 6면 세트 카드의 «세트 업스케일» 만 남습니다.
 */

export default function SheetPanelCropper({
  open,
  onOpenChange,
  imageSrc,
  sourcePath,
  kind,
  ownerName,
  stemPrefix,
  projectName,
  assetType,
  markAssetType,
  initialMarks,
  spaceKind,
  faceSetSize,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 자를 원본 이미지 */
  imageSrc: string;
  /**
   * 원본 파일의 경로. **파일 이름을 지을 때만** 씁니다 — `냥이_클로즈업_001` 을 지우면
   * `냥이_클로즈업_지움_001` 이 되도록. 없으면(blob 만 있는 그림) 원본 꼬리를 생략합니다.
   */
  sourcePath?: string;
  /** 이름 후보를 어느 목록에서 가져올지 */
  kind: BlueprintKind;
  /** 폴더 이름. 대개 캐릭터·배경 이름입니다. */
  ownerName: string;
  /**
   * 파일 이름 앞에 붙는 말. 안 주면 폴더 이름(`ownerName`)입니다 → `냥이_얼굴 정면_자름_001`.
   * 변형 창에서는 «인물_변형» 을 줍니다 → `냥이_겨울_얼굴 정면_자름_001`. 폴더는 같아도
   * 파일 이름에 어느 판에서 잘라 낸 것인지 남아야 마그니픽 @태그로 구분됩니다.
   */
  stemPrefix?: string;
  projectName: string;
  assetType: ProjectAssetType;
  /**
   * 표시한 그림·파노라마·지운 판을 넣을 곳. 안 주면 assetType 과 같습니다.
   *
   * 잘라낸 칸은 «다음 생성에 넣을 재료» 라 레퍼런스 폴더로 가지만,
   * 표시한 그림은 원본 옆에 나란히 있어야 합니다. 앵커를 옮긴 판들을
   * 같은 목록에서 골라야 하니까요.
   */
  markAssetType?: ProjectAssetType;
  /** 이 그림에 이미 그려 둔 표시. 저장된 표시 그림을 다시 열 때 채워집니다. */
  initialMarks?: ImageMark[];
  /**
   * 배경의 실내·실외. 파노라마 여섯 면의 위 면 이름이 실내면 «천장», 아니면 «하늘» 이라
   * 파일 이름 토큰(`faceFileToken`)이 갈립니다. 캐릭터·에셋은 안 줘도 됩니다(파노라마 탭이 없음).
   */
  spaceKind?: SpaceKind | null;
  faceSetSize?: import("@/lib/projectTypes").FaceSetSize | null;
  /** 저장한 파일을 화면 목록에도 넣습니다. */
  onSaved?: (files: CropperSavedFile[]) => void;
}) {
  const t = useT();
  /**
   * 이 창에서 무엇을 하는 중인지.
   *
   * 자르기·지우기는 «그림에서 덜어내는» 일이고, 표시하기는 «그림에 얹는» 일입니다.
   * 손짓은 셋 다 끌기라서 한 화면에 섞어 두면 무엇을 그리는 중인지 알 수 없습니다.
   */
  const [tool, setTool] = useState<"cut" | "mark" | "motion" | "pano" | "cross">("cut");
  /** 지금 그리면 자르기가 되는지 지우기가 되는지. */
  const [mode, setMode] = useState<BoxMode>("crop");
  /**
   * 지운 판 이름에서 «_지움» 뒤에 붙일 말. 비워 두면 `냥이_클로즈업_지움_001`, «손» 이라 적으면
   * `냥이_클로즈업_지움_손_001`. 예전 기본값 «정리» 는 무엇을 했는지 말해 주지 않아 뺐습니다.
   */
  const [cleanName, setCleanName] = useState("");
  const [marks, setMarks] = useState<ImageMark[]>(initialMarks || []);

  /** 파일 이름 앞부분. 변형 창은 «인물_변형», 나머지는 인물 이름. */
  const prefix = stemPrefix || ownerName || "이미지";

  /** 가로로 아주 넓은 그림에만 파노라마 도구를 띄웁니다. */
  const [wide, setWide] = useState(false);
  /**
   * 원본의 픽셀 크기. 업스케일 안내(«원본 1024px 이면 4096px 이 상한») 와 «지금 그림 업스케일»
   * 줄이 씁니다. 어차피 파노라마 판정으로 한 번 재는 그림이라 같은 자리에서 같이 받습니다.
   */
  const [sourceSize, setSourceSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    if (!open || !imageSrc) return;
    setMarks(initialMarks || []);
    const probe = new Image();
    probe.onload = () => {
      const width = probe.naturalWidth || probe.width;
      const height = probe.naturalHeight || probe.height;
      setSourceSize(width && height ? { width, height } : null);
      const nextWide = (width || 1) / (height || 1) >= 1.7;
      setWide(nextWide);
      if (!nextWide)
        setTool((current) => (current === "pano" ? "cut" : current));
    };
    probe.src = imageSrc;
  }, [open, imageSrc]);


  const surfaceRef = useRef<HTMLDivElement>(null);
  /**
   * 그린 상자들과 되돌리기 기록.
   *
   * 자리를 잘못 그리면 지우는 것 말고는 방법이 없었습니다. 여러 개를 그리다
   * 하나를 잘못 그리면 어느 것이 그건지 찾아야 했습니다. Ctrl+Z 로 방금 한 것만
   * 되돌리는 편이 훨씬 빠릅니다.
   *
   * `commit` 은 되돌릴 수 있는 변경 — 바꾸기 전 상태를 먼저 쌓습니다. 상자 추가·삭제와
   * **덮을 색 바꾸기·자동으로 되돌리기** 가 여기 듭니다(색은 결과 그림이 바뀌는 일이라
   * Ctrl+Z 가 먹어야 합니다 — 규칙 4).
   * 이름 고치기는 기록하지 않습니다(`replaceBoxes`). 글자를 지우면 그만이고,
   * 한 글자마다 기록하면 Ctrl+Z 를 여러 번 눌러야 상자 하나가 없어져서 오히려
   * 답답합니다.
   */
  const boxHistory = useUndoStack<CropBox[]>([]);
  const {
    value: boxes,
    set: commit,
    replace: replaceBoxes,
    undo,
    redo,
    canUndo,
    canRedo,
  } = boxHistory;
  const eraseStem = () =>
    editedStem({
      prefix,
      sourcePath,
      ownerName,
      action: "지움",
      detail: cleanName,
    });
  const cropStem = (box: CropBox) =>
    editedStem({
      prefix,
      sourcePath,
      ownerName,
      action: "자름",
      detail: box.name,
    });

  const [drawing, setDrawing] = useState<CropBox | null>(null);

  /* 파일을 만드는 일 전부(잘라 저장·표시한 그림·여섯 면·업스케일)는 한 훅이 합니다. */
  const {
    cleanRef,
    saving,
    faceProgress,
    saveExtra,
    saveFaces,
    saveAll,
    upscaleSourceNow,
    installedEngines,
    upscaleOn,
    setUpscaleOn,
    engineChoice,
    setEngineChoice,
    targetSize,
    setTargetSize,
    upscaleNote,
    setUpscaleNote,
    activeEngine,
    upscaler,
  } = useCropperSave({
    imageSrc,
    boxes,
    prefix,
    spaceKind,
    projectName: projectName ?? "",
    ownerName: ownerName ?? "",
    assetType,
    markAssetType,
    stemPrefix,
    sourcePath,
    cropStem,
    eraseStem,
    onSaved,
    onOpenChange,
  });

  /**
   * 미리보기.
   *
   * `cleanRef` 는 지우기를 적용한 큰 캔버스 — 미리보기와 저장이 **같은 것** 을 씁니다.
   * 저장할 때 다시 굽지 않으니 미리 본 것과 저장되는 것이 다를 수 없습니다.
   * 지우기 지문(`eraseKey`)이 같으면 자르기 상자만 바뀐 것이라 캔버스를 다시 만들지 않습니다.
   */
  const previewRef = useRef<PreviewResult | null>(null);
  /** 늦게 끝난 옛 미리보기가 새것을 덮지 않게 순번을 셉니다. */
  const buildSeq = useRef(0);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  /** 그리기 면에 원본 대신 지운 판을 보일지. 켜 둔 채로 상자를 계속 고칠 수 있습니다. */
  const [previewing, setPreviewing] = useState(false);
  const [previewState, setPreviewState] = useState<
    "idle" | "waiting" | "building" | "ready" | "error"
  >("idle");

  // 이름 후보는 화면에서 고르는 항목과 같은 목록에서 가져옵니다.
  // 새로 지어내면 폴더에 비슷하지만 다른 이름이 쌓입니다.
  const nameOptions = getBlueprintGroups(kind).flatMap((group) =>
    group.options.map((option) => option.label),
  );

  const revokeCrops = (target: PreviewResult | null) => {
    target?.crops.forEach((crop) => URL.revokeObjectURL(crop.url));
  };

  const dropClean = () => {
    if (cleanRef.current?.url) URL.revokeObjectURL(cleanRef.current.url);
    cleanRef.current = null;
  };

  useEffect(() => {
    // 창을 닫으면 그린 것과 모드를 처음 상태로. 다음에 열었을 때 지우기 모드가
    // 남아 있으면 칸을 자르려다 지워 버립니다. 미리보기 캔버스와 blob 주소도 놓아 줍니다 —
    // 6000 시트 캔버스를 창마다 들고 있으면 메모리가 남지 않습니다.
    if (!open) {
      boxHistory.reset([]);
      setDrawing(null);
      setMode("crop");
      setCleanName("");
      // 업스케일 켬 상태는 창마다 새로. 남아 있으면 다음에 열어 자를 때 모르는 사이에 몇 분이 걸립니다.
      setUpscaleOn(false);
      setUpscaleNote(null);
      buildSeq.current += 1;
      revokeCrops(previewRef.current);
      previewRef.current = null;
      dropClean();
      setPreview(null);
      setPreviewing(false);
      setPreviewState("idle");
    }
  }, [open]);

  // 창이 통째로 사라질 때도 놓아 줍니다.
  useEffect(
    () => () => {
      revokeCrops(previewRef.current);
      dropClean();
    },
    [],
  );

  // Ctrl+Z 되돌리기, Ctrl+Shift+Z 또는 Ctrl+Y 다시 하기.
  // 이름 칸에 글자를 쓰는 중이면 그 칸의 되돌리기가 먼저입니다. 가로채면 안 됩니다.
  useEffect(() => {
    /*
      **자르기 탭일 때만 듣습니다**(2026-09-18 점검).

      여태 `open` 만 보고 `tool` 을 안 봤습니다. 그래서 «표시» 탭에서는 이 되돌리기와
      `ImageMarkupEditor` 자체의 되돌리기가 **둘 다 살아 있어**, Ctrl+Z 한 번에
      자르기 상자 하나와 표시 하나가 **동시에** 사라졌습니다.

      의존성 배열도 없어서 렌더마다 리스너를 뗐다 붙이고 있었습니다.
    */
    if (!open || tool !== "cut") return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, tool, undo, redo]);

  const toRatio = (event: React.PointerEvent) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
    };
  };

  const startDraw = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toRatio(event);
    setDrawing({
      id: Math.random().toString(36).slice(2),
      points: [point, point],
      name: "",
      mode,
    });
  };

  const moveDraw = (event: React.PointerEvent) => {
    if (!drawing) return;
    const point = toRatio(event);
    setDrawing((current) =>
      current ? { ...current, points: [current.points[0], point] } : current,
    );
  };

  const endDraw = () => {
    if (!drawing) return;
    const rect = boxRect(drawing);
    // 손이 미끄러져 생긴 점 하나짜리 상자는 버립니다.
    // 지우기는 반지 하나, 단추 하나처럼 작은 것을 덮는 일이라 기준을 더 낮춥니다.
    const floor = drawing.mode === "erase" ? 0.004 : 0.02;
    if (rect.width > floor && rect.height > floor) {
      commit((current) => [
        ...current,
        drawing.mode === "erase"
          ? // 지우기는 파일이 따로 안 생기므로 이름이 필요 없습니다.
            drawing
          : // 아직 안 쓴 이름을 순서대로 하나 넣어 둡니다. 그대로 써도 되고 바꿔도 됩니다.
            {
              ...drawing,
              name:
                nameOptions.filter(
                  (label) => !current.some((box) => box.name === label),
                )[0] || "",
            },
      ]);
    }
    setDrawing(null);
  };

  useEffect(() => {
    const stop = () => setDrawing(null);
    window.addEventListener("blur", stop);
    return () => window.removeEventListener("blur", stop);
  }, []);

  /** 기록 없이 고칩니다 — 이름 글자. */
  const update = (id: string, patch: Partial<CropBox>) =>
    replaceBoxes((current) =>
      current.map((box) => (box.id === id ? { ...box, ...patch } : box)),
    );

  /** 기록하고 고칩니다 — 덮을 색. 결과 그림이 바뀌는 일이라 Ctrl+Z 가 먹어야 합니다. */
  const updateRecorded = (id: string, patch: Partial<CropBox>) =>
    commit((current) =>
      current.map((box) => (box.id === id ? { ...box, ...patch } : box)),
    );

  const remove = (id: string) =>
    commit((current) => current.filter((box) => box.id !== id));


  /**
   * 미리보기를 다시 만듭니다. 상자를 그리고 잠시 손을 멈추면(디바운스) 저절로 불립니다.
   *
   * 지운 판은 `cleanRef` 것을 그대로 쓰고, 잘라낼 칸은 긴 변 320px 로 작게 떠냅니다.
   * 순번(`buildSeq`)이 바뀌었으면 — 그 사이 상자를 더 그렸거나 창을 닫았으면 — 결과를 버립니다.
   */
  const rebuildPreview = async (list: CropBox[]) => {
    const seq = ++buildSeq.current;
    if (!list.length) {
      revokeCrops(previewRef.current);
      previewRef.current = null;
      setPreview(null);
      setPreviewState("idle");
      return;
    }
    setPreviewState("building");
    try {
      const built = await buildCleanCanvas(imageSrc, list, cleanRef);
      if (seq !== buildSeq.current) return;
      if (!built) throw new Error("캔버스를 만들지 못했습니다");
      const { canvas: clean, width, height } = built;
      const crops: PreviewResult["crops"] = [];
      for (const box of list.filter((item) => item.mode === "crop")) {
        const { x, y, w, h } = pixelRect(box, width, height);
        const scale = Math.min(1, PREVIEW_CROP_SIZE / Math.max(w, h));
        const small = document.createElement("canvas");
        small.width = Math.max(1, Math.round(w * scale));
        small.height = Math.max(1, Math.round(h * scale));
        const context = small.getContext("2d");
        if (!context) continue;
        context.drawImage(clean, x, y, w, h, 0, 0, small.width, small.height);
        const blob = await toBlob(small);
        if (blob)
          crops.push({
            boxId: box.id,
            url: URL.createObjectURL(blob),
            width: w,
            height: h,
          });
      }
      if (seq !== buildSeq.current) {
        crops.forEach((crop) => URL.revokeObjectURL(crop.url));
        return;
      }
      const next: PreviewResult = { url: built.url, width, height, crops };
      revokeCrops(previewRef.current);
      previewRef.current = next;
      setPreview(next);
      setPreviewState("ready");
    } catch (error) {
      if (seq !== buildSeq.current) return;
      console.warn("미리보기를 만들지 못했습니다", error);
      setPreviewState("error");
    }
  };

  // 상자(자리·모드·색)가 바뀌면 잠시 뒤 미리보기를 새로 만듭니다. 이름은 그림과 무관하니 빼고,
  // 그리는 중인 상자(`drawing`)는 아직 목록에 없으니 손을 뗀 뒤에만 셉니다.
  const boxesKey = JSON.stringify(
    boxes.map((box) => [box.mode, boxRect(box), box.fill || ""]),
  );
  useEffect(() => {
    if (!open || tool !== "cut") return;
    if (!boxes.length) {
      void rebuildPreview([]);
      return;
    }
    setPreviewState("waiting");
    const timer = window.setTimeout(
      () => void rebuildPreview(boxes),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open, tool, imageSrc, boxesKey]);

  /**
   * 저장될 파일 이름(번호 앞까지). 미리보기 목록과 실제 저장이 같은 함수를 씁니다.
   *
   * **자른 뒤 업스케일한 결과의 이름은 `…_자름_001` 그대로입니다** — `…_자름_업스케일` 이 아닙니다.
   * 이유 둘.
   * 1) «업스케일해서 저장» 은 원래 해상도 파일을 따로 남기지 않고 방금 저장한 그 파일을
   * **덮어씁니다**(`upscaleFilesInPlace`). 짝이 없으니 이름으로 구분할 것도 없습니다.
   * `…_자름` 과 `…_자름_업스케일` 을 둘 다 남기면 폴더에 같은 그림이 두 장씩 쌓이고,
   * 레퍼런스로 걸 때마다 어느 쪽인지 골라야 합니다.
   * 2) 엔진은 실패할 수 있습니다. 이름을 먼저 `…_업스케일` 로 지어 두면 실패했을 때
   * **원래 해상도 파일이 «업스케일» 이라는 거짓 이름을 달고** 남습니다. 저장 이름은 «무엇을
   * 했는가»(자름·지움)만 적고, 크기는 파일이 스스로 말하게 둡니다.
   * `…_업스케일_NNN`(`editedStem` 의 «업스케일») 은 **원본을 그대로 두고 새 파일을 만드는**
   * «지금 그림 업스케일» 에서만 씁니다 — 거기서는 원본과 키운 것이 나란히 남아 이름이 갈라야 합니다.
   */
  /** Rust 가 레퍼런스 갈래에는 `ref_` 를 붙입니다. 화면의 이름 미리보기도 같은 모양이어야 합니다. */
  const refPrefix = (type: ProjectAssetType) =>
    type.endsWith("-reference") ? "ref_" : "";

  const visible = drawing ? [...boxes, drawing] : boxes;
  const cropBoxes = boxes.filter((box) => box.mode !== "erase");
  const eraseBoxes = boxes.filter((box) => box.mode === "erase");
  /** 미리보기가 지금 상자들과 맞는지 — 기다리는 중이나 만드는 중이면 옛 그림입니다. */
  const previewFresh = previewState === "ready" && preview !== null;

  /** 저장될 파일 줄 끝에 붙일 «→ 8192» — 업스케일을 껐으면 아무 말도 하지 않습니다. */
  const upscaleTail = (longEdge: number) => {
    if (!upscaleOn || !activeEngine) return "";
    return isStretchedTarget(activeEngine, targetSize, longEdge)
      ? ` → ${targetSize} (늘리기)`
      : ` → ${targetSize}`;
  };

  /**
   * 안내(«이 엔진은 원본의 N배까지») 에 쓸 원본 긴 변.
   * 편집 결과가 여럿이면 **가장 작은 것** 을 씁니다 — 배율 한계는 작은 그림에서 먼저 걸리니
   * 걸리는 쪽을 말해야 합니다. 아직 미리보기가 없으면 원본 그림 크기로 말합니다.
   */
  const noteLongEdge = (() => {
    const edges: number[] = [];
    if (previewFresh && preview) {
      if (eraseBoxes.length)
        edges.push(Math.max(preview.width, preview.height));
      preview.crops.forEach((crop) =>
        edges.push(Math.max(crop.width, crop.height)),
      );
    }
    if (!edges.length && sourceSize)
      edges.push(Math.max(sourceSize.width, sourceSize.height));
    return edges.length ? Math.min(...edges) : null;
  })();
  const reachNote = activeEngine
    ? upscaleReachNote(activeEngine, noteLongEdge)
    : null;
  /** 그리기 면에 보일 그림. 미리보기를 켰고 지운 판이 있으면 그것, 아니면 원본. */
  const surfaceSrc = previewing && preview?.url ? preview.url : imageSrc;

  /**
   * ESC·바깥 클릭으로도 **도는 중에는 닫히지 않게** 합니다.
   *
   * 닫으면 부모가 `cropTarget` 을 비워 이 창이 사라지고, 저장·업스케일이 화면 밖에서
   * 몇 분 동안 돕니다. 그 사이 다른 창에서 업스케일을 또 걸면 엔진 둘이 겹칩니다.
   */
  const requestOpenChange = (next: boolean) => {
    if (!next && (saving || upscaleNote || upscaler.busy)) {
      toast.info("저장·업스케일이 도는 중입니다. 끝나면 닫힙니다.");
      return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        tutorialHolds={HOLDS_CROPPER}
        className="w-[calc(100vw-2rem)] lg:w-[calc(100vw-8rem)] max-w-none sm:max-w-none max-h-[calc(100vh-2rem)] overflow-y-auto p-0 gap-0 border-0 text-white"
        style={{ background: "oklch(0.15 0.01 265)" }}
      >
        <DialogTitle className="sr-only">시트에서 칸 잘라내기</DialogTitle>
        <DialogDescription className="sr-only">
          시트의 한 칸을 원본 해상도로 잘라 이름 붙은 레퍼런스 파일로 저장합니다
        </DialogDescription>

        {/* 오른쪽은 자동 닫기 X 자리로 비워 둡니다. */}
        <div
          className="flex items-center gap-3 py-4 pl-5 pr-12"
          style={{ borderBottom: "1px solid oklch(1 0 0 / 8%)" }}
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{
              background: "oklch(0.62 0.22 290 / 18%)",
              color: "oklch(0.78 0.18 290)",
            }}
          >
            <Scissors className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              시트에서 칸 잘라내기 · 지우기
              {/*
                **원본 크기를 적어 둡니다.** 이 창은 그림을 창에 맞춰 줄여 보여 주므로 화면에서 보는 크기와 파일
                크기가 다릅니다. 자른 칸이 몇 px 로 나올지, 업스케일이 필요한지가 여기서 갈립니다.
              */}
              {sourceSize && (
                <span
                  className="rounded px-1.5 py-0.5 font-mono text-[10px] font-normal"
                  style={{ background: "oklch(1 0 0 / 7%)", color: "oklch(0.62 0.01 265)" }}
                >
                  {sizeLabel(sourceSize)}
                </span>
              )}
            </p>
            <p className="text-xs" style={{ color: "oklch(0.50 0.01 265)" }}>
              잘라낸 칸은 «{prefix}_칸 이름_자름», 지운 판은 «…_지움» 으로
              저장됩니다 — 미리 보고 «저장» 을 눌러야 파일이 생깁니다
            </p>
          </div>
        </div>

        {/*
          표시하기가 배경 전용이 아닌 이유는, 하는 일이 배경의 성질이 아니라
          그림의 성질이기 때문입니다. 캐릭터의 «이 소매만», 씬의 «이 구역만» 도
          결국 자리를 짚고 말을 붙이는 같은 동작입니다.
        */}
        <div className="flex gap-1 px-5" data-tour="cropper-tabs">
          {[
            { id: "cut" as const, label: "자르기 · 지우기", icon: Scissors, opens: "cropper-surface cropper-undo cropper-box-list cropper-box-row cropper-upscale cropper-upscale-now cropper-footer" },
            { id: "mark" as const, label: "표시하기", icon: MapPin, opens: "cropper-mark-shapes" },
            /*
              **동선**은 컷 카드의 «이미지 편집» 단추에 있던 것을 여기로 옮긴 것입니다.
              그림 위에 화살표를 그리는 일은 컷의
              성질이 아니라 그림의 성질입니다(표시하기와 같은 까닭).
            */
            { id: "motion" as const, label: "동선", icon: PenLine, opens: "cropper-motion" },
            ...(wide
              ? [{ id: "pano" as const, label: "파노라마", icon: Globe2, opens: "cropper-pano-howto cropper-pano-fix cropper-pano-faces" }]
              : []),
            /*
              전개도는 «가로로 아주 넓은» 조건을 걸지 않습니다. 실내 십자는 층고가 낮으면
              16:9 언저리라 파노라마 판정(`wide`)에 걸리지 않는데, 그렇다고 탭을 숨기면
              정작 실내에서 못 씁니다.
            */
            { id: "cross" as const, label: "전개도 6면", icon: Grid2x2, opens: "cropper-cross-lines cropper-cross-tools" },
          ].map((item) => {
            const on = tool === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTool(item.id)}
                /*
                  탭은 그 자리에서 보는 것만 바뀝니다 — 튜토리얼이 대신 눌러 그 탭으로 넘어갑니다.
                  걸음마다 제 탭으로 저절로 가야 자리를 안 잃습니다.
                */
                data-tour-switch={item.opens}
                data-tour-switch-kind="tab"
                className="flex items-center gap-1.5 rounded-t-md px-3 py-2 text-[11px] font-semibold"
                style={{
                  background: on ? "oklch(1 0 0 / 8%)" : "transparent",
                  color: on ? "oklch(0.84 0.16 290)" : "oklch(0.52 0.01 265)",
                }}
              >
                <item.icon className="h-3.5 w-3.5" /> {item.label}
              </button>
            );
          })}
        </div>

        {tool === "cross" ? (
          <div className="p-5">
            <CrossUnfoldWorkbench
              imageSrc={imageSrc}
              spaceKind={spaceKind}
              targetSize={faceSetSize}
              progress={faceProgress}
              onSaveFaces={saveFaces}
            />
          </div>
        ) : tool === "pano" ? (
          <div className="p-5">
            <PanoramaWorkbench
              imageSrc={imageSrc}
              spaceKind={spaceKind}
              progress={faceProgress}
              onSaveEquirect={(file, stem) => saveExtra(file, stem, "panorama")}
              onSaveFaces={saveFaces}
            />
          </div>
        ) : tool === "motion" ? (
          <div className="space-y-3 p-5">
            <MotionLinesEditor
              src={imageSrc}
              saveLabel="동선 그림 저장"
              onSave={async (blob) => {
                // 표시하기와 같은 길로 저장합니다 — 이름은 «원본_동선», 폴더는 이 항목의 폴더(규칙 5).
                const file = new File([blob], "동선.png", { type: "image/png" });
                await saveExtra(file, "동선", "motion");
              }}
              note="카메라·인물·빛 동선을 그려 저장하면 «원본 이름_동선» 파일이 이 항목의 폴더에 생깁니다. 영상 생성기에 프레임과 함께 올리면 방향이 고정됩니다."
            />
          </div>
        ) : tool === "mark" ? (
          <div className="space-y-3 p-5">
            <ImageMarkupEditor
              imageSrc={imageSrc}
              marks={marks}
              onChange={setMarks}
              onSave={(file, stem, drawn) =>
                saveExtra(file, stem, "mark", drawn)
              }
              // 흑백 마스크도 **같은 길**로 저장합니다 — 이름은 «원본_움직임», 폴더는 이 항목의 폴더(규칙 5).
              onSaveMask={(file, stem, drawn) =>
                saveExtra(file, stem, "motionMask", drawn)
              }
            />
            <p
              className="text-[11px] leading-relaxed"
              style={{ color: "oklch(0.45 0.01 265)" }}
            >
              <b>표시한 그림 저장</b>을 누르면 번호와 화살표가 그려진 그림이
              폴더에 새 파일로 생기고, 이 항목의 생성 이미지 목록에도
              들어갑니다(변형 창에서 레퍼런스로 집을 수 있습니다). 저장되는
              모양은 지금 화면에 보이는 그대로입니다. 요청문과 함께 그 그림을
              올려 주세요. <b>번호가 보여야</b> 생성기가 «①번 지점» 을
              알아봅니다. ComfyUI 인페인팅은 흑백 마스크를 따로 받으므로 이
              그림으로는 안 됩니다.
            </p>
            <p
              className="text-[11px] leading-relaxed"
              style={{ color: "oklch(0.45 0.01 265)" }}
            >
              <b>움직임 구역</b>을 켜고 그린 자리는 <b>움직임 마스크 저장</b>으로
              흑백 PNG 가 됩니다(«원본 이름_움직임»). 흰 구역만 움직이고 나머지는
              첫 프레임 그대로 붙박이라, 배경이 정지 이미지라서 통째로 얼어붙는
              컷(달리는 차 안의 창밖)과, 인물만 붙들고 배경은 풀어 두고 싶은
              캐릭터 스왑에 씁니다. <b>로컬 영상은 그린 뒤 자동으로 물립니다</b> —
              컷의 그림 선반에서 찾아 쓰므로 어디서 또 고를 필요가 없습니다.
              다만 <b>뽑은 뒤에 합성</b>하는 방식이라, 카메라가 움직이거나 사람·물건이 흰
              구역 밖으로 나가는 컷에서는 경계에 자국이 남습니다 — 그럴 때는 구역을 넉넉히
              잡거나, 마스크 대신 <b>배경 영상</b>(구도잡기 → 환경)을 쓰세요.
              바깥 생성기(프리픽·클링 등)에는 대표 그림과 <b>함께</b> 올리세요 —
              마스크만 올리면 검은 판 한 장일 뿐입니다.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <CropperSurface
              surfaceRef={surfaceRef}
              surfaceSrc={surfaceSrc}
              visible={visible}
              previewing={previewing}
              setPreviewing={setPreviewing}
              preview={preview}
              eraseBoxes={eraseBoxes}
              boxes={boxes}
              previewState={previewState}
              mode={mode}
              setMode={setMode}
              undo={undo}
              redo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              startDraw={startDraw}
              moveDraw={moveDraw}
              endDraw={endDraw}
            />

            <div className="space-y-2">
              <CropperBoxList
                boxes={boxes}
                cropBoxes={cropBoxes}
                eraseBoxes={eraseBoxes}
                preview={preview}
                previewFresh={previewFresh}
                nameOptions={nameOptions}
                update={update}
                updateRecorded={updateRecorded}
                remove={remove}
                cropStem={cropStem}
                eraseStem={eraseStem}
                refPrefix={refPrefix}
                upscaleTail={upscaleTail}
                assetType={assetType}
                markAssetType={markAssetType}
              />
              <CropperSavePanel
                activeEngine={activeEngine}
                engineChoice={engineChoice}
                setEngineChoice={setEngineChoice}
                installedEngines={installedEngines}
                targetSize={targetSize}
                setTargetSize={setTargetSize}
                upscaleOn={upscaleOn}
                setUpscaleOn={setUpscaleOn}
                noteLongEdge={noteLongEdge}
                reachNote={reachNote}
                saving={saving}
                sourceSize={sourceSize}
                sourcePath={sourcePath}
                upscaleSourceNow={upscaleSourceNow}
                upscaler={upscaler}
                prefix={prefix}
              />
            </div>
          </div>
        )}

        {tool === "cut" && (
          <div
            /*
              **바닥에 붙입니다.** 「자동으로 아래로 안내려가네」.

              이 띠는 스크롤을 쥔 `DialogContent` 의 직계 자식이라 본문과 **같이 흘러 내려갑니다.**
              시트처럼 세로가 긴 그림에서는 «저장» 이 창 밖으로 밀려, 끝까지 굴려야 보였습니다.
              안내 창이 여기를 가리킬 때도 화면 맨 아래 모서리에 겨우 걸쳐 빈 띠처럼 보였고요.
              스크롤 컨테이너가 바로 위라 `sticky bottom-0` 이 그대로 먹습니다 — 배경을 창과 같은
              색으로 채워야 뒤엣것이 비쳐 보이지 않습니다.
            */
            className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 px-5 py-4"
            style={{
              borderTop: "1px solid oklch(1 0 0 / 8%)",
              background: "oklch(0.15 0.01 265)",
            }}
            data-tour="cropper-footer"
          >
            {/*
              상자가 없으면 «미리보기 새로 고침» 과 «저장» 이 흐릿하게만 떠 «고장인가» 로 읽힙니다.
              지우기 이름 칸(`mr-auto`)이 없을 때만 그 자리에 한 줄 적어 둡니다 — 둘은 배타입니다.
            */}
            {boxes.length === 0 && (
              <p className="mr-auto text-[11px]" style={{ color: "oklch(0.50 0.01 265)" }}>
                {t("그림 위에 상자를 끌어 그리면 미리보기와 저장이 켜집니다.")}
              </p>
            )}
            {/*
            저장·업스케일이 도는 중에는 닫히지 않게 막습니다. 닫으면 부모가 이 창을 없애
            진행 표시가 통째로 사라지고, 몇 분 걸리는 일이 화면 밖에서 돕니다.
            (토스트로도 보이지만, 도는 중인 일을 두고 창을 접는 길은 열어 두지 않습니다.)
          */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={
                saving || Boolean(upscaleNote) || Boolean(upscaler.busy)
              }
              title={
                saving || upscaleNote || upscaler.busy
                  ? "저장·업스케일이 끝나면 닫을 수 있습니다."
                  : "닫기"
              }
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-white/10 disabled:opacity-35"
              style={{ color: "oklch(0.62 0.01 265)" }}
            >
              <X className="h-3.5 w-3.5" /> 닫기
            </button>
            {/* 지운 판은 «…_지움_001» 로 남습니다. 뒤에 말을 더 붙이고 싶을 때만 적습니다(«손» → «…_지움_손_001»). */}
            {eraseBoxes.length > 0 && (
              <label
                className="mr-auto flex items-center gap-2 text-[11px]"
                style={{ color: "oklch(0.55 0.01 265)" }}
              >
                <Eraser className="h-3 w-3" style={{ color: ERASE_COLOR }} />
                지움 뒤에 붙일 말(선택)
                <input
                  value={cleanName}
                  onChange={(event) => setCleanName(event.target.value)}
                  placeholder="예: 손"
                  className="w-28 rounded px-2 py-1 text-[11px] outline-none"
                  style={{
                    background: "oklch(0.18 0.012 265)",
                    border: "1px solid oklch(1 0 0 / 10%)",
                    color: "white",
                  }}
                />
              </label>
            )}
            <button
              type="button"
              onClick={() => void rebuildPreview(boxes)}
              disabled={boxes.length === 0 || previewState === "building"}
              title="상자를 그리면 저절로 만들어집니다. 기다리지 않고 바로 보고 싶을 때 누르세요."
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-white/10 disabled:opacity-35"
              style={{ color: "oklch(0.72 0.01 265)" }}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${previewState === "waiting" || previewState === "building" ? "animate-spin" : ""}`}
              />
              {previewState === "waiting"
                ? "잠시 뒤 새로 고침…"
                : previewState === "building"
                  ? "만드는 중…"
                  : "미리보기 새로 고침"}
            </button>
            <button
              type="button"
              onClick={() => void saveAll()}
              // «지금 그림 업스케일» 이 도는 중에는 막습니다 — 둘이 동시에 워커에 들어가면 VRAM 을 다투다 죽습니다.
              disabled={saving || boxes.length === 0 || Boolean(upscaler.busy)}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white gradient-primary disabled:opacity-35"
            >
              <Save className="h-3.5 w-3.5" />
              {/* 업스케일이 도는 동안에는 그 진행이 저장 단추에 보입니다 — 몇 분 걸리는 일이라 «저장하는 중…» 만으로는 멈춘 줄 압니다. */}
              {upscaleNote
                ? upscaleNote
                : saving
                  ? "저장하는 중…"
                  : [
                      cropBoxes.length ? `${cropBoxes.length}칸 잘라` : "",
                      eraseBoxes.length ? `${eraseBoxes.length}곳 지워` : "",
                      upscaleOn ? `${targetSize}px 로 키워 저장` : "저장",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
