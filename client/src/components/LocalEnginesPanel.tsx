import { useEffect, useState } from "react";
import ApiTokenRow from "@/components/ApiTokenRow";
import { invoke } from "@tauri-apps/api/core";
import { Cpu, Loader2, Trash2, Download, HardDriveDownload, X } from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useT } from "@/lib/i18n";
import {
  cancelLocalInstall,
  installLocalEngine,
  listLocalEngines,
  LOCAL_KIND_LABEL,
  LOCAL_STAGE_LABELS,
  LOCAL_ENGINE_CATALOG,
  prefetchLocalWeights,
  stopLocalWorkers,
  uninstallLocalEngine,
  useLocalEngines,
  engineFit,
  PRECISION_LABEL,
  precisionFor,
  savePrecision,
  saveLocalMemoryPolicy,
  useLocalMemoryPolicy,
  usePrecisionSetting,
  PRECISION_LADDER,
  type EngineFit,
  type HardwareProbe,
  type LocalPrecision,
  type LocalEngineId,
  type LocalEngineStatus,
  type LocalMemoryPolicy,
} from "@/lib/localEngines";

/**
 * 로컬 모델 설치 칸 — 설정 화면과 BGM 화면이 같이 씁니다.
 *
 *
 *
 * `kinds` 를 주면 그 갈래만 보여 줍니다 — BGM 화면에서는 음악 엔진만 보여야 합니다.
 * 설치·제거·진행은 모듈 저장소(`lib/localEngines.ts`)가 들어서, 화면을 떠났다 돌아와도
 * 진행 줄이 이어집니다.
 */
