import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  backgroundColorOf,
  assessCrossFaces,
  measureCrossFaces,
  cutCrossFaces,
  looksLikeCrossUnfold,
} from "@/lib/crossUnfold";
import { crossUnfoldWarning } from "@/lib/crossUnfoldWarnings";
import { t } from "@/lib/i18n";
import { saveFaceSet } from "@/lib/faceSetSave";
import { faceFileToken } from "@/lib/faceSets";
import { assetSrc, loadImageForCanvas, type ProjectAssetType } from "@/lib/mediaLibrary";
import { isDesktopApp } from "@/lib/llm";
import { uid, type FaceSetSize, type GeneratedImageAsset } from "@/lib/projectTypes";
import { withFaceSetSize } from "@/lib/pngMeta";
import {
  PANORAMA_CHIP_ID,
  PANORAMA_INTERIOR_CHIP_ID,
  ROOM_OUTER_CHIP_ID,
  ROOM_INNER_CHIP_ID,
  CUBEMAP_CHIP_ID,
  OUTDOOR_DEFAULT_SIDE,
  outdoorFaceSetSize,
  unfoldSpaceFromPrompt,
  blueprintForSpace,
  spaceForChips,
  panoramaBoxOf,
  panoramaDistances,
  spaceFitsChip,
  type BlueprintRouteMark,
  type PanoramaSpace,
  type SpaceKind,
} from "@/lib/blueprint";
import { boxFacesFromEquirect, cubeFacesFromEquirect, nativeFaceSize } from "@/lib/panorama";
import type { CompositionCubeFace } from "@/lib/composition";

/**
 * 카드가 등장방형 칩을 켜 두었을 때 넘기는 것. 없으면 등장방형 자동 자르기는 안 합니다.
 *
 * 예전엔 아니었습니다
 * (가위 → 파노라마 탭 → «여섯 면 만들기» 를 손으로). 전개도와 같은 자리에서 자동으로 합니다.
 */
export interface AutoEquirect {
  /** 실내 등장방형 칩이면 방 상자로, 실외면 정육면체로 자릅니다. */
  indoor: boolean;
  space?: PanoramaSpace | null;
  /** 정체성 그림 위 앵커 — 실내에서 벽까지 거리를 셀 때. */
  marks?: BlueprintRouteMark[] | null;
  /**
   * «방 바깥쪽 · 외벽 전개도» 칩 — 등장방형은 안 자르고, 들어온 **전개도**를 «<접두>_외벽» 세트로 저장합니다.
   * 접두가 달라야 구도잡기에서 안쪽 세트와 갈리고, 세트를 걸 때 바깥 껍질로 들어갑니다(`usePlannerMedia`).
   */
  outer?: boolean;
  /**
   * 등장방형 투영으로 자를 것인가(옛 등장방형 칩). 전개도 칩은 false — 16:9 로 들어온 십자 전개도를 파노라마로
   * 잘못 읽어 투영해 버리면 안 됩니다.
   */
  projection?: boolean;
  /** 잘라 낸 세트에 붙일 공간 크기(`GeneratedImageAsset.faceSetSize`). */
  stamp?: FaceSetSize | null;
}

