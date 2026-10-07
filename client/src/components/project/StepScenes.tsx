import { useEffect, useRef, useState } from "react";
import { expectEmptyProjectSave } from "@/lib/localProjectStore";
import { ChevronDown, ChevronRight, Clapperboard, Film, Plus, Trash2 } from "lucide-react";
import { confirmDialog } from "@/components/ConfirmDialog";
import { deleteCutFiles, deleteSceneFiles } from "@/lib/mediaLibrary";
import AutoTextarea from "@/components/AutoTextarea";
import CutCard from "@/components/project/CutCard";
import NaturalPromptButton from "@/components/NaturalPromptButton";
import SceneStoryboard from "@/components/project/SceneStoryboard";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import { newCut, newScene, type Cut, type ProjectDraft, type Scene } from "@/lib/projectTypes";
import { fieldStyle } from "@/components/project/fieldStyle";
import { TUTORIAL_CUT_EVENT } from "@/lib/tutorialStore";
import { sceneEditorStore } from "@/lib/sceneEditorState";
import { useEditorDisclosure } from "./useSceneSelection";
import { scenePanelId } from "./SceneNavigation";
import { useT } from "@/lib/i18n";

/**
 * 3단계 — 장면과 컷, 그리고 이 작품이 쓸 **장소·에셋**.
 *
 * 컷 하나가 영상 한 토막입니다. 여기서는 **무엇이 나오는지**만 정합니다 —
 * 어느 인물이, 어느 장소에서. 카메라를 어디 두고 인물을 어떻게 세울지는
 * 구도잡기에서 정하고, 그 결과가 컷에 붙습니다.
 *
 * 컷 프롬프트를 LLM 에게 통째로 맡기지 않는 이유가 있습니다. 구도잡기에서
 * 읽은 샷 크기·앵글·무빙은 **사실**입니다. 그걸 LLM 에 넘기면 임의로
 * 바꿔 버립니다. 규칙이 사실을 만들고 LLM 은 문장만 다듬는 2단계라야 합니다.
 */
