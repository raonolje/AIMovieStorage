import { pickedCharacterRefs } from "@/lib/promptPayloads";
import { useMemo, useState } from "react";
import { Clapperboard, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import PromptResultPanels from "@/components/PromptResultPanels";
import CutVideoShelf from "@/components/project/CutVideoShelf";
import SheetPreview from "@/components/project/SheetPreview";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import { composeInMagnific } from "@/lib/magnificCompose";
import {
  fileStem,
  safeFileName,
  saveProjectMediaAsset,
} from "@/lib/mediaLibrary";
import {
  buildStoryboardVideoPrompt,
  composeStoryboard,
  storyboardCells,
  storyboardNoteRoom,
  storyboardSize,
} from "@/lib/storyboardSheet";
import { LlmRequestButton } from "@/components/LlmRequestButton";
import { requestPromptFromLlm } from "@/lib/promptRequest";
import { useApiReady } from "@/lib/useApiReady";

import { cutVideoSecondsOf } from "@/lib/cutVideoPrompt";
import { cameraMovesOf } from "@/lib/compositionEdit";
import { describeCameraMoves } from "@/lib/cameraMoves";
import { characterLegend, objectLegend } from "@/lib/compositionLegend";
import { sceneFolderName } from "@/lib/projectNames";
import type { Background, Character, Scene } from "@/lib/projectTypes";
import type { StoryboardSwap } from "@/lib/storyboardSheet";

/**
 * 장면 **스토리보드** — 컷 대표 그림을 6000×6000 한 장으로 굽고, 그 한 장으로 영상까지.
 *
 * # 왜 장면 화면에 두는가
 *
 * 확인 탭에도 스토리보드가 있지만 그쪽은 **보는 자리**입니다(컷을 한 줄로 편 표).
 * 굽는 일은 컷 그림이 바로 옆에 있는 여기서 해야 «별을 옮기고 다시 굽기» 가 한 화면에서
 * 끝납니다. 확인 탭은 구운 결과와 씬 영상을 받아 보여 줍니다.
 */
export default function SceneStoryboard({
  scene,
  index,
  onPatch,
  characters = [],
  backgrounds = [],
  aspect = "16:9",
  videoAspect,
}: {
  scene: Scene;
  /** 장면 순번 — 제목이 없을 때 폴더 이름이 「장면 N」 이 됩니다. */
  index: number;
  onPatch: (updater: (current: Scene) => Partial<Scene>) => void;
  /** 프로젝트의 인물·장소. 시트와 함께 올릴 «무엇을 무엇으로» 를 여기서 찾습니다. */
  characters?: Character[];
  backgrounds?: Background[];
  /**
   * 작품이 정한 그림 비율. **칸 모양이 여기서 나옵니다.**
   *
   * 2026-09-18 점검: 칸이 16:9 로 못 박혀 있어 숏츠(9:16) 컷이 시트에서 잘렸습니다.
   */
  aspect?: string;
  /**
   * **영상** 비율. 칸 모양을 정하는 그림 비율과 다를 수 있습니다.
   *
   * 사용자 2026-09-18 점검: 씬 영상 프롬프트에 화면비가 아예 안 실리고 있었습니다.
   */
  videoAspect?: string;
}) {
  const { projectName, imageMarks } = useProjectMedia();
  /**
   * 이 장면에 나오는 인물 이름 — 맨 뒤 «바꾸지 마세요» 문장에 박습니다.
   *
   * 하나만 잠그면 「얼굴은 같은데 옷이 바뀐다」 가 됩니다. 이름을 박아야 그 사람으로 걸립니다.
   */
  const lockNames = useMemo(
    () =>
      [...new Set(scene.cuts.flatMap((cut) => cut.characterIds || []))]
        .map((id) => characters?.find((item) => item.id === id)?.name)
        .filter((name): name is string => Boolean(name)),
    [scene.cuts, characters],
  );
  const [baking, setBaking] = useState(false);
  /*
    표시(동선·카메라 무빙)는 **그림에 붙어** 있습니다 — 그림 선반의 «표시하기» 에서 그린 것이
    `imageMarks[파일경로]` 로 남고, 대표 그림이 바뀌면 그 그림의 표시가 따라옵니다.
    칸에 덧그리는 일과 프롬프트에 글로 싣는 일이 같은 목록을 써야 번호가 어긋나지 않습니다.
  */
  const cells = useMemo(
    () => storyboardCells(scene, imageMarks),
    [scene, imageMarks],
  );
  const markedCount = cells.filter((cell) => cell.marks?.length).length;
  /** 지금 구우면 나올 크기 — 굽기 전에 보여 줍니다(6000×6000 고정이 아닙니다). */
  const sheetSize = useMemo(
    () => storyboardSize(cells.length, storyboardNoteRoom(cells, aspect), aspect),
    [cells, aspect],
  );

  /**
   * 시트와 **함께 올리는 것들** — 인물 시트 · 소품 에셋 · 배경.
   *
   * 시트의 칸은 마네킹과 회색 상자입니다. 누구이고 무엇인지 말해 주지 않으면 생성기가
   * 마네킹을 그대로 그립니다. 칸에서 찾는 길은 **색**이고(캡처에 이름표가 안 나갑니다),
   * 그릴 근거는 **@시트**입니다.
   */
  const swaps = useMemo<StoryboardSwap[]>(() => {
    const out: StoryboardSwap[] = [];
    const seen = new Set<string>();
    const tagOf = (path?: string) => (path ? `@${fileStem(path)}` : undefined);

    for (const cell of cells) {
      const cut = cell.cut;
      // 인물 — 구도에 선 사람은 색으로, 아니면 이름으로.
      const legend = characterLegend(cut.composition, (id) => {
        const source = characters.find((item) => item.id === id);
        return source ? { name: source.name, gender: source.gender } : undefined;
      });
      const ids = legend.length
        ? legend.map((item) => item.characterId)
        : cut.characterIds;
      for (const id of ids) {
        if (seen.has(`c:${id}`)) continue;
        const source = characters.find((item) => item.id === id);
        if (!source) continue;
        seen.add(`c:${id}`);
        // 전부 뺀 인물([])은 시트 없이 이름만 — 규칙은 `pickedCharacterRefs` 한 곳.
        const picked = pickedCharacterRefs(cut, id);
        const auto =
          (source.generatedImages ?? []).find((item) => item.isCompositeSheet) ??
          (source.generatedImages ?? []).find((item) => item.isPrimary);
        out.push({
          kind: "character",
          name: source.name || "인물",
          color: legend.find((item) => item.characterId === id)?.color.ko,
          tag: tagOf(picked ? picked[0] : auto?.filePath),
        });
      }

      // 소품 — 색 이름으로 부르고, 에셋을 이어 두었으면 그 시트를 함께.
      for (const item of objectLegend(cut.composition)) {
        const key = `p:${item.color.ko}:${item.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const swapRef = cut.composition?.objects.find(
          (object) => object.id === item.id,
        )?.swapRef;
        const asset = swapRef
          ? backgrounds.find((entry) => entry.id === swapRef.id) ??
            characters.find((entry) => entry.id === swapRef.id)
          : undefined;
        out.push({
          kind: "prop",
          name: swapRef?.name || item.label,
          color: item.color.ko,
          tag: tagOf(
            (asset?.generatedImages ?? []).find((image) => image.isCompositeSheet)?.filePath ??
              (asset?.generatedImages ?? []).find((image) => image.isPrimary)?.filePath,
          ),
        });
      }

      // 배경 — 컷이 가리키는 장소 하나.
      const place = backgrounds.find((item) => item.id === cut.backgroundId);
      if (place && !seen.has(`b:${place.id}`)) {
        seen.add(`b:${place.id}`);
        out.push({
          kind: "background",
          name: place.name || "장소",
          tag: tagOf(
            (place.generatedImages ?? []).find((image) => image.isPrimary)?.filePath ??
              (place.generatedImages ?? [])[0]?.filePath,
          ),
        });
      }
    }
    return out;
  }, [cells, characters, backgrounds]);
  const missing = scene.cuts.length - cells.length;
  /** 키 이미지가 없어 **구도 그림**으로 채운 칸 수. */
  const guideCount = cells.filter((cell) => cell.image.id.startsWith("guide-")).length;

  /*
    ── 시트 한 장을 **API 로** 영상 프롬프트 만들기 ────────────────────
    

    여태 프롬프트는 **규칙으로만** 지었습니다(`buildStoryboardVideoPrompt`). 칸 순서와
    길이는 규칙이 정확하지만, 장면의 분위기와 연기를 문장으로 엮는 일은 규칙이 못 합니다.
    규칙 조립은 그대로 두고(시트를 구울 때 자동으로 채워집니다) 그 위에 API 를 얹습니다.
  */
  const apiReady = useApiReady();
  const [writing, setWriting] = useState(false);

  /** 요청문과 API 가 **같은 재료**를 봅니다(`promptRequest` 규칙). */
  const boardRequestData = () => {
    const built = buildStoryboardVideoPrompt({
      sceneTitle: scene.title,
      sceneSummary: scene.summary,
      cells,
      aspect: videoAspect,
      lockNames,
    });
    return {
      sceneTitle: scene.title || "장면",
      sceneSummary: scene.summary || "",
      sheetTag: scene.storyboardPath ? `@${fileStem(scene.storyboardPath)}` : null,
      swaps,
      totalSeconds: Number(built.seconds.toFixed(1)),
      clamped: built.clamped,
      // 길이·화면비·잠금은 늘 실어 보냅니다(공개 프롬프트 실측에서 가장 자주 빠지는 셋).
      aspect: videoAspect || null,
      lockNames: lockNames.length ? lockNames : null,
      cuts: cells.map((cell) => {
        const moves = cell.cut.composition ? cameraMovesOf(cell.cut.composition) : [];
        return {
          order: cell.cut.order,
          title: cell.cut.title || null,
          seconds: Number(
            cutVideoSecondsOf(cell.cut).toFixed(1),
          ),
          /*
            **영문 카메라 문장도 함께 보냅니다.**

            사용자 2026-09-18 점검에서 드러났습니다 — 한국어만 보내고 있었습니다. 그래서
            LLM 이 영문 칸을 스스로 번역해 썼고, 규칙으로 조립한 글과 서로 다른 말이
            됐습니다. 촬영 용어 문장은 이미 `describeCameraMoves` 가 만들어 둡니다.
          */
          camera: describeCameraMoves(moves)?.ko ?? "고정",
          cameraEn: describeCameraMoves(moves)?.en ?? "locked-off static camera, no camera movement",
          description: cell.cut.description || null,
          acting: cell.cut.acting || null,
          vfx: cell.cut.vfx || null,
          marks: (cell.marks ?? []).map((mark, index) => `${index + 1}) ${mark.note || "동선"}`),
          // 키 이미지가 아니라 마네킹 구도 그림으로 채운 칸.
          fromGuide: cell.image.id.startsWith("guide-"),
        };
      }),
    };
  };

  const writePrompt = async () => {
    if (writing) return;
    if (!scene.storyboardPath) {
      toast.error("먼저 스토리보드를 만들어 주세요.", {
        description: "시트가 있어야 프롬프트에 @파일이름 으로 걸 수 있습니다.",
      });
      return;
    }
    setWriting(true);
    try {
      const result = await requestPromptFromLlm({
        label: `스토리보드 · ${scene.title || "장면"}`,
        deliveredTo: `${scene.title || "장면"} 스토리보드 프롬프트 두 칸에 넣음`,
        task: "cutPrompt",
        template: "storyboard-video",
        data: boardRequestData(),
      });
      onPatch(() => ({
        storyboardPromptKo: result.ko,
        storyboardPromptEn: result.en,
      }));
      toast.success("스토리보드 영상 프롬프트를 받았습니다.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWriting(false);
    }
  };

  const bake = async () => {
    if (baking) return;
    if (!cells.length) {
      toast.error("칸에 넣을 그림이 없습니다.", {
        description:
          "컷 그림을 뽑아 별로 대표를 정하거나, 구도잡기에서 구도를 저장하세요 — 키 이미지가 없으면 구도 그림이 대신 들어갑니다.",
      });
      return;
    }
    setBaking(true);
    try {
      const size = storyboardSize(cells.length, storyboardNoteRoom(cells, aspect), aspect);
      const { blob } = await composeStoryboard(scene, { imageMarks, aspect });
      // 폴더 이름은 **한 곳**에서 정합니다 — 여기와 컷 카드가 다르면 한 장면의 파일이 두 폴더로 갈립니다.
      const title = sceneFolderName(scene.title, index);
      const file = new File([blob], `${safeFileName(title)}_스토리보드.png`, {
        type: "image/png",
      });
      const saved = await saveProjectMediaAsset(file, {
        projectName,
        assetType: "scene-cut",
        ownerName: title,
        stem: `${safeFileName(title)}_스토리보드`,
      });
      if (!saved?.path) {
        toast.error("스토리보드를 폴더에 저장하지 못했습니다.");
        return;
      }
      const prompt = buildStoryboardVideoPrompt({
        sceneTitle: scene.title,
        sceneSummary: scene.summary,
        cells,
        // 방금 저장한 시트의 이름이라야 `@…` 가 실제로 올라간 그림을 가리킵니다.
        sheetTag: `@${fileStem(saved.path)}`,
        swaps,
      });
      /*
        값이 아니라 **지금 값에서** 만듭니다. 6000×6000 을 굽는 데 몇 초가 걸리고,
        그 사이 컷 제목을 고치는 것이 정상적인 사용법입니다(공통 규칙 — patch 는 함수).
      */
      onPatch(() => ({
        storyboardPath: saved.path,
        storyboardAt: new Date().toISOString(),
        storyboardPromptKo: prompt.ko,
        storyboardPromptEn: prompt.en,
      }));
      toast.success(
        `스토리보드를 만들었습니다 — 컷 ${cells.length}칸${markedCount ? ` · 표시 ${markedCount}칸` : ""}.`,
        {
          description: prompt.clamped
            ? `러닝타임은 생성기 한도인 ${prompt.seconds.toFixed(1)}초로 잘랐습니다. 컷 길이의 합이 더 깁니다.`
            : `러닝타임 ${prompt.seconds.toFixed(1)}초 · ${size.width}×${size.height}`,
        },
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBaking(false);
    }
  };

  /** 시트 한 장을 그대로 영상 생성기로. 레퍼런스는 이 시트 하나입니다. */
  const sendToMagnific = async (prompt: string) => {
    if (!scene.storyboardPath) {
      toast.error("먼저 스토리보드를 만들어 주세요.");
      return;
    }
    const seconds = buildStoryboardVideoPrompt({
      sceneTitle: scene.title,
      sceneSummary: scene.summary,
      cells,
      aspect: videoAspect,
      lockNames,
    }).seconds;
    await composeInMagnific({
      kind: "video",
      seconds,
      prompt,
      referencePaths: [scene.storyboardPath],
      owner: {
        kind: "scene",
        name: scene.title || "장면",
        sceneId: scene.id,
      },
      onStatus: (message) => toast.loading(message, { id: `board:${scene.id}` }),
    });
    toast.success(`${scene.title || "장면"} 스토리보드를 영상 생성기로 올렸습니다.`, {
      id: `board:${scene.id}`,
      description: `러닝타임 ${seconds.toFixed(1)}초 · 돌아온 영상은 후보함에서 «씬 영상» 으로 채택하세요`,
    });
  };

  return (
    <section
      className="space-y-2 rounded-lg p-3"
      style={{
        background: "oklch(0.13 0.009 265)",
        border: "1px solid oklch(0.84 0.16 85 / 22%)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2" data-tour="scene-storyboard">
        <Clapperboard
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: "oklch(0.88 0.16 85)" }}
        />
        <p className="shrink-0 text-[11px] font-semibold text-white">
          스토리보드
        </p>
        <p
          className="min-w-0 flex-1 truncate text-[10px]"
          style={{ color: "oklch(0.45 0.01 265)" }}
        >
          {cells.length
            ? `컷 ${cells.length}칸 · ${sheetSize.width}×${sheetSize.height}` +
              (guideCount > 0 ? ` · ${guideCount}칸은 키 이미지가 없어 구도 그림으로` : "") +
              (missing > 0 ? ` · 그림도 구도도 없는 컷 ${missing}개는 빠집니다` : "") +
              (markedCount
                ? ` · 표시 ${markedCount}칸(동선·카메라 무빙이 칸 위에 그려집니다)`
                : " · 컷 그림의 «표시하기» 로 동선·카메라 무빙을 그리면 칸에 같이 실립니다")
            : "컷 그림을 뽑아 별로 대표를 정하세요. 아직 없으면 구도잡기에서 저장한 구도가 대신 들어갑니다"}
        </p>
        <button
          type="button"
          onClick={() => void bake()}
          data-tour="scene-storyboard-make"
          disabled={baking || !cells.length}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold disabled:opacity-40"
          style={{
            background: "oklch(1 0 0 / 6%)",
            color: "oklch(0.88 0.16 85)",
          }}
        >
          {baking ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {scene.storyboardPath ? "다시 만들기" : "스토리보드 만들기"}
        </button>
        {/*
          시트가 생긴 뒤에만 뜹니다 — 프롬프트가 시트를 `@파일이름` 으로 걸어야 해서,
          시트 없이 받으면 아무 그림도 안 붙은 글이 됩니다.
        */}
        {scene.storyboardPath && (
          <>
            <LlmRequestButton
              template="storyboard-video"
              title={`스토리보드 → 씬 영상 · ${scene.title || "장면"}`}
              data={() => boardRequestData()}
              onApplyPrompt={(result) =>
                onPatch(() => ({
                  storyboardPromptKo: result.ko,
                  storyboardPromptEn: result.en,
                }))
              }
            />
            <button
              type="button"
              onClick={() => void writePrompt()}
              disabled={writing || !apiReady}
              title={
                apiReady
                  ? "설정에서 고른 모델로 이 시트의 영상 프롬프트를 받습니다"
                  : "설정에서 API 키를 넣어야 씁니다. 「LLM 요청문」 은 지금도 됩니다"
              }
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold text-white gradient-primary disabled:opacity-40"
            >
              {writing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              프롬프트 작성
            </button>
          </>
        )}
      </div>

      {/* 미리보기는 공용 부품이 맡습니다 — 두 화면이 같은 규칙을 씁니다(공통 규칙 1). */}
      {scene.storyboardPath && (
        <SheetPreview path={scene.storyboardPath} alt="스토리보드" maxHeight={260} />
      )}

      {/*
        영상 프롬프트는 시트를 구울 때 함께 짓습니다. 칸 순서를 아는 것이 그때뿐이라
        나중에 따로 지으면 「왼쪽 위부터」 가 실제 배치와 어긋날 수 있습니다.
      */}
      {scene.storyboardPath && (
        <PromptResultPanels
          compact
          owner={{
            kind: "scene",
            name: scene.title || "장면",
            sceneId: scene.id,
          }}
          composeLabel="영상으로"
          composeTitle="스토리보드 시트를 올리고, 러닝타임까지 맞춘 영상 생성기를 이어 붙입니다."
          onCompose={(text) => sendToMagnific(text)}
          korean={scene.storyboardPromptKo || ""}
          english={scene.storyboardPromptEn || ""}
          onKoreanChange={(storyboardPromptKo) =>
            onPatch(() => ({ storyboardPromptKo }))
          }
          onEnglishChange={(storyboardPromptEn) =>
            onPatch(() => ({ storyboardPromptEn }))
          }
        />
      )}

      {/* 씬 영상 — 후보함에서 «씬 영상» 으로 채택하면 여기 붙습니다. */}
      <CutVideoShelf
        label="씬 영상"
        videos={scene.videos || []}
        onChange={(update) =>
          onPatch((current) => ({ videos: update(current.videos || []) }))
        }
      />
    </section>
  );
}