/** 카드의 구성 칩에서 등장방형 자동 자르기 설정을 만듭니다. 등장방형 칩이 없으면 null. 장소 카드·변형 창이 같이 씁니다. */
export function autoEquirectOf(
  blueprint: string[] | undefined,
  spaceKind: SpaceKind | null | undefined,
  room: PanoramaSpace | null | undefined,
  exterior: PanoramaSpace | null | undefined,
  marks: BlueprintRouteMark[] | null | undefined,
  /**
   * 카드의 지금 프롬프트(en·ko). 적힌 크기가 있으면 **그 크기**가 세트 크기입니다.
   *
   * 사용자 2026-09-16: 50 m 로 프롬프트를 뽑아 그림을 받은 뒤 칸의 한 변을 100 으로 바꿔 두자, 세트가 100 m 방으로 서서 나무가
   * 사람의 두 배로 커 보였습니다. 그림이 담은 공간은 생성기가 읽은 프롬프트의 크기이지 지금 칸의 값이 아닙니다.
   */
  promptText?: string | null,
): AutoEquirect | null {
  const chips = blueprintForSpace(blueprint, spaceKind);
  const written = unfoldSpaceFromPrompt(chips, promptText);
  const space = written ?? spaceForChips(chips, room, exterior);
  const roomStamp = spaceFitsChip(PANORAMA_INTERIOR_CHIP_ID, space) ? panoramaBoxOf(space, true) : null;
  if (chips.includes(ROOM_OUTER_CHIP_ID))
    return { indoor: true, outer: true, space: space ?? null, marks: marks ?? null, stamp: roomStamp };
  if (chips.includes(ROOM_INNER_CHIP_ID))
    return { indoor: true, space: space ?? null, marks: marks ?? null, stamp: roomStamp };
  if (chips.includes(CUBEMAP_CHIP_ID)) {
    const side = space && space.width > 0 ? space.width : OUTDOOR_DEFAULT_SIDE;
    return { indoor: false, space: space ?? null, marks: marks ?? null, stamp: outdoorFaceSetSize(side) };
  }
  /*
    등장방형 칩은 걷었습니다(2차는 전개도 세 벌). 전개도는 칩과 상관없이 늘 자동으로 잘리므로 여기서 할 일은
    «외벽» 표시뿐입니다. 등장방형 자르기(`cutEquirect`)는 옛 저장값이 등장방형으로 남은 경우를 위해 코드만 둡니다 —
    `blueprintForSpace` 가 옛 id 를 전개도로 읽어 실제로는 타지 않습니다.
  */
  if (chips.includes(PANORAMA_INTERIOR_CHIP_ID)) return { indoor: true, projection: true, space: space ?? null, marks: marks ?? null };
  if (chips.includes(PANORAMA_CHIP_ID)) return { indoor: false, projection: true, space: space ?? null, marks: marks ?? null };
  return null;
}

const SETTING_KEY = "frameforge.autoUnfold";

/**
 * 자동 커팅을 켤 것인가. 기본은 **켜짐**.
 *
 * 끄는 길을 두는 까닭: 판정이 아무리 조여도 «전개도로 보이는데 아닌 그림» 이 언젠가
 * 나옵니다. 그때 사용자가 설정에서 끄고 손으로 자를 수 있어야 합니다.
 */