export default function LocalEnginesPanel({
  kinds,
  compact,
}: {
  kinds?: LocalEngineStatus["kind"][];
  compact?: boolean;
}) {
  const t = useT();
  const { engines, installs, loaded, statusError } = useLocalEngines();
  const memoryPolicy = useLocalMemoryPolicy();
  const [stoppingWorkers, setStoppingWorkers] = useState(false);
  const updateMemoryPolicy = (next: LocalMemoryPolicy) => {
    const failed = (error: unknown) => toast.error(t("메모리 설정을 저장하지 못했습니다: {error}", { error: String(error) }));
    try { void saveLocalMemoryPolicy(next).catch(failed); }
    catch (error) { failed(error); }
  };
  const shown = kinds
    ? engines.filter((engine) => kinds.includes(engine.kind))
    : engines;

  /*
    이 컴퓨터를 **한 번** 읽습니다(). 카드마다 읽으면 엔진 수만큼 nvidia-smi 가 돕니다.
  */
  const [probe, setProbe] = useState<HardwareProbe | null>(null);
  /** 사람이 못 박은 정밀도. «자동» 이면 워커가 GPU 를 보고 정합니다. */
  const precision = usePrecisionSetting() as LocalPrecision;
  useEffect(() => {
    let alive = true;
    void invoke<HardwareProbe>("probe_hardware")
      .then((value) => {
        if (alive) setProbe(value);
      })
      // 브라우저로 열었거나 명령이 없으면 조용히 «확인 못 함» 으로 둡니다.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-2">
      {!compact && (
        <p
          className="text-[11px] leading-relaxed"
          style={{ color: "oklch(0.45 0.01 265)" }}
        >
          엔진은 앱 데이터 폴더 <b>local/</b> 에 <b>각자 고정 환경</b>(전용 파이썬 ·
          고정 판 패키지)으로 설치됩니다. <b>ComfyUI 와 무관</b>합니다. 영상 엔진(미니맥스 ·
          완)은 가중치를 <b>설치 때 통째로</b> 받아 두고, 나머지는 수십 GB 라 <b>첫 생성 때</b>
          받습니다. 이미 깔아 둔 영상 엔진은 <b>가중치 미리 받기</b> 단추로 받습니다.
        </p>
      )}

      {!loaded && (
        <p className="text-[11px]" style={{ color: "oklch(0.50 0.01 265)" }}>
          설치 상태를 확인하는 중…
        </p>
      )}
      {statusError && (
        <p
          className="text-[10px] leading-relaxed"
          style={{ color: "oklch(0.70 0.16 25)" }}
        >
          엔진 상태를 읽지 못했습니다 — {statusError}. 데스크톱 앱(`pnpm
          dev:desktop`)에서 열었는지 확인하세요.
        </p>
      )}

      {!compact && (
        <HardwareRow
          probe={probe}
          precision={precision}
          onPrecision={(value) => {
            void savePrecision(value).catch(error => toast.error(String(error)));
          }}
        />
      )}
      {!compact && <HuggingFaceTokenRow />}

      {!compact && (
        <div className="space-y-2 rounded-lg border border-white/10 p-3 text-[11px]">
          <label className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t("생성 후 메모리")}</span>
            <select
              value={memoryPolicy.mode}
              onChange={(event) => updateMemoryPolicy({ ...memoryPolicy, mode: event.target.value as LocalMemoryPolicy["mode"] })}
              className="rounded-md border border-white/10 bg-background px-2 py-1.5"
            >
              <option value="release">{t("생성 후 메모리 비우기 (기본)")}</option>
              <option value="adaptive">{t("사용량이 기준 이상이면 메모리 비우기")}</option>
              <option value="retain">{t("빠른 연속 생성을 위해 모델 유지")}</option>
            </select>
          </label>
          {memoryPolicy.mode === "adaptive" && (
            <div className="flex flex-wrap gap-3">
              {(["ramPercent", "vramPercent"] as const).map(field => (
                <label key={field} className="flex items-center gap-2">
                  <span>{t(field === "ramPercent" ? "RAM 사용률 기준 (%)" : "VRAM 사용률 기준 (%)")}</span>
                  <input
                    type="number" min={1} max={99} step={1} value={memoryPolicy[field]}
                    onChange={(event) => {
                      const percent = event.target.valueAsNumber;
                      if (!Number.isInteger(percent) || percent < 1 || percent > 99) return;
                      updateMemoryPolicy({ ...memoryPolicy, [field]: percent });
                    }}
                    className="w-16 rounded-md border border-white/10 bg-background px-2 py-1"
                  />
                </label>
              ))}
            </div>
          )}
          <p className="leading-relaxed text-muted-foreground">
            {memoryPolicy.mode === "release"
              ? t("로컬 생성 후 사용한 워커를 종료해 RAM·VRAM을 돌려줍니다. 다음 생성은 모델을 다시 불러오므로 더 오래 걸릴 수 있습니다.")
              : memoryPolicy.mode === "adaptive"
                ? t("생성이 끝나면 캐시를 정리합니다. RAM 또는 VRAM 사용률이 기준 이상이거나 사용량을 읽지 못하면 해당 워커를 종료합니다. 모델을 다시 불러오는 시간이 늘어날 수 있습니다.")
                : t("모델을 메모리에 남겨 다음 생성의 로딩 시간을 줄입니다. RAM·VRAM 점유가 계속될 수 있습니다.")}
          </p>
          <p className="leading-relaxed text-muted-foreground">
            {t("설정은 다음 생성부터 적용됩니다. 이미 남아 있는 모델은 ‘워커 내리기’로 해제하세요.")}
            {" "}{t("자동 정리는 생성이 끝난 뒤에만 실행하며, 생성 도중 사용률을 이유로 작업을 중단하지 않습니다.")}
          </p>
        </div>
      )}

      {shown.map((engine) => (
        <EngineSettingsCard
          key={engine.id}
          engine={engine}
          progress={installs[engine.id]}
          fit={engineFit(engine, probe)}
          probe={probe}
        />
      ))}

      {!compact && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => void listLocalEngines()}
            className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
            style={{
              background: "oklch(1 0 0 / 6%)",
              color: "oklch(0.72 0.01 265)",
            }}
          >
            상태 새로 고침
          </button>
          <button
            type="button"
            disabled={stoppingWorkers}
            onClick={() => {
              setStoppingWorkers(true);
              void stopLocalWorkers()
                .then(() => toast.success(t("로컬 모델 워커를 내렸습니다. 해당 워커의 RAM·VRAM을 해제했습니다.")))
                .catch((error) => toast.error(t("워커를 내리지 못했습니다: {error}", { error: String(error) })))
                .finally(() => setStoppingWorkers(false));
            }}
            title={t("현재 로컬 워커를 모두 종료합니다. 실행 중인 생성도 중단될 수 있으며 다음 생성 때 모델을 다시 불러옵니다.")}
            className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
            style={{
              background: "oklch(1 0 0 / 6%)",
              color: "oklch(0.72 0.14 60)",
            }}
          >
            {t(stoppingWorkers ? "워커를 내리는 중…" : "워커 내리기")}
          </button>
        </div>
      )}
    </div>
  );
}