export default function StepScenes({
  draft,
  onChange,
  controlCutRequest,
  onControlRequestHandled,
  selectedSceneId,
  onSelectScene,
  editorStateKey,
  getCurrentDraft,
}: {
  draft: ProjectDraft;
  selectedSceneId: string | null;
  onSelectScene: (id: string) => void;
  editorStateKey: string;
  getCurrentDraft: () => ProjectDraft;
  controlCutRequest?: { cutId: string } | null;
  onControlRequestHandled?: () => void;
  /**
   * 초안을 고칩니다. **지금 값을 받아 다음 값을 만드는 함수** 여야 합니다.
   *
   * 값으로 덮어쓰면, LLM 요청이 도는 사이에 카드를 더하거나 지웠을 때
   * 나중에 도착한 갱신이 그 사이 변경을 통째로 지웁니다.
   */
  onChange: (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => void;
}) {
  const t = useT();
  const handledControlRequest = useRef<{ cutId: string } | null | undefined>(null);
  useEffect(() => {
    if (!controlCutRequest || handledControlRequest.current === controlCutRequest) return;
    const scene = draft.scenes.find(item => item.cuts.some(cut => cut.id === controlCutRequest.cutId));
    if (!scene) return;
    handledControlRequest.current = controlCutRequest;
    sceneEditorStore.disclose(editorStateKey, scene.id, "scene", true);
    sceneEditorStore.disclose(editorStateKey, controlCutRequest.cutId, "cut", true);
    onSelectScene(scene.id);
    // 소비된 화면 이동 요청은 부모에서 비웁니다. 단계 재방문이 수동 선택을 덮지 않습니다.
    onControlRequestHandled?.();
  }, [controlCutRequest, draft.scenes, onSelectScene, editorStateKey, onControlRequestHandled]);

  const add = () => {
    const created = newScene();
    onChange((current) => ({ scenes: [...current.scenes, created] }));
    onSelectScene(created.id);
  };

  /*
    ── 튜토리얼이 컷 하나를 펴 둡니다 ─────────────────────────────────────
    

    접힌 컷은 머리줄(«구도잡기» · «구도 불러오기»)만 보입니다. 그 아래 `cut-…` 자리들은 펴야
    생기므로, 그런 걸음에 이르면 첫 컷을 펴 둡니다. 장면이나 컷이 아직 없으면 만들어서라도 —
    없는 자리를 가리키며 「여기 있습니다」 라고 할 수는 없습니다.
  */
  const [tutorialCutId, setTutorialCutId] = useState<string | null>(null);
  useEffect(() => {
    const onWant = () => {
      const scene = draft.scenes.find(item => item.id === selectedSceneId) ?? draft.scenes[0];
      if (!scene) {
        const created = newScene();
        onChange((current) => ({ scenes: [...current.scenes, created] }));
        onSelectScene(created.id);
        setTutorialCutId(created.cuts[0]?.id ?? null);
        return;
      }
      sceneEditorStore.disclose(editorStateKey, scene.id, "scene", true);
      onSelectScene(scene.id);
      const cut = scene.cuts[0];
      if (cut) {
        setTutorialCutId(cut.id);
        return;
      }
      const created = newCut(1);
      onChange((current) => ({
        scenes: current.scenes.map((item) =>
          item.id === scene.id ? { ...item, cuts: [...item.cuts, created] } : item,
        ),
      }));
      setTutorialCutId(created.id);
    };
    window.addEventListener(TUTORIAL_CUT_EVENT, onWant);
    return () => window.removeEventListener(TUTORIAL_CUT_EVENT, onWant);
  }, [draft.scenes, onChange, selectedSceneId, onSelectScene, editorStateKey]);

  const patchScene = (id: string, updater: (current: Scene) => Partial<Scene>) =>
    onChange((current) => ({
      scenes: current.scenes.map((item) => (item.id === id ? { ...item, ...updater(item) } : item)),
    }));

  const { projectName } = useProjectMedia();
  const remove = async (scene: Scene) => {
    // 화면에서 지우면 폴더의 원본도 지웁니다. 캐릭터·배경과 같은 규칙입니다. (지시 307)
    const ok = await confirmDialog({
      title: `${scene.title || "이름 없는 장면"} 을 지울까요?`,
      description:
        `컷 ${scene.cuts.length}개와 스토리보드·씬 영상이 함께 사라집니다. ` +
        "저장 폴더의 원본 파일(그림·영상)도 함께 지워집니다. 되돌릴 수 없습니다.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!ok) return;
    expectEmptyProjectSave();
    onChange((current) => ({ scenes: current.scenes.filter((item) => item.id !== scene.id) }));
    for (const cut of scene.cuts) void deleteCutFiles(projectName, cut);
    // 스토리보드 시트와 씬 영상도 장면 것입니다.
    void deleteSceneFiles(projectName, scene);
  };

  return (
    <div className="space-y-3">
      {/*
        ── 장소·배경 에셋은 **구도잡기 안**에 있습니다 ───────────────────
        , 「방 추가 → 전개도 입혀지지 않은 방에서 캐릭터
        배치랑 공간 크기 보고 → 방 수치 세팅 완료 후 전개도 생성 → 전개도 입힌 다음 오브젝트 배치 → 오브젝트에 연결된 에셋 시트
        생성 → 오브젝트랑 에셋 매칭」.

        배경은 «혼자 만드는 것» 이 아니라 구도잡기에서 방을 세울 때 필요한 것이라, 만드는 자리도 거기입니다. 여기 씬 단계에는
        장면과 컷만 남습니다.
      */}
      {/* 빈 상태는 캐릭터·배경과 같은 꼴입니다. 단계마다 다르게 생기면
          «여기는 뭔가 덜 만들어졌나» 싶어집니다. */}
      {draft.scenes.length === 0 && (
        <div
          className="flex flex-col items-center gap-3 rounded-xl px-4 py-10"
          style={{ border: "2px dashed oklch(1 0 0 / 10%)" }}
        >
          <Clapperboard className="h-8 w-8" style={{ color: "oklch(0.35 0.01 265)" }} />
          <p className="text-xs" style={{ color: "oklch(0.52 0.01 265)" }}>
            등록된 장면이 없습니다
          </p>
          <button
            type="button"
            onClick={add}
            data-tour="scenes-add"
            className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-semibold"
            style={{
              background: "oklch(0.70 0.15 160 / 16%)",
              border: "1px solid oklch(0.70 0.15 160 / 40%)",
              color: "oklch(0.84 0.15 160)",
            }}
          >
            <Plus className="h-3.5 w-3.5" /> 첫 장면 추가하기
          </button>
          <p className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
            장면 없이도 계속 진행할 수 있습니다
          </p>
        </div>
      )}

      {/* 탭의 관계 대상만 남깁니다. 다른 씬의 컷·스토리보드 본문은 마운트하지 않습니다. */}
      {draft.scenes.map((scene, index) => (
        <div key={scene.id} id={scenePanelId(scene.id)} role="tabpanel" aria-label={`${t("씬 {n}", { n: index + 1 })}${scene.title ? ` · ${scene.title}` : ""}`}
          hidden={scene.id !== selectedSceneId} tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          style={{ scrollMarginTop: "var(--scene-scroll-offset, 160px)" }}>
        {scene.id === selectedSceneId && <SceneCard
          scene={scene}
          index={index}
          draft={draft}
          editorStateKey={editorStateKey}
          getCurrentDraft={getCurrentDraft}
          onPatch={(updater) => patchScene(scene.id, updater)}
          onChange={onChange}
          onRemove={() => void remove(scene)}
          tutorialCutId={tutorialCutId}
        />}
        </div>
      ))}

      {/* 빈 상태 박스 안에 이미 같은 버튼이 있습니다. 둘 다 두면 어느 쪽을
          눌러야 하는지 잠깐 헷갈립니다. */}
      {draft.scenes.length > 0 && (
        <button
          type="button"
          onClick={add}
          data-tour="scenes-add"
          className="flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-xs font-semibold"
          style={{ background: "oklch(0.70 0.15 160 / 14%)", color: "oklch(0.82 0.15 160)" }}
        >
          <Plus className="h-3.5 w-3.5" /> 장면 추가
        </button>
      )}

      {/* 하단 상태줄 — 컷이 접혀 있으면 프롬프트가 어디 있는지 안 보입니다. */}
      {draft.scenes.length > 0 && (
        <p className="text-center text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
          {t("컷과 연출 설정은 기본으로 펼쳐집니다. 화살표로 접거나 다시 펼칠 수 있습니다.")}
        </p>
      )}
    </div>
  );
}

function SceneCard({
  scene,
  index,
  draft,
  editorStateKey,
  getCurrentDraft,
  onPatch,
  onChange,
  onRemove,
  tutorialCutId,
}: {
  scene: Scene;
  index: number;
  draft: ProjectDraft;
  editorStateKey: string;
  getCurrentDraft: () => ProjectDraft;
  /** 튜토리얼이 펴 두라고 고른 컷. 그 컷이 이 장면에 있으면 펴집니다. */
  tutorialCutId: string | null;
  onPatch: (updater: (current: Scene) => Partial<Scene>) => void;
  /** 초안 전체를 고칩니다 — 구도잡기에서 만든 장소는 장면이 아니라 프로젝트에 붙습니다. */
  onChange: (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => void;
  onRemove: () => void;
}) {
  const { projectContext } = useProjectMedia();
  const [open, setOpen] = useEditorDisclosure(editorStateKey, scene.id, "scene");
  const t = useT();

  const patchCut = (cutId: string, patch: Partial<Cut> | ((cut: Cut) => Partial<Cut>)) =>
    onPatch((current) => ({
      cuts: current.cuts.map((cut) =>
        cut.id === cutId ? { ...cut, ...(typeof patch === "function" ? patch(cut) : patch) } : cut,
      ),
    }));

  const addCut = () =>
    onPatch((current) => ({ cuts: [...current.cuts, newCut(current.cuts.length + 1)] }));

  const { projectName } = useProjectMedia();
  const removeCut = async (cut: Cut) => {
    const ok = await confirmDialog({
      title: `컷 ${cut.order} 를 지울까요?`,
      description: "저장 폴더의 원본 파일(그림·영상)도 함께 지워집니다. 되돌릴 수 없습니다.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!ok) return;
    void deleteCutFiles(projectName, cut);
    // 번호를 다시 매깁니다. 중간을 지우면 3, 5, 6 처럼 비어 버립니다.
    onPatch((current) => ({
      cuts: current.cuts
        .filter((item) => item.id !== cut.id)
        .map((item, order) => ({ ...item, order: order + 1 })),
    }));
  };

  return (
    <section
      className="rounded-xl"
      style={{ background: "oklch(0.14 0.009 265)", border: "1px solid oklch(1 0 0 / 8%)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={() => setOpen(!open)} className="shrink-0" aria-label={t(open ? "장면 접기" : "장면 펼치기")} aria-expanded={open}>
          {open ? (
            <ChevronDown className="h-4 w-4" style={{ color: "oklch(0.60 0.01 265)" }} />
          ) : (
            <ChevronRight className="h-4 w-4" style={{ color: "oklch(0.60 0.01 265)" }} />
          )}
        </button>
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
          style={{ background: "oklch(0.70 0.15 160 / 18%)", color: "oklch(0.84 0.15 160)" }}
        >
          {index + 1}
        </span>
        <input
          value={scene.title}
          onChange={(event) => onPatch(() => ({ title: event.target.value }))}
          placeholder="장면 제목"
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold outline-none"
          style={{ color: "white" }}
        />
        <span className="shrink-0 text-[10px]" style={{ color: "oklch(0.48 0.01 265)" }}>
          컷 {scene.cuts.length}개
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="지우기"
          className="shrink-0 rounded p-1.5 hover:bg-white/10"
          style={{ color: "oklch(0.60 0.15 25)" }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t px-3 pb-3 pt-3" style={{ borderColor: "oklch(1 0 0 / 8%)" }}>
          <div>
            {/*
              장면 요약도 프롬프트로 갑니다 — 씬 영상 프롬프트의 첫 줄입니다.
              그래서 컷·대사·VFX 와 **같은 단추**를 답니다(규칙 1).
            */}
            <div className="mb-1 flex items-center justify-end">
              <NaturalPromptButton
                text={scene.summary}
                kind="scene"
                isVideo
                people={[...new Set(scene.cuts.flatMap((cut) => cut.characterIds || []))]
                  .map((id) => draft.characters.find((item) => item.id === id)?.name)
                  .filter((name): name is string => Boolean(name))}
                context={projectContext}
                onApply={(ko) => onPatch(() => ({ summary: ko }))}
              />
            </div>
            <AutoTextarea
              value={scene.summary}
              onChange={(event) => onPatch(() => ({ summary: event.target.value }))}
              placeholder="이 장면에서 무슨 일이 일어나는지"
              data-tour="scene-summary"
              className="w-full rounded-md px-2.5 py-2 text-xs outline-none"
              style={fieldStyle}
            />
          </div>

          {scene.cuts.map((cut) => (
            <CutCard
              key={cut.id}
              editorStateKey={editorStateKey}
              getCurrentDraft={getCurrentDraft}
              tutorialOpen={cut.id === tutorialCutId}
              cut={cut}
              scene={scene}
              scenes={draft.scenes}
              index={index}
              sceneTitle={scene.title}
              sceneSummary={scene.summary}
              characters={draft.characters}
              backgrounds={draft.backgrounds}
              projectAspect={draft.aspect?.image}
              imageModel={draft.magnific?.imageModel}
              videoModel={draft.magnific?.videoModel}
              videoAspect={draft.aspect?.video}
              /*
                **이 프로젝트에서 잡아 둔 구도들.**
                지금 컷은 뺍니다 — 제 구도를 제게 불러올 일은 없습니다.
              */
              savedShots={draft.scenes.flatMap((other, otherIndex) =>
                other.cuts
                  .filter((entry) => entry.id !== cut.id && entry.composition)
                  .map((entry) => ({
                    id: entry.id,
                    label: `${other.title || `장면 ${otherIndex + 1}`} · 컷 ${entry.order}`,
                    thumb: entry.guideImagePath || entry.guideImage,
                    composition: entry.composition!,
                  })),
              )}
              context={projectContext}
              patchCut={(patch) => patchCut(cut.id, patch)}
              onRemove={() => void removeCut(cut)}
              // 구도잡기에서 만든 장소는 **프로젝트**에 들어갑니다 — 장면마다 따로 두면 같은 골목이 컷마다 달라집니다.
              onCreateBackground={(background) => onChange((current) => ({ backgrounds: [...current.backgrounds, background] }))}
              /*
                구도잡기 안에서 연 장소 카드도 **씬 탭의 그 카드**입니다 — 고친 것이 곧바로 프로젝트에 들어가야
                두 자리가 갈라지지 않습니다(공통 규칙 1).
              */
              onPatchBackground={(id, updater) =>
                onChange((current) => ({
                  backgrounds: current.backgrounds.map((item) =>
                    item.id === id ? { ...item, ...updater(item) } : item,
                  ),
                }))
              }
              onRemoveBackground={(id) =>
                onChange((current) => ({
                  backgrounds: current.backgrounds.filter((item) => item.id !== id),
                }))
              }
              /*
                장소 라이브러리(옛 «배경» 단계) — 구도잡기 환경 탭에서 창으로 엽니다. 초안을 통째로 넘기는 까닭은
                그 화면이 계보·다른 원본·보유 에셋까지 다루기 때문입니다.
              */
              placeLibrary={{ draft, onChange }}
              /* 방 라이브러리는 **프로젝트** 것입니다 — 다른 씬의 다른 컷에서 같은 방을 꺼내 씁니다. */
              onChangeSharedAssets={(update) =>
                onChange((current) => ({ sharedAssets: update(current.sharedAssets || []) }))
              }
              roomPresets={draft.roomPresets}
              onSaveRoomPreset={(preset) =>
                onChange((current) => ({ roomPresets: [...(current.roomPresets || []), preset] }))
              }
              onRemoveRoomPreset={(id) =>
                onChange((current) => ({
                  roomPresets: (current.roomPresets || []).filter((item) => item.id !== id),
                }))
              }
            />
          ))}

          <button
            type="button"
            onClick={addCut}
            data-tour="scene-cut-add"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold"
            style={{ background: "oklch(1 0 0 / 5%)", color: "oklch(0.62 0.01 265)" }}
          >
            <Film className="h-3 w-3" /> 컷 추가
          </button>

          {/*
            스토리보드는 **컷 밑**에 둡니다. 컷 그림을 보고 별을 옮긴 다음 바로 굽는
            순서라, 위에 두면 화면을 위아래로 오가게 됩니다.
          */}
          <SceneStoryboard
            editorStateKey={editorStateKey}
            getCurrentDraft={getCurrentDraft}
            scene={scene}
            index={index}
            onPatch={onPatch}
            characters={draft.characters}
            backgrounds={draft.backgrounds}
            aspect={draft.aspect?.image}
            videoAspect={draft.aspect?.video}
          />
        </div>
      )}
    </section>
  );
}
