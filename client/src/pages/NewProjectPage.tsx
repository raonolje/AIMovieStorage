import { useEffect, useMemo, useRef, useState } from "react";
import { ensureProjectInbox } from "@/lib/mediaLibrary";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { applyMovedPaths, revertOwnerNames, syncOwnerFolders } from "@/lib/ownerFolders";
import { useAutoSave } from "@/lib/autoSave";
import GlobalNav from "@/components/GlobalNav";
import { WORK_WIDTH } from "@/lib/layout";
import StepBasics from "@/components/project/StepBasics";
import StepCharacters from "@/components/project/StepCharacters";
import StepScenes from "@/components/project/StepScenes";
import StepFinish from "@/components/project/StepFinish";
import ProjectEditorLoadGate from "@/components/project/ProjectEditorLoadGate";
import { ConfirmDialogHost } from "@/components/ConfirmDialog";
import { ProjectMediaContext, type ProjectMedia } from "@/components/project/ProjectMediaContext";
import {
  clearDraftSnapshot,
  describeSavedAt,
  readDraftSnapshot,
  saveDraftSnapshot,
} from "@/lib/draftAutosave";
import {
  getLocalProject,
  onProjectReloaded,
  projectFolderName,
  saveLocalProject,
  type LocalProject,
} from "@/lib/localProjectStore";
import { adoptBootstrapRun } from "@/lib/bootstrapStore";
import { registerProjectTarget } from "@/lib/projectWrite";
import { commitOpenProjectChange, type ProjectChangeCommit } from "@/lib/projectCommit";
import { registerCompositionProjectPage } from "@/lib/compositionControl";
import { withoutEmptyEraRanges } from "@/lib/projectContext";
import { buildProjectMedia, pickProjectMediaInput, projectMediaDeps } from "@/lib/projectMedia";
import { newProjectDraft, settleLoading, type ProjectDraft } from "@/lib/projectTypes";
import { stepFilled } from "@/lib/stepProgress";
import type { ImageMark } from "@/components/ImageMarkupEditor";
import MagnificInboxPanel from "@/components/MagnificInboxPanel";
import { useT } from "@/lib/i18n";
import {
  onTutorialPageRequest,
  projectPageToStep,
  projectStepToPage,
  reportTutorialPage,
} from "@/lib/tutorialStore";

/**
 * 프로젝트를 만들고 고치는 화면.
 *
 * # 왜 이렇게 나눴는가
 *
 * 원래는 9,440줄짜리 한 파일이었습니다. 사고로 잃고 다시 쓰면서 **껍데기와
 * 단계를 갈랐습니다.** 이 파일이 맡는 것은 셋뿐입니다 — 초안을 들고 있기,
 * 단계 사이를 오가기, 저장하기. 각 단계의 내용은 `components/project/` 에
 * 따로 있습니다.
 *
 * 한 파일에 다 있으면 «캐릭터 카드의 버튼 하나» 를 고치려 해도 그 안을
 * 헤매야 했고, 문자열로 자리를 찾다 엉뚱한 곳을 고치는 일이 실제로 있었습니다.
 *
 * # 저장이 두 겹인 이유
 *
 * - **자동 저장** — 손을 멈추면 브라우저 저장소에 초안을 넣습니다. 창을
 * 실수로 닫아도 돌아옵니다. 임시입니다.
 * - **프로젝트 파일** — 「저장」 을 누르거나 단계를 넘길 때 폴더에 씁니다.
 * 이쪽이 진짜입니다.
 *
 * 자동 저장만 믿고 있다가 복구 배너를 잘못 눌러 통째로 날린 적이 있어서,
 * 단계를 넘길 때마다 파일로도 씁니다.
 */

/*
  ── 네 단계 ───────────────────────────────────────────────────────────────
  

  장소는 **여러 장면이 나눠 쓰는 자료**라 데이터는 프로젝트에 그대로 둡니다(장면마다 배경을 새로 만들면 같은 골목이 컷마다
  달라집니다). 바뀐 것은 **만드는 자리**뿐입니다 — 장소·에셋 칸이 씬 단계 안으로 들어갔습니다. 옛 저장본의 진행 표시는
  `migrateProgress` 가 옮깁니다.

  이름과 힌트는 한국어 원문 그대로 두고 그릴 때 `t()` 로 바꿉니다 — 모듈 상수에 `t()` 를 넣으면
  언어를 바꿔도 따라오지 않습니다.
*/
const STEPS = [
  { id: 1, label: "주제 설정", hint: "장르·스타일·시대. 이후 모든 프롬프트의 머리말이 됩니다" },
  { id: 2, label: "캐릭터", hint: "인물과 레퍼런스, 캐릭터 시트" },
  { id: 3, label: "씬 구성", hint: "장면과 컷 · 이 장면에 쓸 장소·에셋도 여기서" },
  { id: 4, label: "확인", hint: "스토리보드와 한눈에 보기" },
];

