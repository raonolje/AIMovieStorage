import { ChevronDown, ChevronRight } from "lucide-react";
import { CUT_TOGGLE_GROUPS } from "@/lib/cutStyle";
import type { AutoRealism } from "@/lib/autoRealism";
import { useT } from "@/lib/i18n";

/**
 * **연출 토글 패널** — 스타일·촬영·조명·색감·질감을 켜고 끕니다.
 *
 * 2026-09-18 에 `CutCard.tsx` 에서 떼어 냈습니다. 자족적인 아코디언이라 바깥에서
 * 필요한 것은 «켠 목록·여닫힘·자동으로 켜진 것» 셋뿐입니다.
 *
 * # «자동» 칸을 따로 보여 주는 까닭
 *
 * 다만 **말없이** 넣지는 않습니다 —
 * 자동으로 무엇이 들어갔는지 안 보이면 「왜 이런 그림이 나왔지」 를 알 수가 없습니다.
 * 손으로 켜고 끈 것이 늘 이깁니다.
 */
export default function CutStyleToggles({
  tags,
  openGroups,
  setOpenGroups,
  toggleTag,
  autoLook,
}: {
  /** 손으로 켠 토글 id. */
  tags: string[];
  openGroups: Record<string, boolean>;
  setOpenGroups: (next: Record<string, boolean>) => void;
  toggleTag: (id: string) => void;
  /** 앱이 알아서 켠 것. 화면에 다른 색으로 보여 줍니다. */
  autoLook: AutoRealism;
}) {
  const t = useT();
  return (
    <>
      {CUT_TOGGLE_GROUPS.map((group) => {
        const groupOpen = openGroups[group.id] ?? true;
        const picked = group.options.filter((option) =>
          tags.includes(option.id),
        );
        return (
          <div
            key={group.id}
            data-tour="cut-style-toggles"
            className="rounded-md"
            style={{
              background: "oklch(0.14 0.01 265)",
              border: "1px solid oklch(1 0 0 / 7%)",
            }}
          >
            <button
              type="button"
              onClick={() =>
                setOpenGroups({ ...openGroups, [group.id]: !groupOpen })
              }
              className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left"
              aria-expanded={groupOpen}
            >
              {groupOpen ? (
                <ChevronDown
                  className="h-3 w-3"
                  style={{ color: "oklch(0.55 0.01 265)" }}
                />
              ) : (
                <ChevronRight
                  className="h-3 w-3"
                  style={{ color: "oklch(0.55 0.01 265)" }}
                />
              )}
              <span
                className="text-[11px] font-bold"
                style={{ color: "oklch(0.82 0.16 290)" }}
              >
                {t(group.label)}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-[9px]"
                style={{ color: "oklch(0.42 0.01 265)" }}
              >
                {picked.length
                  ? picked.map((item) => item.label).join(", ")
                  : group.description}
              </span>
              {/* 이 칸에서 앱이 알아서 켠 것. 손으로 켠 것과 구분해 흐리게 보여 줍니다. */}
              {group.id === "texture" && autoLook.ids.length > 0 && (
                <span
                  className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold"
                  title={autoLook.why}
                  style={{
                    background: "oklch(0.55 0.15 200 / 20%)",
                    color: "oklch(0.78 0.12 200)",
                  }}
                >
                  자동 {autoLook.ids.length}
                </span>
              )}
            </button>
            {groupOpen && (
              <div className="flex flex-wrap gap-1 px-2.5 pb-2.5">
                {group.options.map((option) => {
                  const on = tags.includes(option.id);
                  // 손으로 안 켰는데 앱이 켠 것 — 눌러서 끌 수 있게 그대로 둡니다.
                  const auto = !on && autoLook.ids.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleTag(option.id)}
                      className="rounded px-1.5 py-1 text-[10px]"
                      title={auto ? autoLook.why : option.hint}
                      style={{
                        background: on
                          ? "oklch(0.62 0.22 290 / 20%)"
                          : auto
                            ? "oklch(0.55 0.15 200 / 14%)"
                            : "oklch(1 0 0 / 5%)",
                        border: `1px solid ${
                          on
                            ? "oklch(0.62 0.22 290 / 42%)"
                            : auto
                              ? "oklch(0.55 0.15 200 / 34%)"
                              : "oklch(1 0 0 / 7%)"
                        }`,
                        color: on
                          ? "oklch(0.84 0.16 290)"
                          : auto
                            ? "oklch(0.76 0.11 200)"
                            : "oklch(0.58 0.01 265)",
                      }}
                    >
                      {option.label}
                      {auto && " ·"}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
