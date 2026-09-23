import { useEffect, useRef, useState } from "react";
import { HOLDS_SHEET } from "@/lib/useTutorialPanel";
import {
  Copy,
  LayoutGrid,
  Loader2,
  Plus,
  Redo2,
  RefreshCw,
  Scissors,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { confirmDialog } from "@/components/ConfirmDialog";
import { assetSrc, deleteProjectMediaFile, saveProjectMediaAsset } from "@/lib/mediaLibrary";
import { NumberInput } from "@/components/composition/fields";
import SheetPanelCropper, { type CropperSavedFile } from "@/components/SheetPanelCropper";
import SheetSourcePanel from "@/components/sheet/SheetSourcePanel";
import ProfileBoxPreview from "@/components/sheet/ProfileBoxPreview";
import { readImageSize, SHEET_SOURCE_MIME, type SheetSource } from "@/components/sheet/sheetSources";
import { composeSheet, fitImageToSheet, fitPlacements, normalizeSheetSize, SHEET_SIZE } from "@/lib/sheetCompose";
import {
  uid,
  type GeneratedImageAsset,
  type SheetLayout,
  type SheetPlacement,
  type SheetSize,
  type SheetSnapshot,
} from "@/lib/projectTypes";
import type { CharacterProfile } from "@/lib/characterProfile";
import { useUndoHistory } from "@/lib/useUndoStack";

/**
 * 시트 배치 창.
 *
 * # 왜 시트를 만드는가
 *
 * 영상 모델에 이 한 장을 물려서 「이 인물로 연기해」 라고 시킵니다. 전신·얼굴·
 * 표정·색 기준이 한 장에 다 있어야 컷마다 다른 사람이 나오지 않아요.
 *
 * # 배치도는 프로젝트 공용, 그림은 인물 것
 *
 * 배치도(칸의 자리·크기·이름·규격)는 프로젝트가 들고, 어느 칸에 어느 그림을 넣었는지는
 * 인물이 듭니다. 이 창은 둘을 합친 `placements` 를 받고 `onPlacementsChange` 로
 * 돌려줄 뿐, 나누는 일은 `EntitySheetComposer` 가 합니다.
 * ()
 *
 * # 상자 크기와 글자 크기는 따로입니다
 *
 * 글 상자를 넓혔더니 글씨까지 같이 커져서 배치를 잡을 수가 없었습니다.
 * 「글자」 슬라이더는 **상자와 무관하게** 글자만 키웁니다.
 *
 * # 좌표는 규격(캔버스)의 실제 px 로 저장합니다
 *
 * 처음에는 «긴 변 = 6000» 기준으로 저장하고 굽는 순간 규격에 맞춰 통째로 줄였습니다.
 * 그러자 규격을 바꿔도 같은 그림이 작아질 뿐이었습니다 —
 * 「이미지는 출력된 사이즈로 들어가야해」. 이제 규격 = 캔버스 px, 칸 = 그 캔버스의 px,
 * 그림을 넣으면 칸이 그 그림의 뽑힌 크기가 됩니다. 규격을 바꿔도 칸의 px 는 그대로이고
 * 밖으로 나가는 칸만 안으로 밀려 들어옵니다(`fitPlacements`). 화면은 긴 변을 VIEW 에
 * 맞춰 축소해 보여 줄 뿐입니다.
 */

/** 화면에 띄우는 긴 변 px. 6000 을 그대로 띄울 수는 없습니다. */
const VIEW = 720;

/**
 * 뽑을 규격 프리셋. 밑의 가로·세로 입력으로 임의 규격도 됩니다.
 * ()
 */
export const SHEET_SIZES: { id: string; label: string; size: SheetSize }[] = [
  { id: "6000", label: "6000 (정사각)", size: { width: 6000, height: 6000 } },
  { id: "4k", label: "4K (4096)", size: { width: 4096, height: 4096 } },
  { id: "2k", label: "2K (2048)", size: { width: 2048, height: 2048 } },
];

const SIZE_MIN = 512;
const SIZE_MAX = 12000;

/** 프로필 글자 기본값 — 긴 변 6000 시트 기준. 다른 규격의 새 글상자는 긴 변에 비례해 줄입니다 */
const DEFAULT_FONT = 46;
/** 칸의 최소 px. 이보다 작으면 손잡이를 잡을 수 없고 0 으로 수렴하던 오류(지시 270)가 재발합니다 */
const MIN_SLOT = 200;

/** 되돌리기가 기록하는 한 판. 규격이 칸을 움직이므로(밀어 넣기·줄이기) 둘을 따로 되돌리면 어긋납니다 */
type SheetState = { placements: SheetPlacement[]; size: SheetSize };

type DragState =
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "resize"; id: string; startX: number; startY: number; width: number; height: number }
  | null;

