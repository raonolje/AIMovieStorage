import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, EyeOff, FolderSync, Maximize2 as ExpandIcon } from "lucide-react";
import ImageLightbox from "@/components/ImageLightbox";
import { toast } from "sonner";
import {
  assetSrc,
  claimProjectInboxFile,
  listProjectInbox,
  openProjectInbox,
  type MagnificImportedFile,
  type ProjectInboxFile,
} from "@/lib/mediaLibrary";
import {
  guessMagnificKind,
  guessMagnificOwner,
  isMagnificSentFile,
  listMagnificTargets,
  type MagnificOwnerHint,
  type MagnificTarget,
} from "@/lib/magnificBridge";
import { uid, type GeneratedImageAsset, type MagnificHandled, type ProjectDraft } from "@/lib/projectTypes";
import type { VisualAsset } from "@/lib/visualAsset";

/**
 * 후보함 — `<프로젝트>/magnific/` 에 온 그림·영상을 보여 주고, 고른 것만 «채택» 합니다.
 *
 * 마그니픽 동기화 폴더 하나를 후보함에 걸면 A컷·B컷·C컷·영상이 전부 섞여 옵니다.
 * 프로젝트에는 **쓰기로 한 것만** 남아야 하므로 여기서는 아무것도 자동으로 옮기지
 * 않습니다. 보낸 프롬프트로 «누구 것 같은지» 만 미리 골라 두고, 사람이 채택하면
 * 그때 주인 폴더로 **복사**해 우리 이름을 붙이고 카드에 붙입니다. 나머지는 «숨기기».
 *
 * 후보함의 파일은 건드리지 않습니다. 마그니픽 동기화는 «지운 파일을 다시 내려받는다»
 * 고 스스로 밝히고 있어서(설정 화면 안내문), 옮기거나 지우면 곧 되살아납니다.
 * 처리한 것은 project.json 의 magnificHandled 에 적어 목록에서만 뺍니다.
 *
 * 창이 활성화될 때·10초마다 봅니다 — 마그니픽에서 돌아오는 순간이 곧 도착한 순간입니다.
 */
/** 어느 탭에서 보는가. 주면 그 탭 것(과 주인을 모르는 것)만 보입니다. */
export type InboxScope = "character" | "background" | "cut";

