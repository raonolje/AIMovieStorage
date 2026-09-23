import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  assetSrc,
  editedStem,
  fileStem,
  saveProjectMediaAsset,
  type EditAction,
  type ProjectAssetType,
} from "@/lib/mediaLibrary";
import { MOTION_MASK_ACTION } from "@/lib/motionMask";
import { saveFaceSet } from "@/lib/faceSetSave";
import {
  availableEngines,
  defaultEngine,
  getUpscaleSettings,
  isUpscaleRunning,
  upscaleFilesInPlace,
  useUpscaleEngines,
  type UpscaleEngineId,
  type UpscaleTarget,
} from "@/lib/upscale";
import { useUpscaleActions } from "@/components/project/useUpscaleActions";
import { buildCleanCanvas, type CleanCanvas } from "@/lib/cropClean";
import { toBlob } from "@/lib/canvasBlob";
import { pixelRect, type CropBox, type CropperSavedFile } from "@/lib/cropBoxes";
import type { ImageMark } from "@/components/ImageMarkupEditor";
import { PANORAMA_DIR, faceLabel } from "@/lib/faceSets";
import type { SpaceKind } from "@/lib/blueprint";
import {
  BICUBIC_MAX,
  type PanoramaFaceFile,
  type PanoramaFacePlan,
} from "@/components/PanoramaWorkbench";

/**
 * **칸 자르기 창이 파일을 만드는 일 전부** — 잘라 저장 · 표시한 그림 · 여섯 면 세트 ·
 * 업스케일.
 *
 * 2026-09-18 에 `SheetPanelCropper.tsx` 에서 떼어 냈습니다. 창 본문 위아래로 흩어져
 * 있던 것이 실은 한 덩이입니다 — 넷 다 «지운 판을 굽고 → 원본 픽셀로 떠내고 →
 * 폴더에 쓰고 → 읽히는지 확인하고 → 필요하면 키운다» 는 같은 순서를 밟습니다.
 *
 * 특히 **업스케일 설정은 한 벌만** 두어야 합니다. 「업스케일해서 저장」 과 「지금 그림
 * 업스케일」 이 각자 엔진·목표를 들고 있으면, 사람은 어느 쪽 설정으로 돌아간 것인지
 * 알 수가 없습니다.
 */
