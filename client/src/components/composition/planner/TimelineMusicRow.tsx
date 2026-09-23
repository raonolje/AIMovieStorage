import MusicWave from "@/components/composition/planner/MusicWave";
import type { CompositionMusic } from "@/lib/composition";

/**
 * **노래 레이어** — 타임라인 맨 윗줄.
 *
 * 편집 프로그램처럼 맨 윗줄입니다 — 노래가 시간표이고 나머지가 그 위에서 움직이니까요.
 * 2026-09-18 에 `MoveTimeline.tsx` 에서 떼어 냈습니다. 바깥에 기대는 것이 다섯뿐입니다.
 */
export default function TimelineMusicRow({
  music,
  span,
  gutterStyle,
  ratioOf,
  onSeek,
}: {
  /** 올려 둔 노래. 없으면 줄 자체가 안 보입니다. */
  music: CompositionMusic | null | undefined;
  /** 타임라인 전체 길이(초). */
  span: number;
  gutterStyle: React.CSSProperties;
  /** 시각 → 가로 비율(0~1). */
  ratioOf: (time: number) => number;
  onSeek: (time: number) => void;
}) {
  if (!music) return null;
  return (
    <>
      <div
        className="flex items-center gap-1 pt-1 text-[8px] font-semibold"
        style={{ color: "oklch(0.50 0.01 265)" }}
      >
        <span className="truncate" style={gutterStyle} title={music.path}>
          노래 · {music.name}
        </span>
        <span className="h-px flex-1" style={{ background: "oklch(1 0 0 / 8%)" }} />
      </div>
      <div className="flex items-center">
        <div className="flex shrink-0 items-center gap-1" style={gutterStyle}>
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: "oklch(0.72 0.18 300)" }} />
          <span className="min-w-0 flex-1 truncate text-[9px] font-semibold" style={{ color: "oklch(0.78 0.01 265)" }}>
            구간 {music.sections.length || "없음"}
          </span>
        </div>
        {/*
          줄을 키웠습니다(5 → 9). 파형이 눌리면 조용한 데와 센 데가 구분이 안 가서,
          「소리가 있다」 는 알아도 «어디가 후렴인지» 는 못 읽습니다.
        */}
        <div className="relative h-9 flex-1" style={{ background: "oklch(1 0 0 / 3%)", borderRadius: 3 }}>
          {/*
            ── 파형 ────────────────────────────────────────────────
            

            구간을 안 나눠 두면 이 줄이 **텅 비어** 있었습니다 — 노래를 올렸는지조차
            알 수 없었습니다. 파형은 구간 칸 **뒤에** 깔립니다(칸이 덮으면 안 되니까).
          */}
          <MusicWave path={music.path} offset={music.offset ?? 0} timelineSeconds={span} />
          {music.sections.map((section, index) => {
            const left = ratioOf(section.start) * 100;
            const width = Math.max(0.4, (ratioOf(section.end) - ratioOf(section.start)) * 100);
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onSeek(section.start)}
                title={`${section.label} — ${section.start.toFixed(2)}초 ~ ${section.end.toFixed(2)}초 (${(section.end - section.start).toFixed(1)}초). 누르면 그 자리로 갑니다`}
                className="absolute top-0.5 h-8 overflow-hidden truncate px-1 text-[8px] font-semibold"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  // 구간마다 색을 조금씩 돌려 경계가 눈에 보이게 합니다 — 같은 색이면 어디가 끊긴 자리인지 모릅니다.
                  background: `oklch(0.55 0.16 ${300 + (index % 3) * 18} / 22%)`,
                  border: "1px solid oklch(0.72 0.18 300 / 40%)",
                  borderRadius: 2,
                  color: "oklch(0.92 0.06 300)",
                }}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
