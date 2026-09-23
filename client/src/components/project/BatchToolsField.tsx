import { Loader2, RefreshCw } from "lucide-react";
import { availableLocalEngines, useLocalEngines, type LocalEngineId } from "@/lib/localEngines";
import { useMagnificStatus } from "@/lib/magnificMcp";
import { useMagnificModels, type MagnificModel } from "@/lib/magnificModels";
import { aspectOf, enginesOf, type BatchEngine } from "@/lib/batchRun";
import { targetModelOf, targetModels } from "@/lib/modelRules";
import LoraPicker from "@/components/LoraPicker";
import type { ProjectDraft } from "@/lib/projectTypes";

/**
 * **무엇으로 뽑을까** — 생성기·모델·해상도. 이미지와 영상을 따로 고릅니다.
 *
 *
 *
 * 그래서 이 부품이 **일괄 생성 창**(주제 설정)에 삽니다. 「넣고 이미지·영상까지 바로 뽑기」
 * 를 켜는 자리와 **무엇으로 뽑을지 고르는 자리**가 같아야, 켜 놓고 확인 탭까지 갔다 올
 * 일이 없습니다.
 *
 * 값은 **프로젝트가** 들고 있습니다(`batchEngines` · `magnific`). 작품마다 답이 다르고,
 * 앱 설정에 두면 옆 작품을 잘못된 모델로 통째로 뽑게 됩니다.
 */
