import { useMemo, useState } from "react";
import { Loader2, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { assetSrc } from "@/lib/mediaLibrary";
import {
  borrowCandidates,
  borrowCards,
  borrowRoomCandidates,
  borrowRooms,
  type BorrowCandidate,
  type BorrowKind,
} from "@/lib/borrowCards";
import { useEscapeClose } from "@/components/useEscapeClose";
import type { Background, Character, ProjectDraft } from "@/lib/projectTypes";
import type { RoomPreset } from "@/lib/roomPreset";

/**
 * **다른 작품에서 끌어오기** — 고르는 창.
 *
 *
 *
 * 두 단으로 고릅니다 — **카드를 고르고, 그 카드의 그림 중 몇 장을 고릅니다.** 카드만
 * 고르고 그림을 안 고르면 설정만 옵니다(그것도 쓸모가 있습니다 — 이쪽에서 새로 뽑으면 됩니다).
 *
 * 갈래를 섞지 않습니다(`kind`). 인물 목록에 장소가 섞이면 고르는 자리가 흐려집니다.
 */
export default function BorrowCardsDialog({
  kind,
  draft,
  projectName,
  onClose,
  onDone,
}: {
  kind: BorrowKind;
  draft: ProjectDraft;
  /** 지금 작품의 폴더 이름. 그림을 여기로 복사하고, 목록에서 이 작품은 뺍니다. */
  projectName: string;
  onClose: () => void;
  /** 만들어진 카드들. 부르는 쪽이 초안에 붙입니다. */
  onDone: (made: {
    characters: Character[];
    backgrounds: Background[];
    /** 끌어온 방. 이 작품의 방 라이브러리에만 들어갑니다. */
    rooms?: RoomPreset[];
  }) => void;
}) {
  useEscapeClose(true, onClose);
  const all = useMemo(
    () => (kind === "room" ? [] : borrowCandidates(kind, projectName)),
    [kind, projectName],
  );
  /*
    방은 카드가 아니라 **라이브러리 한 칸**이라 목록이 따로입니다.
    면 표에 값이 있는 칸만 복사합니다.
  */
  const rooms = useMemo(
    () => (kind === "room" ? borrowRoomCandidates(projectName) : []),
    [kind, projectName],
  );
  const [pickedRooms, setPickedRooms] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  /**
   * 카드마다 **고른 변형과 그 변형의 그림**. 열쇠는 `카드키|변형id`.
   *
   * 변형이 수십 개인 카드를 통째로
   * 가져오면 폴더가 금세 붑니다 — 대부분은 이 작품에서 안 씁니다.
   */
  const [varPicked, setVarPicked] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  const keyOf = (item: BorrowCandidate) => `${item.projectId}:${item.card.id}`;
  const label = kind === "character" ? "인물" : kind === "room" ? "방" : "장소";

  /** 카드를 켜면 **대표 그림 한 장**을 기본으로 고릅니다. 하나도 없는 채로 켜는 일이 잦아서요. */
  const toggleCard = (item: BorrowCandidate) => {
    const key = keyOf(item);
    setPicked((current) => {
      if (current[key]) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      const primary = item.images.find((image) => image.isPrimary) ?? item.images[0];
      return { ...current, [key]: primary ? [primary.id] : [] };
    });
  };

  const varKey = (item: BorrowCandidate, variationId: string) => `${keyOf(item)}|${variationId}`;

  /** 변형을 켜면 그 변형의 **대표 그림 한 장**을 기본으로 고릅니다. */
  const toggleVariation = (item: BorrowCandidate, variation: BorrowCandidate["variations"][number]) => {
    const key = varKey(item, variation.id);
    setVarPicked((current) => {
      if (current[key]) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      const primary = variation.images.find((image) => image.isPrimary) ?? variation.images[0];
      return { ...current, [key]: primary ? [primary.id] : [] };
    });
  };

  const toggleVarImage = (item: BorrowCandidate, variationId: string, imageId: string) => {
    const key = varKey(item, variationId);
    setVarPicked((current) => {
      const now = current[key] ?? [];
      return {
        ...current,
        [key]: now.includes(imageId) ? now.filter((id) => id !== imageId) : [...now, imageId],
      };
    });
  };

  const toggleImage = (item: BorrowCandidate, imageId: string) => {
    const key = keyOf(item);
    setPicked((current) => {
      const now = current[key] ?? [];
      return {
        ...current,
        [key]: now.includes(imageId) ? now.filter((id) => id !== imageId) : [...now, imageId],
      };
    });
  };

  const run = async () => {
    if (kind === "room") {
      const picks = rooms.filter((item) => pickedRooms.includes(item.preset.id));
      if (!picks.length) {
        toast.message("가져올 방을 고르세요.");
        return;
      }
      setBusy(true);
      try {
        const made = await borrowRooms({ picks, draft, projectName });
        onDone({ characters: [], backgrounds: [], rooms: made.presets });
        toast.success(`방 ${picks.length}개를 가져왔습니다.`, {
          description:
            `방에 걸려 있던 면 그림 ${made.copied}장을 이 작품 폴더로 복사했습니다` +
            (made.failed ? ` · ${made.failed}장은 못 옮겼습니다` : "") +
            " · 안 건 면은 가져오지 않았습니다",
        });
        onClose();
      } catch (error) {
        toast.error(String(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    const picks = all
      .filter((item) => picked[keyOf(item)])
      .map((item) => ({
        candidate: item,
        imageIds: picked[keyOf(item)] ?? [],
        // 켠 변형만 넘깁니다 — 안 켠 것은 열쇠 자체가 없습니다.
        variationImageIds: Object.fromEntries(
          item.variations
            .filter((variation) => varPicked[varKey(item, variation.id)])
            .map((variation) => [variation.id, varPicked[varKey(item, variation.id)] ?? []]),
        ),
      }));
    if (!picks.length) {
      toast.message(`가져올 ${label}을(를) 고르세요.`);
      return;
    }
    setBusy(true);
    try {
      const made = await borrowCards({ kind, picks, draft, projectName });
      onDone({ characters: made.characters, backgrounds: made.backgrounds });
      toast.success(`${label} ${picks.length}개를 가져왔습니다.`, {
        description:
          `그림 ${made.copied}장을 이 작품 폴더로 복사했습니다` +
          (made.failed ? ` · ${made.failed}장은 못 옮겼습니다(원본이 없어진 듯합니다)` : "") +
          " · 원래 작품과는 이제 아무 관계가 없습니다",
      });
      onClose();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  const count = kind === "room" ? pickedRooms.length : Object.keys(picked).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "oklch(0 0 0 / 60%)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-lg"
        style={{ background: "oklch(0.12 0.008 265)", border: "1px solid oklch(1 0 0 / 12%)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b px-4 py-3" style={{ borderColor: "oklch(1 0 0 / 8%)" }}>
          <p className="text-sm font-bold" style={{ color: "oklch(0.92 0.01 265)" }}>
            다른 작품에서 {label} 끌어오기
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: "oklch(0.58 0.01 265)" }}>
            고른 것을 **이 작품 폴더로 복사**합니다. 가져온 뒤에는 원래 작품과 아무 관계가
            없어서, 여기서 고치거나 지워도 저쪽은 그대로입니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {kind !== "room" && all.length === 0 && (
            <p className="py-8 text-center text-[11px]" style={{ color: "oklch(0.52 0.01 265)" }}>
              끌어올 {label}이(가) 없습니다. 다른 작품에 {label} 카드를 먼저 만드세요.
            </p>
          )}

          {kind === "room" && rooms.length === 0 && (
            <p className="py-8 text-center text-[11px]" style={{ color: "oklch(0.52 0.01 265)" }}>
              끌어올 방이 없습니다. 다른 작품에서 구도잡기의 «방 라이브러리에 담기» 를 먼저 쓰세요.
            </p>
          )}

          {rooms.map((item) => {
            const on = pickedRooms.includes(item.preset.id);
            return (
              <button
                key={item.preset.id}
                type="button"
                data-tour="env-room-borrow"
                onClick={() =>
                  setPickedRooms((current) =>
                    current.includes(item.preset.id)
                      ? current.filter((id) => id !== item.preset.id)
                      : [...current, item.preset.id],
                  )
                }
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left"
                style={{
                  background: on ? "oklch(0.62 0.22 290 / 12%)" : "oklch(0.15 0.01 265)",
                  border: `1px solid ${on ? "oklch(0.62 0.22 290 / 40%)" : "oklch(1 0 0 / 7%)"}`,
                }}
              >
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold"
                  style={{
                    background: on ? "oklch(0.62 0.22 290 / 40%)" : "oklch(1 0 0 / 8%)",
                    color: on ? "oklch(0.92 0.16 290)" : "transparent",
                  }}
                >
                  ✓
                </span>
                <span className="text-[12px] font-semibold" style={{ color: "oklch(0.90 0.01 265)" }}>
                  {item.preset.name}
                </span>
                <span className="text-[10px]" style={{ color: "oklch(0.52 0.01 265)" }}>
                  {item.projectTitle} · 소품 {item.preset.objects.length}개 ·{" "}
                  {item.faceCount ? `걸린 면 ${item.faceCount}장` : "면 그림 없음"}
                </span>
              </button>
            );
          })}

          {all.map((item) => {
            const key = keyOf(item);
            const on = Boolean(picked[key]);
            const chosen = picked[key] ?? [];
            return (
              <div
                key={key}
                className="rounded-md"
                style={{
                  background: on ? "oklch(0.62 0.22 290 / 12%)" : "oklch(0.15 0.01 265)",
                  border: `1px solid ${on ? "oklch(0.62 0.22 290 / 40%)" : "oklch(1 0 0 / 7%)"}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleCard(item)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left"
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold"
                    style={{
                      background: on ? "oklch(0.62 0.22 290 / 40%)" : "oklch(1 0 0 / 8%)",
                      color: on ? "oklch(0.92 0.16 290)" : "transparent",
                    }}
                  >
                    ✓
                  </span>
                  <span className="text-[12px] font-semibold" style={{ color: "oklch(0.90 0.01 265)" }}>
                    {item.card.name}
                  </span>
                  <span className="text-[10px]" style={{ color: "oklch(0.52 0.01 265)" }}>
                    {item.projectTitle} · 그림 {item.images.length}장
                  </span>
                </button>

                {/* 카드를 켰을 때만 그림을 고르게 합니다 — 안 켠 카드의 그림은 볼 까닭이 없습니다. */}
                {on && item.images.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                    {item.images.map((image) => {
                      const taken = chosen.includes(image.id);
                      return (
                        <button
                          key={image.id}
                          type="button"
                          onClick={() => toggleImage(item, image.id)}
                          title={image.name || ""}
                          className="h-16 w-16 overflow-hidden rounded"
                          style={{
                            border: `2px solid ${taken ? "oklch(0.62 0.22 290 / 70%)" : "oklch(1 0 0 / 10%)"}`,
                            opacity: taken ? 1 : 0.45,
                          }}
                        >
                          <img
                            src={assetSrc(image.filePath) || image.thumb}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
                {on && item.images.length === 0 && (
                  <p className="px-3 pb-3 text-[10px]" style={{ color: "oklch(0.52 0.01 265)" }}>
                    그림이 없는 카드입니다. 설정만 가져오고 여기서 새로 뽑으면 됩니다.
                  </p>
                )}

                {/*
                  ── 변형 ──────────────────────────────────────────────
                   카드와 같은 방식으로
                  **변형을 켜고, 그 변형의 그림을 고릅니다.**
                */}
                {on && item.variations.length > 0 && (
                  <div className="space-y-1 px-3 pb-3">
                    <p className="text-[9px] font-semibold" style={{ color: "oklch(0.55 0.01 265)" }}>
                      변형 {item.variations.length}개 — 가져올 것만 켜세요
                    </p>
                    {item.variations.map((variation) => {
                      const vKey = varKey(item, variation.id);
                      const vOn = Boolean(varPicked[vKey]);
                      const vChosen = varPicked[vKey] ?? [];
                      return (
                        <div
                          key={variation.id}
                          className="rounded"
                          style={{
                            background: vOn ? "oklch(0.55 0.15 200 / 12%)" : "oklch(1 0 0 / 3%)",
                            border: `1px solid ${vOn ? "oklch(0.55 0.15 200 / 34%)" : "oklch(1 0 0 / 6%)"}`,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => toggleVariation(item, variation)}
                            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
                          >
                            <span
                              className="flex h-3 w-3 shrink-0 items-center justify-center rounded text-[8px] font-bold"
                              style={{
                                background: vOn ? "oklch(0.55 0.15 200 / 45%)" : "oklch(1 0 0 / 8%)",
                                color: vOn ? "oklch(0.92 0.12 200)" : "transparent",
                              }}
                            >
                              ✓
                            </span>
                            <span className="text-[10px]" style={{ color: "oklch(0.82 0.01 265)" }}>
                              {variation.name}
                            </span>
                            <span className="text-[9px]" style={{ color: "oklch(0.48 0.01 265)" }}>
                              그림 {variation.images.length}장
                            </span>
                          </button>
                          {vOn && variation.images.length > 0 && (
                            <div className="flex flex-wrap gap-1 px-2 pb-2">
                              {variation.images.map((image) => {
                                const taken = vChosen.includes(image.id);
                                return (
                                  <button
                                    key={image.id}
                                    type="button"
                                    onClick={() => toggleVarImage(item, variation.id, image.id)}
                                    title={image.name || ""}
                                    className="h-12 w-12 overflow-hidden rounded"
                                    style={{
                                      border: `2px solid ${taken ? "oklch(0.55 0.15 200 / 70%)" : "oklch(1 0 0 / 10%)"}`,
                                      opacity: taken ? 1 : 0.45,
                                    }}
                                  >
                                    <img
                                      src={assetSrc(image.filePath) || image.thumb}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          className="flex items-center justify-between border-t px-4 py-3"
          style={{ borderColor: "oklch(1 0 0 / 8%)" }}
        >
          <span className="text-[11px]" style={{ color: "oklch(0.58 0.01 265)" }}>
            {count ? `${label} ${count}개를 고름` : "고른 것 없음"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-[11px]"
              style={{ background: "oklch(1 0 0 / 7%)", color: "oklch(0.68 0.01 265)" }}
            >
              닫기
            </button>
            <button
              type="button"
              onClick={run}
              disabled={busy || !count}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
              style={{
                background: count ? "oklch(0.62 0.22 290 / 30%)" : "oklch(1 0 0 / 6%)",
                color: count ? "oklch(0.90 0.16 290)" : "oklch(0.45 0.01 265)",
              }}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <PackageOpen className="h-3 w-3" />}
              가져오기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