function human(bytes: number): string {
  if (!bytes) return "";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** 판정 색과 말 — 「됩니다 / 줄이면 됩니다 / 빠듯합니다 / 안 됩니다 / 확인 못 함」. */
const FIT_COLOR: Record<EngineFit["level"], string> = {
  ok: "oklch(0.78 0.15 160)",
  quant: "oklch(0.80 0.14 75)",
  tight: "oklch(0.76 0.15 45)",
  no: "oklch(0.70 0.18 25)",
  unknown: "oklch(0.52 0.01 265)",
};

const FIT_LABEL: Record<EngineFit["level"], string> = {
  ok: "이 기계에서 됩니다",
  quant: "줄이면 됩니다",
  tight: "빠듯합니다",
  no: "이 기계에서는 안 됩니다",
  unknown: "확인 못 함",
};

/**
 * 이 컴퓨터가 무엇인지 한 줄로.
 *
 *
 * 아래 카드들의 판정이 **무엇을 근거로 한 것인지** 여기서 먼저 보여 줍니다 — 근거가
 * 안 보이면 「안 됩니다」 를 믿을 수가 없습니다.
 */
function HardwareRow({
  probe,
  precision,
  onPrecision,
}: {
  probe: HardwareProbe | null;
  /** 사람이 못 박은 정밀도(«자동» 이면 워커가 정합니다). */
  precision: LocalPrecision;
  onPrecision: (value: LocalPrecision) => void;
}) {
  const t = useT();
  if (!probe) {
    return (
      <p className="text-[10px]" style={{ color: "oklch(0.48 0.01 265)" }}>
        이 컴퓨터를 확인하는 중…
      </p>
    );
  }
  const gpu = probe.gpus[0];
  return (
    <div
      className="rounded-lg px-3 py-2 text-[10px] leading-relaxed"
      style={{ background: "oklch(1 0 0 / 4%)", color: "oklch(0.60 0.01 265)" }}
    >
      <b style={{ color: "oklch(0.80 0.01 265)" }}>이 컴퓨터</b>{" "}
      {gpu ? (
        <>
          {gpu.name}
          {gpu.vramGb != null && ` · VRAM ${gpu.vramGb} GB`}
          {probe.gpus.length > 1 && ` 외 ${probe.gpus.length - 1}개`}
        </>
      ) : (
        "GPU 를 읽지 못했습니다"
      )}
      {probe.ramGb != null && ` · RAM ${probe.ramGb} GB`}
      {probe.diskFreeGb != null && ` · 빈 자리 ${Math.floor(probe.diskFreeGb)} GB`}
      <br />
      <span style={{ color: "oklch(0.46 0.01 265)" }}>
        아래 판정은 이 값으로 잽니다. 못 읽은 값이 있으면 그 엔진은 «확인 못 함» 으로 둡니다 —
        틀린 숫자로 «됩니다» 라고 하는 것보다 낫습니다.
      </span>
      {/*
        ── 정밀도 ────────────────────────────────────────────────────
        기본이 «자동» 이고, 워커가 올릴 때 이 GPU 를 보고 정합니다.
        여기서 못 박는 것은 자동이 틀릴 때(다른 프로그램이 VRAM 을 쥐고 있을 때)를 위한 길입니다.
      */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="shrink-0" style={{ color: "oklch(0.60 0.01 265)" }}>
          정밀도
        </span>
        {(["auto", "bf16", "int8", "int4"] as const).map((value) => {
          const on = value === precision;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onPrecision(value)}
              title={
                value === "auto"
                  ? "워커가 올릴 때 이 GPU 의 VRAM 을 보고 정합니다"
                  : value === "bf16"
                    ? "원본 그대로. 안 들어가면 느려지거나 죽습니다"
                    : value === "int8"
                      ? t("메모리를 줄입니다. 속도와 품질은 모델과 GPU에 따라 다릅니다.")
                      : t("메모리를 더 줄입니다. 속도와 품질은 원본과 비교해 선택하세요.")
              }
              className="rounded px-1.5 py-0.5 text-[9px]"
              style={{
                background: on ? "oklch(0.62 0.22 290 / 22%)" : "oklch(1 0 0 / 5%)",
                color: on ? "oklch(0.84 0.16 290)" : "oklch(0.58 0.01 265)",
              }}
            >
              {PRECISION_LABEL[value]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EngineSettingsCard({ engine, progress, fit, probe }: {
  engine: LocalEngineStatus;
  progress?: { stage: string; percent: number | null; message: string };
  fit: EngineFit;
  probe: HardwareProbe | null;
}) {
  const t = useT();
  const setting = usePrecisionSetting(engine.id);
  const common = usePrecisionSetting() as LocalPrecision;
  const info = LOCAL_ENGINE_CATALOG[engine.id];
  const modes = info.precisionModes ?? PRECISION_LADDER;
  const precision = precisionFor(info, probe, setting === "inherit" ? common : setting);
  return <div className="space-y-1">
    <LocalEngineCard engine={engine} progress={progress} fit={fit} precision={precision} />
    {engine.kind !== "mocap" && <div className="mb-3 flex flex-wrap items-center gap-2 px-3 text-[11px]">
      <label className="flex items-center gap-2">
        {t("모델별 정밀도")}
        <select aria-label={t("{model} 정밀도", { model: engine.name })} value={setting}
          className="rounded border border-white/10 bg-background px-2 py-1"
          onChange={event => {
            try { void savePrecision(event.target.value as LocalPrecision | "inherit", engine.id).catch(error => toast.error(String(error))); }
            catch (error) { toast.error(String(error)); }
          }}>
          <option value="inherit">{t("공통 설정 따르기")}</option>
          <option value="auto">{t("자동 — 이 GPU 에 맞춰")}</option>
          {modes.map(mode => <option key={mode} value={mode}>{t(PRECISION_LABEL[mode])}</option>)}
        </select>
      </label>
      <span className="text-muted-foreground">{t("다음 생성 예상: {precision}", { precision })}</span>
      <span className="w-full text-muted-foreground">{t("메모리를 줄여도 더 빨라진다고 보장하지 않습니다. 같은 입력으로 품질과 시간을 비교하세요.")}</span>
    </div>}
  </div>;
}

function LocalEngineCard({
  engine,
  progress,
  fit,
  precision,
}: {
  engine: LocalEngineStatus;
  progress?: { stage: string; percent: number | null; message: string };
  /** 이 기계에서 돌까 — 설치 **전에** 보여 줍니다. */
  fit: EngineFit;
  /** 이 엔진을 켜면 실제로 올라갈 정밀도. */
  precision: LocalPrecision;
}) {
  const [busy, setBusy] = useState(false);
  const installing = Boolean(progress) || engine.installing;

  const install = async (id: LocalEngineId) => {
    setBusy(true);
    try {
      await installLocalEngine(id);
      toast.success(`${engine.name} 을 설치했습니다.`, {
        description: engine.canPrefetch
          ? "가중치까지 받아 두었습니다 — 바로 생성할 수 있습니다."
          : "가중치는 첫 생성 때 받습니다 — 그때 한 번 오래 걸립니다.",
      });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  /*
    «가중치 미리 받기» — 
    이 개편 전에 깐 엔진은 설치 때 받는 길을 이미 지나쳤습니다. 미니맥스 H3 의
    레퍼런스용 transformer_ref(62 GB)와 완 I2V 판(60 GB)이 첫 생성 안에서 말없이 내려오지 않게
    여기서 미리 받습니다. 진행은 설치와 같은 막대, 멈추기도 같은 단추입니다.
  */
  const prefetch = async (id: LocalEngineId) => {
    setBusy(true);
    try {
      await prefetchLocalWeights(id);
      toast.success(`${engine.name} 의 가중치를 받아 두었습니다.`, {
        description: "이제 첫 생성에서 내려받기를 기다리지 않습니다.",
      });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: LocalEngineId) => {
    const ok = await confirmDialog({
      title: `${engine.name} 을 제거할까요?`,
      description:
        "앱 데이터 폴더의 이 엔진 폴더만 지웁니다(파이썬 환경과 받아 둔 가중치). " +
        "프로젝트 폴더의 그림·영상은 건드리지 않습니다. 되돌릴 수 없습니다.",
      confirmLabel: "제거",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await uninstallLocalEngine(id);
      toast.success(`${engine.name} 을 제거했습니다.`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: "oklch(0.11 0.008 265)",
        border: `1px solid ${engine.installed ? "oklch(0.70 0.15 160 / 32%)" : "oklch(1 0 0 / 8%)"}`,
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Cpu
          className="h-3.5 w-3.5 shrink-0"
          style={{
            color: engine.installed
              ? "oklch(0.82 0.15 160)"
              : "oklch(0.50 0.01 265)",
          }}
        />
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold"
          style={{
            background: "oklch(0.62 0.22 290 / 16%)",
            color: "oklch(0.82 0.14 290)",
          }}
        >
          {LOCAL_KIND_LABEL[engine.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
          {engine.name}
        </span>
        {engine.installed && (
          <span
            className="shrink-0 text-[10px] tabular-nums"
            style={{ color: "oklch(0.50 0.01 265)" }}
            title={
              engine.weightsReady
                ? "가중치까지 받아 둔 폴더 크기입니다"
                : "폴더 크기 — 생성 뒤와 하루에 한 번 뒤에서 다시 잽니다"
            }
          >
            {human(engine.diskBytes)}
            {engine.weightsReady && " · 가중치 있음"}
          </span>
        )}
        {installing ? (
          <button
            type="button"
            onClick={() => void cancelLocalInstall(engine.id)}
            className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
            style={{
              background: "oklch(1 0 0 / 6%)",
              color: "oklch(0.72 0.16 25)",
            }}
          >
            {/*
              «받기 멈추기» 인지 «설치 멈추기» 인지는 Rust 의 `prefetching` 으로 가립니다. 예전에는 `installed` 로
              골랐는데, 새로 까는 엔진은 uv venv 직후부터 «설치됨» 이라 패키지를 받는 동안에도 「받기 멈추기」 로
              보였습니다(2026-09-22 점검). 어느 쪽이든 같은 취소 깃발이 듣습니다.
            */}
            <X className="h-3 w-3" /> {engine.prefetching ? "받기 멈추기" : "설치 멈추기"}
          </button>
        ) : engine.installed ? (
          <>
            {engine.canPrefetch && !engine.weightsReady && (
              <button
                type="button"
                onClick={() => void prefetch(engine.id)}
                disabled={busy}
                title={`저장소를 통째로 받아 둡니다 (약 ${engine.needs.diskGb} GB · 이미 있는 파일은 건너뜁니다). 안 받으면 첫 생성 안에서 받습니다`}
                className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-white gradient-primary disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <HardDriveDownload className="h-3 w-3" />
                )}
                가중치 미리 받기 (약 {engine.needs.diskGb} GB)
              </button>
            )}
            <button
              type="button"
              onClick={() => void remove(engine.id)}
              disabled={busy}
              className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-40"
              style={{
                background: "oklch(1 0 0 / 6%)",
                color: "oklch(0.68 0.15 25)",
              }}
            >
              <Trash2 className="h-3 w-3" /> 제거
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void install(engine.id)}
            disabled={busy}
            className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-white gradient-primary disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            설치
          </button>
        )}
      </div>

      <p
        className="mt-1.5 text-[10px] leading-relaxed"
        style={{ color: "oklch(0.58 0.01 265)" }}
      >
        {engine.purpose}
      </p>
      <p
        className="mt-1 text-[10px]"
        style={{ color: "oklch(0.44 0.01 265)" }}
      >
        {engine.sizeHint} · {engine.license}
      </p>

      {/*
        **이 기계에서 되나.** 125 GB 를 한 시간 받고 나서 「VRAM 이 모자랍니다」 를 보는 것이
        가장 나쁩니다. 설치 전에 여기서 말합니다.
      */}
      <p className="mt-1 flex items-center gap-1 text-[10px]">
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: FIT_COLOR[fit.level] }}
        />
        <span style={{ color: FIT_COLOR[fit.level] }}>{FIT_LABEL[fit.level]}</span>
        <span style={{ color: "oklch(0.46 0.01 265)" }}>— {fit.note}</span>
        {/* 판정뿐 아니라 **실제로 무엇으로 올라가는지** 적습니다 — 결이 달라지는 까닭이 여기 있습니다. */}
        {engine.kind !== "mocap" && precision !== "auto" && (
          <span style={{ color: "oklch(0.46 0.01 265)" }}>
            · {precision === "bf16" ? "원본 그대로 올립니다" : `${precision} 로 줄여서 올립니다`}
          </span>
        )}
      </p>

      {progress && (
        <div className="mt-2">
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[10px] font-semibold"
              style={{ color: "oklch(0.80 0.14 290)" }}
            >
              {LOCAL_STAGE_LABELS[progress.stage] || progress.stage}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-right text-[10px]"
              style={{ color: "oklch(0.50 0.01 265)" }}
            >
              {progress.message}
            </span>
          </div>
          <div
            className="mt-1 h-1 w-full overflow-hidden rounded-full"
            style={{ background: "oklch(1 0 0 / 8%)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress.percent ?? 30}%`,
                background: "oklch(0.72 0.18 290)",
                // 퍼센트를 모르는 단계(패키지 설치)는 흐리게 — 멈춘 것으로 보이지 않게.
                opacity: progress.percent === null ? 0.5 : 1,
              }}
            />
          </div>
        </div>
      )}

      {engine.lastError && !progress && (
        <p
          className="mt-1.5 text-[10px] leading-relaxed"
          style={{ color: "oklch(0.70 0.16 25)" }}
        >
          지난 설치에서 실패했습니다 — {engine.lastError}
        </p>
      )}
    </div>
  );
}


/**
 * 허깅페이스 토큰 — 승인받은 사람만 받는 저장소(SAM 3D Body·FLUX Krea·SD 3.5)용.
 *
 * 사용자 2026-09-16 모션 캡처 모델을 넣으며 생겼습니다. 토큰을 넘기는 길이 없어서 게이트 저장소 엔진은 설치해도 첫 실행에서 401 로
 * 멈췄습니다. API 키와 같은 자리(설정 폴더 파일)에 두고, Rust 가 워커를 띄울 때 환경 변수로만 넘깁니다(`upscale.rs` ensure_worker).
 * 화면에는 끝 네 글자만 보입니다.
 */
function HuggingFaceTokenRow() {
  // 줄의 모양은 `ApiTokenRow` 한 벌(2026-09-22 Civitai 키와 같이 씀). 여기서는 무슨 토큰인지와, 저장 뒤 워커를 내리는 일만.
  return (
    <ApiTokenRow
      provider="huggingface"
      title="허깅페이스 토큰"
      description="SAM 3D Body · FLUX Krea · SD 3.5 는 모델 페이지에서 접근 승인을 받은 계정의 토큰(읽기 권한)이 있어야 받습니다. 로라 받기에도 같은 토큰을 씁니다."
      placeholder="hf_…"
      prefix="hf_"
      link={{ label: "토큰 만들기", url: "https://huggingface.co/settings/tokens" }}
      // 이미 떠 있는 워커는 옛 환경이라 토큰을 모릅니다 — 내려 두면 다음 실행 때 새로 뜨며 받습니다.
      onChanged={() => stopLocalWorkers().catch(() => undefined)}
    />
  );
}