export default function BatchToolsField({
  draft,
  onChange,
  disabled,
}: {
  draft: ProjectDraft;
  /** 초안을 고칩니다. **지금 값을 받아 다음 값을 만드는 함수** 여야 합니다. */
  onChange: (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => void;
  disabled?: boolean;
}) {
  useLocalEngines(); // 설치 상태를 구독해야 목록이 제때 살아납니다.
  const imageEngines = availableLocalEngines("image");
  const videoEngines = availableLocalEngines("video");
  const engines = enginesOf(draft);

  /*
    마그니픽 MCP 는 **연결했을 때만** 고를 수 있습니다. 안 그러면 뽑기를 눌러 놓고
    「연결되어 있지 않습니다」 를 스무 번 보게 됩니다.
  */
  const magnific = useMagnificStatus();
  const usingMcpImage = engines.image === "magnific-mcp";
  const usingMcpVideo = engines.video === "magnific-mcp";
  const imageModels = useMagnificModels("image", usingMcpImage && magnific.connected);
  const videoModels = useMagnificModels("video", usingMcpVideo && magnific.connected);
  const picked = draft.magnific ?? {};

  const setEngine = (kind: "image" | "video", value: BatchEngine) =>
    onChange((current) => ({ batchEngines: { ...(current.batchEngines || {}), [kind]: value } }));
  const setMagnific = (patch: Partial<NonNullable<ProjectDraft["magnific"]>>) =>
    onChange((current) => ({ magnific: { ...(current.magnific || {}), ...patch } }));
  const setAspect = (kind: "image" | "video", value: string) =>
    onChange((current) => ({ aspect: { ...(current.aspect || {}), [kind]: value } }));

  /*
    ── 화면 비율 ──────────────────────────────────────────────────────────
    

    고른 모델이 받는 것만 보여 줍니다 — 안 받는 비율을 보내면 거절당하는데, 사람은
    「비율만 바꿨을 뿐」 이라 까닭을 짐작하기 어렵습니다. 모델을 안 골랐으면 흔한 넷.
  */
  const COMMON_ASPECTS = ["16:9", "9:16", "1:1", "4:3"];
  const aspectPick = (
    label: string,
    kind: "image" | "video",
    model: string | undefined,
    models: MagnificModel[],
    usingMcp: boolean,
  ) => {
    const allowed = usingMcp
      ? models.find((item) => item.slug === model)?.aspectRatios ?? []
      : [];
    const options = allowed.length ? allowed : COMMON_ASPECTS;
    return (
      <label className="flex items-center gap-1.5 text-[10px]" style={{ color: "oklch(0.55 0.01 265)" }}>
        {label}
        <select
          value={aspectOf(draft, kind)}
          disabled={disabled}
          onChange={(event) => setAspect(kind, event.target.value)}
          title="숏츠는 9:16 입니다"
          className="rounded-md px-2 py-1 text-[10px] outline-none disabled:opacity-40"
          style={box}
        >
          {options.map((item) => (
            <option key={item} value={item}>
              {item}
              {item === "9:16" ? " (세로·숏츠)" : item === "16:9" ? " (가로)" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const box = {
    background: "oklch(0.11 0.007 265)",
    border: "1px solid oklch(1 0 0 / 10%)",
    color: "oklch(0.84 0.01 265)",
  };

  const enginePick = (
    label: string,
    value: BatchEngine,
    onPick: (next: BatchEngine) => void,
    locals: { id: LocalEngineId; name: string }[],
  ) => (
    <label className="flex items-center gap-1.5 text-[10px]" style={{ color: "oklch(0.55 0.01 265)" }}>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onPick(event.target.value as BatchEngine)}
        className="rounded-md px-2 py-1 text-[10px] outline-none disabled:opacity-40"
        style={box}
      >
        <option value="magnific">마그니픽 — 생성기를 차려 놓기(무제한)</option>
        {magnific.connected && <option value="magnific-mcp">마그니픽 — 끝까지 뽑기(건당 과금)</option>}
        {locals.map((engine) => (
          <option key={engine.id} value={engine.id}>
            {engine.name} — 이 컴퓨터가 뽑기
          </option>
        ))}
      </select>
    </label>
  );

  /**
   * **어느 모델에 맞춰 글을 쓸까** — 연결 없이도 고릅니다.
   *
   * 고른 값은 `matchModelRule` 로 규칙을, `loadModelGuide` 로 모델 문서를 부르고,
   * 「구성」 이 마그니픽 생성기를 차릴 때 그 모델을 골라 둡니다.
   */
  const targetPick = (
    label: string,
    kind: "image" | "video",
    value: string | undefined,
    onPick: (id: string) => void,
  ) => {
    const list = targetModels(kind);
    const chosen = targetModelOf(value);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px]" style={{ color: "oklch(0.55 0.01 265)" }}>
          {label}
          <select
            value={chosen?.id ?? ""}
            disabled={disabled}
            onChange={(event) => onPick(event.target.value)}
            className="rounded-md px-2 py-1 text-[10px] outline-none disabled:opacity-40"
            style={box}
          >
            <option value="">고르지 않음 — 어느 모델에나 통하는 모양으로</option>
            {list.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
                {model.guided ? "" : " (규칙만, 문서 없음)"}
              </option>
            ))}
          </select>
        </label>
        {/*
          고르면 무엇이 달라지는지 한 줄로. 안 적으면 「골라도 뭐가 달라지지」 가 됩니다.
        */}
        {chosen && (
          <span className="text-[10px]" style={{ color: "oklch(0.60 0.12 160)" }}>
            대사 문법·금지 표기·길이를 {chosen.label} 에 맞춰 씁니다
            {chosen.kind === "video" && !chosen.magnific && " · 마그니픽에서는 직접 골라 주세요"}
          </span>
        )}
      </div>
    );
  };

  /** 모델 하나와 그 모델이 받는 해상도 하나. 목록이 비면 «불러오기» 를 내놓습니다. */
  const modelPick = (
    label: string,
    catalog: {
      models: MagnificModel[];
      failed: string;
      loading: boolean;
      reload: (fresh?: boolean) => Promise<void>;
    },
    model: string | undefined,
    onModel: (next: string) => void,
    resolution: string | undefined,
    onResolution: (next: string) => void,
  ) => {
    const sizes = catalog.models.find((item) => item.slug === model)?.resolutions ?? [];
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1.5 text-[10px]" style={{ color: "oklch(0.55 0.01 265)" }}>
          {label}
          <select
            value={model || ""}
            disabled={disabled}
            onChange={(event) => onModel(event.target.value)}
            className="rounded-md px-2 py-1 text-[10px] outline-none disabled:opacity-40"
            style={box}
          >
            <option value="">마그니픽이 알아서</option>
            {catalog.models.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {sizes.length > 0 && (
          <select
            value={resolution || ""}
            disabled={disabled}
            onChange={(event) => onResolution(event.target.value)}
            title="이 모델이 받는 해상도"
            className="rounded-md px-2 py-1 text-[10px] outline-none disabled:opacity-40"
            style={box}
          >
            <option value="">해상도 기본</option>
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        )}
        {/*
          목록을 **손으로 받아 올 수 있게** 합니다. 
        */}
        <button
          type="button"
          onClick={() => void catalog.reload()}
          disabled={disabled || catalog.loading}
          title="마그니픽에게 지금 있는 모델을 다시 물어봅니다"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
          style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.74 0.13 200)" }}
        >
          {catalog.loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {catalog.models.length ? `모델 ${catalog.models.length}` : "목록 불러오기"}
        </button>
        {catalog.failed && (
          <span className="text-[10px]" style={{ color: "oklch(0.76 0.15 25)" }}>
            {catalog.failed}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-3">
        {enginePick("이미지", engines.image, (next) => setEngine("image", next), imageEngines)}
        {enginePick("영상", engines.video, (next) => setEngine("video", next), videoEngines)}
        <span className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
          이 작품에만 저장됩니다
        </span>
      </div>

      {/*
        ── 이 작품을 **무슨 모델로 뽑는가** ──────────────────────────────
        

        예전에는 **마그니픽 MCP 에 연결했을 때만** 고를 수 있었습니다. 「차려 놓기」 로
        쓰면 아무도 안 골라서, 모델별 규칙·문서·대사 문법이 **통째로 잠자고** 있었습니다
        (2026-09-21 실측 — 컷 예순두 개가 전부 모델 모양 없는 프롬프트였습니다).

        이 고르개는 **뽑는 길과 상관없이** 늘 보입니다. 마그니픽으로 뽑든, 로컬로 뽑든,
        복사해서 딴 데 붙여넣든 «어느 모델에 맞춰 쓸 글인가» 는 정해야 하니까요.
        MCP 에 연결돼 있으면 진짜 목록이 오므로 그때는 위의 것이 이깁니다.
      */}
      {!usingMcpImage && targetPick("이미지 모델", "image", picked.imageModel, (id) => setMagnific({ imageModel: id }))}
      {!usingMcpVideo && targetPick("영상 모델", "video", picked.videoModel, (id) => setMagnific({ videoModel: id }))}

      {usingMcpImage &&
        modelPick(
          "이미지 모델",
          imageModels,
          picked.imageModel,
          // 모델을 바꾸면 해상도는 비웁니다 — 모델마다 받는 값이 달라 옛 값은 거절당합니다.
          (imageModel) => setMagnific({ imageModel, imageResolution: "" }),
          picked.imageResolution,
          (imageResolution) => setMagnific({ imageResolution }),
        )}
      {usingMcpVideo &&
        modelPick(
          "영상 모델",
          videoModels,
          picked.videoModel,
          (videoModel) => setMagnific({ videoModel, videoResolution: "" }),
          picked.videoResolution,
          (videoResolution) => setMagnific({ videoResolution }),
        )}

      {/* 화면 비율 — 마그니픽이든 로컬이든 같은 값을 씁니다. */}
      <div className="flex flex-wrap items-center gap-3">
        {aspectPick("이미지 비율", "image", picked.imageModel, imageModels.models, usingMcpImage)}
        {aspectPick("영상 비율", "video", picked.videoModel, videoModels.models, usingMcpVideo)}
      </div>

      {/*
        로컬 엔진을 골랐으면 **이번 작품에 쓸 로라**도 여기서 고릅니다.
         받아 둔 로라가 없으면 줄 자체가 안 보입니다.
      */}
      {!engines.image.startsWith("magnific") && (
        <LoraPicker
          engine={engines.image as LocalEngineId}
          picked={draft.localLoras?.[engines.image] ?? []}
          onChange={(next) =>
            onChange((current) => ({
              localLoras: { ...(current.localLoras || {}), [engines.image]: next },
            }))
          }
          disabled={disabled}
        />
      )}
      {!engines.video.startsWith("magnific") && engines.video !== engines.image && (
        <LoraPicker
          engine={engines.video as LocalEngineId}
          picked={draft.localLoras?.[engines.video] ?? []}
          onChange={(next) =>
            onChange((current) => ({
              localLoras: { ...(current.localLoras || {}), [engines.video]: next },
            }))
          }
          disabled={disabled}
        />
      )}

      {(usingMcpImage || usingMcpVideo) && !magnific.connected && (
        <p className="text-[10px]" style={{ color: "oklch(0.74 0.13 60)" }}>
          마그니픽에 연결되어 있지 않습니다 — 설정 → 마그니픽에서 «연결» 을 눌러 주세요.
        </p>
      )}
    </div>
  );
}