export function getAutoUnfoldEnabled(): boolean {
  try {
    return window.localStorage.getItem(SETTING_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoUnfoldEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(SETTING_KEY, on ? "on" : "off");
  } catch {
    /* 저장 공간이 없으면 이번 판만 못 기억합니다. */
  }
}

/**
 * 전개도가 들어오면 **자동으로 여섯 면을 잘라 저장합니다.**
 *
 * 전개도는 우리가 프롬프트를 정해 뽑으므로 판 배치가 늘 같습니다(가로 십자). 그러니
 * 사람이 창을 열어 선을 확인하고 저장을 누르는 일은 **매번 같은 손놀림**입니다.
 * 그림이 카드에 붙는 순간 여기서 대신 합니다.
 *
 * # 어디에 걸었나 — 카드 하나
 *
 * 그림이 들어오는 길은 여럿입니다(선반에 떨구기 · 후보함 채택 · 로컬로 뽑기 · 폴더 읽기).
 * 길마다 걸면 새 길이 생길 때 빠뜨립니다. 그래서 **카드가 제 그림 목록을 지켜보다가**
 * 아직 안 자른 전개도를 보면 자릅니다 — 어느 길로 들어왔든 걸립니다(공통 규칙 1).
 *
 * # 조용히 잘못 자르지 않습니다
 *
 * `looksLikeCrossUnfold` 가 **네 가지를 다** 만족할 때만 «전개도» 로 봅니다 — 회색 바탕 위
 * 십자, 여섯 칸이 전부 그려짐, 칸마다 색이 여러 가지(마그니픽에 올리는 «전개도 틀» 은
 * 면마다 단색이라 여기서 걸립니다), 네 귀퉁이가 빔. 애매하면 아무것도 안 합니다 — 놓친
 * 전개도는 사람이 가위로 열어 자르면 되지만, 잘못 자른 그림은 폴더에 파일 여섯 개와
 * 세트 카드를 남깁니다.
 *
 * 실측(2026-09-15)으로 실내 안쪽·바깥·실외 전개도 셋은 전부 잡고, 전개도 틀은 «단색» 에서
 * 걸러 내는 것을 확인했습니다.
 *
 * # 전개도 원본은 그대로 둡니다
 *
 * 자른 뒤에도 전개도는 목록에 남습니다 — 다시
 * 자르거나, 선을 고쳐 다시 뽑을 때 그것이 재료입니다. 대신 `unfoldedAt` 을 찍어 **두 번
 * 자르지 않습니다.* */
export function useAutoUnfold(options: {
  /** 이 카드의 생성 이미지. 전개도를 여기서 찾습니다. */
  images: GeneratedImageAsset[] | undefined;
  patch: (
    updater: (current: { generatedImages: GeneratedImageAsset[] }) => {
      generatedImages: GeneratedImageAsset[];
    },
  ) => void;
  projectName: string;
  assetType: ProjectAssetType;
  ownerName: string;
  /** 파일 이름 앞부분 — «장소» 또는 «장소_변형». */
  prefix: string;
  spaceKind?: SpaceKind | null;
  /** 꺼 두면 아무것도 하지 않습니다. 안 주면 설정 값을 봅니다. */
  enabled?: boolean;
  /** 등장방형 칩을 켠 카드면 넘깁니다 — 2:1 그림을 여섯 면으로 자릅니다. */
  equirect?: AutoEquirect | null;
  /**
   * 잘라 낸 여섯 장을 **다른 목록**에 붙일 때. 변형 창은 잘라 낸 칸을 원본의 생성 이미지로 보냅니다
   * (`cropSave.onSaved` 와 같은 규칙 — 위 줄에 떠야 어느 변형에서든 집을 수 있음). 없으면 이 카드 목록에.
   */
  onSaved?: (added: GeneratedImageAsset[]) => void;
  /**
   * 켜면 **처음 볼 때 이미 있던 그림은 건드리지 않고** 그 뒤에 들어온 그림만 봅니다.
   *
   * 변형 창에는 이 훅을 늦게 붙였습니다. 그대로 걸면 창을 여는 순간 예전에 뽑아 손으로 이미 잘라 둔 파노라마·전개도까지
   * 다시 잘라 «6면» 폴더에 같은 세트가 또 생깁니다. 표시(`unfoldedAt`)도 안 찍습니다 — 옛 그림을 «아님» 으로 굳히지 않게.
   */
  onlyNew?: boolean;
}) {
  const {
    images,
    projectName,
    assetType,
    ownerName,
    prefix,
    spaceKind,
    enabled = getAutoUnfoldEnabled(),
  } = options;

  /*
    **한 번에 하나, 그리고 본 것은 다시 안 봅니다.**

    effect 는 목록이 바뀔 때마다 돕니다. 자르는 중에 6면 여섯 장이 목록에 붙으면서 다시
    돌기 때문에, 붙잡아 두지 않으면 같은 전개도를 여러 번 자릅니다.
  */
  const working = useRef(false);
  const tried = useRef(new Set<string>());
  const patchRef = useRef(options.patch);
  patchRef.current = options.patch;
  const onSavedRef = useRef(options.onSaved);
  onSavedRef.current = options.onSaved;
  const equirect = options.equirect ?? null;
  /*
    실내 등장방형인데 방 크기가 비어 있어 **기다리는 그림**. 표시를 찍지 않고 넘어갔다가, 크기가 바뀌면
    (`spaceKey` 가 달라지면) 다시 봅니다. 표시를 찍어 버리면 크기를 넣은 뒤에도 영영 안 자릅니다.
  */
  const waiting = useRef(new Map<string, string>());
  const baseline = useRef<Set<string> | null>(null);
  const spaceKey = equirect
    ? `${equirect.indoor ? "in" : "out"}|${JSON.stringify(equirect.space ?? null)}|${JSON.stringify(equirect.marks ?? null)}`
    : "none";

  useEffect(() => {
    if (!enabled) {
      // 꺼져 있던 동안의 그림도 «처음부터 있던 것» 입니다 — 다시 켜질 때(창을 다시 열 때) 새로 잽니다.
      baseline.current = null;
      return;
    }
    if (options.onlyNew && !baseline.current) {
      baseline.current = new Set((images || []).map((image) => image.id));
      baseline.current.forEach((id) => tried.current.add(id));
    }
    if (working.current) return;
    // 브라우저에서는 폴더에 못 씁니다. 돌려 봐야 «저장하지 못했습니다» 만 뜹니다.
    if (!isDesktopApp()) return;
    if (!projectName.trim() || !ownerName.trim() || !prefix.trim()) return;

    // 크기가 바뀌었으면 기다리던 그림을 다시 후보로.
    for (const [id, key] of waiting.current) {
      if (key !== spaceKey) {
        waiting.current.delete(id);
        tried.current.delete(id);
      }
    }
    const candidate = (images || []).find(
      (image) =>
        image.filePath &&
        !image.unfoldedAt &&
        // 6면 세트에서 잘라 낸 낱장은 다시 자를 것이 아닙니다.
        !image.face &&
        !image.isCompositeSheet &&
        !tried.current.has(image.id),
    );
    if (!candidate?.filePath) return;

    let alive = true;
    working.current = true;
    tried.current.add(candidate.id);

    const run = async () => {
      const source = await loadImageForCanvas(
        assetSrc(candidate.filePath) || candidate.thumb,
      ).catch(() => null);
      if (!alive || !source) return;

      /*
        ── 등장방형 ─────────────────────────────────────────────────────────
        전개도 판정보다 **먼저** 봅니다. 전개도 판정은 아니면 «아님» 표시를 찍어 두 번 안 보므로, 순서가 바뀌면
        파노라마가 «전개도 아님» 으로 찍힌 채 영영 안 잘립니다. 가로세로비 1.6~2.2 만 받습니다 — 마그니픽은
        2:1 을 시켜도 2752×1536(1.79)로 줍니다(실측). 그래도 경도·위도를 가로·세로에 그대로 펴 둔 그림이라
        그대로 읽으면 됩니다(이 그림으로 숲 여섯 면을 만들어 확인).
      */
      const naturalWidth = source.naturalWidth || source.width;
      const naturalHeight = source.naturalHeight || source.height;
      const ratio = naturalWidth / Math.max(1, naturalHeight);
      if (equirect?.projection && ratio >= 1.6 && ratio <= 2.2) {
        await cutEquirect(source, naturalWidth, naturalHeight);
        return;
      }

      const lines = looksLikeCrossUnfold(source);
      // 전개도가 아니면 조용히 넘어갑니다. 대부분의 그림이 여기서 끝납니다.
      if (!lines) {
        markChecked(candidate.id);
        return;
      }

      const background = backgroundColorOf(source);
      const faces = cutCrossFaces(source, lines, { background, targetSize: equirect?.stamp });
      if (faces.length < 6) {
        // 선은 찾았는데 여섯 칸이 안 나오면 사람이 손으로 맞추는 편이 낫습니다.
        markChecked(candidate.id);
        toast.message("전개도로 보이는데 여섯 칸을 다 자르지 못했습니다", {
          description: `${candidate.name} — 가위로 열어 «전개도» 탭에서 선을 맞춰 주세요.`,
        });
        return;
      }

      const inspection = assessCrossFaces(measureCrossFaces(faces, background), equirect?.stamp);
      if (!inspection.safe) {
        // 원본은 등록된 채로 둡니다. 누락된 후면을 둘로 쪼개 만들어 자동으로 방에 입히면 문이 크게 늘어납니다.
        markChecked(candidate.id);
        toast.warning(t("전개도 경계를 확인해 주세요 — 자동 6면 저장을 보류했습니다"), {
          description: `${candidate.name}\n${inspection.issues.map((issue) => crossUnfoldWarning(issue, spaceKind)).join("\n")}\n${t("원본은 그대로 있습니다. 가위 → 전개도에서 선을 맞추거나, 빠진 면을 포함해 다시 생성하세요.")}`,
          duration: 15000,
        });
        return;
      }

      const files = [];
      for (const cut of faces) {
        const drawn = await new Promise<Blob | null>((resolve) =>
          cut.canvas.toBlob(resolve, "image/png"),
        );
        if (!drawn) continue;
        // 공간 크기를 그림 파일에도 — 폴더에서 읽은 세트도 크기를 알게(`pngMeta` 머리말).
        const blob = equirect?.stamp ? await withFaceSetSize(drawn, equirect.stamp) : drawn;
        const token = faceFileToken(cut.face, spaceKind);
        files.push({
          file: new File([blob], `${token}.png`, { type: "image/png" }),
          face: cut.face,
        });
      }
      if (!alive || files.length < 6) {
        markChecked(candidate.id);
        return;
      }

      const result = await saveFaceSet({
        files,
        projectName,
        assetType,
        ownerName,
        // 외벽 전개도면 «<접두>_외벽» — 안쪽 세트와 이름으로 갈립니다.
        prefix: equirect?.outer ? `${prefix}_외벽` : prefix,
        spaceKind,
      });
      if (!alive) return;

      if (!result.saved.length) {
        markChecked(candidate.id);
        toast.error("6면을 저장하지 못했습니다", {
          description:
            result.stoppedBecause ??
            "저장 폴더가 설정되어 있는지 확인해 주세요.",
        });
        return;
      }

      /*
        잘라 낸 여섯 장을 목록에 붙이고, 전개도에는 «잘랐다» 를 찍습니다.
        **한 번의 patch 로** 합니다 — 두 번 나눠 부르면 뒤 호출이 앞 호출을 덮어씁니다.
      */
      const stamp = new Date().toISOString();
      const added = result.saved.map((file) => ({
        id: uid(),
        name: file.name,
        thumb: file.thumb ?? "",
        file: null,
        filePath: file.path,
        face: file.face,
        faceSet: file.faceSet,
        // 이 세트를 어떤 크기의 공간으로 뽑았는지 — 구도잡기가 세트를 걸 때 방을 이 크기로 세웁니다.
        ...(equirect?.stamp ? { faceSetSize: equirect.stamp } : {}),
      }));
      const onSaved = onSavedRef.current;
      // 변형 창은 잘라 낸 칸을 원본의 생성 이미지로 보냅니다(`onSaved`). 한 번의 patch 로 — 나눠 부르면 뒤가 앞을 덮습니다.
      patchRef.current((current) => ({
        generatedImages: [
          ...current.generatedImages.map((image) =>
            image.id === candidate.id ? { ...image, unfoldedAt: stamp } : image,
          ),
          ...(onSaved ? [] : added),
        ],
      }));
      onSaved?.(added);

      toast.success(`${equirect?.outer ? "외벽 " : ""}전개도를 6면으로 잘라 저장했습니다 — ${result.saved.length}장`, {
        description: `${candidate.name} · «6면» 폴더에 한 세트로. 전개도 원본은 그대로 둡니다`,
      });
    };

    void run()
      .catch((error) => {
        markChecked(candidate.id);
        toast.error("자동 6면 커팅에 실패했습니다", {
          description: String(error),
        });
      })
      .finally(() => {
        working.current = false;
      });

    /** 등장방형 한 장 → 여섯 면. 실내는 방 상자, 실외는 정육면체(카메라가 한가운데). */
    async function cutEquirect(source: HTMLImageElement, naturalWidth: number, naturalHeight: number) {
      if (!equirect || !candidate) return;
      const faceSpaceKind: SpaceKind = equirect.indoor ? "interior" : "exterior";
      let canvases: Record<CompositionCubeFace, HTMLCanvasElement> | null = null;
      if (equirect.indoor) {
        if (!spaceFitsChip(PANORAMA_INTERIOR_CHIP_ID, equirect.space)) {
          waiting.current.set(candidate.id, spaceKey);
          toast.message("실내 등장방형 — 방 크기를 넣으면 여섯 면으로 자릅니다", {
            description: `${candidate.name} · «2차 · 앵커에서 보기» 의 가로·깊이·층고를 넣으면 곧바로 네 벽·천장·바닥으로 잘립니다.`,
            id: `equirect-wait-${candidate.id}`,
          });
          return;
        }
        const box = panoramaBoxOf(equirect.space, true);
        const d = panoramaDistances(box, equirect.marks);
        // 가장 긴 변을 원본 가로의 절반까지(1024~4096) — 90° 한 면이 가로의 1/4 이라 벽 한 장에 두 배쯤이면 넉넉합니다.
        const longest = Math.min(4096, Math.max(1024, Math.round(naturalWidth / 2)));
        canvases = boxFacesFromEquirect(
          source,
          { ahead: d.ahead, right: d.right, behind: d.behind, left: d.left, height: box.height, eye: 1.6 },
          longest,
        );
      } else {
        /*
          실외는 **카메라가 한가운데인 정육면체** — 먼 풍경은 카메라를 따라다니는 배경이라 90° 면이 맞습니다
          (파노라마 탭의 «여섯 면 만들기» 와 같은 결과). 한 변 길이는 프롬프트의 거리 단서에만 씁니다.
        */
        const read = document.createElement("canvas");
        read.width = naturalWidth;
        read.height = naturalHeight;
        read.getContext("2d", { willReadFrequently: true })?.drawImage(source, 0, 0);
        canvases = cubeFacesFromEquirect(read, Math.max(1024, nativeFaceSize(naturalWidth)));
      }
      if (!alive || !canvases) return;

      const files = [];
      for (const face of ["front", "back", "left", "right", "top", "bottom"] as CompositionCubeFace[]) {
        const canvas = canvases[face];
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) continue;
        const token = faceFileToken(face, faceSpaceKind);
        files.push({ file: new File([blob], `${token}.png`, { type: "image/png" }), face });
      }
      if (!alive || files.length < 6) {
        markChecked(candidate.id);
        return;
      }
      const result = await saveFaceSet({ files, projectName, assetType, ownerName, prefix, spaceKind: faceSpaceKind });
      if (!alive) return;
      if (!result.saved.length) {
        markChecked(candidate.id);
        toast.error("6면을 저장하지 못했습니다", {
          description: result.stoppedBecause ?? "저장 폴더가 설정되어 있는지 확인해 주세요.",
        });
        return;
      }
      const stamp = new Date().toISOString();
      const added = result.saved.map((file) => ({
        id: uid(),
        name: file.name,
        thumb: file.thumb ?? "",
        file: null,
        filePath: file.path,
        face: file.face,
        faceSet: file.faceSet,
      }));
      const onSaved = onSavedRef.current;
      // 한 번의 patch 로 — 두 번 나눠 부르면 뒤 호출이 앞 호출을 덮어씁니다(아래 전개도와 같은 까닭).
      patchRef.current((current) => ({
        generatedImages: [
          ...current.generatedImages.map((image) =>
            image.id === candidate.id ? { ...image, unfoldedAt: stamp } : image,
          ),
          ...(onSaved ? [] : added),
        ],
      }));
      onSaved?.(added);
      const box = equirect.indoor && equirect.space ? panoramaBoxOf(equirect.space, true) : null;
      toast.success(`등장방형을 6면으로 잘라 저장했습니다 — ${result.saved.length}장`, {
        description: box
          ? `${candidate.name} · 방 ${box.width}×${box.depth}×${box.height} m 의 네 벽·천장·바닥으로. 원본 파노라마는 그대로 둡니다`
          : `${candidate.name} · 정육면체 여섯 면(하늘·땅 포함). 원본 파노라마는 그대로 둡니다`,
      });
    }

    /** 전개도가 아니었던 그림에도 표시를 남깁니다 — 열 때마다 다시 재지 않게. */
    function markChecked(id: string) {
      if (!alive) return;
      patchRef.current((current) => ({
        generatedImages: current.generatedImages.map((image) =>
          image.id === id
            ? { ...image, unfoldedAt: image.unfoldedAt ?? "not-unfold" }
            : image,
        ),
      }));
    }

    return () => {
      alive = false;
    };
    // equirect 는 매 렌더 새 객체라 deps 에 넣지 않고 `spaceKey` 로 대신합니다 — 넣으면 렌더마다 효과가 다시 돕니다.
  }, [images, projectName, assetType, ownerName, prefix, spaceKind, enabled, spaceKey]);
}
