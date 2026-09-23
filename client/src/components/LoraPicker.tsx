import { AlertTriangle, FolderOpen } from "lucide-react";
import {
  loraItems,
  openLoraFolder,
  styleClash,
  useLoraFiles,
} from "@/lib/localLoras";
import type { LocalEngineId } from "@/lib/localEngines";

/**
 * **이번에 쓸 로라 고르기** — 받아 둔 것만 보입니다.
 *
 * # 왜 «받아 둔 것만» 인가
 *
 * 여태 목록은 사용자가 적어 둔 **경로**였습니다. 파일을 옮기거나 지워도 목록은 남아, 고르는
 * 순간에야 「없는 파일」 이 됩니다. 이제 엔진 폴더를 읽어 **있는 것만** 내놓습니다.
 *
 * # 아무것도 안 고르면
 *
 * 설정에서 «기본으로 켜 둔» 것들이 들어갑니다. 고르면 **고른 것만** 들어갑니다 —
 * 「이번 컷만 다른 화풍으로」 가 되어야 하니까요.
 */
export default function LoraPicker({
  engine,
  picked,
  onChange,
  disabled,
}: {
  engine: LocalEngineId;
  /** 고른 로라의 파일 경로들. 비어 있으면 «설정의 기본» 을 씁니다. */
  picked: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const files = useLoraFiles();
  const items = loraItems(files, engine);
  if (!items.length) return null;

  const chosen = picked.length ? items.filter((item) => picked.includes(item.path)) : [];
  const clash = styleClash(chosen.length ? chosen : items.filter((item) => item.enabled));

  const toggle = (path: string) =>
    onChange(picked.includes(path) ? picked.filter((item) => item !== path) : [...picked, path]);

  /*
    **한 줄입니다.** 예전에는 «라벨·안내·폴더» 줄과 «칩» 줄로 나뉘어 있어서, 컷 카드의 머리줄
    오른쪽에 붙으면 로컬 영상 단추 아래로 두 줄이 매달렸습니다(). 안내문은 라벨의 툴팁으로 옮기고, 고른 개수만 글자로 남깁니다.
  */
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="text-[10px] font-semibold"
          title="안 고르면 설정에서 켜 둔 로라가 전부 들어갑니다. 눌러서 이번에만 쓸 것을 고를 수 있습니다."
          style={{ color: "oklch(0.60 0.01 265)" }}
        >
          로라{picked.length ? ` ${picked.length}` : ""}
        </span>
        {items.map((item) => {
          const on = picked.includes(item.path);
          return (
            <button
              key={item.path}
              type="button"
              disabled={disabled}
              onClick={() => toggle(item.path)}
              title={`${item.fileName}${item.weight !== 1 ? ` · 세기 ${item.weight}` : ""}${
                item.enabled ? " · 설정에서 기본으로 켬" : ""
              }`}
              className="rounded-md px-2 py-1 text-[10px] font-medium disabled:opacity-40"
              style={{
                background: on ? "oklch(0.62 0.22 290 / 20%)" : "oklch(1 0 0 / 5%)",
                border: `1px solid ${
                  on
                    ? "oklch(0.62 0.22 290 / 45%)"
                    : item.enabled
                      ? "oklch(0.74 0.14 160 / 35%)"
                      : "oklch(1 0 0 / 8%)"
                }`,
                color: on ? "oklch(0.86 0.16 290)" : "oklch(0.62 0.01 265)",
              }}
            >
              {item.name}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => void openLoraFolder(engine)}
          title="이 엔진의 로라 폴더를 엽니다"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] hover:bg-white/10"
          style={{ color: "oklch(0.55 0.01 265)" }}
        >
          <FolderOpen className="h-3 w-3" /> 폴더
        </button>
      </div>

      {/*
        화풍이 섞이면 **보이게만** 합니다. 막지 않는 까닭은 일부러 섞어 보는 일이 있어서고,
        조용히 두지 않는 까닭은 결과가 이상할 때 원인을 못 찾기 때문입니다.
      */}
      {clash.length > 0 && (
        <p className="flex items-center gap-1 text-[10px]" style={{ color: "oklch(0.78 0.14 60)" }}>
          <AlertTriangle className="h-3 w-3" />
          화풍 로라가 둘 이상입니다({clash.join(", ")}) — 어느 쪽도 아닌 결이 나올 수 있습니다.
        </p>
      )}
    </div>
  );
}
