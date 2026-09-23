import { sizeLabel, type ImageSize } from "@/lib/useImageSize";
import { useRef, useState } from "react";
import { CloudDownload, ImagePlus, Star, FolderSync } from "lucide-react";
import { toast } from "sonner";
import MagnificImportDialog from "@/components/MagnificImportDialog";
import { useMagnificStatus } from "@/lib/magnificMcp";
import ImageActions from "@/components/ImageActions";
import ImageLightbox, { type LightboxImage } from "@/components/ImageLightbox";
import FaceSetCard from "@/components/FaceSetCard";
import { useUpscaleActions } from "@/components/project/useUpscaleActions";
import type { UpscaleRunOptions } from "@/lib/upscale";
import {
  faceDisplayName,
  faceSetImages,
  splitFaceSets,
  type FaceSet,
} from "@/lib/faceSets";
import SheetPanelCropper from "@/components/SheetPanelCropper";
import CompositeSheetShelf from "@/components/CompositeSheetShelf";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import {
  assetSrc,
  copyImageWithNotice,
  deleteProjectMediaFile,
  restoreProjectMediaFile,
  openProjectInbox,
  saveProjectMediaAsset,
  type ProjectAssetType,
} from "@/lib/mediaLibrary";
import { filterImageFiles } from "@/lib/promptWorkflow";
import { uid, type GeneratedImageAsset } from "@/lib/projectTypes";
import type { BlueprintKind, SpaceKind } from "@/lib/blueprint";

/**
 * 밖에서 만들어 온 그림을 등록하는 자리.
 *
 * 이 앱은 그림을 직접 만들지 않습니다. 프롬프트를 여기서 만들어 프리픽이나
 * ComfyUI 로 가져가 뽑고, 결과를 다시 여기 등록합니다. 그래야 다음 시트를
 * 뽑을 때 레퍼런스로 걸 수 있습니다.
 *
 * **드래그해서 넣으세요.** 붙여넣기로도 되지만, 그러면 파일 이름이 없어서
 * Magnific 태그(`@냥이_얼굴 정면_001`)를 만들 수 없습니다.
 *
 * 캐릭터·배경·에셋이 같이 씁니다.
 */
