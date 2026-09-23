import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Scissors } from "lucide-react";
import { assetSrc } from "@/lib/mediaLibrary";
import FaceSetCard from "@/components/FaceSetCard";
import { splitFaceSets } from "@/lib/faceSets";
import {
  readImageSize,
  SHEET_SOURCE_MIME,
  type SheetSource,
  type SheetSourceGroup,
} from "@/components/sheet/sheetSources";

/**
 * 시트 창 왼쪽의 «넣을 그림» 목록.
 *
 * 그룹(원본 → 변형 → 다른 원본 → 보유 에셋 → 공용 에셋)마다 머리줄을 두고 접을 수 있습니다.
 * 에셋까지 한
 * 목록에 섞어 두면 어느 것이 인물 그림이고 어느 것이 소품인지 알 수 없어 그룹으로
 * 나누고 타일에 «보유»/«공용» 배지를 붙입니다.
 *
 * 타일은 **누르면** 시트에 놓이고(계단식 자리), **끌어서** 배치 상자 위에 놓으면
 * 그 칸의 그림이 바뀝니다.
 *
 * 가위(오른쪽 아래 — `ImageActions` 의 자리 규칙)는 시트 창 안에서 그 그림을
 * 자르기·지우기 창으로 엽니다.
 *
 * 6면 세트는 낱장 여섯으로 늘어놓지 않고 세트 카드 한 장(선반과 같은 카드)으로 둡니다.
 * 시트에는 낱장을 놓아야 하므로 카드의 **셀 하나** 를 누르거나 끌면 그 면만 놓입니다.
 */

const GROUP_ORDER: SheetSourceGroup[] = ["원본", "변형", "다른 원본", "보유 에셋", "공용 에셋"];

const BADGE: Partial<Record<SheetSourceGroup, string>> = {
  "다른 원본": "원본",
  "보유 에셋": "보유",
  "공용 에셋": "공용",
};

