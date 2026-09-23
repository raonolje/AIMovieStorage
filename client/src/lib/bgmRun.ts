import { toast } from "sonner";
import { loadBgmProjects, updateBgmProjectsAndConfirm } from "@/lib/bgmProjects";
import { loadPrecision, LOCAL_ENGINE_IDS, type LocalEngineId } from "@/lib/localEngines";
import { runLocalToProject } from "@/lib/localOutput";
import { BGM_ROOT } from "@/lib/bgmLibrary";
import { enqueueTask, isStopping, registerTaskRunner, setTaskResult } from "@/lib/taskQueue";
import { whenAppSettingsReady } from "@/lib/mediaLibrary";
import { z } from "zod";

/**
 * **BGM 뽑기도 작업 줄에서.**
 *
 *
 *
 * 맞습니다 — BGM 만 제 화면 안에서 `await` 로 돌고 있었습니다. 그래서 그 화면을 벗어나면
 * 진행을 물을 데가 없고, 앱이 꺼지면 남은 일이 사라졌습니다. 곡 하나에 몇 분씩 걸리는
 * 일이라 다른 일과 같은 줄에 서야 합니다.
 *
 * # 줄은 `media` 입니다
 *
 * 음악도 GPU 를 씁니다. 그림·영상과 같은 줄에 세워 **한 번에 하나**만 돌게 합니다 —
 * 둘을 같이 돌리면 VRAM 이 터지거나 둘 다 느려집니다.
 *
 * # 어디에 놓이는가
 *
 * `BGM/곡/<프로젝트>/` 입니다. **영상 프로젝트 폴더가 아닙니다** — 한 곡을 여러 영상에서 돌려 쓰는데 프로젝트 폴더에
 * 두면 그 프로젝트를 지울 때 곡까지 사라지고, 같은 곡이 프로젝트마다 복사본으로 늘어납니다.
 *
 * 앱 안에서는 그 곡 카드의 **«뽑은 결과»** 에 붙습니다(`track.resultPaths`).
 */

export const BGM_TASK = "bgmTrack";

export interface BgmPayload {
  projectId: string;
  projectName?: string;
  trackId: string;
  trackName?: string;
  engine: LocalEngineId;
  prompt: string;
  seconds: number;
  lyrics: string;
}

const payloadSchema = z.object({
  projectId: z.string().min(1).max(200), trackId: z.string().min(1).max(200),
  projectName: z.string().max(300).optional(), trackName: z.string().max(300).optional(),
  engine: z.enum(["minimaxmusic", "acestep"]), prompt: z.string().trim().min(1).max(32000),
  seconds: z.number().finite().min(1).max(300), lyrics: z.string().max(16000),
  // UI 대기열이 중복 방지 표를 재료에 붙입니다. 재시작해도 같은 입력 검사를 통과해야 합니다.
  dedupe: z.string().max(400).optional(),
}).strict();

/** UI·외부 명령·재시작한 작업은 모두 같은 입력과 대상 검사를 지납니다. */
export function validateBgmPayload(raw: unknown) {
  const input = payloadSchema.parse(raw);
  if (!LOCAL_ENGINE_IDS.includes(input.engine)) throw new Error("이 배포판에서 사용할 수 없는 음악 엔진입니다.");
  const project = loadBgmProjects().find((item) => item.id === input.projectId);
  const track = project?.tracks.find((item) => item.id === input.trackId);
  if (!project || !track) throw new Error("BGM 프로젝트나 곡을 찾지 못했습니다.");
  return { input, project, track };
}

/** 곡 하나를 줄에 세웁니다. */
export function startBgmTrack(input: BgmPayload): boolean {
  if (!input.prompt.trim()) {
    toast.error("먼저 프롬프트를 만들어 주세요.");
    return false;
  }
  try { validateBgmPayload(input); } catch (error) { toast.error(String(error)); return false; }
  const id = enqueueTask({
    lane: "media",
    kind: BGM_TASK,
    projectId: `bgm:${input.projectId}`,
    projectTitle: `BGM · ${input.projectName}`,
    label: `${input.trackName || "곡"} 뽑기`,
    // 같은 곡을 두 번 세우지 않습니다 — 「뽑기」 를 두 번 눌러도 한 번만 돕니다.
    dedupe: `bgm:${input.trackId}`,
    payload: input,
  });
  if (!id) {
    toast.message("이미 줄에 서 있습니다.", {
      description: "위쪽 «작업» 단추에서 차례를 볼 수 있습니다.",
    });
    return false;
  }
  toast.success(`${input.trackName || "곡"} 을 줄에 세웠습니다.`, {
    description: "위쪽 «작업» 단추로 진행을 봅니다. 창을 나가도 계속 돕니다.",
  });
  return true;
}

registerTaskRunner(BGM_TASK, async (raw, report, task) => {
  await whenAppSettingsReady();
  if (isStopping(task.id)) return;
  const { input: payload, project, track } = validateBgmPayload(raw);

  report({ step: "모델을 올리는 중" });
  const made = await runLocalToProject({
    engine: payload.engine,
    extension: "wav",
    kind: "audio",
    projectName: BGM_ROOT,
    assetType: "bgm-track",
    ownerName: project.name,
    stem: `${project.name}_${track.name || "곡"}`,
    opts: {
      prompt: payload.prompt,
      seconds: payload.seconds,
      // 연주곡이면 가사를 비웁니다 — 비면 엔진이 `[inst]` 로 받습니다.
      lyrics: payload.lyrics,
      precision: loadPrecision(),
    },
    timeoutSecs: 3600,
    onProgress: (message) => report({ step: message || "뽑는 중" }),
  });

  setTaskResult(task.id, { paths: [made.path] });
  if (isStopping(task.id)) return { paths: [made.path], data: { attached: false, cancelled: true } };

  report({ step: "곡에 붙이는 중" });
  /*
    **지금 값을 받아 다음 값을 만듭니다.** 몇 분이 걸리는 일이라 그사이 다른 곡을
    만지는 것이 정상입니다 — 값으로 덮어쓰면 그 사이 편집이 사라집니다(CLAUDE.md).
  */
  await updateBgmProjectsAndConfirm((projects) => {
    const found = projects.find((item) => item.id === payload.projectId);
    if (!found?.tracks.some((entry) => entry.id === payload.trackId)) throw new Error("뽑기는 했는데 결과를 붙일 BGM 프로젝트나 곡을 찾지 못했습니다.");
    return projects.map((item) =>
      item.id !== payload.projectId
        ? item
        : {
            ...item,
            updatedAt: Date.now(),
            tracks: item.tracks.map((entry) =>
              entry.id !== payload.trackId
                ? entry
                : { ...entry, updatedAt: Date.now(), resultPaths: [...new Set([...(entry.resultPaths || []), made.path])] },
            ),
          },
    );
  });
  return { paths: [made.path], data: { attached: true, projectId: payload.projectId, trackId: payload.trackId } };
});