export function useCropperSave({
  imageSrc,
  boxes,
  prefix,
  spaceKind,
  projectName,
  ownerName,
  assetType,
  markAssetType,
  stemPrefix,
  sourcePath,
  cropStem,
  eraseStem,
  onSaved,
  onOpenChange,
}: {
  imageSrc: string;
  boxes: CropBox[];
  /** 파일 이름의 앞부분(`stemPrefix || ownerName || "이미지"`). 창이 이미 정해 둔 값입니다. */
  prefix: string;
  /** 실내·실외. 여섯 면 세트 이름과 안내문이 이것으로 갈립니다. */
  spaceKind?: SpaceKind | null;
  projectName: string;
  ownerName: string;
  assetType: ProjectAssetType;
  /** 표시한 그림·파노라마·지운 판을 넣을 곳. 안 주면 `assetType` 과 같습니다. */
  markAssetType?: ProjectAssetType;
  stemPrefix?: string;
  /** 원본 파일의 경로. 없으면 «지금 그림만 키우기» 를 못 합니다(폴더에 없는 그림이라). */
  sourcePath?: string;
  /** 자른 칸 하나의 파일 이름 몸통. */
  cropStem: (box: CropBox) => string;
  /** 지운 판의 파일 이름 몸통. */
  eraseStem: () => string;
  onSaved?: (files: CropperSavedFile[]) => void;
  onOpenChange: (open: boolean) => void;
}) {
  /** 미리보기가 구워 둔 «지운 판». 저장이 그것을 그대로 씁니다 — 미리 본 것과 저장되는 것이 같아야 합니다. */
  const cleanRef = useRef<CleanCanvas | null>(null);

  const [saving, setSaving] = useState(false);

  /* ── 업스케일 ─────────────────────────────────────────────────────────
     엔진 설치 상태를 구독합니다 — 설정 화면에서 엔진을 깔고 돌아오면 이 칸이 바로 살아나야 합니다.
     (`useUpscaleActions` 도 안에서 구독하지만 여기서 따로 겁니다. 구독은 겹쳐도 값이 하나라
     문제가 없고, 이 칸이 무엇에 기대는지 눈에 보이는 편이 낫습니다.)
     엔진·목표는 **한 벌만** 두고 «업스케일해서 저장» 과 «지금 그림 업스케일» 이 같이 씁니다.
     두 벌로 두면 어느 쪽 설정으로 돌아간 것인지 사람이 알 수 없습니다. */
  useUpscaleEngines();
  const installedEngines = availableEngines();
  /** 편집 결과를 저장한 뒤 그 자리에서 키울지. 창을 닫으면 꺼집니다(다음에 열 때 모르고 키우는 사고 방지). */
  const [upscaleOn, setUpscaleOn] = useState(false);
  /** 빈 값이면 설정의 기본 엔진. */
  const [engineChoice, setEngineChoice] = useState<UpscaleEngineId | "">("");
  const [targetSize, setTargetSize] = useState<UpscaleTarget>(
    () => getUpscaleSettings().defaultTarget,
  );
  /** 업스케일이 도는 동안의 한 줄(«얼굴 정면 업스케일 중 1/3 (37%)»). 취소는 못 합니다. */
  const [upscaleNote, setUpscaleNote] = useState<string | null>(null);
  const activeEngine: UpscaleEngineId | null = engineChoice || defaultEngine();
  /** «지금 그림 업스케일» — 낱장을 새 파일로 만드는 일은 타일 단추와 **같은 훅**을 씁니다(규칙 1). */
  const upscaler = useUpscaleActions({ ownerName, prefix: stemPrefix });

  /**
   * 저장 직후 앱이 그 파일을 읽을 수 있는지 한 번 확인합니다.
   *
   * — 파일은 멀쩡한데 화면이 깨지면 사람이 원인을 알 길이 없었습니다. 못 읽으면
   * 경로와 크기를 알림으로 띄워 바로 짚을 수 있게 합니다. 등록은 그대로 진행합니다 — 받는 쪽이
   * 방금 만든 blob(`thumb`)을 폴백으로 보여 줍니다.
   */
  const verifyReadable = (path: string, width: number, height: number) => {
    const src = assetSrc(path);
    if (!src) return;
    const probe = new Image();
    probe.onerror = () => {
      console.warn("저장한 그림을 앱이 읽지 못했습니다", path, src);
      toast.error("저장은 됐지만 앱이 그림을 읽지 못합니다", {
        description: `${path} · ${width}×${height}`,
      });
    };
    probe.src = src;
  };

  /** 표시한 그림·동선·움직임 마스크·파노라마를 **새 파일**로 남깁니다. 원본은 손대지 않습니다. */
  const saveExtra = async (
    file: File,
    stem: string,
    kind: "mark" | "motion" | "motionMask" | "panorama",
    extraMarks?: ImageMark[],
  ) => {
    /*
      그림 위에 얹은 것들은 «원본 이름_동작» — 무엇을 한 것인지 이름에 남깁니다.
      편집 창의 이름 칸은 기본값이 그 동작 이름이라, 그대로면 두 번 붙지 않게 빼고 다르게
      적었으면 꼬리로 붙입니다. 파노라마는 면 이름(`front`·`equirect`)이 곧 무엇인지라
      기존 규칙 그대로입니다.

      **규칙을 여기 한 벌만** 둡니다 — 마스크가 제 이름 규칙을 따로 들면 폴더 이름 바꾸기
      (Rust `rename_owner_tree`)와 마그니픽 @태그가 그 한 종류만 못 따라옵니다.
    */
    const action: EditAction | null =
      kind === "motion" ? "동선" : kind === "motionMask" ? MOTION_MASK_ACTION : kind === "mark" ? "표시" : null;
    const full = action
      ? editedStem({
          prefix,
          sourcePath,
          ownerName,
          action,
          detail: stem.trim() === action ? "" : stem,
        })
      : `${prefix}_${stem}`;
    const result = await saveProjectMediaAsset(file, {
      projectName,
      assetType: markAssetType || assetType,
      ownerName,
      stem: full,
      // 돔에 두르는 파노라마는 **별도 폴더**에. 자리로 갈려야 목록에서 가릴 수 있습니다.
      subdir: kind === "panorama" ? PANORAMA_DIR : undefined,
    });
    if (!result?.path) {
      toast.error(
        "저장하지 못했습니다. 저장 폴더가 설정되어 있는지 확인해 주세요.",
      );
      return;
    }
    // 화면 이름 = 저장된 파일 이름(번호까지). 파일 이름이 곧 마그니픽 @태그라 둘이 같아야 합니다.
    onSaved?.([
      {
        path: result.path,
        name: fileStem(result.path),
        marks: extraMarks,
        // 동선 그림도 «표시한 그림» 갈래로 등록합니다 — 둘 다 그림 위에 얹은 것이라 쓰임이 같습니다.
        // 마스크만 제 이름으로 갑니다(쓰임이 다릅니다 — `CropperSavedFile.kind` 참조).
        kind: kind === "motion" ? "mark" : kind,
        thumb: URL.createObjectURL(file),
      },
    ]);
    toast.success(
      kind === "motion"
        ? "동선 그림을 저장했습니다."
        : kind === "motionMask"
          ? "움직임 마스크를 저장했습니다. 영상 생성기에 그림과 함께 올리세요 — 흰 구역만 움직입니다."
          : kind === "mark"
            ? "표시한 그림을 저장했습니다."
            : "보정한 파노라마를 저장했습니다.",
    );
    /*
      마스크를 구운 뒤에는 **창을 닫지 않습니다.** 마스크와 «표시한 그림» 을 둘 다 남기는 것이
      흔한 쓰임인데, 여기서 닫으면 그려 둔 표시가 사라져 처음부터 다시 그려야 합니다
      («지금 그림 업스케일» 이 창을 안 닫는 것과 같은 까닭).
    */
    if (kind === "mark" || kind === "motion") onOpenChange(false);
  };
  /** 여섯 면 저장·업스케일의 진행 문구. 파노라마 탭 단추에 «정면 업스케일 중 1/6» 으로 보입니다. */
  const [faceProgress, setFaceProgress] = useState<string | null>(null);

  /**
   * 파노라마에서 잘라낸 여섯 면을 **한 세트**로 저장합니다.
   *
   * - 자리: 주인 폴더 안 `6면/` . 뿌리에 섞이지 않으니 목록이 세트 카드 하나로 접힙니다.
   * - 이름: `<접두>_<면>_<NNN>` — 면 이름을 **앞에 두지 않습니다.** 폴더 이름 바꾸기(Rust
   * `rename_owner_tree`)와 마그니픽 @태그가 «접두 먼저» 를 전제로 해서, 앞에 두면 장소 이름을
   * 바꿀 때 여섯 면이 옛 이름으로 남습니다. 화면은 `faceDisplayName` 이 «정면 · 장소 #1» 로 보여 줍니다.
   * 위 면 토큰은 실내 «천장», 아니면 «하늘»(`faceFileToken`).
   * - 번호 `_NNN` 은 **세트 단위로 한 번** 정합니다(`nextFaceSetNumber`). 이름이 `<접두>_<면>` 이라
   * Rust 의 «빈 첫 번호» 를 면마다 따로 받으면, 앞 세트가 3장에서 끊겼거나 위 면이 «천장»→«하늘» 로
   * 바뀐 뒤 면끼리 번호가 어긋나 한 번에 저장한 세트가 둘로 갈렸습니다. 저장 뒤 이름을 파싱해
   * `face`/`faceSet` 를 채웁니다.
   * - 업스케일(`plan.upscale`): 원래 해상도로 저장한 뒤 기본 업스케일 엔진으로 차례로 키워 **같은 파일을 덮어씁니다.**
   * 이름이 바뀌면 세트가 깨집니다. 실패하면 원래 해상도 파일이 그대로 남습니다 — 브라우저에서 키운
   * 판으로 바꿔 넣지 않는 이유는, 덮어쓰기 명령이 없어 지웠다 다시 저장해야 하고(번호가 어긋날 수
   * 있음) 다시 시도할 때는 원래 해상도가 더 나은 재료이기 때문입니다.
   */
  const saveFaces = async (
    files: PanoramaFaceFile[],
    plan: PanoramaFacePlan,
  ) => {
    let saved: CropperSavedFile[] = [];
    try {
      // 번호 정하기·이름 짓기·세트 묶기는 `lib/faceSetSave.ts` 한 곳에 있습니다.
      // 자동 커팅(`useAutoUnfold`)도 같은 함수를 써야 세트 규칙이 한 벌로 남습니다.
      const result = await saveFaceSet({
        files: files.map((item) => ({ file: item.file, face: item.face })),
        projectName,
        assetType: markAssetType || assetType,
        ownerName,
        prefix,
        spaceKind,
        onProgress: (message) => setFaceProgress(message),
      });
      saved = result.saved.map((file) => ({
        path: file.path,
        name: file.name,
        kind: "panorama" as const,
        thumb: file.thumb,
        face: file.face,
        faceSet: file.faceSet,
      }));
      if (result.stoppedBecause) {
        toast.error("여섯 면을 한 번호로 저장하지 못했습니다", {
          description: `${result.stoppedBecause} — 6면 폴더의 파일 번호를 정리한 뒤 다시 만드세요.`,
          duration: 12000,
        });
      }
      if (!saved.length) {
        toast.error(
          "저장하지 못했습니다. 저장 폴더가 설정되어 있는지 확인해 주세요.",
        );
        return;
      }

      // 번호를 세트 단위로 정했으니 여섯 장은 같은 세트여야 합니다. 그래도 갈렸다면(Rust 와 접두 다듬기가
      // 어긋난 경우) 조용히 넘기지 않습니다 — 세트 카드가 둘로 갈라져 보이는 것을 사람이 알아야 합니다.
      const setIds = new Set(saved.map((file) => file.faceSet).filter(Boolean));
      if (setIds.size > 1) {
        toast.warning("면마다 번호가 달라 한 세트로 묶이지 않을 수 있습니다", {
          description: `저장된 세트 id: ${[...setIds].join(", ")}`,
        });
      }


      if (plan.upscale) {
        let done = 0;
        try {
          await upscaleFilesInPlace(
            saved.map((file) => ({
              path: file.path,
              label: file.face ? faceLabel(file.face, spaceKind) : file.name,
            })),
            (message, index) => {
              done = index;
              setFaceProgress(message);
            },
            { targetSize: plan.faceSize },
          );
          done = saved.length;
          toast.success(`여섯 면을 ${plan.faceSize} 로 업스케일했습니다.`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          // 앞서 끝난 면은 이미 덮여 있고, 나머지는 원래 해상도 그대로입니다. 세트는 그대로 유효합니다.
          toast.error("업스케일에 실패했습니다", {
            description:
              `${reason} — ${done}/${saved.length}장까지 키웠고 나머지는 원래 해상도(${plan.nativeSize})로 남아 있습니다. ` +
              "설정 → 업스케일 엔진에서 상태를 확인하고 세트 카드의 «세트 업스케일» 로 다시 시도하세요.",
            duration: 12000,
          });
        }
      } else if (plan.enlarged) {
        toast.message("업스케일 엔진이 없어 그냥 키웠습니다", {
          description:
            "설정 → 업스케일 엔진에서 엔진을 하나 설치하면 진짜 업스케일합니다." +
            (plan.capped
              ? ` 그냥 키우기는 ${BICUBIC_MAX} 까지라 고른 크기보다 작게 저장됐습니다.`
              : ""),
          duration: 10000,
        });
      }

      onSaved?.(saved);
      toast.success(
        `여섯 면 중 ${saved.length}장을 «6면» 폴더에 한 세트로 저장했습니다.`,
      );
      onOpenChange(false);
    } finally {
      setFaceProgress(null);
    }
  };

  /**
   * 그린 상자마다 원본 해상도로 잘라 파일로 저장합니다. **«저장» 을 눌렀을 때만.**
   *
   * 화면에 보이는 크기로 자르면 원본보다 작아집니다. 잘라내는 목적이
   * 화질을 지키는 것이라 반드시 원본 픽셀에서 잘라야 합니다.
   *
   * 미리보기가 만들어 둔 캔버스가 있으면 그것을 그대로 씁니다 — 미리 본 것과 저장되는 것이
   * 같아야 하고, 6000 시트를 두 번 굽지 않아야 합니다.
   */
  const saveAll = async () => {
    const crops = boxes.filter((box) => box.mode !== "erase");
    const erases = boxes.filter((box) => box.mode === "erase");
    const named = crops.filter((box) => box.name.trim());
    if (!crops.length && !erases.length) {
      toast.error("자르거나 지울 자리를 그려 주세요.");
      return;
    }
    if (crops.length && !named.length) {
      toast.error("자를 자리의 이름을 정해 주세요.");
      return;
    }
    if (named.length !== crops.length) {
      toast.error("이름이 비어 있는 상자가 있습니다.");
      return;
    }
    /*
      다른 편집 창에서 업스케일이 도는 중이면 시작하지 않습니다. 창마다 들고 있는 busy 로는
      다른 창의 작업이 안 보여서, 엔진 둘이 겹쳐 돌면 VRAM 을 다투다 죽습니다(창을 옮기면
      같은 창에서 막아 둔 것이 그대로 뚫렸습니다).
    */
    if (upscaleOn && isUpscaleRunning()) {
      toast.info(
        "다른 곳에서 업스케일이 도는 중입니다. 끝난 뒤에 저장하세요 — 둘이 겹치면 VRAM 을 다투다 죽습니다.",
      );
      return;
    }

    setSaving(true);
    try {
      const built = await buildCleanCanvas(imageSrc, boxes, cleanRef);
      if (!built) {
        toast.error("이미지를 읽지 못했습니다.");
        return;
      }
      const { canvas: clean, width, height } = built;
      const saved: CropperSavedFile[] = [];

      // 지운 판 자체도 남깁니다. 원본은 그대로 두고 새 파일로.
      // 이름은 «원본 이름_지움» —
      if (erases.length) {
        const blob = await toBlob(clean);
        if (blob) {
          const stem = eraseStem();
          const result = await saveProjectMediaAsset(
            new File([blob], `${stem}.png`, { type: "image/png" }),
            {
              projectName,
              assetType: markAssetType || assetType,
              ownerName,
              stem,
            },
          );
          if (result?.path) {
            // kind 는 «지움» — «표시» 와 같은 이름으로 넘기면 받는 쪽이 버립니다(위 CropperSavedFile 참조).
            // thumb 은 방금 구운 blob — 저장된 파일을 앱이 못 읽어도 액박 대신 그림이 보이게.
            saved.push({
              path: result.path,
              name: fileStem(result.path),
              kind: "erase",
              thumb: URL.createObjectURL(blob),
            });
            verifyReadable(result.path, width, height);
          }
        }
      }

      for (const box of named) {
        const { x, y, w, h } = pixelRect(box, width, height);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext("2d");
        if (!context) continue;

        // 원본이 아니라 «지운 판» 에서 떠냅니다.
        context.drawImage(clean, x, y, w, h, 0, 0, w, h);

        const blob = await toBlob(canvas);
        if (!blob) continue;

        // 파일 이름이 곧 Magnific 태그입니다. 「냥이_얼굴 정면_자름_001.png」 → @냥이_얼굴 정면_자름_001
        // 변형 창에서는 「냥이_겨울_얼굴 정면_자름_001」 — 어느 판에서 잘라 냈는지 이름에 남습니다.
        const stem = cropStem(box);
        const file = new File([blob], `${stem}.png`, { type: "image/png" });
        const result = await saveProjectMediaAsset(file, {
          projectName,
          assetType,
          ownerName,
          stem,
        });
        // 화면 이름 = 저장된 파일 이름(번호까지). 「냥이_얼굴 정면」 으로 보이면 태그 @냥이_얼굴 정면_자름_001 과 어긋납니다.
        if (result?.path) {
          saved.push({
            path: result.path,
            name: fileStem(result.path),
            kind: "crop",
            thumb: URL.createObjectURL(blob),
          });
          verifyReadable(result.path, w, h);
        }
      }

      if (!saved.length) {
        toast.error(
          "저장하지 못했습니다. 저장 폴더가 설정되어 있는지 확인해 주세요.",
        );
        return;
      }

      // 미리보기에서 «업스케일해서 저장» 을 켰으면, 방금 저장한 파일들을 그 자리에서 키웁니다.
      // 한 장씩 차례로(`upscaleFilesInPlace`) — 한꺼번에 넣으면 VRAM 을 다투어 죽습니다.
      // 실패해도 파일은 원래 해상도로 남아 있으므로 등록은 그대로 진행합니다.
      if (upscaleOn && activeEngine) {
        /*
          진행을 **토스트로** 알립니다.

          예전에는 저장 단추 글자에만 나왔습니다. 이 창은 ESC·바깥 클릭·«닫기» 로 닫히고
          닫히면 부모가 컴포넌트를 없애서, 몇 분 걸리는 업스케일이 화면 어디에도 표시되지
          않은 채 돌았습니다. 토스트는 창 밖에서도 보이고 같은 id 로 끝을 바꿔 답니다.
        */
        const toastId = `cropper-upscale:${saved[0]?.path ?? Date.now()}`;
        setUpscaleNote("업스케일 준비 중");
        toast.loading(
          `저장한 ${saved.length}장 업스케일 중 — 취소할 수 없습니다`,
          { id: toastId },
        );
        try {
          await upscaleFilesInPlace(
            saved.map((file) => ({ path: file.path, label: file.name })),
            (message) => {
              setUpscaleNote(message);
              toast.loading(message, { id: toastId });
            },
            { engine: activeEngine, targetSize },
          );
          toast.success(
            `저장한 ${saved.length}장을 ${targetSize}px 로 키웠습니다.`,
            { id: toastId },
          );
        } catch (error) {
          toast.error("업스케일에 실패했습니다", {
            id: toastId,
            description:
              `${String(error)} — 파일은 원래 해상도로 저장돼 있습니다. ` +
              "설정 → 업스케일 엔진에서 상태를 확인한 뒤 다시 편집 창에서 키우세요.",
            duration: 12000,
          });
        } finally {
          setUpscaleNote(null);
        }
      }

      onSaved?.(saved);
      const parts = [
        named.length ? `${named.length}개 칸을 레퍼런스로` : "",
        erases.length ? `지운 판 1장을` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(`${parts} 저장했습니다.`);
      onOpenChange(false);
    } catch {
      toast.error("이미지를 읽지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * 편집하지 않고 **원본 그림만** 키웁니다. 원본은 그대로 두고 `…_업스케일_NNN` 을 옆에 새로 만듭니다
   * (`useUpscaleActions.upscaleToNew` — 예전 타일 «업스케일 ▾» 이 하던 일 그대로).
   * 창은 닫지 않습니다 — 키운 뒤에 이어서 자르고 싶을 수 있고, 목록에는 바로 들어갑니다.
   */
  const upscaleSourceNow = async () => {
    if (!sourcePath) {
      toast.error(
        "폴더에 저장된 그림만 업스케일할 수 있습니다. 먼저 등록해 주세요.",
      );
      return;
    }
    const result = await upscaler.upscaleToNew(
      { filePath: sourcePath, name: fileStem(sourcePath) },
      { engine: activeEngine ?? undefined, target: targetSize },
    );
    if (!result) return;
    onSaved?.([{ path: result.path, name: result.name, kind: "upscale" }]);
  };

  return {
    cleanRef,
    saving,
    faceProgress,
    saveExtra,
    saveFaces,
    saveAll,
    upscaleSourceNow,
    /* ── 업스케일 손잡이 (판이 그대로 씁니다) ── */
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
  };
}