export default function MagnificInboxPanel({
  draft,
  patch,
  projectName,
  scope,
}: {
  draft: ProjectDraft;
  patch: (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => void;
  projectName: string;
  /**
   * 탭별로 나눠 보기().
   * 추정한 주인의 갈래로 가릅니다. 영상은 컷에만 가고, 에셋은 캐릭터·배경 페이지 양쪽에 있으니
   * 두 탭에서 보이며, 주인을 모르는 것은 어느 탭에서든 보이되 «누구 것?» 목록은 그 탭 갈래만 줍니다.
   * 안 주면(작업실·확인 단계) 전부 보입니다.
   */
  scope?: InboxScope;
}) {
  const [files, setFiles] = useState<ProjectInboxFile[]>([]);
  // 펼친 채가 기본입니다. 대신 목록 높이를 제한해 후보가 많아도 아래 단계 화면은 남깁니다.
  const [open, setOpen] = useState(true);
  const [choice, setChoice] = useState<Record<string, string>>({});
  /** 주인은 몰라도 갈래(캐릭터/배경/컷)만 짐작한 것. 탭을 가르는 데 씁니다. */
  const [kindHint, setKindHint] = useState<Record<string, MagnificOwnerHint["kind"] | undefined>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  /** 크게 보기로 연 후보. 작은 타일로는 A·B·C컷을 가를 수 없습니다. */
  const [viewing, setViewing] = useState<ProjectInboxFile | null>(null);
  // 리스너는 한 번만 달리는데 draft·patch 는 렌더마다 새것이라 ref 로 최신을 봅니다.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const busy = useRef(false);

  const targets = useMemo(() => listMagnificTargets(draft), [draft]);
  const handled = draft.magnificHandled || {};
  const hiddenCount = Object.values(handled).filter((item) => item.status === "hidden").length;
  const bouncedCount = Object.values(handled).filter((item) => item.reason === "sent-back").length;

  /** 처리 기록을 남깁니다. 파일은 그대로 두고 목록에서만 뺍니다. */
  const mark = (entries: Record<string, MagnificHandled>, extra?: (current: ProjectDraft) => Partial<ProjectDraft>) =>
    patchRef.current((current) => ({
      ...(extra ? extra(current) : {}),
      magnificHandled: { ...(current.magnificHandled || {}), ...entries },
    }));

  const scan = async () => {
    if (busy.current || !projectName.trim()) return;
    busy.current = true;
    try {
      const found = await listProjectInbox({ projectName });
      found.sort((a, b) => b.modifiedMs - a.modifiedMs);
      setFiles(found);
      /*
        우리가 마그니픽에 붙여넣은 그림이 되돌아온 것은 바로 숨깁니다.
        마그니픽이 붙여넣은 그림을 생성물로 올리고 동기화가 다시 내려주기 때문입니다.
        사람이 숨긴 것과 구분해 reason 을 남깁니다.
      */
      const handledNow = draftRef.current.magnificHandled || {};
      const bounced = found.filter((file) => !handledNow[file.relativePath] && isMagnificSentFile(file.fingerprint));
      if (bounced.length) {
        const now = Date.now();
        mark(Object.fromEntries(bounced.map((file) => [file.relativePath, { status: "hidden" as const, at: now, reason: "sent-back" as const }])));
      }
      // 새로 온 것만 미리 골라 둡니다. 사람이 바꾼 선택은 건드리지 않습니다.
      const currentTargets = listMagnificTargets(draftRef.current);
      setChoice((current) => {
        const next = { ...current };
        for (const file of found) {
          if (next[file.filePath] !== undefined) continue;
          const guess = guessMagnificOwner(file.name, currentTargets, file.modifiedMs);
          const videoOk = guess?.kind === "cut" || guess?.kind === "scene";
          next[file.filePath] = guess && (file.kind === "image" || videoOk) ? guess.key : "";
        }
        return next;
      });
      setKindHint((current) => {
        const next = { ...current };
        for (const file of found) {
          if (file.filePath in next) continue;
          next[file.filePath] = guessMagnificKind(file.name, file.modifiedMs);
        }
        return next;
      });
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    void scan();
    const onFocus = () => void scan();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void scan(), 10_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName]);

  const forget = (paths: string[]) => {
    const gone = new Set(paths);
    setPicked((set) => new Set([...set].filter((path) => !gone.has(path))));
  };

  /** «채택» — 복사하고, 이름 붙이고, 카드에 붙입니다. */
  const adopt = async (file: ProjectInboxFile, target: MagnificTarget): Promise<boolean> => {
    if (file.kind === "video" && target.kind !== "cut" && target.kind !== "scene") {
      toast.error("영상은 컷이나 장면에만 붙일 수 있습니다.");
      return false;
    }
    const imported = await claimProjectInboxFile({
      projectName,
      filePath: file.filePath,
      assetType: file.kind === "video" ? "scene-video" : target.assetType,
      ownerName: target.ownerName,
      // 변형에 채택하면 «인물_변형_001». 폴더는 부모 것이라도 파일 이름에 어느 판인지 남깁니다.
      stem: target.stem,
    });
    if (!imported) return false;
    mark(
      { [file.relativePath]: { status: "adopted", at: Date.now(), target: target.key } },
      (current) => attach(current, target, imported, file.kind),
    );
    forget([file.filePath]);
    return true;
  };

  const adoptMany = async (list: ProjectInboxFile[], targetKey: string) => {
    const target = targets.find((item) => item.key === targetKey);
    if (!target) return;
    let done = 0;
    for (const file of list) if (await adopt(file, target)) done += 1;
    if (done) toast.success(`${target.label} 에 ${done}개 붙였습니다.`);
  };

  /** «숨기기» — 안 쓸 후보. 파일은 두고 기록만. 마그니픽 쪽에서 지워야 진짜로 사라집니다. */
  const hideMany = (list: ProjectInboxFile[]) => {
    if (!list.length) return;
    const now = Date.now();
    mark(Object.fromEntries(list.map((file) => [file.relativePath, { status: "hidden" as const, at: now }])));
    forget(list.map((file) => file.filePath));
  };

  const unhideAll = () =>
    patchRef.current((current) => ({
      magnificHandled: Object.fromEntries(
        Object.entries(current.magnificHandled || {}).filter(([, item]) => item.status !== "hidden"),
      ),
    }));

  const pending = files.filter((file) => !handled[file.relativePath]);
  /**
   * 이 자리가 지금 탭 것인가 — 세 군데(타일 select · 일괄 select · 보이기)가 같은 규칙을 씁니다.
   * 보유 에셋은 주인 탭에만, 공용 에셋(ownerKind 없음)은 캐릭터·배경 양 탭에, 컷은 컷 탭에만.
   */
  const inScope = (item: MagnificTarget) => {
    if (!scope) return true;
    if (scope === "cut") return item.kind === "cut" || item.kind === "scene";
    if (item.kind === "asset") return !item.ownerKind || item.ownerKind === scope;
    return item.kind === scope;
  };
  /** 이 탭에서 보일 것인가 — 사람이 고른 주인이 먼저, 없으면 갈래 짐작. 둘 다 없으면 «모름» — 어느 탭에서든. */
  const fitsScope = (file: ProjectInboxFile) => {
    if (!scope) return true;
    if (file.kind === "video") return scope === "cut";
    const chosen = targets.find((item) => item.key === (choice[file.filePath] || ""));
    if (chosen) return inScope(chosen);
    const kind = kindHint[file.filePath];
    if (!kind) return true;
    if (kind === "asset") return scope !== "cut";
    return kind === scope;
  };
  /** 이 탭에서 고를 수 있는 주인. 영상은 컷뿐, 그림은 탭 갈래(+그 탭의 보유 에셋+공용 에셋). */
  const optionsFor = (file: ProjectInboxFile) => {
    if (file.kind === "video")
      return targets.filter((item) => item.kind === "cut" || item.kind === "scene");
    return targets.filter(inScope);
  };
  const visible = pending.filter(fitsScope);
  const elsewhere = pending.length - visible.length;
  if (!visible.length && !hiddenCount && !elsewhere) return null;

  const selected = visible.filter((file) => picked.has(file.filePath));
  const togglePick = (path: string) =>
    setPicked((set) => {
      const next = new Set(set);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <section
      className="mb-3 rounded-xl"
      style={{ background: "oklch(0.14 0.009 265)", border: "1px solid oklch(0.72 0.14 200 / 35%)" }}
    >
      {viewing && (
        <ImageLightbox
          image={{ name: viewing.name, thumb: assetSrc(viewing.filePath), filePath: viewing.filePath }}
          onClose={() => setViewing(null)}
        />
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2" data-tour="inbox-panel">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          /* 접혀 있으면 후보 타일도 «크게 보기» 도 없습니다 — 안내 창이 먼저 여기를 펴 줍니다. */
          data-tour-switch="shelf-inbox-zoom"
          data-tour-switch-kind="expand"
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs font-semibold text-white"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {visible.length
            ? `마그니픽에서 온 것 ${visible.length}개${scope ? " (이 탭 것)" : ""} — ${open ? "쓸 것만 채택하세요" : "눌러서 펼치기"}`
            : elsewhere
              ? `이 탭에 온 것 없음 — 다른 탭 것 ${elsewhere}개`
              : "마그니픽 새 후보 없음"}
          {visible.length > 0 && elsewhere > 0 && (
            <span className="font-normal" style={{ color: "oklch(0.55 0.01 265)" }}>· 다른 탭 것 {elsewhere}개</span>
          )}
        </button>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: "oklch(0.62 0.01 265)" }}>
          {hiddenCount > 0 && (
            <button type="button" onClick={unhideAll} className="flex items-center gap-1" title="숨긴 후보를 다시 보입니다">
              <EyeOff className="h-3 w-3" /> 숨긴 것 {hiddenCount}개 되살리기
              {bouncedCount > 0 && ` (보낸 그림이 되돌아온 것 ${bouncedCount})`}
            </button>
          )}
          <button
            type="button"
            onClick={() => void openProjectInbox({ projectName })}
            className="flex items-center gap-1"
            title="후보함 폴더를 엽니다. 마그니픽 데스크톱에서 이 폴더 하나만 동기화하면 됩니다."
          >
            <FolderSync className="h-3 w-3" /> 후보함 열기
          </button>
        </div>
      </div>

      {open && visible.length > 0 && (
        <div className="space-y-2 px-3 pb-3">
          {/* 높이를 제한해 안에서만 스크롤합니다. 후보가 수십 장이어도 아래 화면은 남습니다. */}
          <div className="flex max-h-[40vh] flex-wrap gap-2 overflow-y-auto pr-1">
            {visible.map((file) => {
              const key = choice[file.filePath] || "";
              const target = targets.find((item) => item.key === key);
              const options = optionsFor(file);
              return (
                <div
                  key={file.filePath}
                  className="w-[176px] space-y-1 rounded-lg p-2"
                  style={{
                    background: picked.has(file.filePath) ? "oklch(0.62 0.22 290 / 14%)" : "oklch(1 0 0 / 4%)",
                    border: `1px solid ${picked.has(file.filePath) ? "oklch(0.62 0.22 290 / 45%)" : "oklch(1 0 0 / 8%)"}`,
                  }}
                >
                  <div className="relative">
                  {file.kind === "image" && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setViewing(file);
                      }}
                      data-tour="shelf-inbox-zoom"
                      title="크게 보기"
                      className="absolute right-1 top-1 z-10 rounded-full p-1"
                      style={{ background: "oklch(0 0 0 / 72%)", color: "white" }}
                    >
                      <ExpandIcon className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => togglePick(file.filePath)}
                    className="block w-full overflow-hidden rounded"
                    title={`${file.name} — 눌러서 고르기`}
                  >
                    {file.kind === "video" ? (
                      <video src={assetSrc(file.filePath)} muted preload="metadata" className="aspect-video w-full object-cover" />
                    ) : (
                      <img src={assetSrc(file.filePath)} alt={file.name} className="aspect-square w-full object-cover" />
                    )}
                  </button>
                  </div>
                  <p className="truncate text-[10px]" title={file.name} style={{ color: "oklch(0.62 0.01 265)" }}>
                    {file.kind === "video" ? "🎬 " : ""}
                    {file.name}
                  </p>
                  <div className="flex items-center gap-1">
                    <select
                      value={key}
                      onChange={(event) => setChoice((current) => ({ ...current, [file.filePath]: event.target.value }))}
                      className="min-w-0 flex-1 rounded px-1 py-0.5 text-[11px]"
                      style={{ background: "oklch(0.11 0.008 265)", color: "white", border: "1px solid oklch(1 0 0 / 10%)" }}
                    >
                      <option value="">누구 것?</option>
                      {options.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!target}
                      onClick={() => target && void adopt(file, target).then((ok) => ok && toast.success(`${target.label} 에 붙였습니다.`))}
                      className="shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40"
                      style={{ background: "oklch(0.62 0.22 290 / 20%)", color: "oklch(0.84 0.19 290)" }}
                    >
                      채택
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 여러 개 한 번에. 고른 것이 없으면 «전부» 를 숨깁니다. */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "oklch(0.62 0.01 265)" }}>
            <span>{selected.length ? `${selected.length}개 고름` : "타일을 눌러 여러 개 고를 수 있습니다"}</span>
            <select
              value={bulkTarget}
              onChange={(event) => setBulkTarget(event.target.value)}
              className="rounded px-1 py-0.5"
              style={{ background: "oklch(0.11 0.008 265)", color: "white", border: "1px solid oklch(1 0 0 / 10%)" }}
            >
              <option value="">고른 것을 …에 채택</option>
              {targets.filter(inScope).map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selected.length || !bulkTarget}
              onClick={() => void adoptMany(selected, bulkTarget)}
              className="rounded px-2 py-0.5 font-semibold disabled:opacity-40"
              style={{ background: "oklch(0.62 0.22 290 / 20%)", color: "oklch(0.84 0.19 290)" }}
            >
              채택
            </button>
            <button
              type="button"
              onClick={() => hideMany(selected.length ? selected : visible)}
              className="flex items-center gap-1 rounded px-2 py-0.5"
              style={{ color: "oklch(0.7 0.16 25)" }}
              title="안 쓸 후보를 목록에서 뺍니다. 파일은 그대로 둡니다 — 마그니픽 동기화가 지운 파일을 다시 내려받기 때문입니다."
            >
              <EyeOff className="h-3 w-3" /> {selected.length ? "고른 것 숨기기" : "전부 숨기기"}
            </button>
          </div>
          <p className="text-[10px]" style={{ color: "oklch(0.48 0.01 265)" }}>
            후보함의 파일은 옮기거나 지우지 않습니다 — 마그니픽 동기화가 지운 파일을 다시 내려받습니다. 진짜로 없애려면 마그니픽에서 지우세요.
          </p>
        </div>
      )}
    </section>
  );
}

/** 채택한 것을 초안의 해당 자리에 끼워 넣습니다. 늘 «지금 값» 에서 만듭니다. */
function attach(
  current: ProjectDraft,
  target: MagnificTarget,
  imported: MagnificImportedFile,
  kind: "image" | "video",
): Partial<ProjectDraft> {
  const image = (list: GeneratedImageAsset[] | undefined): GeneratedImageAsset => ({
    id: uid(),
    name: imported.name,
    thumb: "",
    file: null,
    filePath: imported.filePath,
    sourceName: imported.sourceName,
    isPrimary: !(list || []).length,
  });
  const append = <T extends { generatedImages: GeneratedImageAsset[] }>(entity: T): T => ({
    ...entity,
    generatedImages: [...(entity.generatedImages || []), image(entity.generatedImages)],
  });
  /**
   * 원본이면 원본에, 변형이면 그 변형에. 인물·장소·공용 에셋·보유 에셋이 전부 «원본 + variations[]»
   * 모양이라 하나로 됩니다 — 갈래마다 따로 적으면 변형 처리를 한 갈래만 빠뜨립니다.
   */
  const appendAt = <V extends { id: string; generatedImages: GeneratedImageAsset[] }, T extends { generatedImages: GeneratedImageAsset[]; variations?: V[] }>(
    entity: T,
    variationId: string | undefined,
  ): T => {
    if (!variationId) return append(entity);
    return {
      ...entity,
      variations: (entity.variations || []).map((variation) => (variation.id === variationId ? append(variation) : variation)),
    };
  };

  // 다른 원본 — 주인(rootId)의 alternates 안에서 alternateId 를 찾아 그 원본 또는 그 변형에 붙입니다.
  // 보유 에셋 분기보다 앞에 둡니다 — `kind` 가 주인 갈래 그대로라 아래 character/background 분기가
  // 먼저 잡으면 주인 원본에 붙어 버립니다.
  if (target.alternateId) {
    const withAlternate = <
      O extends {
        id: string;
        generatedImages: GeneratedImageAsset[];
        variations?: { id: string; generatedImages: GeneratedImageAsset[] }[];
        alternates?: O[];
      },
    >(
      owner: O,
    ): O =>
      owner.id !== target.rootId
        ? owner
        : {
            ...owner,
            alternates: (owner.alternates || []).map((alternate) =>
              alternate.id === target.alternateId ? appendAt(alternate, target.variationId) : alternate,
            ),
          };
    return target.ownerKind === "background"
      ? { backgrounds: current.backgrounds.map(withAlternate) }
      : { characters: current.characters.map(withAlternate) };
  }
  // 보유 에셋 — 주인(rootId)의 assets 안에서 assetId 를 찾아 원본 또는 그 변형에 붙입니다.
  if (target.assetId) {
    const withAsset = <O extends { id: string; assets: VisualAsset[] }>(owner: O): O =>
      owner.id !== target.rootId
        ? owner
        : {
            ...owner,
            assets: owner.assets.map((asset) => (asset.id === target.assetId ? appendAt(asset, target.variationId) : asset)),
          };
    return target.ownerKind === "background"
      ? { backgrounds: current.backgrounds.map(withAsset) }
      : { characters: current.characters.map(withAsset) };
  }
  if (target.kind === "character") {
    return {
      characters: current.characters.map((character) =>
        character.id === target.rootId ? appendAt(character, target.variationId) : character,
      ),
    };
  }
  if (target.kind === "background") {
    return {
      backgrounds: current.backgrounds.map((background) =>
        background.id === target.rootId ? appendAt(background, target.variationId) : background,
      ),
    };
  }
  if (target.kind === "asset") {
    return {
      sharedAssets: (current.sharedAssets || []).map((asset) =>
        asset.id === target.rootId ? appendAt(asset, target.variationId) : asset,
      ),
    };
  }
  /*
    장면 자리 — 씬 영상 하나. 컷이 아니라 장면에 붙습니다.
    
  */
  if (target.kind === "scene") {
    return {
      scenes: current.scenes.map((scene) =>
        scene.id !== target.sceneId
          ? scene
          : {
              ...scene,
              videos: [
                ...(scene.videos || []),
                { id: uid(), name: imported.name, filePath: imported.filePath },
              ],
            },
      ),
    };
  }
  return {
    scenes: current.scenes.map((scene) =>
      scene.id !== target.sceneId
        ? scene
        : {
            ...scene,
            cuts: scene.cuts.map((cut) => {
              if (cut.id !== target.cutId) return cut;
              if (kind === "video") {
                return {
                  ...cut,
                  videos: [...(cut.videos || []), { id: uid(), name: imported.name, filePath: imported.filePath }],
                };
              }
              return { ...cut, images: [...(cut.images || []), image(cut.images)] };
            }),
          },
    ),
  };
}