export default function SheetSourcePanel({
  sources,
  onAdd,
  onEdit,
  legacyFaceSets = false,
}: {
  /** 아직 시트에 놓이지 않은 그림들 */
  sources: SheetSource[];
  /** 타일을 눌렀을 때. 시트 빈자리에 놓습니다 */
  onAdd: (source: SheetSource) => void;
  /** 가위. 없으면 가위가 안 뜹니다 */
  onEdit?: (source: SheetSource) => void;
  /**
   * `6면/` 밖(옛 프로젝트 뿌리)의 `…_정면_001` 도 세트로 묶을지. 배경에서만 켭니다 — 인물·에셋은
   * «정면»·«후면» 칩으로 자른 칸이 같은 꼴이라 켜면 낱장이 세트 카드로 접힙니다(`FaceSetOptions.legacy`).
   */
  legacyFaceSets?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /*
    타일 밑에 보여 줄 그림의 뽑힌 px 크기. 시트 칸이 이 크기 그대로 들어가므로
     원본 크기를 알아야 4000 시트에 몇 장
    들어가는지 가늠할 수 있습니다. 한 번 읽은 것은 id 로 캐시하고, 읽는 중인 것은 ref 로
    막습니다 — 목록이 다시 그려질 때마다 같은 파일을 또 읽지 않게.

    못 읽은 것(null)도 캐시합니다. 파일이 지워졌거나 blob thumb 이 앱 재시작으로 죽은 그림은
    실패를 안 남기면 칸에 놓거나 뺄 때마다(id 목록이 바뀔 때마다) 또 열어 또 실패하고, 타일은
    영원히 «읽는 중» 으로 보입니다(검토 2026-09-08).
  */
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number } | null>>({});
  const probing = useRef(new Set<string>());
  useEffect(() => {
    for (const source of sources) {
      if (source.id in sizes || probing.current.has(source.id)) continue;
      probing.current.add(source.id);
      // 목록이 바뀌어도 읽던 것은 끝까지 받아 둡니다 — 타일이 잠깐 빠졌다 다시 들어오면(놓았다 뺌) 또 읽지 않게.
      void readImageSize(source).then((natural) => {
        probing.current.delete(source.id);
        setSizes((current) => ({
          ...current,
          [source.id]: natural ? { w: natural.width, h: natural.height } : null,
        }));
      });
    }
    // sources 배열은 부르는 쪽이 렌더마다 새로 만듭니다. id 목록이 같으면 다시 돌지 않게 합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.map((item) => item.id).join("|")]);

  // 그룹 머리 = «그룹 · 세부». 변형·에셋은 이름마다 따로 묶입니다.
  const groups: { key: string; title: string; group: SheetSourceGroup; items: SheetSource[] }[] = [];
  for (const group of GROUP_ORDER) {
    for (const source of sources) {
      if (source.group !== group) continue;
      const key = `${group}|${source.groupDetail || ""}`;
      let bucket = groups.find((item) => item.key === key);
      if (!bucket) {
        bucket = {
          key,
          title: source.groupDetail ? `${group} · ${source.groupDetail}` : group,
          group,
          items: [],
        };
        groups.push(bucket);
      }
      bucket.items.push(source);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold" style={{ color: "oklch(0.48 0.01 265)" }}>
        넣을 그림
      </p>
      {sources.length === 0 && (
        <p className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
          전부 놓았습니다.
        </p>
      )}
      {groups.map((bucket) => {
        const closed = collapsed[bucket.key];
        const badge = BADGE[bucket.group];
        return (
          <div key={bucket.key} className="space-y-1">
            <button
              type="button"
              onClick={() => setCollapsed((current) => ({ ...current, [bucket.key]: !current[bucket.key] }))}
              className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] font-semibold hover:bg-white/5"
              style={{ color: "oklch(0.60 0.01 265)" }}
              title={closed ? "펼치기" : "접기"}
              data-tour="sheet-source-groups"
            >
              {closed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{bucket.title}</span>
              <span className="shrink-0 opacity-60">{bucket.items.length}</span>
            </button>
            {!closed && (
              <div className="grid grid-cols-2 gap-1.5">
                {(() => {
                  const { sets, singles } = splitFaceSets(bucket.items, { legacy: legacyFaceSets });
                  return (
                    <>
                      {sets.map((set) => (
                        // FaceSetCard 는 모르는 속성을 넘겨받지 않아, 튜토리얼이 가리킬 자리를 감싸개로 둡니다.
                        <div key={set.id} data-tour="sheet-face-set">
                          <FaceSetCard
                            set={set}
                            cellHeight={28}
                            title={`${set.label} — 면 하나를 누르면 그 면이 시트에 놓입니다. 칸 위로 끌어다 놓아도 됩니다`}
                            onFaceClick={(_face, entry) => onAdd(entry.image)}
                            onFaceDragStart={(entry, event) => {
                              event.dataTransfer.setData(SHEET_SOURCE_MIME, entry.image.id);
                              event.dataTransfer.effectAllowed = "copy";
                            }}
                            caption={<span style={{ color: "oklch(0.72 0.14 290)" }}>{set.label}</span>}
                          />
                        </div>
                      ))}
                      {singles.map((source) => (
                  <div
                    key={source.id}
                    className="group relative overflow-hidden rounded-md"
                    style={{ border: "1px solid oklch(1 0 0 / 10%)" }}
                  >
                    <button
                      type="button"
                      onClick={() => onAdd(source)}
                      title={`${source.name} — 누르면 시트에 놓입니다. 배치된 칸 위로 끌어다 놓으면 그 칸의 그림이 바뀝니다`}
                      draggable
                      onDragStart={(event) => {
                        // 끌어다 놓기. 칸 위에 떨구면 교체, 빈자리에 떨구면 그 자리에 새 칸.
                        event.dataTransfer.setData(SHEET_SOURCE_MIME, source.id);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      className="block w-full cursor-grab active:cursor-grabbing"
                      data-tour="sheet-source-tile"
                    >
                      <div className="relative aspect-square w-full" style={{ background: "oklch(0.10 0.006 265)" }}>
                        <img
                          src={assetSrc(source.filePath) || source.thumb || ""}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                        <p
                          className="pointer-events-none absolute inset-x-0 bottom-0 truncate px-1 py-0.5 text-[8px]"
                          style={{ background: "oklch(0 0 0 / 55%)", color: "oklch(0.85 0.01 265)" }}
                        >
                          {source.name}
                        </p>
                      </div>
                      {/* 뽑힌 px 크기 — 시트 칸이 이 크기 그대로 들어갑니다. 읽기 전에는 «…», 못 읽으면 «크기 모름»(«…» 은 읽는 중으로 읽힙니다) */}
                      <p
                        className="px-1 py-0.5 text-center text-[8px] tabular-nums"
                        style={{ background: "oklch(0.14 0.01 265)", color: "oklch(0.58 0.01 265)" }}
                        title="그림의 원래 크기(px). 시트에 이 크기 그대로 들어갑니다"
                      >
                        {(() => {
                          const natural = sizes[source.id];
                          if (natural) return `${natural.w}×${natural.h}`;
                          return source.id in sizes ? "크기 모름" : "…";
                        })()}
                      </p>
                    </button>
                    {badge && (
                      <span
                        className="pointer-events-none absolute left-1 top-1 rounded px-1 py-px text-[8px] font-bold"
                        style={{
                          background: bucket.group === "공용 에셋" ? "oklch(0.55 0.15 200 / 85%)" : "oklch(0.62 0.22 290 / 85%)",
                          color: "white",
                        }}
                      >
                        {badge}
                      </span>
                    )}
                    {onEdit && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(source);
                        }}
                        aria-label={`${source.name} 편집 — 자르기·지우기`}
                        title="편집 — 자르기·지우기 (결과가 이 인물의 생성 이미지로 들어갑니다)"
                        data-tour="sheet-source-crop"
                        // 이름 띠와 그 밑 크기 줄 위에 앉힙니다. bottom-4 면 크기 줄에 걸칩니다.
                        className="absolute bottom-8 right-1 z-10 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        style={{ background: "oklch(0 0 0 / 72%)", color: "white" }}
                      >
                        <Scissors className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                      ))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
