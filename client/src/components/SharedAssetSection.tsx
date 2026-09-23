import { useEffect } from "react";
import { Package, Plus } from "lucide-react";
import { newVisualAsset, type VisualAsset } from "@/lib/visualAsset";
import EntityLineagePanel from "@/components/project/EntityLineagePanel";
import AssetLineageDialogs from "@/components/project/AssetLineageDialogs";
import { LINEAGE_GRID } from "@/components/project/lineageGrid";
import { useEntityLineage } from "@/components/project/useEntityLineage";

/**
 * 공용 에셋.
 *
 * 여러 캐릭터·배경이 함께 쓰는 소품입니다. 같은 가방을 인물마다 다시 만들면
 * 조금씩 달라지고, 결국 한 작품 안에서 같은 물건이 여러 개가 됩니다.
 * 여기 한 번 만들어 두고 어느 시트에서든 불러 씁니다.
 *
 * 캐릭터 탭과 배경 탭에 같은 목록이 뜹니다. 한 곳에서 고치면 다른 곳도 같이 바뀝니다.
 * 시트 제작 창에서는 읽기 전용입니다 — 한 캐릭터에서 고친 것이 다른 캐릭터로
 * 번지면 어디서 바뀐 건지 찾을 방법이 없습니다.
 *
 * 지우기·변형 만들기·그림 떨구기 같은 계보 조작은 `useEntityLineage` 가
 * 맡습니다. 캐릭터·배경과 한 벌이라, 여기서 따로 고치면 안 됩니다(규칙 1).
 *
 * «공용 에셋 관리» 창은 없앴습니다(2026-09-08). 목록이 이미 계보 패널로 다 보이고,
 * 카드를 누르면 편집 창이 열리니 따로 열 창이 없었습니다.
 */
export default function SharedAssetSection({
  assets,
  projectName,
  onChange,
  openId,
  onOpened,
}: {
  assets: VisualAsset[];
  projectName: string;
  /** 지금 목록을 받아 다음 목록을 만드는 함수. 값으로 넘기면 안 됩니다 */
  onChange: (updater: (current: VisualAsset[]) => VisualAsset[]) => void;
  /**
   * 이 에셋의 편집 창을 **열어 둔 채로** 뜹니다.
   *
   * 구도잡기에서 소품의 에셋을 만들면
   * 곧바로 그 카드가 열려 있어야 합니다 — 목록만 뜨면 방금 만든 것을 다시 찾아 눌러야 합니다.
   */
  openId?: string | null;
  /** 창을 연 뒤 한 번 부릅니다 — 부르는 쪽이 «열어 달라» 표시를 지웁니다(다시 열리지 않게). */
  onOpened?: () => void;
}) {
  const lineage = useEntityLineage<VisualAsset>({
    kind: "asset",
    entities: assets,
    projectName,
    onChange,
  });
  const { setEditing, patchEntity: patchAsset } = lineage;

  useEffect(() => {
    if (!openId) return;
    setEditing({ entityId: openId, kind: "root" });
    onOpened?.();
    // openId 가 바뀔 때만 — setEditing 을 의존성에 넣으면 창을 닫아도 매 렌더마다 다시 열립니다.
  }, [openId]);

  // 만들자마자 편집 창을 엽니다 — 빈 카드만 생기면 «어디서 채우지?» 가 됩니다.
  const add = () => {
    const created = newVisualAsset();
    onChange((current) => [...current, created]);
    setEditing({ entityId: created.id, kind: "root" });
  };

  return (
    <>
      <section
        className="mt-6 rounded-xl p-4"
        style={{ background: "oklch(0.14 0.009 265)", border: "1px solid oklch(0.70 0.15 160 / 22%)" }}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Package className="h-4 w-4 shrink-0" style={{ color: "oklch(0.78 0.16 160)" }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">공용 에셋</p>
            <p className="text-xs" style={{ color: "oklch(0.48 0.01 265)" }}>
              여러 캐릭터·배경이 함께 쓰는 소품입니다. 시트를 만들 때 어디서든 불러 쓸 수 있습니다.
            </p>
          </div>
          {/* 추가 단추는 목록 끝 하나뿐 — 캐릭터 탭과 같은 규칙. */}
        </div>

        {assets.length === 0 ? (
          <p className="text-xs" style={{ color: "oklch(0.42 0.01 265)" }}>
            아직 등록된 공용 에셋이 없습니다.
          </p>
        ) : (
          /*
            캐릭터·배경과 같은 계보 패널을 씁니다.

            예전에는 네모 썸네일을 죽 늘어놓기만 했습니다. 그런데 에셋도
            「낡은 판」 「새 판」 처럼 갈라집니다. 평평한 목록으로 두면 어느
            것이 원본이고 어느 것이 거기서 나온 것인지 알 수가 없어요.
            인물·장소와 같은 것을 다르게 보여 줄 이유가 없습니다.
          */
          <div className={LINEAGE_GRID}>
            {assets.map((asset, index) => (
              <EntityLineagePanel
                key={asset.id}
                kind="asset"
                entityId={asset.id}
                name={asset.name}
                onNameChange={(name) => patchAsset(asset.id, () => ({ name }))}
                rootIndex={index + 1}
                rootImages={asset.generatedImages}
                variations={asset.variations || []}
                onOpenRoot={() => setEditing({ entityId: asset.id, kind: "root" })}
                onOpenVariation={(id) => setEditing({ entityId: asset.id, kind: "variation", id })}
                onBranch={(fromId) => lineage.branch(asset, fromId)}
                onRemoveVariation={(id) => void lineage.removeVariation(asset, id)}
                onRemove={() => void lineage.remove(asset)}
                onDropImages={(variationId, files) => lineage.dropImages(asset, variationId, files)}
                onSheetRename={(imageId, sheetLabel) => lineage.renameSheet(asset, imageId, sheetLabel)}
                // 공용 에셋은 시트를 만들지 않지만 옛 데이터에 시트가 남아 있을 수 있어 지우기는 같이 겁니다(규칙 1·3).
                onSheetRemove={(imageId) => void lineage.removeSheet(asset, imageId)}
              />
            ))}
          </div>
        )}

        {/* 위 단추까지 올라갔다 내려오지 않게 목록 끝에 둡니다. 캐릭터 탭의 «캐릭터 추가» 와 같은 자리. */}
        <button
          type="button"
          onClick={add}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-xs font-semibold"
          style={{ border: "2px dashed oklch(1 0 0 / 10%)", color: "oklch(0.72 0.14 160)" }}
        >
          <Plus className="h-3.5 w-3.5" /> 공용 에셋 추가
        </button>
      </section>

      {/* 원본·변형 편집 창. 보유 에셋과 같은 컴포넌트입니다 — 한쪽에만 기능이 생기지 않게. */}
      <AssetLineageDialogs
        lineage={lineage}
        rootIndexOf={(id) => assets.findIndex((item) => item.id === id) + 1}
      />
    </>
  );
}
