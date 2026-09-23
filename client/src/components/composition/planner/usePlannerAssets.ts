import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  objectGroupsOf,
  patchObjectGroupIn,
  setObjectSwapIn,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import { newVisualAsset, type VisualAsset } from "@/lib/visualAsset";
import type { CompositionState } from "@/lib/composition";
import type { Background, Character } from "@/lib/projectTypes";

/**
 * **소품에 걸 «바꿔 그릴 시트»** — 고를 목록과, 자리에서 바로 에셋 카드를 만드는 길.
 *
 * 2026-09-18 에 `CompositionPlanner.tsx` 에서 떼어 냈습니다. 목록을 만드는 곳과
 * 카드를 만드는 곳이 한 흐름인데 — 고를 것이 없으면 만들고, 만들면 목록에 생깁니다 —
 * 창 본문에서는 둘 사이에 다른 것이 끼어 있었습니다.
 */
export function usePlannerAssets({
  state,
  setState,
  characters,
  backgrounds,
  sharedAssets,
  onChangeSharedAssets,
}: {
  state: CompositionState;
  setState: UpdateComposition;
  characters: Character[];
  backgrounds: Background[];
  sharedAssets?: VisualAsset[];
  /** 안 주면 «에셋 만들기» 가 아무 일도 안 합니다(그 단추도 안 보입니다). */
  onChangeSharedAssets?: (updater: (current: VisualAsset[]) => VisualAsset[]) => void;
}) {
  /**
   * 소품을 **바꿔 그릴 시트** 목록 — 프로젝트의 인물·배경과 거기 붙은 에셋.
   *
   * 에셋은 인물·배경에 매달려 있으므로(`character.assets`) 한 줄로 펴서 「누구의 무엇」
   * 으로 보여 줍니다 — 「가방」 이 둘일 때 어느 쪽인지 알아야 하니까요.
   */
  const swapOptions = useMemo(() => {
    const list: {
      kind: "character" | "asset" | "background";
      id: string;
      name: string;
      group: string;
    }[] = [];
    for (const person of characters) {
      list.push({
        kind: "character",
        id: person.id,
        name: person.name,
        group: "인물",
      });
      for (const asset of person.assets ?? [])
        list.push({
          kind: "asset",
          id: asset.id,
          name: asset.name,
          group: person.name,
        });
    }
    for (const place of backgrounds) {
      list.push({
        kind: "background",
        id: place.id,
        name: place.name,
        group: "배경",
      });
      for (const asset of place.assets ?? [])
        list.push({
          kind: "asset",
          id: asset.id,
          name: asset.name,
          group: place.name,
        });
    }
    /*
      공용 에셋도 목록에 넣습니다 — 구도잡기에서 «이 소품의 에셋 만들기» 로 만든 것이 여기(공용)로 들어가므로,
      빠뜨리면 방금 만든 에셋이 선택칸에 안 보입니다.
    */
    for (const asset of sharedAssets ?? [])
      list.push({ kind: "asset", id: asset.id, name: asset.name, group: "공용" });
    return list;
  }, [characters, backgrounds, sharedAssets]);

  /*
    ── 소품 → 에셋 시트 ──────────────────────────────────────────────────
    

    소품을 놓은 자리에서 에셋 카드를 만들고 **바로 잇습니다**. 이미 이어 둔 것이 있으면 그 카드를 엽니다 —
    에셋을 만들러 다른 화면으로 갔다 오면 무엇을 만들러 갔는지 잊고, 돌아와 다시 골라야 합니다.
  */
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [openAssetId, setOpenAssetId] = useState<string | null>(null);
  const createAssetForObject = (objectId: string, label: string) => {
    if (!onChangeSharedAssets) return;
    const object = state.objects.find((item) => item.id === objectId);
    const linked = object?.swapRef?.kind === "asset" ? object.swapRef.id : null;
    if (linked) {
      setOpenAssetId(linked);
      setAssetsOpen(true);
      return;
    }
    const created = { ...newVisualAsset(), name: label?.trim() || "소품" };
    onChangeSharedAssets((current) => [...current, created]);
    setState((current) =>
      setObjectSwapIn(current, objectId, { kind: "asset", id: created.id, name: created.name }),
    );
    setOpenAssetId(created.id);
    setAssetsOpen(true);
    toast.success(`«${created.name}» 에셋을 만들어 이 소품에 걸었습니다.`, {
      description: "열린 카드에서 프롬프트를 뽑고 시트를 만들면 그대로 이 소품이 됩니다",
    });
  };

  /**
   * 덩어리 쪽 «에셋 만들기». 소품 하나짜리와 **같은 흐름**이되 이어 두는 자리가 묶음입니다.
   *
   * 의자 넷을 «식탁 세트» 로 묶었으면
   * 프롬프트에도 그 에셋 하나로 실려야 @ 로 링크를 겁니다.
   */
  const createAssetForGroup = (groupId: string, label: string) => {
    if (!onChangeSharedAssets) return;
    const group = objectGroupsOf(state).find((item) => item.id === groupId);
    const linked = group?.swapRef?.kind === "asset" ? group.swapRef.id : null;
    if (linked) {
      setOpenAssetId(linked);
      setAssetsOpen(true);
      return;
    }
    const created = { ...newVisualAsset(), name: label?.trim() || "덩어리" };
    onChangeSharedAssets((current) => [...current, created]);
    setState((current) =>
      patchObjectGroupIn(current, groupId, {
        swapRef: { kind: "asset", id: created.id, name: created.name },
      }),
    );
    setOpenAssetId(created.id);
    setAssetsOpen(true);
    toast.success(`«${created.name}» 에셋을 만들어 이 덩어리에 걸었습니다.`, {
      description: "열린 카드에서 프롬프트를 뽑고 시트를 만들면 그대로 이 덩어리가 됩니다",
    });
  };

  return {
    /** 소품 고르개에 세울 목록. */
    swapOptions,
    assetsOpen,
    setAssetsOpen,
    openAssetId,
    setOpenAssetId,
    createAssetForObject,
    createAssetForGroup,
  };
}
