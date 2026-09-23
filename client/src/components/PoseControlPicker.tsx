import { useState } from "react";
import { Loader2, PersonStanding, X } from "lucide-react";
import { toast } from "sonner";
import { useMocapSources } from "@/lib/mocapStore";
import { bakePoseFrames, type PoseFrameSet } from "@/lib/poseFrames";
import { LOCAL_ENGINE_CATALOG, type LocalEngineId } from "@/lib/localEngines";

/**
 * **동작 기준 고르기** — 모캡으로 분석해 둔 사람을 골라 뼈 그림으로 굽습니다.
 *
 * ,
 * 「댄스 커버 영상 올려서 모션 추출하고, 캐릭터랑 배경만 바꿔서 새로운 댄스 커버 영상」.
 *
 * # 동작을 받는 엔진일 때만 뜹니다
 *
 * 아무 모델에나 뼈 그림을 준다고 따라 그리지 않습니다 — 그 조건을 학습한 가지가 따로
 * 있어야 합니다. 없는 엔진에 주면 **조용히 무시되고**, 사람은 스무 번 뽑고 나서야
 * 「왜 안 따라 하지」 를 알게 됩니다. 그래서 `pose` 를 켜 둔 엔진에서만 묻습니다.
 *
 * # 굽는 일이 여기 있는 까닭
 *
 * 뼈 그림은 **생성 크기에 맞춰** 구워야 어긋나지 않습니다. 모캡 창에서 미리 구워 두면
 * 나중에 크기가 달라졌을 때 늘려 맞추다가 뼈가 틀어집니다. 뽑기 직전에 굽습니다.
 */
export default function PoseControlPicker({
  engine,
  projectName,
  value,
  onChange,
  disabled,
}: {
  engine: LocalEngineId;
  projectName: string;
  /** 구워 둔 뼈 그림 묶음. 없으면 동작을 안 씁니다. */
  value: PoseFrameSet | null;
  onChange: (next: PoseFrameSet | null) => void;
  disabled?: boolean;
}) {
  const sources = useMocapSources(projectName);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  // 이 엔진이 동작을 못 받으면 아예 안 그립니다.
  if (!LOCAL_ENGINE_CATALOG[engine]?.pose) return null;

  /** 분석이 끝나 사람이 들어 있는 것만 — 아직 안 돌린 영상은 고를 것이 없습니다. */
  const ready = sources.filter((source) => source.result?.persons.length);
  if (!ready.length) return null;

  const bake = async (sourceId: string, personNumber: number) => {
    const source = ready.find((item) => item.id === sourceId);
    if (!source?.result) return;
    setBusy(`${sourceId}:${personNumber}`);
    try {
      const made = await bakePoseFrames({
        projectName,
        ownerName: source.name,
        result: source.result,
        personNumber,
        onProgress: (done, total) => setStatus(`뼈 그림 ${done}/${total}`),
      });
      onChange(made);
      toast.success(`동작 기준 ${made.frames.length}장을 구웠습니다.`, {
        description: `${made.seconds.toFixed(1)}초 · ${made.width}×${made.height} — 이 동작을 그대로 따릅니다.`,
      });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy("");
      setStatus("");
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="flex items-center gap-1 text-[10px] font-semibold"
          style={{ color: "oklch(0.60 0.01 265)" }}
        >
          <PersonStanding className="h-3 w-3" /> 동작 기준
        </span>
        {value ? (
          <>
            <span className="text-[10px]" style={{ color: "oklch(0.74 0.14 160)" }}>
              뼈 {value.frames.length}장 · {value.seconds.toFixed(1)}초
            </span>
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled}
              title="동작을 쓰지 않습니다"
              className="rounded p-0.5 hover:bg-white/10"
              style={{ color: "oklch(0.62 0.01 265)" }}
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <span className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
            모캡에서 분석한 사람을 고르면 그 동작을 그대로 따릅니다
          </span>
        )}
      </div>

      {!value && (
        <div className="flex flex-wrap gap-1.5">
          {ready.flatMap((source) =>
            (source.result?.persons ?? []).map((person) => {
              const key = `${source.id}:${person.number}`;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled || Boolean(busy)}
                  onClick={() => void bake(source.id, person.number)}
                  title={`${source.name} 의 ${person.number}번 사람 — 뼈 그림으로 구워 동작 기준으로 씁니다`}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium disabled:opacity-40"
                  style={{
                    background: "oklch(1 0 0 / 5%)",
                    border: "1px solid oklch(1 0 0 / 8%)",
                    color: "oklch(0.62 0.01 265)",
                  }}
                >
                  {busy === key && <Loader2 className="h-3 w-3 animate-spin" />}
                  {source.name} · {person.number}번
                </button>
              );
            }),
          )}
        </div>
      )}

      {status && (
        <p className="text-[10px]" style={{ color: "oklch(0.72 0.14 290)" }}>
          {status}
        </p>
      )}
    </div>
  );
}