export default function NewProjectPage() {
  const [, params] = useRoute("/project/:id");
  const projectId = params?.id;
  // 최신 파일이 오기 전에는 편집·자동 저장·외부 조종 대상 어느 것도 등록하지 않습니다.
  // 경로가 바뀌면 이전 편집기를 먼저 닫고 새 작품의 로딩 경계를 따로 만듭니다.
  return projectId
    ? <ProjectEditorLoadGate key={projectId} projectId={projectId}>{project => <ProjectEditor initialProject={project} />}</ProjectEditorLoadGate>
    : <ProjectEditor key="new-project" />;
}

function draftFromDisk(project: LocalProject): ProjectDraft {
  return settleLoading({ ...newProjectDraft(), ...(project.draft as Partial<ProjectDraft>) });
}

function ProjectEditor({ initialProject }: { initialProject?: LocalProject }) {
  const t = useT();
  const [, navigate] = useLocation();
  const projectId = initialProject?.id;
  const [draft, setDraft] = useState<ProjectDraft>(() => initialProject ? draftFromDisk(initialProject) : newProjectDraft());
  const [step, setStep] = useState(() => {
    if (!initialProject) return 1;
    // 채운 단계의 다음 자리에서 이어갑니다. 이후 목록 갱신은 사용자의 현재 단계를 바꾸지 않습니다.
    const filled = STEPS.map(item => item.id).filter(id => stepFilled(draft, id));
    return Math.min((filled.length ? Math.max(...filled) : 0) + 1, STEPS.length);
  });
  const [controlCutRequest, setControlCutRequest] = useState<{ cutId: string } | null>(null);

  /**
   * **저장하고 프로젝트 목록으로.** 확인이 끝나면 갈 곳은 거기뿐입니다.
   *
   * 작업실 페이지는 앞 단계와
   * 내용이 겹쳐 통째로 걷어냈습니다.
   */
  const finish = () => {
    if (!commit()) {
      toast.error("먼저 제목을 적어 주세요.");
      return;
    }
    navigate("/");
  };
  const [savedId, setSavedId] = useState<string | null>(projectId ?? null);
  const savedIdRef = useRef(savedId);
  const adoptSavedId = (id: string) => { savedIdRef.current = id; setSavedId(id); };
  /**
   * 여태 가 본 가장 먼 단계.
   *
   * 연결선을 여기까지 칠합니다. `step` 만 보면 3단계까지 갔다가 1단계로
   * 돌아왔을 때 선이 도로 꺼져서, 어디까지 훑었는지 알 수 없습니다.
   */
  const [maxStep, setMaxStep] = useState(initialProject ? STEPS.length : 1);
  const [recovered, setRecovered] = useState<string | null>(null);
  /**
   * **디스크에서 막 읽은 초안. 이 객체는 절대 되쓰지 않습니다.**
   *
   * 2026-09-21 두 창 사고의 뒷면입니다. 다른 창이 먼저 저장해 되읽었을 때, 되읽은 것을
   * 자동 저장이 도로 쓰면 내용은 같아도 `updatedAt` 만 새로 찍혀, 이긴 창의 다음 진짜
   * 편집이 «디스크가 다르다» 로 버려집니다. 두 창이 번갈아 서로를 되돌리는 핑퐁이 됩니다.
   * 열기만 해도 한 번 쓰던 것(자동 저장의 «두 번째 변화»)도 같은 검사로 막힙니다.
   */
  const lastDisk = useRef<ProjectDraft | null>(initialProject ? draft : null);
  /** 디스크에서 온 초안을 화면 모양으로 — 여는 길과 되읽는 길이 **같은** 정리를 거쳐야 합니다. */
  const openFromDisk = (project: LocalProject): ProjectDraft => {
    const opened = draftFromDisk(project);
    lastDisk.current = opened;
    return opened;
  };

  // ── 불러오기 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (projectId) return;

    // 새로 만드는 중이면 자동 저장해 둔 것이 있는지 봅니다.
    const snapshot = readDraftSnapshot<ProjectDraft>();
    if (snapshot) setRecovered(snapshot.savedAt);
  }, [projectId]);

  /*
    ── 다른 창이 먼저 저장했을 때 ──────────────────────────────────────────

    저장 관문(`localProjectStore`)이 «디스크가 이 창이 읽은 것과 다르다» 를 알아채면 쓰지
    않고 디스크 것을 되읽은 뒤 여기로 알립니다. 화면을 그것으로 갈아 끼우고 사람에게 말합니다 —
    이 창에서 방금 고친 것은 사라졌으니 다시 해야 합니다. 조용히 넘기면 «고쳤는데 안 고쳐진»
    채로 한참을 갑니다(2026-09-21).
  */
  useEffect(() => {
    if (!savedId) return;
    return onProjectReloaded((project) => {
      if (project.id !== savedId) return;
      setDraft(openFromDisk(project));
      toast.warning("다른 창이 이 작품을 먼저 저장해 다시 읽었습니다. 방금 고친 것은 다시 해 주세요.", {
        duration: 10_000,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedId]);

  // ── 자동 저장 ───────────────────────────────────────────────────────────
  const autoSaveReady = useRef(false);
  useEffect(() => {
    /*
      **이미 저장된 프로젝트를 고치는 중에는 스냅샷을 남기지 않습니다.**

      스냅샷 키는 앱 전체에 하나뿐입니다. 기존 프로젝트를 열기만 해도 그
      내용이 거기 들어갔는데, 그 뒤 그 프로젝트를 숨기거나 폴더째 지우고
      「새 프로젝트」를 누르면 복구 배너가 떠서 **지운 프로젝트가 다른 id 를
      달고 통째로 되살아났습니다.** 폴더 이름까지 물려받아서요.

      기존 프로젝트는 단계를 넘길 때마다 파일로 저장되니 스냅샷이 없어도
      잃을 것이 없습니다. 스냅샷이 필요한 쪽은 «아직 한 번도 저장 안 한
      새 프로젝트» 뿐입니다.
    */
    if (projectId) return;

    // 처음 그려질 때는 넘어갑니다. 안 그러면 빈 초안이 저장돼서
    // 복구 배너가 «빈 것으로 되돌리기» 가 됩니다.
    if (!autoSaveReady.current) {
      autoSaveReady.current = true;
      return;
    }
    const timer = window.setTimeout(() => saveDraftSnapshot(draft, step), 700);
    return () => window.clearTimeout(timer);
  }, [draft, step, projectId]);

  /**
   * 초안을 고칩니다.
   *
   * **값이 아니라 함수로 받습니다.** LLM 요청 하나에 몇 십 초가 걸리고 그
   * 사이에 카드를 더하거나 지우는 것이 정상적인 사용법인데, 값으로 받으면
   * 요청을 걸 때의 낡은 초안 위에 덮어써서 그 사이 변경이 사라집니다.
   */
  const patch = (updater: (current: ProjectDraft) => Partial<ProjectDraft>) =>
    setDraft((current) => ({ ...current, ...updater(current) }));

  /*
    ── AI 일괄 생성이 부을 곳 ──────────────────────────────────────────────

    

    받은 답을 넣으려면 **지금 화면이 들고 있는 초안**이 있어야 합니다. 그래서 이 화면이
    살아 있는 동안 «여기로 부으세요» 를 살림에 맡겨 둡니다. 화면이 없을 때 도착한 답은
    살림이 프로젝트 파일을 직접 고칩니다 — 여기로 부으면 곧 자동 저장이 덮어씁니다.

    등록하는 순간 기다리던 답이 있으면 바로 들어갑니다(돌려보낸 뒤에 연 경우).
  */
  /**
   * **늘 마지막 초안.**
   *
   * 두 곳이 씁니다 — 포커스가 빠져나간 뒤 폴더를 다시 맞출 때, 그리고 **줄에 선
   * 뽑기 일들이 읽을 때**. 뒤엣것이 이번에 생겼습니다(작업 서랍에 「찾지 못했습니다」 가 스물네 개였습니다).
   * 파일은 자동 저장이 돈 뒤에야 갱신되어, 방금 넣은 인물·컷이 파일에는 아직 없습니다.
   */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const bootstrapKey = savedId ?? "새 프로젝트";
  const registeredTargetKey = useRef(bootstrapKey);
  useEffect(
    () => {
      registeredTargetKey.current = bootstrapKey;
      return registerProjectTarget(bootstrapKey, patch, () => draftRef.current);
    },
    [bootstrapKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  /*
    처음 저장되면 열쇠가 「새 프로젝트」 에서 id 로 바뀝니다. 그 사이 돌고 있던 일을
    옮겨 주지 않으면 답이 주인 없는 자리에 떨어집니다.
  */
  useEffect(() => {
    if (savedId) adoptBootstrapRun("새 프로젝트", savedId);
  }, [savedId]);

  /*
    ── 튜토리얼과의 약속 ─────────────────────────────────────────────────────

    안내 창(`TutorialOverlay`)은 앱 뿌리에 살아서 이 화면의 단계 상태를 직접 못 만집니다. 그래서
    「그 단계를 열어 달라」 는 창 이벤트로 받고, 「지금 어느 단계인가」 는 살림에 알립니다 — 위 띠의
    «튜토리얼» 메뉴가 «이 페이지 기능» 을 고를 때 씁니다.

    `goStep` 이 아니라 `setStep` 인 까닭: `goStep` 은 «다음을 눌렀다» 도장을 찍고 파일로 씁니다.
    안내가 단계를 옮긴 것은 사람이 채운 것도, 넘긴 것도 아닙니다.
  */
  useEffect(
    () =>
      onTutorialPageRequest((page) => {
        const next = projectPageToStep(page);
        if (!next) return;
        setStep(next);
        setMaxStep((current) => Math.max(current, next));
      }),
    [],
  );
  useEffect(() => {
    reportTutorialPage(projectStepToPage(step));
  }, [step]);
  useEffect(() => () => reportTutorialPage(null), []);

  // ── 저장 ────────────────────────────────────────────────────────────────
  /**
   * 늘 마지막 초안을 가리킵니다.
   *
   * 아래 commit 을 컨텍스트에 그대로 넘기면, 그 값이 만들어진 시점의 draft 에
   * 묶여서 «저장했는데 옛 내용이 저장되는» 일이 생깁니다.
   */
  const commitRef = useRef(() => {});
  const commitChangeRef = useRef<ProjectChangeCommit>(async () => { throw new Error("프로젝트 저장이 준비되지 않았습니다."); });
  /**
   * 저장 직전에 초안을 정리합니다.
   *
   * 지금은 «아무것도 안 적은 연대 구간» 하나뿐입니다. 화면에서 지우지 않고
   * 여기서 치우는 이유는, 적는 도중에 줄이 사라지면 안 되기 때문입니다.
   * 저장하거나 단계를 넘기는 순간이 «다 적었다» 는 뜻입니다.
   */
  const tidy = (value: ProjectDraft): ProjectDraft => withoutEmptyEraRanges(value);

  /**
   * 저장 관문으로 보냅니다. **디스크에서 막 읽은 그 객체면 보내지 않습니다**(`lastDisk`).
   * 자동 저장과 단계 넘기기가 같이 씁니다 — 한쪽에만 두면 「다음」 이 도장을 새로 찍습니다.
   */
  const store = (value: ProjectDraft): LocalProject => {
    if (value === lastDisk.current && savedIdRef.current) {
      const kept = getLocalProject(savedIdRef.current);
      if (kept) return kept;
    }
    const project = saveLocalProject(value, savedIdRef.current ?? undefined);
    if (!savedIdRef.current) adoptSavedId(project.id);
    return project;
  };

  /**
   * 저장하면서 폴더 이름도 맞춥니다.
   *
   * 이름을 안 정한 채 그림을 올리면 폴더가 「인물」 로 생깁니다. 나중에
   * 「여울」 이라고 적어도 폴더는 그대로라, 폴더를 다시 읽을 때 그 인물의
   * 그림을 못 찾습니다. 저장하는 순간이 «다 적었다» 는 뜻이라 여기서 맞춥니다.
   *
   * 파일을 옮기는 일이라 시간이 걸립니다. 저장을 붙잡아 두지 않고 뒤에서
   * 하고, 끝나면 바뀐 자리를 초안에 반영해 한 번 더 씁니다.
   */

  /**
   * 폴더 맞추기는 한 번에 하나만 돕니다.
   *
   * 「냥이 → 서리로 바꿀까요?」 확인 창이 떠 있는 동안 자동 저장이 또 부르면 확인 창이
   * 겹쳐 앞 것의 답이 영영 안 옵니다. 도는 중에 온 요청은 끝난 뒤 최신 초안으로 한 번 더 돕니다.
   */
  const syncBusy = useRef(false);
  const syncAgain = useRef<string | null>(null);
  /** 이름 칸에서 포커스가 빠져나가기를 기다리는 중이면 그 처리기 */
  const blurWatch = useRef<(() => void) | null>(null);
  /** 같은 실패를 저장할 때마다 되풀이해 알리지 않으려고 마지막에 알린 것을 기억합니다. */
  const reportedFailures = useRef("");

  useEffect(
    () => () => {
      if (blurWatch.current) window.removeEventListener("focusout", blurWatch.current, true);
    },
    [],
  );

  /** 그 이름을 적는 칸에 커서가 있는가. 있으면 폴더 옮기기를 포커스가 빠질 때까지 미룹니다. */
  const isTypingName = (name: string) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return false;
    return active.value.trim() === name.trim();
  };

  const syncFolders = (target: ProjectDraft, id: string) => {
    // 마그니픽 후보함(magnific/)은 프로젝트가 생기는 순간부터 있어야 합니다.
    //
    void ensureProjectInbox({ projectName: projectFolderName(id, target.title) });
    if (syncBusy.current) {
      syncAgain.current = id;
      return;
    }
    syncBusy.current = true;
    // finally 에서 재실행할 때 이번 결과를 초안에 먼저 반영하려고 밖에 둡니다.
    let settled: Awaited<ReturnType<typeof syncOwnerFolders>> | null = null;
    void (async () => {
      try {
        const result = await syncOwnerFolders(target, projectFolderName(id, target.title), {
          isTyping: isTypingName,
        });
        settled = result;
        if (result.moved.size || result.reverts.length) {
          setDraft((current) => {
            // 옮긴 자리를 반영하고, 취소·거절한 이름은 폴더 이름으로 되돌립니다.
            const next = revertOwnerNames(applyMovedPaths(current, result.moved), result.reverts);
            if (next !== current) saveLocalProject(next, id);
            return next;
          });
        }
        const failureKey = result.failed.map((item) => item.path).sort().join("\n");
        if (failureKey !== reportedFailures.current) {
          reportedFailures.current = failureKey;
          if (result.failed.length) {
            toast.error(
              `${result.failed.length}개 파일은 다른 프로그램이 쓰고 있어 이름을 못 바꿨습니다. 다음 저장 때 다시 시도합니다.`,
              { description: result.failed[0].reason },
            );
          }
        }
        if (result.postponed && !blurWatch.current) {
          const handler = () => {
            window.removeEventListener("focusout", handler, true);
            blurWatch.current = null;
            // 포커스가 옮겨 간 뒤에 봅니다 — blur 순간에는 activeElement 가 아직 그 칸입니다.
            window.setTimeout(() => syncFolders(draftRef.current, id), 0);
          };
          blurWatch.current = handler;
          window.addEventListener("focusout", handler, true);
        }
      } finally {
        syncBusy.current = false;
        const again = syncAgain.current;
        syncAgain.current = null;
        // draftRef 는 아직 렌더 전 옛 경로일 수 있습니다. 그대로 넘기면 «냥이 → 서리?» 를
        // 한 번 더 묻고, 취소하면 이름이 되돌아가 폴더와 어긋나는 핑퐁이 됩니다(검토 2026-09-08).
        if (again) {
          const base = settled
            ? revertOwnerNames(applyMovedPaths(draftRef.current, settled.moved), settled.reverts)
            : draftRef.current;
          syncFolders(base, again);
        }
      }
    })();
  };

  const commit = (override?: ProjectDraft) => {
    const target = tidy(override ?? draft);
    // 화면도 정리된 것으로 맞춥니다. 안 그러면 저장된 것과 보이는 것이 갈립니다.
    if (target !== (override ?? draft)) setDraft(target);
    if (!target.title.trim()) {
      toast.error("제목을 먼저 적어 주세요. 폴더 이름이 됩니다.");
      return null;
    }
    const project = store(target);
    if (!savedIdRef.current) adoptSavedId(project.id);
    clearDraftSnapshot();
    syncFolders(target, project.id);
    return project;
  };
  commitRef.current = () => void commit();
  commitChangeRef.current = async (updater) => {
    const result = await commitOpenProjectChange({
      targetKey: () => registeredTargetKey.current,
      projectId: () => savedIdRef.current ?? undefined,
      adoptId: adoptSavedId,
    }, updater);
    clearDraftSnapshot();
    return result;
  };

  /*
    ── 저장 단추를 누를 필요가 없습니다 ───────────────────────────────────

    제목만 정해지면 그때부터는 손대는 것마다 폴더에 씁니다.

    예전에는 「다음」 이나 「저장」 을 눌러야만 갔습니다. 그런데 이 앱에서
    제일 값나가는 것 — 돈 주고 받은 분석과 프롬프트 — 은 단추와 상관없이
    도착합니다. 분석을 돌려 놓고 창을 닫으면 통째로 날아갔습니다.

    제목이 없으면 폴더 이름을 못 정해서 파일로 못 씁니다. 그동안은 위의
    스냅샷이 받쳐 줍니다.
  */
  useAutoSave({
    value: draft,
    /*
      **불러오기가 끝나기 전에는 절대 저장하지 않습니다.**

      기존 프로젝트는 바깥 로딩 경계가 파일을 읽은 뒤에만 이 편집기를 엽니다.
      빈 초안이나 낡은 localStorage를 먼저 등록하면 최신 파일을 덮을 수 있습니다.

      2026-09-04 에 실제로 그렇게 「수화의 숲」 의 내용이 통째로 비었습니다.
      그림 파일은 폴더에 남았지만 그것을 묶고 있던 프로젝트 파일이 비어서
      화면에서는 사라진 것과 같았습니다.
    */
    enabled: Boolean(draft.title.trim()),
    // 1.5초를 두는 이유는 제목입니다. 글자마다 저장하면 「수」 로 폴더가
    // 만들어지고, 폴더 이름은 한 번 정해지면 안 바뀝니다.
    delay: 1500,
    save: (value) => {
      const project = store(value);
      if (!savedIdRef.current) adoptSavedId(project.id);
      clearDraftSnapshot();
      syncFolders(value, project.id);
    },
  });

  const goStep = (next: number) => {
    if (next < 1 || next > STEPS.length) return;
    // 단계를 넘길 때마다 파일로 씁니다. 자동 저장만 믿지 않습니다.
    // 제목이 없어 저장을 못 하더라도 정리는 합니다 — 빈 구간이 남아 있으면
    // 돌아왔을 때 「아직 안 적었습니다」 줄이 그대로 보입니다.
    if (draft.title.trim()) commit();
    else setDraft(tidy);
    /*
      **「다음」 을 눌렀다는 사실 자체를 남깁니다.** (지시 168)

      내용이 있는지와는 다른 이야기입니다. 캐릭터를 하나도 안 만들고 넘어갔다면
      캐릭터는 비었지만 «지나간» 단계이고, 프로그래스 바는 그걸 「건너뛰었다」
      로 그려야 합니다. 되돌아왔다가 다시 넘어가도 지워지지 않습니다.
    */
    if (next > step) {
      setDraft((current) => ({
        ...current,
        progress: { ...(current.progress || {}), [String(step)]: true },
      }));
    }
    setStep(next);
    setMaxStep((current) => Math.max(current, next));
  };

  // ── 아래로 내려보낼 것들 ────────────────────────────────────────────────
  /*
    의존성을 손으로 적지 않습니다. 초안에서 읽을 것을 먼저 뽑고 그 값들에만
    매답니다. 예전에는 [draft.title, savedId, draft.genres, …] 를 손으로 적어서
    ProjectContext 에 필드가 늘면 여기가 조용히 낡았습니다. 이제 늘어난 필드는
    projectMedia.ts 에서 타입 오류로 잡히고, 의존성은 거기서 따라 나옵니다.
  */
  const mediaInput = pickProjectMediaInput(draft, savedId);
  const media = useMemo<ProjectMedia>(
    () =>
      buildProjectMedia(mediaInput, {
        commitProject: () => commitRef.current(),
        commitProjectChange: (updater) => commitChangeRef.current(updater),
        setImageMarks: (filePath: string, marks: ImageMark[]) =>
          setDraft((current) => ({
            ...current,
            imageMarks: { ...(current.imageMarks || {}), [filePath]: marks },
          })),
        // 파일 이름이 바뀌면(변형 이름 바꾸기 등) 초안 전체의 경로를 따라 옮깁니다. 자동 저장이 파일로 씁니다.
        renamePaths: (moved: Map<string, string>) => setDraft((current) => applyMovedPaths(current, moved)),
      }),
    projectMediaDeps(mediaInput),
  );

  useEffect(() => {
    if (!media.projectName) return;
    return registerCompositionProjectPage(media.projectName, () => draftRef.current.scenes.flatMap(scene => scene.cuts.map(cut => ({
      projectName: media.projectName, cutId: cut.id, sceneTitle: scene.title, cutOrder: cut.order,
    }))), cutId => {
      setControlCutRequest({ cutId });
      setStep(3);
      setMaxStep(current => Math.max(current, 3));
    });
  }, [media.projectName]);

  const current = STEPS.find((item) => item.id === step) || STEPS[0];

  return (
    <ProjectMediaContext.Provider value={media}>
      <div className="min-h-screen" style={{ background: "oklch(0.12 0.008 265)" }}>
        <GlobalNav />

        <main className={`${WORK_WIDTH} pb-16 pt-5`}>
          {recovered && (
            <div
              className="mb-4 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5"
              style={{ background: "oklch(0.20 0.06 60 / 40%)", border: "1px solid oklch(0.70 0.14 60 / 35%)" }}
            >
              <p className="min-w-0 flex-1 text-[11px]" style={{ color: "oklch(0.86 0.10 60)" }}>
                {t("{when}에 쓰다 만 초안이 있습니다.", { when: describeSavedAt(recovered) })}
              </p>
              <button
                type="button"
                onClick={() => {
                  const snapshot = readDraftSnapshot<ProjectDraft>();
                  if (snapshot) {
                    setDraft({ ...newProjectDraft(), ...snapshot.draft });
                    setStep(snapshot.step || 1);
                    setMaxStep(Math.max(1, snapshot.step || 1));
                  }
                  setRecovered(null);
                }}
                className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: "oklch(0.70 0.14 60 / 25%)", color: "oklch(0.90 0.12 60)" }}
              >
                {t("이어서 하기")}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearDraftSnapshot();
                  setRecovered(null);
                }}
                className="shrink-0 rounded-md px-2.5 py-1 text-[11px]"
                style={{ color: "oklch(0.62 0.01 265)" }}
              >
                {t("버리기")}
              </button>
            </div>
          )}

          {/*
            전역 프로그래스 바.

            **동그라미와 선이 서로 다른 것을 말합니다.**

            - 동그라미 — 그 단계를 «채웠는가». 인물이 하나도 없으면 안 칠합니다
            - 선       — 어디까지 «가 봤는가». 지나갔으면 칠합니다

            둘을 갈라 놓은 이유가 있습니다. 예전에는 동그라미도 위치만 보고
            칠했습니다. 그러니까 캐릭터를 건너뛰고 배경으로 가도 캐릭터가
            «완료» 로 보였어요. 지금은 «주제 설정은 찼고, 캐릭터는 건너뛰었고,
            지금 배경에 있다» 가 한눈에 읽힙니다.

            지나온 곳은 눌러 돌아갈 수 있고, 아직 안 간 곳도 눌러 건너뛸 수 있습니다.
          */}
          <div data-tour="project-progress" className="mb-5 flex items-center gap-0">
            {STEPS.map((item, index) => {
              const filled = stepFilled(draft, item.id);
              const on = item.id === step;
              // 「다음」 을 눌러 지나간 단계. 되돌아와 있어도 남습니다.
              const walked = Boolean(draft.progress?.[String(item.id)]);
              // 지나온 구간. 되돌아와 있어도 선은 가 본 데까지 칠해 둡니다.
              const passed = item.id < maxStep || walked;
              const skipped = passed && !filled;
              /*
                지금 작업 중이면서 아직 「다음」 을 안 누른 단계는 **반만** 칠합니다.
                「작업 중이니까 프로그래스 바가 캐릭터 절반이 유지가 되어야하고」
              */
              const half = on && !walked;
              return (
                <div key={item.id} className="flex min-w-0 items-center" style={{ flex: index === STEPS.length - 1 ? "0 0 auto" : "1 1 0" }}>
                  <button
                    type="button"
                    onClick={() => goStep(item.id)}
                    title={`${t(item.hint)}${on ? ` · ${t("지금 여기")}` : filled ? ` · ${t("채웠습니다")}` : skipped ? ` · ${t("건너뛰었습니다")}` : ""}`}
                    className="flex shrink-0 items-center gap-2"
                  >
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full"
                      style={{
                        background: filled
                          ? "oklch(0.62 0.22 290)"
                          : half
                            ? "oklch(0.62 0.22 290 / 45%)"
                            : "oklch(1 0 0 / 7%)",
                        // 지금 있는 곳은 채웠든 아니든 테두리로 짚어 줍니다.
                        border: on
                          ? "2px solid oklch(0.80 0.18 290)"
                          : skipped
                            ? "2px dashed oklch(0.62 0.14 60 / 55%)"
                            : "2px solid transparent",
                      }}
                    >
                      {filled ? (
                        <Check className="h-3.5 w-3.5" style={{ color: "white" }} />
                      ) : (
                        // 건너뛴 곳은 빈 채로 둡니다. 체크를 흐리게 넣으면
                        // 「했나 안 했나」 가 도로 헷갈립니다.
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: skipped
                              ? "oklch(0.72 0.14 60)"
                              : on
                                ? "oklch(0.80 0.18 290)"
                                : "oklch(0.32 0.01 265)",
                          }}
                        />
                      )}
                    </span>
                    <span
                      className="whitespace-nowrap text-xs font-semibold"
                      style={{
                        color: on
                          ? "white"
                          : filled
                            ? "oklch(0.78 0.10 290)"
                            : skipped
                              ? "oklch(0.72 0.12 60)"
                              : "oklch(0.50 0.01 265)",
                      }}
                    >
                      {t(item.label)}
                    </span>
                  </button>
                  {index < STEPS.length - 1 && (
                    <span
                      className="mx-3 h-px min-w-6 flex-1"
                      style={{ background: passed ? "oklch(0.62 0.22 290 / 55%)" : "oklch(1 0 0 / 10%)" }}
                    />
                  )}
                </div>
              );
            })}

            {/*
              **«저장» 단추는 걷어냈습니다.** 맞습니다.
              `useAutoSave` 가 손을 멈추면 1.5초 뒤, 창을 가릴 때, 화면을 떠날 때 세 번
              **파일로** 씁니다(브라우저 저장소가 아니라). 단계를 넘길 때도 한 번 더 씁니다.
              누를 필요가 없는 단추가 있으면 «눌러야 저장되나» 하고 누르게 됩니다.
            */}
          </div>

          <p className="mb-3 text-xs" style={{ color: "oklch(0.48 0.01 265)" }}>
            {t("STEP {n} / {total} · {hint}", { n: current.id, total: STEPS.length, hint: t(current.hint) })}
          </p>

          {/* 마그니픽 후보함 — 온 것이 있을 때만 보입니다. 어느 단계에 있든 채택할 수 있게 위에 둡니다. */}
          {/* 후보함은 캐릭터·배경·씬 구성 탭에서만, 그 탭 것만. 주제·확인 단계에는 채택할 자리가 없습니다. */}
          {(step === 2 || step === 3) && (
            <MagnificInboxPanel
              draft={draft}
              patch={patch}
              projectName={media.projectName}
              scope={step === 2 ? "character" : "cut"}
            />
          )}

          {step === 1 && (
            <StepBasics
              draft={draft}
              onChange={patch}
              /* 일괄 생성 살림의 열쇠. 저장 전에는 「새 프로젝트」 하나를 씁니다. */
              projectKey={bootstrapKey}
            />
          )}
          {step === 2 && <StepCharacters draft={draft} onChange={patch} />}
          {step === 3 && <StepScenes draft={draft} onChange={patch} controlCutRequest={controlCutRequest} />}
          {step === 4 && <StepFinish projectId={bootstrapKey} draft={draft} onChange={patch} />}

          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => goStep(step - 1)}
              disabled={step === 1}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-35"
              style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.62 0.01 265)" }}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> {t("이전")}
            </button>
            {step === STEPS.length ? (
              <button
                type="button"
                data-tour="project-finish"
                onClick={finish}
                title={t("저장하고 프로젝트 목록으로 나갑니다")}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white gradient-primary"
              >
                {t("프로젝트 목록으로")} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => goStep(step + 1)}
                  title={t("이 단계는 나중에 채워도 됩니다")}
                  className="ml-auto rounded-lg px-3 py-2 text-xs"
                  style={{ color: "oklch(0.55 0.01 265)" }}
                >
                  {t("건너뛰기")}
                </button>
                <button
                  type="button"
                  data-tour="project-next"
                  onClick={() => goStep(step + 1)}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white gradient-primary"
                >
                  {t("다음")} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </main>
      </div>
      <ConfirmDialogHost />
    </ProjectMediaContext.Provider>
  );
}
