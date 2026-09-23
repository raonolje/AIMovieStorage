import { useState } from "react";
import { Cpu, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { findFillerWords } from "@/lib/modelRules";
import {
  availableLocalEngines,
  loadPrecision,
  onLocalProgress,
  useLocalEngines,
  type LocalEngineId,
  type LocalEngineKind,
} from "@/lib/localEngines";
import { localSize, tuneForLocal, type LocalPromptInput } from "@/lib/localPrompt";
import type { ProjectAssetType } from "@/lib/mediaLibrary";
import { runLocalToProject } from "@/lib/localOutput";
import { lorasToRun, useLoraFiles, withLoraTriggers } from "@/lib/localLoras";
import LoraPicker from "@/components/LoraPicker";
import PoseControlPicker from "@/components/PoseControlPicker";
import type { PoseFrameSet } from "@/lib/poseFrames";
import { validateLocalControlOptions } from "@/lib/localControlCapabilities";
import H3ReferenceRangePicker, { type H3ReferenceRange } from "@/components/H3ReferenceRangePicker";
import { useT } from "@/lib/i18n";
import H3GenerationOptions, { useH3GenerationOptions } from "@/components/H3GenerationOptions";
import StructureControlPicker from "@/components/StructureControlPicker";
import type { LocalStructureControl } from "@/lib/localStructureControl";

/**
 * «로컬로 뽑기» — 이 컴퓨터의 모델로 그림·영상을 바로 만듭니다.
 *
 *
 *
 * 카드마다 프롬프트를 따로 쓰지 않습니다. **적어 둔 프롬프트를 그대로** 가져가되,
 * 보내는 순간에 마그니픽 전제(@칩·미드저니 매개변수)를 걷어냅니다(`tuneForLocal`).
 *
 * 캐릭터·배경·에셋·컷이 이 하나를 같이 씁니다(공통 규칙 1). 갈래마다 다른 것은
 * «어디에 저장하는가»(assetType·ownerName·stem)뿐입니다.
 */
export default function LocalGenerateButton({
  kind,
  prompt,
  aspect = "16:9",
  seconds,
  firstFrame,
  references,
  motionMask,
  projectName,
  assetType,
  ownerName,
  stem,
  label,
  onDone,
}: {
  kind: Extract<LocalEngineKind, "image" | "video">;
  prompt: LocalPromptInput;
  /** 「16:9」·「2:3」. 로컬은 크기를 설정으로 받습니다 — 프롬프트의 `--ar` 은 버립니다. */
  aspect?: string;
  /** 영상 길이(초). 그림에서는 무시합니다. */
  seconds?: number;
  /** 영상의 첫 프레임으로 쓸 그림 경로. 주면 I2V(H3 는 fl2va)로 돕니다. */
  firstFrame?: string;
  /**
   * 레퍼런스 — 구도잡기 영상·인물 시트·배경을 **순서대로**(H3 의 `ref2va`).
   *
   * 이게 있으면 첫 프레임(`firstFrame`)은 쓰이지 않습니다 — H3 의 `ref2va` 는 키프레임을
   * 받지 않습니다. 부르는 쪽이 대표 그림을 레퍼런스 목록 앞에 넣어 두면 됩니다.
   * 레퍼런스를 못 받는 엔진(Wan)에서는 조용히 무시됩니다.
   */
  references?: { kind: "image" | "video" | "audio"; path: string }[];
  /**
   * «여기는 움직인다» 흑백 마스크의 경로(«원본_움직임_NNN»). **영상에서만** 씁니다.
   *
   * 레퍼런스 목록과 갈라 두는 까닭은 `LocalRunOptions.motion_mask` 머리말에 있습니다.
   * 워커가 뽑은 뒤 검은 곳을 첫 장면에 묶습니다(`common.freeze_by_mask`).
   */
  motionMask?: string;
  projectName: string;
  assetType: ProjectAssetType;
  ownerName: string;
  /** 파일 이름 앞부분. 폴더 규칙은 `saveProjectMediaAsset` 이 쥡니다(규칙 5). */
  stem: string;
  label?: string;
  /** 만든 파일을 카드에 붙일 자리. 경로와 보일 이름을 줍니다. */
  onDone: (filePath: string, name: string) => void;
}) {
  const t = useT();
  useLocalEngines(); // 설치 상태를 구독해야 단추가 제때 살아납니다.
  const engines = availableLocalEngines(kind);
  const [engineId, setEngineId] = useState<LocalEngineId | "">("");
  const engine = engines.find((item) => item.id === engineId) ?? engines[0];
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  /*
    ── 이번에 쓸 로라 ────────────────────────────────────────────────────
    

    **엔진마다 따로** 기억합니다. 엔진을 바꾸면 고른 것이 그대로 남아 있으면 안 됩니다 —
    Wan 로라를 LTX 에 먹이면 로딩이 통째로 실패합니다.
  */
  const loraFiles = useLoraFiles();
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  /**
   * 모캡에서 구운 **동작 기준**. 영상에서만 씁니다.
   *
   *
   */
  const [pose, setPose] = useState<PoseFrameSet | null>(null);
  const [structure, setStructure] = useState<LocalStructureControl | null>(null);
  const [ltxQuality, setLtxQuality] = useState<"single" | "two-stage">("single");
  const videoReferences = (references ?? []).filter(item => item.kind === "video").map(item => item.path);
  const referenceKey = JSON.stringify(videoReferences);
  const [referenceSelection, setReferenceSelection] = useState<{ key: string; range: H3ReferenceRange } | null>(null);
  const referenceRange = referenceSelection?.key === referenceKey ? referenceSelection.range : "";
  const needsReferenceRange = kind === "video" && engine?.id === "minimaxh3" && videoReferences.length > 0;
  const chosenLoras = engine ? lorasToRun(engine.id, picked[engine.id], loraFiles) : [];
  const h3Options = useH3GenerationOptions(kind === "video" && engine?.id === "minimaxh3" && !!references?.length, chosenLoras, loraFiles);

  // 쓸 수 있는 엔진이 없으면 **아무것도 안 그립니다.** 설치는 설정에서 합니다 —
  // 카드마다 「설치하세요」 를 띄우면 화면이 안내문으로 뒤덮입니다.
  if (!engine) return null;

  const run = async () => {
    if (busy) return;
    const tuned = tuneForLocal(engine.id, prompt);
    if (!tuned.prompt.trim()) {
      toast.error("보낼 프롬프트가 없습니다.");
      return;
    }
    setBusy(true);
    setStatus("모델을 올리는 중…");
    const off = onLocalProgress((event) => {
      setStatus(event.message || "");
    }, engine.id);
    try {
      if (structure && !videoReferences.includes(structure.path)) throw new Error(t("선택한 윤곽 기준 영상이 현재 레퍼런스 목록에 없습니다. 다시 선택하세요."));
      const checked = validateLocalControlOptions(engine.id, {
        control: kind === "video" && pose ? { kind: "pose", frames: pose.frames, fps: pose.fps } : undefined,
        references: engine.id === "minimaxh3" ? references : undefined,
        reference_video_range: needsReferenceRange ? referenceRange : undefined,
        structure_control: structure,
        seconds: structure?.durationSeconds ?? seconds ?? 5,
      });
      if (!checked.ok) throw new Error(checked.message);
      /*
        결과를 프로젝트 폴더에 놓으려면 «그 폴더 안의 경로» 가 필요합니다. 빈 파일로
        자리를 한 번 잡고 그 경로에 엔진이 씁니다 — 폴더·이름·번호 규칙을 저장 쪽
        한 군데(`saveProjectMediaAsset`)가 계속 쥐고 있게 하려는 것입니다(규칙 5).
      */
      /*
        **그림 @태그를 가리키는 프롬프트는 로컬에서 뜻대로 안 됩니다.**

        2026-09-18 실측: 장소 카드에서 «전개도» 를 Qwen-Image 로 뽑아 봤더니, 프롬프트가
        「틀 그림 @ref_방 1_001 의 칸에 맞춰 그려라」 인데 그 틀이 엔진에 안 가서 **방 사진
        한 장**이 나왔습니다(회색 칸 여섯 개를 벽에 걸린 액자로 그렸습니다). 40분과 60 GB 를
        쓰고 못 쓸 그림을 받는 셈이라, 시작 전에 말해 줍니다.
      */
      const wantsRefs = kind === "image" && /@[^\s]+/.test(tuned.prompt);
      if (wantsRefs)
        toast.warning("이 프롬프트는 그림 @태그를 가리킵니다.", {
          description:
            `${engine.name} 은 글만 받습니다 — 태그가 가리키는 그림이 안 올라가니 결과가 프롬프트와 다를 수 있습니다. 전개도·인물 일관성처럼 그림이 꼭 필요한 것은 마그니픽으로 뽑으세요.`,
          duration: 9000,
        });

      /*
        **품질 수식어를 알려 줍니다.** 요즘 모델은 «극히 매력적인 이미지» 로 추가 미세조정해
        나와서 가만두면 광고 사진이 됩니다. 거기에 「8k」·「masterpiece」 를 또 얹으면 바로
        그 편향을 더 밉니다. 지우지는 않습니다 — 일부러 넣었을 수 있으니 알려만 줍니다.
      */
      /*
        **프롬프트가 한도를 넘으면 뒤쪽이 조용히 잘립니다.**

         텍스트 인코더가 읽는 길이는 정해져 있는데(`localTokenBudget`)
        우리 프롬프트는 상황·환경·인물·구도·빛을 다 적어 길고, **칸 배치 지시가 맨 뒤**에 있습니다.
        넘치면 정확히 그 부분이 날아가 «시킨 것과 전혀 다른 그림» 이 됩니다. 값을 치르기 전에 말합니다.
      */
      if (tuned.overflow)
        toast.warning("프롬프트가 깁니다 — 뒤쪽이 잘립니다.", {
          description: `약 ${tuned.tokens} 토큰인데 ${engine.name} 은 한 번에 ${tuned.budget} 토큰까지 읽습니다. 맨 뒤에 적힌 칸 배치·마감 지시가 안 갑니다 — 짧게 줄이거나 마그니픽으로 뽑으세요.`,
          duration: 12000,
        });

      /*
        **한 장에 여러 칸을 그리는 일은 로컬 모델이 못합니다.**

        2026-09-22 실측: 9칸 시트를 시키면 실루엣이 뭉개진 그림이 나옵니다. 세 칸 안팎이면 같은 인물로
        또렷하게 나옵니다(같은 날 «필리핀계 대원» 이 그랬습니다) — 칸이 늘수록 칸 하나에 주어지는 픽셀이
        줄고, 정체성을 여러 칸에 걸쳐 지키는 것은 나노 바나나 프로 급이 하는 일입니다.
      */
      if (kind === "image" && tuned.panels > 3)
        toast.warning(`${tuned.panels}칸 시트는 이 엔진에 무리입니다.`, {
          description:
            "로컬 모델은 한 장에 세 칸 안팎까지 또렷합니다. 그보다 많으면 칸이 뭉개집니다 — 시트는 마그니픽으로 뽑고, 로컬은 칸을 나눠 한 장씩 뽑으세요.",
          duration: 12000,
        });

      const filler = findFillerWords(tuned.prompt);
      if (filler)
        toast.warning("뺄 만한 말이 있습니다.", {
          description: filler.hint,
          duration: 9000,
        });

      /*
        **로라의 «불러오는 말» 을 프롬프트 앞에 붙입니다.**

        화면에는 「프롬프트에 넣어야 먹습니다」 라고 적어 두고 정작 보낼 때 버리고
        있었습니다(2026-09-18 점검). 로라를 켜도 그 말이 한 글자도 안 갔습니다.
      */
      const withTriggers = withLoraTriggers(tuned.prompt, chosenLoras);

      const size = localSize(engine.id, aspect);
      const result = await runLocalToProject({
        engine: engine.id,
        extension: engine.extension,
        kind,
        projectName,
        assetType,
        ownerName,
        stem,
        opts: {
          prompt: withTriggers,
          negative: tuned.negative,
          // 파이썬 쪽이 같은 한도를 쓰게 넘깁니다 — 두 곳에 다른 숫자를 적으면 한쪽만 맞습니다.
          max_tokens: tuned.budget,
          ...size,
          ...(kind === "video"
            ? {
                seconds: structure?.durationSeconds ?? seconds ?? 5,
                fps: 16,
                image: firstFrame,
                references: engine.id === "minimaxh3" ? references : undefined,
                reference_video_range: needsReferenceRange && referenceRange ? referenceRange : undefined,
                // 그림 한 장에는 얼릴 구역이 없습니다 — 마스크는 영상에만 실립니다.
                motion_mask: motionMask,
                structure_control: structure ?? undefined,
                ltx_quality: engine.id === "ltx25" ? ltxQuality : undefined,
              }
            : {}),
          ...h3Options.options,
          loras: chosenLoras,
          // 뼈 그림은 **영상에만**. 그림 한 장에는 이을 동작이 없습니다.
          ...(kind === "video" && pose ? { control: { kind: "pose" as const, frames: pose.frames, fps: pose.fps } } : {}),
          // «자동» 이면 워커가 이 GPU 를 보고 정합니다. 설정에서 못 박아 두면 그것을 따릅니다.
          precision: loadPrecision(engine.id),
        },
        timeoutSecs: kind === "video" ? 7200 : 1800,
      });
      // **뽑힌 실제 경로**를 넘깁니다. 자리 경로를 넘기면 0바이트를 가리켜 액박이 납니다.
      onDone(result.path, result.name);
      /*
        **버린 레퍼런스는 말해 줍니다.**

        사용자 2026-09-18 점검: 로컬 그림 엔진(Qwen-Image·Z-Image·Krea 2·Anima)은 넷 다
        글자만 받습니다 — 워커에 `image` 를 읽는 자리가 아예 없습니다. 그런데 화면은 인물
        시트를 골라 둔 채로 «만들었습니다» 만 띄웠습니다. 그래서 컷마다 얼굴이 달라지는데도
        까닭을 알 수가 없었습니다. 말없이 버리지 않습니다.
      */
      const dropped =
        kind === "image"
          ? (references?.length ?? 0) + (firstFrame ? 1 : 0)
          : engine.id === "minimaxh3"
            ? 0
            : (references ?? []).filter(item => item.path !== structure?.path).length;
      const referenceMeta = Array.isArray(result.meta?.reference_videos) ? result.meta.reference_videos : [];
      const referenceSummary = referenceMeta.filter((item): item is { conditioning_seconds: number } =>
        !!item && typeof item === "object" && typeof (item as { conditioning_seconds?: unknown }).conditioning_seconds === "number",
      ).map(item => t("H3 참조 입력 {seconds}초", { seconds: item.conditioning_seconds.toFixed(2) })).join(" · ");
      const structureMeta = result.meta?.structure_control as { conditioning_seconds?: number } | undefined;
      const structureSummary = typeof structureMeta?.conditioning_seconds === "number"
        ? t("윤곽 기준 입력 {seconds}초", { seconds: structureMeta.conditioning_seconds.toFixed(3) }) : "";
      toast.success(`${engine.name} 으로 만들었습니다.`, {
        description:
          `${Math.round(result.seconds)}초 걸렸습니다` +
          (referenceSummary ? ` · ${referenceSummary}` : "") +
          (structureSummary ? ` · ${structureSummary}` : "") +
          (result.meta?.ltx_quality === "two-stage" ? ` · ${t("2단계 정제 결과 {width}×{height}", { width: String(result.meta.width), height: String(result.meta.height) })}` : "") +
          (result.meta?.precision ? ` · ${result.meta.precision} 적용` : "") +
          (tuned.usedKorean
            ? " · 영문 칸이 비어 한글로 보냈습니다(오픈 모델은 영어를 훨씬 잘 알아듣습니다)"
            : "") +
          (dropped
            ? ` · 레퍼런스 ${dropped}장은 못 실었습니다 — 이 엔진은 글만 받습니다${
                kind === "image" ? "(인물을 고정하려면 마그니픽으로 뽑으세요)" : ""
              }`
            : ""),
      });
    } catch (error) {
      toast.error(String(error));
    } finally {
      off();
      setStatus("");
      setBusy(false);
    }
  };

  /*
    **세로가 아니라 가로로 흐릅니다.** 예전엔 «모델+단추 / 로라 / 자세» 를 세로로 쌓아
    (flex-col) 컷 카드의 머리줄 오른쪽에서 두세 줄이 단추 아래로 매달렸습니다(). 머리줄의 다른 단추들처럼 한 줄에 서고, 좁으면 통째로 줄바꿈합니다.
  */
  return (
    // 모델 고르는 칸과 «로컬로 뽑기» 를 한 자리로 봅니다 — 튜토리얼이 둘을 함께 가리킵니다.
    // («구성» 과 같은 걸음에 묶여 있었습니다).
    <div data-tour="card-local-generate" className="flex flex-wrap items-center justify-end gap-1.5">
      <div className="flex items-center gap-1">
      {/*
        엔진이 둘 이상일 때만 고르는 칸을 냅니다. 하나뿐인데 드롭다운을 두면
        고를 것이 없는 칸만 자리를 차지합니다.
      */}
      {engines.length > 1 && (
        <select
          value={engine.id}
          onChange={(event) => setEngineId(event.target.value as LocalEngineId)}
          title="이 컴퓨터에 깔린 로컬 모델 중에서"
          className="rounded-md px-1.5 py-1 text-[10px] outline-none"
          style={{
            background: "oklch(0.18 0.012 265)",
            border: "1px solid oklch(1 0 0 / 8%)",
            color: "oklch(0.82 0.01 265)",
          }}
        >
          {engines.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || (needsReferenceRange && !referenceRange)}
        title={
          busy
            ? status || "만드는 중…"
            : `${engine.name} 으로 이 컴퓨터에서 바로 만듭니다. 적어 둔 프롬프트를 그대로 쓰되 마그니픽용 @칩과 매개변수는 걷어냅니다.`
        }
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold disabled:opacity-50"
        style={{
          background: "oklch(1 0 0 / 6%)",
          color: "oklch(0.82 0.14 290)",
        }}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Cpu className="h-3 w-3" />
        )}
        {busy ? status || "만드는 중…" : label || "로컬로 뽑기"}
      </button>
      </div>

      {needsReferenceRange && <H3ReferenceRangePicker paths={videoReferences} value={referenceRange}
        onChange={range => setReferenceSelection({ key: referenceKey, range })} disabled={busy} />}
      {kind === "video" && (engine.id === "ltx25" || structure) && <StructureControlPicker
        paths={videoReferences} value={structure} onChange={setStructure} disabled={busy} seconds={seconds} />}
      {kind === "video" && engine.id === "ltx25" && <label className="flex items-center gap-1 text-[10px]"
        title={t("설정한 크기가 최종 출력입니다. 절반 크기로 생성한 뒤 2배 확대·3회 정제합니다. 윤곽·포즈 기준은 128픽셀, 그 외는 64픽셀 배수로 맞춥니다. 시간과 메모리가 늘 수 있습니다.")}>
        <span>{t("LTX 품질")}</span>
        <select value={ltxQuality} disabled={busy} onChange={event => setLtxQuality(event.target.value as "single" | "two-stage")}
          aria-label={t("LTX 품질")} className="rounded-md border border-white/10 bg-black/20 px-1.5 py-1">
          <option value="single">{t("1단계 (기본)")}</option>
          <option value="two-stage">{t("2단계 고해상도 정제")}</option>
        </select>
      </label>}

      <H3GenerationOptions value={h3Options} disabled={busy} />

      {/* 받아 둔 로라가 있을 때만 뜹니다. 없으면 이 줄 자체가 없습니다. */}
      <LoraPicker
        engine={engine.id}
        picked={picked[engine.id] ?? []}
        onChange={(next) => setPicked((current) => ({ ...current, [engine.id]: next }))}
        disabled={busy}
      />

      {/* 동작을 받는 엔진일 때만 뜹니다 — 없는 엔진에 주면 조용히 무시됩니다. */}
      {kind === "video" && (
        <PoseControlPicker
          engine={engine.id}
          projectName={projectName}
          value={pose}
          onChange={setPose}
          disabled={busy}
        />
      )}
    </div>
  );
}