export default function GeneratedImageShelf({
  images,
  onChange,
  assetLabel,
  ownerName,
  stem,
  assetType,
  cropKind = "character",
  spaceKind,
  faceSetSize,
}: {
  images: GeneratedImageAsset[];
  /**
   * **지금 목록을 받아 다음 목록을 돌려주는 함수** 를 받습니다.
   *
   * 값으로 받던 때는 폴더 저장(수 초)이 끝난 뒤 «요청할 때의 목록» 으로
   * 덮어써서, 그 사이 넣은 그림이 사라졌습니다. (2026-09-05 검증)
   */
  onChange: (
    update: (current: GeneratedImageAsset[]) => GeneratedImageAsset[],
  ) => void;
  /** 화면에 보여 줄 이름 */
  assetLabel: string;
  /** 폴더 이름이 되는 값 */
  ownerName: string;
  /**
   * 파일 이름 앞부분. 안 주면 폴더 이름 → `냥이_001`. 변형 창은 «인물_변형» 을 줍니다
   * → `냥이_겨울_001`. 폴더는 부모 것 하나지만 파일 이름에 어느 판인지 남아야
   * 탐색기에서도, 마그니픽 @태그에서도 구분됩니다.
   */
  stem?: string;
  assetType: ProjectAssetType;
  /** 자르기 창에서 이름 후보를 어느 목록에서 가져올지 */
  cropKind?: BlueprintKind;
  /** 배경의 실내·실외 — 파노라마 여섯 면의 위 면 이름(천장/하늘)이 갈립니다. 배경만 줍니다. */
  spaceKind?: SpaceKind | null;
  faceSetSize?: import("@/lib/projectTypes").FaceSetSize | null;
}) {
  const { projectName, imageMarks, setImageMarks } = useProjectMedia();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [cropTarget, setCropTarget] = useState<GeneratedImageAsset | null>(
    null,
  );
  /** 크게 보기로 연 그림(들). 6면 세트는 여섯 면을 ←/→ 로 넘겨 봅니다. */
  /** 그림마다 잰 원본 px 크기. 썸네일이 뜨는 순간 채워집니다(아래 onLoad). */
  const [sizes, setSizes] = useState<Record<string, ImageSize>>({});
  const [viewing, setViewing] = useState<{
    images: LightboxImage[];
    index: number;
  } | null>(null);
  /**
   * 세트 업스케일은 같은 경로에 덮어씁니다. 경로가 같으면 <img> 가 옛 그림을 캐시에서 꺼내
   * 보여 주므로, 끝난 뒤 이 숫자를 올려 주소 꼬리를 바꿔 다시 읽게 합니다.
   */
  const [refreshBump, setRefreshBump] = useState(0);
  const upscaler = useUpscaleActions({ ownerName, prefix: stem });

  const previewOf = (image: GeneratedImageAsset) =>
    assetSrc(image.filePath) || image.thumb || "";
  /*
    ── 마그니픽에서 가져오기 ──────────────────────────────────────────────
     값을 치르고 뽑아 둔 것을 **다시 뽑지 않고** 끌어옵니다.
    연결했을 때만 뜹니다 — 못 쓰는 단추는 자리만 차지합니다.
  */
  const magnific = useMagnificStatus();
  const [importing, setImporting] = useState(false);

  const toLightbox = (image: GeneratedImageAsset): LightboxImage => ({
    // 6면은 «정면 · 장소 #1» 로 — 파일 이름은 접두가 먼저라 넘겨 볼 때 어느 면인지 끝을 읽어야 했습니다.
    // 세트가 아니면 원래 이름을 그대로 돌려주니 낱장에도 안전합니다.
    name: faceDisplayName(image, spaceKind),
    thumb: previewOf(image),
    filePath: image.filePath,
  });

  const addFiles = async (files: FileList | File[]) => {
    const picked = filterImageFiles(files);
    if (!picked.length) {
      toast.error("이미지 파일만 등록할 수 있습니다.");
      return;
    }

    const added: GeneratedImageAsset[] = picked.map((file, index) => ({
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, ""),
      thumb: URL.createObjectURL(file),
      file,
      // 처음 넣는 그림이 대표가 됩니다. 목록에서 이 카드를 보여 줄 때 씁니다.
      isPrimary: images.length === 0 && index === 0,
    }));

    onChange((current) => [...current, ...added]);

    // 제목이 없으면 폴더를 못 정합니다. 그냥 넘어가면 화면에는 그림이 보이는데
    // 폴더에는 아무것도 없고, blob 주소라 **앱을 닫으면 통째로 사라집니다.**
    // 조용히 실패하면 알 방법이 없어서 반드시 알려 줍니다.
    if (!projectName.trim()) {
      toast.warning(
        "프로젝트 제목을 먼저 정하세요. 그래야 그림이 폴더에 저장됩니다.",
      );
      return;
    }

    const saved = await Promise.all(
      added.map(async (image) => {
        if (!image.file) return null;
        const result = await saveProjectMediaAsset(image.file, {
          projectName,
          assetType,
          ownerName,
          // 원본 파일 이름은 넘기지 않습니다 — 「인물 이름_001」(변형은 「인물_변형_001」) 로 저장됩니다.
          // 원본 이름을 그대로 쓰면 생성기가 붙인 긴 이름이 폴더에 쌓이고,
          // 파일 이름이 곧 @태그라 그런 이름으로는 태그를 못 겁니다.
          stem,
        }).catch(() => null);
        return result
          ? { id: image.id, path: result.path, name: result.name }
          : null;
      }),
    );

    const stored = new Map(
      saved.filter(Boolean).map((item) => [item!.id, item!]),
    );
    if (!stored.size) return;
    // added 를 기준으로 다시 만듭니다. 저장이 끝나는 사이에 다른 것이 들어왔을 수 있습니다.
    // 폴더에 놓인 이름과 화면 이름을 같이 맞춥니다.
    onChange((current) =>
      current.map((image) => {
        const item = stored.get(image.id);
        return item
          ? { ...image, filePath: item.path, name: item.name }
          : image;
      }),
    );
  };

  const remove = async (image: GeneratedImageAsset) => {
    // 화면 삭제 = 폴더 파일도 삭제. 파일이 남으면 폴더를 다시 읽을 때 되살아납니다.
    const ok = await confirmDialog({
      title: `${image.name} 을 지울까요?`,
      description: image.filePath
        ? "저장 폴더의 원본 파일도 함께 지워집니다."
        : "목록에서 빠집니다.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!ok) return;
    onChange((current) => current.filter((item) => item.id !== image.id));
    if (image.filePath) {
      const deleted = await deleteProjectMediaFile(projectName, image.filePath);
      if (!deleted) {
        toast.error("폴더의 파일은 지우지 못했습니다. 직접 지워 주세요.");
        return;
      }
      /*
        **되돌리기는 지운 바로 그 자리에서.**

        지운 것은 곧바로 없어지지 않고 프로젝트 폴더 안 휴지통에 한 단계 머뭅니다
        (`src-tauri/src/trash.rs`). 그런데 그것을 부르는 화면이 없어서, 되돌릴 수 있는데도
        되돌릴 길이 없었습니다(2026-09-23 검토). 사람이 「아차」 하는 순간은 **지운 그때**라,
        되살리기 창을 따로 두기보다 여기 단추 하나를 두는 편이 실제로 닿습니다.
      */
      const path = image.filePath;
      toast.success(`${image.name} 을 지웠습니다.`, {
        action: {
          label: "되돌리기",
          onClick: () => {
            void restoreProjectMediaFile(projectName, path).then((back) => {
              if (!back) {
                toast.error("되돌리지 못했습니다. 휴지통에서 이미 비워졌을 수 있습니다.");
                return;
              }
              onChange((current) =>
                // 이미 같은 파일이 다시 들어와 있으면 두 장이 되지 않게.
                current.some((item) => item.filePath === back)
                  ? current
                  : [...current, { ...image, filePath: back, thumb: assetSrc(back) || image.thumb }],
              );
              toast.success(`${image.name} 을 되돌렸습니다.`);
            });
          },
        },
      });
    }
  };

  /**
   * 세트 X — 여섯 파일을 다 지웁니다(규칙 3). 면 하나만 지우면 세트가 깨져 구도잡기에서
   * 빈 면이 생기니, 낱장 X 는 세트 카드에 두지 않았습니다.
   */
  const removeSet = async (set: FaceSet<GeneratedImageAsset>) => {
    const members = faceSetImages(set);
    const ok = await confirmDialog({
      title: `${set.label} 을 지울까요?`,
      description:
        "저장 폴더의 원본 파일도 함께 지워집니다. 되돌릴 수 없습니다. 여섯 면이 모두 지워집니다.",
      confirmLabel: "세트 지우기",
      tone: "danger",
    });
    if (!ok) return;
    const ids = new Set(members.map((image) => image.id));
    onChange((current) => current.filter((item) => !ids.has(item.id)));
    let failed = 0;
    for (const image of members) {
      if (!image.filePath) continue;
      const deleted = await deleteProjectMediaFile(projectName, image.filePath);
      if (!deleted) failed += 1;
    }
    if (failed)
      toast.error(
        `폴더의 파일 ${failed}개는 지우지 못했습니다. 직접 지워 주세요.`,
      );
  };

  /*
    낱장 업스케일은 여기 없습니다(2026-09-09). — 낱장 키우기는 가위로 여는 편집 창
    (`SheetPanelCropper`)의 «지금 그림 업스케일»·«업스케일해서 저장» 으로 갔습니다.
    여섯 장을 한 번에 덮어쓰는 세트 업스케일만 카드에 남습니다.
  */
  const upscaleSet = async (
    set: FaceSet<GeneratedImageAsset>,
    options?: UpscaleRunOptions,
  ) => {
    // spaceKind 를 넘겨야 실내 세트의 진행 문구가 «천장 업스케일 중» 으로 파일 이름과 맞습니다.
    const changed = await upscaler.upscaleSetInPlace(set, spaceKind, options);
    if (changed) setRefreshBump((value) => value + 1);
  };

  const setPrimary = (id: string) =>
    onChange((current) =>
      current.map((image) => ({ ...image, isPrimary: image.id === id })),
    );

  const sheets = images.filter((image) => image.isCompositeSheet);
  // 6면 세트는 여덟 장으로 늘어놓지 않고 카드 한 장으로. 낱장은 `singles`.
  // `6면/` 밖의 이름 인식(legacy)은 배경에서만 — 캐릭터·에셋의 «정면»·«후면» 칸이 세트로 오인되지 않게.
  const { sets: faceSets, singles: plain } = splitFaceSets(
    images.filter((image) => !image.isCompositeSheet),
    { legacy: cropKind === "background" },
  );

  return (
    <div
      data-tour="card-generated-images"
      className="space-y-2 rounded-lg p-3"
      style={{
        background: "oklch(0.13 0.009 265)",
        border: `1px solid ${dragging ? "oklch(0.62 0.22 290 / 55%)" : "oklch(0.55 0.15 200 / 20%)"}`,
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void addFiles(event.dataTransfer.files);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-white">생성 결과 이미지</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              void openProjectInbox({ projectName }).then((path) => {
                if (path)
                  toast.success(
                    "후보함을 열었습니다. 마그니픽 데스크톱에서 이 폴더 하나만 동기화하면 됩니다.",
                  );
              })
            }
            title="프로젝트 후보함(magnific/)을 엽니다. 온 것은 화면 위 «마그니픽에서 온 것» 에서 채택합니다."
            className="flex items-center gap-1 text-[10px]"
            style={{ color: "oklch(0.62 0.01 265)" }}
          >
            <FolderSync className="h-3 w-3" /> 마그니픽 후보함
          </button>
          {magnific.connected && (
            <button
              type="button"
              onClick={() => setImporting(true)}
              data-tour-open="shelf-import-search shelf-import-grid"
              title="마그니픽에 이미 만들어 둔 것을 골라 이 카드에 붙입니다 — 다시 뽑지 않습니다"
              className="flex items-center gap-1 text-[10px]"
              style={{ color: "oklch(0.72 0.13 250)" }}
            >
              <CloudDownload className="h-3 w-3" /> 가져오기
            </button>
          )}
          <span
            className="text-[10px]"
            style={{ color: "oklch(0.48 0.01 265)" }}
          >
            {images.length}개 등록
          </span>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {faceSets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {faceSets.map((set) => (
            <FaceSetCard
              key={set.id}
              set={set}
              width={120}
              refreshBump={refreshBump}
              upscaling={
                upscaler.busy?.key === set.id ? upscaler.busy.message : null
              }
              onClick={() =>
                setViewing({
                  images: faceSetImages(set).map(toLightbox),
                  index: 0,
                })
              }
              onRemove={() => void removeSet(set)}
              onUpscale={
                upscaler.enabled
                  ? (options) => void upscaleSet(set, options)
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {plain.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {plain.map((image) => (
            /* 레퍼런스 타일과 같은 규칙 — 눌러서 고르고 Ctrl+C 로 복사. (지시 121) */
            <div
              key={image.id}
              tabIndex={0}
              title={`${image.name} — 눌러서 고르고 Ctrl+C 로 복사`}
              onKeyDown={(event) => {
                if (
                  !(event.ctrlKey || event.metaKey) ||
                  event.key.toLowerCase() !== "c"
                )
                  return;
                event.preventDefault();
                void copyImageWithNotice(image);
              }}
              className="group relative w-[120px] outline-none focus-visible:ring-2"
            >
              <div
                className="aspect-square w-full overflow-hidden rounded-lg"
                style={{ background: "oklch(0.10 0.006 265)" }}
              >
                {previewOf(image) && (
                  <img
                    src={previewOf(image)}
                    alt={image.name}
                    // 썸네일을 누르면 크게 봅니다. 「어디서든 이미지를 클릭하면 이미지를
                    // 크게 보여줘야 제대로 된 이미지인지 체크하지」 (지시 255·273)
                    onClick={() =>
                      setViewing({ images: [toLightbox(image)], index: 0 })
                    }
                    data-tour-open="shelf-lightbox-nav"
                    /*
                      **원본 크기를 재 둡니다.** 어차피 브라우저가 받아 놓은 그림이라 `naturalWidth` 를 읽는 것이
                      가장 싸고 정확합니다 — 따로 `Image` 를 또 띄우면 같은 파일을 두 번 읽습니다.
                    */
                    onLoad={(event) => {
                      const target = event.currentTarget;
                      if (!target.naturalWidth) return;
                      setSizes((current) =>
                        current[image.id]
                          ? current
                          : { ...current, [image.id]: { width: target.naturalWidth, height: target.naturalHeight } },
                      );
                    }}
                    className="h-full w-full cursor-zoom-in object-cover"
                    /*
                      저장된 파일을 못 읽으면 blob(thumb)으로 한 번 더 시도하고, 그것도 없으면 숨깁니다 —
                      ReferenceImageUploader 와 같은 규칙(액박 대신 빈 칸).  막힌 경로는 콘솔에 남깁니다.
                    */
                    onError={(event) => {
                      const fallback = image.thumb;
                      if (fallback && event.currentTarget.src !== fallback) {
                        event.currentTarget.src = fallback;
                        return;
                      }
                      console.warn(
                        "그림을 읽지 못했습니다",
                        image.filePath,
                        event.currentTarget.src,
                      );
                      event.currentTarget.style.display = "none";
                    }}
                  />
                )}
              </div>
              <ImageActions
                image={image}
                onRemove={() => void remove(image)}
                onCrop={() => setCropTarget(image)}
              />
              <button
                type="button"
                onClick={() => setPrimary(image.id)}
                title={
                  image.isPrimary
                    ? "대표 이미지입니다 — 목록 카드와 스토리보드 칸에 이 장이 실립니다"
                    : "대표 이미지로"
                }
                // 왼쪽 위는 공통 「복사」 자리라 겹쳤습니다. 위 가운데로. (지시 255)
                //
                // 대표는 **늘 보입니다.** 마우스를 올려야만 보이면 여러 장 중 어느 것이
                // 스토리보드에 실릴지 알 수가 없어서, 한 장씩 짚어 보게 됩니다.
                className={`absolute left-1/2 top-1 z-10 -translate-x-1/2 rounded-full p-1 transition-opacity ${
                  image.isPrimary
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100"
                }`}
                style={{
                  background: "oklch(0 0 0 / 72%)",
                  color: image.isPrimary ? "oklch(0.84 0.16 85)" : "white",
                }}
              >
                <Star
                  className="h-3 w-3"
                  fill={image.isPrimary ? "currentColor" : "none"}
                />
              </button>
              <p
                className="mt-1 truncate text-[10px]"
                style={{ color: "oklch(0.55 0.01 265)" }}
              >
                {image.name}
              </p>
              {sizes[image.id] && (
                <p className="truncate font-mono text-[9px]" style={{ color: "oklch(0.44 0.01 265)" }}>
                  {sizeLabel(sizes[image.id])}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <ImageLightbox
          images={viewing.images}
          index={viewing.index}
          onClose={() => setViewing(null)}
        />
      )}

      {/* 합성 시트는 따로 보여 줍니다. 모델이 뽑아 준 그림과 성격이 달라서요. */}
      {sheets.length > 0 && (
        <CompositeSheetShelf
          sheets={sheets}
          label={assetLabel}
          onRename={(id, sheetLabel) =>
            onChange((current) =>
              current.map((image) =>
                image.id === id ? { ...image, sheetLabel } : image,
              ),
            )
          }
          onRemove={(id) => {
            const target = images.find((image) => image.id === id);
            if (target) void remove(target);
          }}
          // 정작 칸을 잘라내야 할 대상이 합성 시트입니다. (지시 215·217)
          onCrop={(id) => {
            const target = images.find((image) => image.id === id);
            if (target) setCropTarget(target);
          }}
        />
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold"
        style={{
          background: "oklch(1 0 0 / 5%)",
          color: "oklch(0.62 0.01 265)",
        }}
      >
        <ImagePlus className="h-3.5 w-3.5" /> 이미지 등록 — 폴더에서 끌어다
        놓아도 됩니다
      </button>

      {cropTarget && (
        <SheetPanelCropper
          open
          onOpenChange={(next) => {
            if (!next) setCropTarget(null);
          }}
          imageSrc={previewOf(cropTarget)}
          // 원본 경로는 이름 짓기용 — `냥이_클로즈업_001` 을 지우면 `냥이_클로즈업_지움_001`.
          sourcePath={cropTarget.filePath}
          kind={cropKind}
          ownerName={ownerName}
          stemPrefix={stem}
          projectName={projectName}
          assetType={`${assetType.split("-")[0]}-reference` as ProjectAssetType}
          // 표시한 그림·파노라마·지운 판은 원본 옆에 남아야 합니다. 앵커를 옮긴 판들을
          // 같은 목록에서 골라야 하니까요. 잘라낸 칸만 레퍼런스로 갑니다.
          markAssetType={assetType}
          initialMarks={
            cropTarget.filePath ? imageMarks[cropTarget.filePath] : undefined
          }
          spaceKind={spaceKind}
          faceSetSize={cropTarget.faceSetSize ?? faceSetSize}
          onSaved={(files) => {
            files.forEach((file) => {
              if (file.marks) setImageMarks(file.path, file.marks);
            });
            // 잘라낸 칸은 ref/ 에 저장되고 다음에 열 때 폴더 읽기가 줍습니다. 나머지(표시·파노라마·지운 판)는
            // 여기 뿌리 폴더에 있어 폴더 읽기가 안 보니 지금 등록해야 합니다.
            const kept = files.filter((file) => file.kind !== "crop");
            if (kept.length) {
              onChange((current) => [
                ...current,
                ...kept.map((file) => {
                  // 파노라마 탭이 6면을 저장하며 붙이는 면·세트 표. 없으면(옛 창) 이름 파싱이 보완합니다.
                  const faced = file as Partial<
                    Pick<GeneratedImageAsset, "face" | "faceSet">
                  >;
                  return {
                    // 예전에는 경로를 id 로 썼습니다. 다른 항목과 같은 uid 로 — 옛 항목의 경로 id 는 그대로 읽힙니다.
                    id: uid(),
                    name: file.name,
                    // 방금 구운 blob. `assetSrc(filePath)` 하나에만 기대다 그게 막히면 곧바로 액박이었습니다.
                    thumb: file.thumb ?? "",
                    file: null,
                    filePath: file.path,
                    face: faced.face,
                    faceSet: faced.faceSet,
                  };
                }),
              ]);
            }
          }}
        />
      )}
      <MagnificImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        projectName={projectName}
        assetType={assetType}
        ownerName={ownerName}
        stem={stem}
        onPicked={(filePath, name) =>
          onChange((current) => [
            // 가져온 것이 **대표**가 됩니다 — 방금 고른 것이 지금 쓰려는 것입니다.
            ...current.map((image) => ({ ...image, isPrimary: false })),
            { id: uid(), name, thumb: "", file: null, filePath, isPrimary: true },
          ])
        }
      />

    </div>
  );
}