export default function SheetComposerDialog({
  open,
  onOpenChange,
  ownerName,
  images,
  profile,
  basics,
  placements,
  onPlacementsChange,
  layouts,
  layoutId,
  onLayoutSelect,
  onLayoutAdd,
  onLayoutRename,
  onLayoutRemove,
  onLayoutSizeChange,
  onLayoutCaptionsChange,
  onSheetCreated,
  editing,
  onSheetReplaced,
  onImagesAdded,
  projectName,
  assetType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerName: string;
  /** 넣을 수 있는 그림 전부. 원본·변형·보유 에셋·공용 에셋  */
  images: SheetSource[];
  profile?: CharacterProfile;
  /** 프로필 상자 표에 찍을 값들 */
  basics: { label: string; value: string }[];
  /** 지금 배치도의 칸 + 이 인물의 그림. 합친 값입니다 */
  placements: SheetPlacement[];
  onPlacementsChange: (placements: SheetPlacement[]) => void;
  /**
   * 프로젝트 공용 배치도들. 비어 있으면 「기본 배치」 한 줄을 가상으로 보여 주고,
   * 첫 변경 때 부르는 쪽이 `layoutId` 로 만듭니다.
   *
   * 시트를 여러 장 만드는 것이 이 기능의 목적입니다 — 의상이 바뀌면
   * 필요한 칸만 갈아 끼워 다시 뽑습니다. 그래서 **배치를 복제**할 수
   * 있어야 합니다. (지시 183·184)
   */
  layouts: SheetLayout[];
  /** 지금 고른 배치도 id. 배치도가 아직 없으면 «만들어질 id» */
  layoutId?: string;
  onLayoutSelect: (id: string) => void;
  onLayoutAdd: (from?: SheetLayout) => void;
  onLayoutRename: (id: string, name: string) => void;
  onLayoutRemove: (id: string) => void;
  onLayoutSizeChange: (id: string, size: SheetSize) => void;
  onLayoutCaptionsChange: (id: string, captions: boolean) => void;
  /** 구운 시트를 목록에 넣습니다 */
  onSheetCreated: (image: GeneratedImageAsset) => void;
  /**
   * 고치는 중인 시트. 있으면 «다시 굽기» 가 이 항목을 갈아 끼웁니다.
   */
  editing?: GeneratedImageAsset;
  /** 다시 구운 시트. previousPath 는 지운 옛 파일 — 경로를 열쇠로 든 곳(표시·구도 배경)을 갈아 끼우려고 넘깁니다. */
  onSheetReplaced?: (image: GeneratedImageAsset, previousPath?: string) => void;
  /** 이 창 안에서 자르기·지우기로 만든 그림을 인물의 생성 이미지에 넣습니다 */
  onImagesAdded: (images: GeneratedImageAsset[]) => void;
  projectName: string;
  assetType: "character-generated" | "background-generated";
}) {
  /*
    보여 줄 배치도. 아직 하나도 없으면 지금 놓고 있는 것을 「기본 배치」 로
    보여 줍니다. 저장은 첫 변경 때 부르는 쪽에서 `layoutId` 로 합니다.
  */
  const shownLayouts: SheetLayout[] = layouts.length
    ? layouts
    : [{ id: layoutId || "기본", name: `${ownerName} 기본 배치`, placements }];
  const currentLayout = shownLayouts.find((item) => item.id === layoutId) || shownLayouts[0];
  const size = normalizeSheetSize(currentLayout.size);
  const captions = currentLayout.captions !== false;
  const long = Math.max(size.width, size.height);
  // 시트 px → 화면 px. 규격이 작아지면 같은 px 의 칸이 화면에서 커 보입니다 — 그게 맞습니다.
  const scale = VIEW / long;
  const boardWidth = size.width * scale;
  const boardHeight = size.height * scale;

  const [drag, setDrag] = useState<DragState>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** 소스 타일을 끌고 있을 때 밑에 있는 칸. 외곽선을 강조합니다 */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** 인라인으로 이름을 고치는 중인 칸 */
  const [labelEditing, setLabelEditing] = useState<string | null>(null);
  /** 자르기·지우기 창에 올린 그림. `placementId` 가 있으면 결과로 그 칸을 갈아 끼웁니다 */
  const [cropTarget, setCropTarget] = useState<{ source: SheetSource; placementId?: string } | null>(null);
  // 규격 입력칸에서 치는 동안처럼 렌더 밖에서 «지금 판» 이 필요할 때. 닫힌 값을 보면 한 발 늦은 판을 맞춥니다.
  const placementsRef = useRef(placements);
  placementsRef.current = placements;
  /**
   * 가로·세로 입력칸에서 치기 시작했을 때의 판. 「4000」 을 치는 동안 4 → 40 → 400 → 4000 으로
   * 네 번 올라오는데, 그때마다 «지금 판» 을 맞추면 512 시트에 맞춰 줄어든 칸이 4000 이 됐을 때
   * 되돌아오지 않습니다. 그래서 매번 **이 기준 판에서** 다시 맞춥니다. blur 에 맡기지 않는 이유는
   * blur 가 안 나는 길이 실제로 있어서입니다 — 치다가 Escape 로 닫기(언마운트는 blur 를 안 보냄),
   * 커서를 둔 채 보드의 칸 끌기(preventDefault 라 포커스가 안 옮겨짐). 그러면 규격 2048 에 4096 칸이
   * 남아 굽히면 잘렸습니다(검토 2026-09-08). null 이면 치는 중이 아닙니다.
   */
  const sizeEditBase = useRef<SheetPlacement[] | null>(null);
  const [baking, setBaking] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  /*
    되돌리기(규칙 4). 배치는 시행착오가 많아 없으면 손이 묶입니다.

    판은 부르는 쪽이 들고 있고 여기서는 기록만 맡습니다. 「손잡이를 눌렀다
    그냥 떼도 쌓이는 판은 건너뛰기」(지시 263) 는 훅 안에 있습니다. `mark` 는
    끌기·글자 입력 시작에서 «여기부터 한 동작» 을 표시하고, 도중은 기록하지 않습니다.
    칸 이름·글자 크기·그림 교체·빈 칸 채우기도 전부 `commit` 으로 갑니다.

    기록하는 판 = **칸 + 규격**. 규격은 원래 설정이라 대상이 아니었는데, 좌표가 절대 px 가
    되면서 규격 변경이 칸을 «고치는» 조작(밖으로 나간 칸 밀어 넣기·큰 칸 줄이기)이 됐습니다.
    칸만 되돌리면 규격 2048 에 4096 칸이 되살아나 굽히면 잘립니다(검토 2026-09-08). 그래서
    Ctrl+Z 한 번에 «규격 변경 + 칸 맞춤» 이 같이 풀립니다. 배치도 이름·캡션 토글은 여전히
    되돌리기 대상이 아닙니다(변형 이름과 같은 규칙).
  */
  const history = useUndoHistory<SheetState>(
    { placements, size },
    (next) => {
      // 바뀐 쪽만 올립니다 — 규격만 다른 판을 되돌리는데 칸까지 다시 저장할 이유가 없습니다.
      if (next.placements !== placements) onPlacementsChange(next.placements);
      if (next.size.width !== size.width || next.size.height !== size.height) {
        onLayoutSizeChange(currentLayout.id, next.size);
      }
    },
    { limit: 50 },
  );
  const { mark, undo, redo, clear } = history;
  /** 칸만 고치는 갱신 — 규격은 지금 것을 물려받습니다. 칸을 만지는 곳이 규격까지 알 필요는 없습니다 */
  const withPlacements =
    (next: SheetPlacement[] | ((current: SheetPlacement[]) => SheetPlacement[])) =>
    (current: SheetState): SheetState => ({
      ...current,
      placements: typeof next === "function" ? next(current.placements) : next,
    });
  const commit = (next: SheetPlacement[] | ((current: SheetPlacement[]) => SheetPlacement[])) =>
    history.set(withPlacements(next));
  const replace = (next: SheetPlacement[] | ((current: SheetPlacement[]) => SheetPlacement[])) =>
    history.replace(withPlacements(next));
  // 배치도를 바꾸면 되돌리기 기록을 비웁니다 — 앞 배치도의 판이 지금 배치도에 덮이지 않게(공용 배치도).
  useEffect(() => {
    clear();
    sizeEditBase.current = null;
  }, [layoutId, clear]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      // 자르기 창이 위에 떠 있으면 그쪽 되돌리기가 받습니다.
      if (cropTarget) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea")) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, undo, redo, cropTarget]);

  // ── 끌기 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const board = boardRef.current;
      if (!board) return;
      const rect = board.getBoundingClientRect();
      // 화면 좌표를 시트 px 로 되돌립니다.
      const x = (event.clientX - rect.left) / scale;
      const y = (event.clientY - rect.top) / scale;

      replace(
        placements.map((item) => {
          if (item.id !== drag.id) return item;
          if (drag.kind === "move") {
            return {
              ...item,
              x: Math.round(Math.max(0, Math.min(size.width - item.width, x - drag.dx))),
              y: Math.round(Math.max(0, Math.min(size.height - item.height, y - drag.dy))),
            };
          }
          return {
            ...item,
            width: Math.round(Math.max(MIN_SLOT, Math.min(size.width - item.x, drag.width + (x - drag.startX)))),
            height: Math.round(Math.max(MIN_SLOT, Math.min(size.height - item.y, drag.height + (y - drag.startY)))),
          };
        }),
      );
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, placements, replace, scale, size.width, size.height]);

  const startMove = (event: React.PointerEvent, placement: SheetPlacement) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setSelected(placement.id);
    const rect = boardRef.current!.getBoundingClientRect();
    // preventDefault 라 규격 입력칸의 포커스가 남습니다. 끌고 나서 또 치면 끌기 전 판으로 되돌아가지 않게 기준을 버립니다.
    sizeEditBase.current = null;
    mark();
    setDrag({
      kind: "move",
      id: placement.id,
      dx: (event.clientX - rect.left) / scale - placement.x,
      dy: (event.clientY - rect.top) / scale - placement.y,
    });
  };

  /**
   * 그림을 시트에 놓습니다. `at` 이 있으면 그 자리를 **칸의 중심**으로(끌어다 놓은 곳), 없으면 계단식.
   *
   * 칸 크기 = 그림의 뽑힌 크기(naturalWidth × naturalHeight) 그대로입니다.
   * 예전에는 긴 변 1800(6000 기준)
   * 으로 넣어서 2048 그림이든 1024 그림이든 같은 크기가 됐습니다. 시트보다 크면 비율을 지켜
   * 시트에 맞추고 알립니다. 크기를 못 읽으면(파일도 thumb 도 못 열림) 긴 변 30% 정사각.
   *
   * 크기를 읽은 **뒤에** 놓습니다 — 먼저 놓고 나중에 고치면 놓이는 자리(중심)가 어긋나고,
   * 되돌리기 한 번에 «놓기» 와 «크기 고치기» 두 판이 남습니다.
   */
  const addImage = async (image: SheetSource, at?: { x: number; y: number }) => {
    const natural = await readImageSize(image);
    const fallback = Math.round(long * 0.3);
    const box = natural ? fitImageToSheet(natural, size) : { width: fallback, height: fallback, shrunk: false };
    if (natural && box.shrunk) {
      toast.info(`그림(${natural.width}×${natural.height})이 시트보다 커서 시트에 맞춰 줄였습니다`);
    }
    const id = uid();
    commit((current) => {
      // 빈자리를 찾기보다 계단식으로 놓습니다. 어차피 옮길 테니까요. 걸음은 시트 크기에 비례합니다.
      const step = Math.round(long * 0.03);
      const offset = current.length * step;
      const x = at ? at.x - box.width / 2 : step + (offset % Math.round(long / 3));
      const y = at ? at.y - box.height / 2 : step + (offset % Math.round(long * 0.4));
      return [
        ...current,
        {
          id,
          kind: "image",
          imageId: image.id,
          x: Math.round(Math.max(0, Math.min(size.width - box.width, x))),
          y: Math.round(Math.max(0, Math.min(size.height - box.height, y))),
          width: box.width,
          height: box.height,
        },
      ];
    });
    setSelected(id);
  };

  const addProfile = () => {
    const id = uid();
    // 글상자는 시트의 40% 정사각을 오른쪽 아래 근처에. 글자는 6000 시트의 46px 을 긴 변에 비례해(최소 20).
    const side = Math.round(long * 0.4);
    commit((current) => [
      ...current,
      {
        id,
        kind: "profile",
        x: Math.max(0, Math.min(size.width - side, Math.round(long * 0.53))),
        y: Math.max(0, Math.min(size.height - side, Math.round(long * 0.53))),
        width: side,
        height: side,
        fontSize: Math.max(20, Math.round((DEFAULT_FONT * long) / SHEET_SIZE)),
      },
    ]);
    setSelected(id);
  };

  /**
   * 칸의 그림을 바꿉니다. 상자 크기는 그대로 — 칸이 곧 규격입니다.
   */
  const replaceSlot = (placementId: string, imageId: string) =>
    commit((current) =>
      current.map((item) =>
        item.id === placementId && item.kind !== "profile" ? { ...item, imageId } : item,
      ),
    );

  const setLabel = (placementId: string, label: string) =>
    replace((current) => current.map((item) => (item.id === placementId ? { ...item, label } : item)));

  const setFontSize = (placementId: string, fontSize: number, record: boolean) => {
    const next = Math.max(20, Math.min(200, Math.round(fontSize)));
    const update = (current: SheetPlacement[]) =>
      current.map((item) => (item.id === placementId ? { ...item, fontSize: next } : item));
    if (record) commit(update);
    else replace(update);
  };

  /**
   * 규격 바꾸기. 칸의 px 는 그대로 두고, 새 시트
   * 밖으로 나가는 칸만 안으로 밀어 넣습니다(시트보다 큰 칸은 비율을 지켜 시트에 맞춤 — `fitPlacements`).
   * 규격과 칸 맞춤은 **한 판** 으로 기록됩니다 — Ctrl+Z 한 번에 둘 다 돌아와야 어긋난 상태가 안 생깁니다.
   *
   * - 프리셋 단추(`setSize`): 지금 판을 맞춰 바로 `set`(기록 후 적용).
   * - 입력칸(`typeSize`): 첫 변경에 `mark` 하고 그때 판을 `sizeEditBase` 로 잡아 둔 뒤, 매 키 입력마다
   * **그 기준 판에서** 다시 맞춰 `replace`(기록 없이). 512 로 줄었다가 4000 이 되면 원래 크기로 돌아오고,
   * 포커스가 떠나지 않은 채 창을 닫거나 칸을 끌어도 저장된 배치도는 늘 규격에 맞습니다.
   */
  const clampSize = (next: Partial<SheetSize>): SheetSize | null => {
    const merged = {
      width: Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(next.width ?? size.width))),
      height: Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(next.height ?? size.height))),
    };
    if (merged.width === size.width && merged.height === size.height) return null;
    return merged;
  };
  const setSize = (next: SheetSize) => {
    const merged = clampSize(next);
    if (!merged) return;
    history.set((current) => ({ size: merged, placements: fitPlacements(current.placements, merged) }));
  };
  const typeSize = (next: Partial<SheetSize>) => {
    const merged = clampSize(next);
    if (!merged) return;
    if (!sizeEditBase.current) {
      mark();
      sizeEditBase.current = placementsRef.current;
    }
    const base = sizeEditBase.current;
    history.replace(() => ({ size: merged, placements: fitPlacements(base, merged) }));
  };

  const removeLayout = async (layout: SheetLayout) => {
    const ok = await confirmDialog({
      title: `「${layout.name || "이름 없는 배치"}」 배치도를 지울까요?`,
      description: "다른 인물이 쓰고 있어도 목록에서 빠집니다. 이미 구운 시트는 그대로입니다.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!ok) return;
    onLayoutRemove(layout.id);
  };

  /** 끌고 있는 소스 타일을 받아 줍니다. 형식이 맞을 때만 떨어뜨릴 수 있게 */
  const acceptSource = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(SHEET_SOURCE_MIME)) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    return true;
  };
  const droppedSource = (event: React.DragEvent) => {
    const id = event.dataTransfer.getData(SHEET_SOURCE_MIME);
    return id ? images.find((item) => item.id === id) : undefined;
  };

  const selectedPlacement = placements.find((item) => item.id === selected);
  const profilePlacements = placements.filter((item) => item.kind === "profile");
  /** 글자 슬라이더의 대상. 고른 프로필 칸, 아니면 첫 프로필 칸 */
  const fontTarget =
    selectedPlacement?.kind === "profile" ? selectedPlacement : profilePlacements[0];
  const outOfFrame = placements.some(
    (item) => item.x + item.width > size.width + 1 || item.y + item.height > size.height + 1,
  );

  /**
   * 굽기.
   *
   * `mode === "replace"` 는 고치는 중인 시트를 갈아 끼웁니다 — 새 파일을 저장한 뒤 옛
   * 파일을 지우고(규칙 3) 같은 항목(id·이름표 유지)의 파일·판을 바꿉니다. 저장에
   * 실패하면 옛 파일은 건드리지 않습니다.
   */
  const bake = async (mode: "new" | "replace") => {
    if (!placements.length) {
      toast.error("배치한 것이 없습니다.");
      return;
    }
    const target = mode === "replace" ? editing : undefined;
    if (mode === "replace" && !target) return;
    if (target) {
      const ok = await confirmDialog({
        title: `${target.sheetLabel || target.name} 을 다시 구울까요?`,
        description:
          "저장 폴더의 원본 파일도 함께 지워집니다. 되돌릴 수 없습니다. 새 파일은 이름(번호)이 바뀝니다. 옛 파일을 남기려면 「새 판으로 저장」 을 쓰세요.",
        subject: target.filePath,
        confirmLabel: "다시 굽기",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBaking(true);
    try {
      // 좌표·크기·글자가 이미 규격의 px 라 환산 없이 그대로 굽습니다. 환산을 두면 다시
      // «4000 시트 = 6000 시트의 축소판» 이 됩니다.
      const blob = await composeSheet({
        placements,
        images,
        profile,
        basics,
        size,
        captions,
      });
      const stem = `${ownerName || "시트"}_시트`;
      const file = new File([blob], `${stem}.png`, { type: "image/png" });

      let saved: { path: string; name: string } | null = null;
      if (projectName.trim()) {
        saved = await saveProjectMediaAsset(file, {
          projectName,
          assetType,
          // 인물 폴더 안에 넣습니다. 시트 폴더를 따로 만들지 않습니다.
          ownerName: ownerName || "시트",
          stem,
        }).catch(() => null);
      }

      // 다시 열어 고칠 수 있게 판을 결과에 붙입니다.
      const snapshot: SheetSnapshot = {
        layoutId: layouts.length ? currentLayout.id : undefined,
        layoutName: currentLayout.name,
        size,
        placements: placements.map((item) => ({ ...item })),
        captions,
        coords: "px",
      };
      const thumb = URL.createObjectURL(blob);
      const sizeText = `${size.width}×${size.height}`;

      if (target) {
        if (target.filePath && !saved) {
          toast.error("폴더에 저장하지 못해 옛 시트를 그대로 둡니다.");
          return;
        }
        if (target.filePath && saved && target.filePath !== saved.path) {
          const removed = await deleteProjectMediaFile(projectName, target.filePath);
          if (!removed) {
            toast.warning("옛 시트 파일은 지우지 못했습니다. 폴더에 남아 있습니다.", {
              description: target.filePath,
            });
          }
        }
        onSheetReplaced?.(
          {
            ...target,
            name: saved?.name ?? stem,
            thumb,
            file,
            filePath: saved?.path ?? target.filePath,
            sheet: snapshot,
          },
          target.filePath,
        );
        toast.success("시트를 다시 구웠습니다.", {
          description: saved ? `파일 이름은 ${saved.name} 로 바뀝니다 · ${sizeText}` : sizeText,
        });
      } else {
        onSheetCreated({
          id: uid(),
          // 폴더에 놓인 이름과 화면 이름이 같아야 합니다(마그니픽 @태그 = 파일 이름).
          name: saved?.name ?? stem,
          thumb,
          file,
          filePath: saved?.path,
          isCompositeSheet: true,
          sheetLabel: stem,
          sheet: snapshot,
        });
        toast.success(saved ? "시트를 구워 폴더에 넣었습니다." : "시트를 구웠습니다.", {
          description: saved ? `${sizeText} · ${saved.path}` : sizeText,
        });
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(`시트를 굽지 못했습니다. ${error instanceof Error ? error.message : error}`);
    } finally {
      setBaking(false);
    }
  };

  // 이 인물 풀에서 실제로 놓인 그림만 뺍니다. 다른 인물의 imageId 는 풀에 없으니 빈 칸입니다.
  const unplaced = images.filter(
    (image) => !image.isCompositeSheet && !placements.some((item) => item.imageId === image.id),
  );

  const title = editing
    ? `${ownerName} · 시트 편집 — ${editing.sheetLabel || editing.name}`
    : `${ownerName} · 시트 제작`;
  const sizeText = `${size.width} × ${size.height}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        tutorialHolds={HOLDS_SHEET}
        showCloseButton={false}
        className="h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none border-0 p-0 text-white sm:max-w-none"
        style={{ background: "oklch(0.11 0.008 265)" }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          그림과 프로필을 배치해 {sizeText} 한 장으로 굽습니다
        </DialogDescription>

        <div className="flex h-full min-h-0 flex-col">
          <div
            className="flex shrink-0 items-center gap-2 px-4 py-2.5"
            style={{ borderBottom: "1px solid oklch(1 0 0 / 8%)" }}
          >
            <LayoutGrid className="h-4 w-4 shrink-0" style={{ color: "oklch(0.84 0.18 290)" }} />
            <p className="shrink-0 text-sm font-semibold">{title}</p>
            <p
              className="min-w-0 flex-1 truncate text-[11px]"
              style={{ color: "oklch(0.48 0.01 265)" }}
            >
              끌어서 옮기고, 오른쪽 아래 모서리로 크기를 바꿉니다. 왼쪽 그림을 칸 위에 끌어다 놓으면 그 칸의 그림이 바뀝니다
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="닫기"
              data-tour="sheet-close"
              className="shrink-0 rounded p-1.5 hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
            {/* ── 왼쪽: 넣을 것 ─────────────────────────────────────── */}
            <aside
              className="composition-scroll min-h-0 space-y-2 overflow-y-auto p-3"
              style={{ borderRight: "1px solid oklch(1 0 0 / 8%)" }}
            >
              {/* 원본·변형·보유 에셋·공용 에셋. 가위는 이 창 안에서 자르기·지우기. */}
              <SheetSourcePanel
                sources={unplaced}
                onAdd={(source) => void addImage(source)}
                onEdit={(source) => setCropTarget({ source })}
                legacyFaceSets={assetType.startsWith("background")}
              />

              {/*
                배치도 — 프로젝트 공용. (지시 183·184, 사용자 2026-09-08)

                시트는 한 번 만들고 끝이 아닙니다. 의상이 바뀌면 필요한 칸만
                갈아 끼워 다시 뽑습니다. 그때 처음부터 다시 놓는 것은 시트를
                새로 만드는 일이라 시간이 너무 듭니다. **복제**가 있어야 합니다.

                「배치도에 빈 배치 추가는 왜 있는 거야? 활용 가치가 있으려면 배치도 이름을
                바꿀 수 있어야 하고, 다른 캐릭터에서 캐릭터 시트 제작 눌렀을 때 배치도를
                선택할 수 있어야」 — 그래서 이름은 입력칸이고, 목록은 프로젝트 전체 것입니다.
              */}
              <div className="mt-2 space-y-1" data-tour="sheet-layouts">
                <p className="text-[10px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
                  배치도 (프로젝트 공용 · {shownLayouts.length})
                </p>
                {shownLayouts.map((layout) => {
                  const on = layout.id === currentLayout.id;
                  return (
                    <div
                      key={layout.id}
                      className="flex items-center gap-1 rounded px-1 py-0.5"
                      style={{
                        background: on ? "oklch(0.62 0.22 290 / 20%)" : "oklch(1 0 0 / 4%)",
                        border: `1px solid ${on ? "oklch(0.62 0.22 290 / 45%)" : "oklch(1 0 0 / 7%)"}`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onLayoutSelect(layout.id)}
                        aria-label={`${layout.name || "이름 없는 배치"} 고르기`}
                        title="이 배치도로 바꿉니다"
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{
                          background: on ? "oklch(0.84 0.19 290)" : "transparent",
                          border: `1px solid ${on ? "oklch(0.84 0.19 290)" : "oklch(0.52 0.01 265)"}`,
                        }}
                      />
                      <input
                        value={layout.name}
                        onFocus={() => onLayoutSelect(layout.id)}
                        onChange={(event) => onLayoutRename(layout.id, event.target.value)}
                        placeholder="배치도 이름"
                        title="배치도 이름 — 다른 인물의 시트에서도 이 이름으로 고릅니다"
                        className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[10px] outline-none"
                        style={{ color: on ? "oklch(0.90 0.10 290)" : "oklch(0.70 0.01 265)" }}
                      />
                      <span className="shrink-0 text-[9px] opacity-50">{layout.placements.length}칸</span>
                      <button
                        type="button"
                        onClick={() => onLayoutAdd(layout)}
                        title="이 배치를 복제합니다. 칸 몇 개만 갈아 끼울 때 씁니다"
                        className="shrink-0 rounded p-1 hover:bg-white/10"
                        style={{ color: "oklch(0.70 0.15 200)" }}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      {layouts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void removeLayout(layout)}
                          title="이 배치도를 지웁니다"
                          className="shrink-0 rounded p-1 hover:bg-white/10"
                          style={{ color: "oklch(0.62 0.15 25)" }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => onLayoutAdd()}
                  title="칸을 새로 잡습니다. 다른 인물의 시트에서도 이 배치도를 고를 수 있습니다"
                  className="flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-[10px]"
                  style={{ background: "oklch(1 0 0 / 4%)", color: "oklch(0.60 0.01 265)" }}
                >
                  <Plus className="h-3 w-3" /> 새 배치도
                </button>
              </div>

              {/*
                뽑을 규격 = 캔버스의 실제 px. 프리셋 셋 + 가로·세로 직접 입력. 배치도에 저장됩니다.
                칸의 px 는 그대로 두고 캔버스만 커지거나 작아집니다. (지시 259·267, )
                고른 규격이 단추·설명·결과 어디에도 안 보여 «안 바뀐다» 로 보였습니다.
              */}
              <div className="mt-2 space-y-1">
                <p className="text-[10px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
                  뽑을 규격 (px)
                </p>
                <div className="grid grid-cols-3 gap-1">
                  {SHEET_SIZES.map((option) => {
                    const on = option.size.width === size.width && option.size.height === size.height;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setSize(option.size)}
                        className="rounded px-1 py-1 text-[10px]"
                        style={{
                          background: on ? "oklch(0.62 0.22 290 / 20%)" : "oklch(1 0 0 / 4%)",
                          border: `1px solid ${on ? "oklch(0.62 0.22 290 / 45%)" : "oklch(1 0 0 / 7%)"}`,
                          color: on ? "oklch(0.84 0.19 290)" : "oklch(0.62 0.01 265)",
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {/* 치는 동안 매 키 입력마다 «치기 시작한 판» 에서 다시 맞춥니다(typeSize 설명 참고). */}
                <div
                  className="grid grid-cols-2 gap-1"
                  data-tour="sheet-size-fields"
                  onBlur={(event) => {
                    // 가로 → 세로로 옮겨 가는 중이면 아직 치는 중입니다. 둘 다 떠나면 한 동작이 끝난 것입니다.
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    sizeEditBase.current = null;
                  }}
                >
                  <label className="text-[9px]" style={{ color: "oklch(0.48 0.01 265)" }}>
                    가로
                    <NumberInput
                      value={size.width}
                      step={64}
                      min={SIZE_MIN}
                      onChange={(next) => typeSize({ width: next })}
                    />
                  </label>
                  <label className="text-[9px]" style={{ color: "oklch(0.48 0.01 265)" }}>
                    세로
                    <NumberInput
                      value={size.height}
                      step={64}
                      min={SIZE_MIN}
                      onChange={(next) => typeSize({ height: next })}
                    />
                  </label>
                </div>
                <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.42 0.01 265)" }}>
                  {SIZE_MIN}~{SIZE_MAX}. 규격은 캔버스 크기입니다 — 그림은 뽑힌 px 그대로 들어가고,
                  규격을 바꿔도 칸 크기는 그대로입니다(밖으로 나가는 칸만 안으로 밀려 들어옵니다).
                </p>
                <label
                  className="flex items-center gap-1.5 text-[10px]"
                  style={{ color: "oklch(0.62 0.01 265)" }}
                  title="칸 이름(«전신», «표정»)을 그림 밑에 굽습니다"
                >
                  <input
                    type="checkbox"
                    checked={captions}
                    onChange={(event) => onLayoutCaptionsChange(currentLayout.id, event.target.checked)}
                  />
                  칸 이름 굽기
                </label>
              </div>

              {/*
                고른 칸. 이름과 크기를 숫자로. 손잡이로는 딱 맞추기 어렵습니다.
                예전에 숫자를 넣으면 0 으로 수렴하던 오류(지시 270)는 빈 값이나
                「-」 를 그 자리에서 숫자로 바꾸던 탓입니다 — NumberInput 은 유효한
                숫자일 때만 올립니다. 최소 200 으로 막아 사라지지 않게 합니다.
              */}
              {selectedPlacement && (
                <div className="mt-2 space-y-1" data-tour="sheet-selected">
                  <p className="text-[10px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
                    고른 칸
                  </p>
                  {selectedPlacement.kind !== "profile" && (
                    <label className="block text-[9px]" style={{ color: "oklch(0.48 0.01 265)" }}>
                      칸 이름
                      <input
                        value={selectedPlacement.label ?? ""}
                        onFocus={mark}
                        onChange={(event) => setLabel(selectedPlacement.id, event.target.value)}
                        placeholder={
                          images.find((item) => item.id === selectedPlacement.imageId)?.name || "전신, 표정…"
                        }
                        className="mt-0.5 h-8 w-full rounded-md px-2 text-xs outline-none"
                        style={{
                          background: "oklch(0.18 0.012 265)",
                          border: "1px solid oklch(1 0 0 / 9%)",
                          color: "oklch(0.82 0.01 265)",
                        }}
                      />
                    </label>
                  )}
                  <p className="text-[9px]" style={{ color: "oklch(0.48 0.01 265)" }}>
                    크기 (px)
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {(["width", "height"] as const).map((key) => (
                      <label key={key} className="text-[9px]" style={{ color: "oklch(0.48 0.01 265)" }}>
                        {key === "width" ? "가로" : "세로"}
                        <NumberInput
                          value={selectedPlacement[key]}
                          step={50}
                          min={MIN_SLOT}
                          onChange={(next) =>
                            commit((current) =>
                              current.map((item) =>
                                item.id === selectedPlacement.id
                                  ? { ...item, [key]: Math.max(MIN_SLOT, Math.round(next)) }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={addProfile}
                className="mt-2 w-full rounded-md px-2 py-2 text-[10px] font-semibold"
                style={{
                  background: "oklch(0.18 0.012 265)",
                  border: "1px dashed oklch(0.62 0.22 290 / 55%)",
                  color: "oklch(0.82 0.18 290)",
                }}
              >
                + 프로필 글상자
              </button>
              <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.42 0.01 265)" }}>
                이름·나이·MBTI 와 성격·말투·버릇이 시트 빈자리에 찍힙니다. 영상 모델이 이 인물을
                연기할 때 읽는 것이라, 그림만으로는 알 수 없는 것을 담습니다.
              </p>

              {/*
                글자 크기. 프로필 칸이 하나라도 있으면 늘 보입니다 — 칸을 눌러 골라야만
                나타나던 것을 로 봤습니다.
              */}
              {fontTarget && (
                <div
                  className="mt-2 rounded-md p-2.5"
                  data-tour="sheet-profile-font"
                  style={{ background: "oklch(0.14 0.01 265)", border: "1px solid oklch(1 0 0 / 8%)" }}
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <Type className="h-3 w-3" style={{ color: "oklch(0.72 0.15 200)" }} />
                    <span className="text-[10px]" style={{ color: "oklch(0.62 0.01 265)" }}>
                      프로필 글자
                    </span>
                    <span
                      className="ml-auto text-[10px] tabular-nums"
                      style={{ color: "oklch(0.76 0.15 200)" }}
                    >
                      {fontTarget.fontSize ?? DEFAULT_FONT}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={200}
                    step={2}
                    value={fontTarget.fontSize ?? DEFAULT_FONT}
                    // 끌기 시작에 한 번 기록하고 도중은 기록하지 않습니다. Ctrl+Z 한 번에 한 번의 끌기.
                    onPointerDown={mark}
                    onKeyDown={mark}
                    onChange={(event) => setFontSize(fontTarget.id, Number(event.target.value), false)}
                    className="w-full"
                  />
                  <NumberInput
                    value={fontTarget.fontSize ?? DEFAULT_FONT}
                    step={2}
                    min={20}
                    onChange={(next) => setFontSize(fontTarget.id, next, true)}
                  />
                  <p className="mt-1 text-[9px] leading-relaxed" style={{ color: "oklch(0.42 0.01 265)" }}>
                    상자 크기와 **따로** 움직입니다. 상자를 넓혀도 글씨는 그대로예요. (20~200)
                  </p>
                </div>
              )}
            </aside>

            {/* ── 오른쪽: 시트 ──────────────────────────────────────── */}
            <div className="flex min-h-0 flex-col items-center justify-center gap-3 overflow-auto p-4">
              <div
                ref={boardRef}
                className="relative shrink-0 overflow-hidden rounded-lg"
                data-tour="sheet-board"
                style={{
                  width: boardWidth,
                  height: boardHeight,
                  background: "#ffffff",
                  boxShadow: "0 8px 40px oklch(0 0 0 / 45%)",
                  outline: dropTarget === "board" ? "2px dashed oklch(0.70 0.20 290)" : undefined,
                }}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) setSelected(null);
                }}
                onDragOver={(event) => {
                  if (acceptSource(event)) setDropTarget("board");
                }}
                onDragLeave={(event) => {
                  if (event.target === event.currentTarget) setDropTarget(null);
                }}
                onDrop={(event) => {
                  // 빈자리에 떨구면 그 자리에 새 칸. 칸 위에 떨구는 것은 칸이 먼저 받고 전파를 끊습니다.
                  setDropTarget(null);
                  const image = droppedSource(event);
                  if (!image) return;
                  event.preventDefault();
                  const rect = boardRef.current!.getBoundingClientRect();
                  // 떨군 자리가 칸의 중심이 됩니다(크기는 그림을 읽은 뒤 정해지므로 여기서는 중심만 넘깁니다).
                  void addImage(image, {
                    x: (event.clientX - rect.left) / scale,
                    y: (event.clientY - rect.top) / scale,
                  });
                }}
              >
                {placements.map((placement) => {
                  const image = images.find((item) => item.id === placement.imageId);
                  const on = selected === placement.id;
                  const isProfile = placement.kind === "profile";
                  const empty = !isProfile && !image;
                  const dropOn = dropTarget === placement.id;
                  const caption = placement.label?.trim() || "";
                  return (
                    <div
                      key={placement.id}
                      className="group absolute cursor-move"
                      data-tour="sheet-slot"
                      style={{
                        left: placement.x * scale,
                        top: placement.y * scale,
                        width: placement.width * scale,
                        height: placement.height * scale,
                        outline: dropOn
                          ? "3px solid oklch(0.78 0.20 200)"
                          : on
                            ? "2px solid oklch(0.70 0.20 290)"
                            : empty
                              ? "2px dashed oklch(0.55 0.10 290 / 70%)"
                              : "1px solid oklch(0 0 0 / 18%)",
                      }}
                      // 상자 본체가 이동 손잡이입니다. 예전 «위 띠» 는 그림을 가렸습니다.
                      onPointerDown={(event) => startMove(event, placement)}
                      onDragOver={(event) => {
                        if (isProfile) return;
                        if (acceptSource(event)) {
                          event.stopPropagation();
                          setDropTarget(placement.id);
                        }
                      }}
                      onDragLeave={() => setDropTarget((current) => (current === placement.id ? null : current))}
                      onDrop={(event) => {
                        if (isProfile) return;
                        const dropped = droppedSource(event);
                        if (!dropped) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setDropTarget(null);
                        replaceSlot(placement.id, dropped.id);
                        setSelected(placement.id);
                      }}
                    >
                      {isProfile ? (
                        <div className="h-full w-full overflow-hidden" style={{ background: "#ffffff" }}>
                          <ProfileBoxPreview
                            width={placement.width}
                            height={placement.height}
                            scale={scale}
                            fontSize={placement.fontSize ?? DEFAULT_FONT}
                            basics={basics}
                            profile={profile}
                          />
                        </div>
                      ) : image ? (
                        <img
                          src={assetSrc(image.filePath) || image.thumb || ""}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        // 빈 칸 — 배치도는 프로젝트 공용이라 다른 인물이 넣은 그림은 여기 없습니다.
                        <div
                          className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center"
                          style={{ background: "oklch(0.96 0.01 290)", color: "oklch(0.50 0.05 290)" }}
                        >
                          <p className="truncate text-[10px] font-semibold">{caption || "빈 칸"}</p>
                          <p className="text-[9px]">그림을 끌어다 놓으세요</p>
                        </div>
                      )}

                      {/*
                        칸 이름 — 상자 **밖 위**. 그림을 안 가립니다. 더블클릭으로 바꿉니다.
                        → 상자 밖 아래에 두었더니 바로 밑 상자와 붙어
                        어느 칸 이름인지 헷갈렸습니다(「타이틀이 상단으로 가게」). 상자가 시트
                        맨 위에 붙어 있으면 시트 밖(overflow-hidden)이라 그때만 상자 안 위에 겹칩니다.
                      */}
                      <div
                        className={`absolute left-0 max-w-full ${placement.y * scale < 16 ? "top-0.5 z-10" : "bottom-full mb-0.5"}`}
                        data-tour="sheet-slot-label"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {labelEditing === placement.id ? (
                          <input
                            autoFocus
                            value={placement.label ?? ""}
                            onChange={(event) => setLabel(placement.id, event.target.value)}
                            onBlur={() => setLabelEditing(null)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === "Escape") setLabelEditing(null);
                            }}
                            placeholder={isProfile ? "프로필" : image?.name || "칸 이름"}
                            className="w-28 rounded px-1 py-0.5 text-[9px] outline-none"
                            style={{
                              background: "oklch(0.18 0.012 265)",
                              border: "1px solid oklch(0.70 0.20 290)",
                              color: "white",
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            onDoubleClick={() => {
                              mark();
                              setLabelEditing(placement.id);
                            }}
                            onClick={() => setSelected(placement.id)}
                            title="더블클릭해서 칸 이름을 바꿉니다 — «전신», «표정»"
                            className="max-w-full truncate rounded px-1.5 py-0.5 text-left text-[9px]"
                            style={{
                              background: "oklch(0.12 0.01 265 / 88%)",
                              color: caption ? "oklch(0.90 0.01 265)" : "oklch(0.60 0.01 265)",
                            }}
                          >
                            {caption || (isProfile ? "프로필" : image?.name || "칸 이름 없음")}
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => commit((current) => current.filter((item) => item.id !== placement.id))}
                        aria-label="빼기"
                        data-tour="sheet-slot-remove"
                        className="absolute bottom-1 left-1 z-10 rounded p-0.5"
                        style={{ background: "oklch(0 0 0 / 70%)", color: "white" }}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>

                      {/* 가위 — 이 칸의 그림을 자르기·지우기. 오른쪽 아래는 크기 손잡이라 오른쪽 위에. */}
                      {image && (
                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => setCropTarget({ source: image, placementId: placement.id })}
                          aria-label={`${image.name} 편집 — 자르기·지우기`}
                          title="편집 — 자르기·지우기. 결과가 이 칸에 들어갑니다"
                          className="absolute right-1 top-1 z-10 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          style={{ background: "oklch(0 0 0 / 72%)", color: "white" }}
                        >
                          <Scissors className="h-3 w-3" />
                        </button>
                      )}

                      {/* 프로필 칸의 글자 크기 — 마우스를 올리면 오른쪽 위에 A-/A+ */}
                      {isProfile && (
                        <div
                          className="absolute right-1 top-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          {([-4, 4] as const).map((delta) => (
                            <button
                              key={delta}
                              type="button"
                              onClick={() => setFontSize(placement.id, (placement.fontSize ?? DEFAULT_FONT) + delta, true)}
                              title={delta < 0 ? "글자 작게" : "글자 크게"}
                              className="rounded px-1 py-0.5 text-[9px] font-bold"
                              style={{ background: "oklch(0 0 0 / 72%)", color: "white" }}
                            >
                              {delta < 0 ? "A-" : "A+"}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* 오른쪽 아래 모서리로 크기를 바꿉니다. */}
                      <div
                        className="absolute bottom-0 right-0 z-10 h-3 w-3 cursor-nwse-resize"
                        style={{
                          background:
                            "linear-gradient(135deg, transparent 50%, oklch(0.70 0.20 290) 50%)",
                        }}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelected(placement.id);
                          const rect = boardRef.current!.getBoundingClientRect();
                          // startMove 와 같은 이유 — 포커스가 규격 입력칸에 남아 있어도 기준 판은 여기서 끝냅니다.
                          sizeEditBase.current = null;
                          mark();
                          setDrag({
                            kind: "resize",
                            id: placement.id,
                            startX: (event.clientX - rect.left) / scale,
                            startY: (event.clientY - rect.top) / scale,
                            width: placement.width,
                            height: placement.height,
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {outOfFrame && (
                <p className="text-[10px]" style={{ color: "oklch(0.75 0.15 60)" }}>
                  규격 밖으로 나간 칸이 있습니다. 굽히면 그 부분은 잘립니다.
                </p>
              )}

              <div className="flex shrink-0 flex-wrap items-center justify-center gap-2" data-tour="sheet-actions">
                <button
                  type="button"
                  onClick={undo}
                  className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px]"
                  style={{ background: "oklch(1 0 0 / 5%)", color: "oklch(0.66 0.01 265)" }}
                >
                  <Undo2 className="h-3 w-3" /> 되돌리기 <kbd className="opacity-50">Ctrl+Z</kbd>
                </button>
                <button
                  type="button"
                  onClick={redo}
                  className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px]"
                  style={{ background: "oklch(1 0 0 / 5%)", color: "oklch(0.66 0.01 265)" }}
                >
                  <Redo2 className="h-3 w-3" /> 다시 하기
                </button>
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void bake("replace")}
                      disabled={baking}
                      title="옛 파일을 지우고 이 항목의 시트를 새로 구운 것으로 바꿉니다"
                      className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[11px] font-semibold text-white gradient-primary disabled:opacity-50"
                    >
                      {baking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      다시 굽기 (이 시트를 바꿈) · {sizeText}
                    </button>
                    <button
                      type="button"
                      onClick={() => void bake("new")}
                      disabled={baking}
                      title="옛 시트는 그대로 두고 새 시트 항목을 만듭니다"
                      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold disabled:opacity-50"
                      style={{
                        background: "oklch(0.62 0.22 290 / 12%)",
                        border: "1px solid oklch(0.62 0.22 290 / 32%)",
                        color: "oklch(0.84 0.18 290)",
                      }}
                    >
                      <LayoutGrid className="h-3 w-3" /> 새 판으로 저장
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void bake("new")}
                    disabled={baking}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[11px] font-semibold text-white gradient-primary disabled:opacity-50"
                  >
                    {baking ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <LayoutGrid className="h-3 w-3" />
                    )}
                    {sizeText} 시트 제작
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>

      {/*
        시트 창 안에서 자르기·지우기. 결과는 이 인물의 생성 이미지로 들어가고(계보
        패널에도 보임), 칸에서 열었으면 그 칸의 그림이 첫 결과로 바뀝니다.
        

        `kind` 는 구분하지 않습니다 — 잘라낸 칸이든 지운 판이든 파일이 오면 전부 새 그림.
        자르기 창은 제 Dialog 라 이 창 위에 그대로 겹쳐 뜹니다(PromptCardBody 와 같음).
      */}
      {cropTarget && (
        <SheetPanelCropper
          open
          onOpenChange={(next) => {
            if (!next) setCropTarget(null);
          }}
          imageSrc={assetSrc(cropTarget.source.filePath) || cropTarget.source.thumb || ""}
          // 파일 이름에 원본 꼬리가 남게(`냥이_클로즈업_지움_001`). 없으면 blob 뿐이라 생략됩니다.
          sourcePath={cropTarget.source.filePath}
          kind={assetType.startsWith("background") ? "background" : "character"}
          ownerName={ownerName}
          projectName={projectName}
          // 잘라낸 칸·지운 판 전부 이 인물의 생성 이미지로(fe19e75 규칙과 같음).
          assetType={assetType}
          markAssetType={assetType}
          onSaved={(files: CropperSavedFile[]) => {
            const added: GeneratedImageAsset[] = files.map((file) => ({
              id: uid(),
              name: file.name,
              thumb: file.thumb ?? "",
              file: null,
              filePath: file.path,
              // 파노라마 여섯 면이면 면·세트 표도 같이(세트 카드로 묶이게).
              face: file.face,
              faceSet: file.faceSet,
            }));
            if (!added.length) return;
            onImagesAdded(added);
            if (cropTarget.placementId) replaceSlot(cropTarget.placementId, added[0].id);
            toast.success(
              cropTarget.placementId
                ? `편집한 ${added.length}장을 생성 이미지에 넣고 첫 장을 그 칸에 놓았습니다.`
                : `편집한 ${added.length}장을 생성 이미지에 넣었습니다. 왼쪽 목록에서 놓으세요.`,
            );
          }}
        />
      )}
    </Dialog>
  );
}
