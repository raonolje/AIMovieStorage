import { getLocalProject, saveLocalProjectAndConfirm, type PersistOutcome } from "@/lib/localProjectStore";
import { newProjectDraft, settleLoading, type ProjectDraft } from "@/lib/projectTypes";

/**
 * **창 밖에서 돌던 일이 프로젝트에 결과를 적는 통로.**
 *
 * , 「영상이랑 이미지까지
 * 뽑을 때는 알아서 대표 이미지 선택까지 해서 로컬 폴더에 이미지랑 영상들 다 정리까지」.
 *
 * # 어려운 것은 «어디에 쓸 것인가» 입니다
 *
 * 초안은 편집 화면이 들고 있습니다. 다른 프로젝트를 보고 있는 동안 답이 도착하면 쓸
 * 자리가 없고, 그렇다고 프로젝트 파일에 곧장 쓰면 **열려 있는 화면의 자동 저장이 곧
 * 덮어씁니다.** 그래서 길을 둘로 냅니다.
 *
 * 1. **그 프로젝트가 열려 있으면** 화면이 등록해 둔 길로. 화면이 들고 있는 초안이
 * 진짜입니다.
 * 2. **닫혀 있으면** 프로젝트 파일을 직접 고쳐 씁니다. 다음에 열면 들어 있습니다.
 *
 * 일괄 생성도, 한 번에 뽑기도 같은 통로를 씁니다(공통 규칙 1). 예전에는 일괄 생성만
 * 이 길을 갖고 있어서, 뽑은 그림은 화면이 열려 있을 때만 카드에 붙었습니다.
 */

type Updater = (current: ProjectDraft) => Partial<ProjectDraft>;

interface Target {
  apply: (updater: Updater) => void;
  /**
   * **지금 화면이 들고 있는 초안**을 그대로 돌려줍니다.
   *
   * 작업 서랍에 「그 인물
   * 카드를 찾지 못했습니다」 가 스물네 개 찍혀 있었습니다.
   *
   * 까닭은 **읽는 곳과 쓰는 곳이 달랐기** 때문입니다. 답을 부을 때는 화면(React 상태)에
   * 썼는데, 곧바로 줄에 선 뽑기 일들은 **프로젝트 파일**을 읽었습니다. 파일은 자동 저장이
   * 돌아야 갱신되는데 그건 몇 초 뒤입니다. 그래서 방금 만든 인물·컷·장면이 파일에는 아직
   * 없었고, 전부 「찾지 못했습니다」 로 죽었습니다.
   *
   * 이제 열려 있는 프로젝트는 **화면 것을 읽습니다.** 쓰는 길과 읽는 길이 같아집니다.
   */
  read: () => ProjectDraft;
  /** 갱신 함수가 아직 안 불린 쓰기들의 «포기» 손잡이. 등록이 풀리면 유예 뒤에 부릅니다(`writeLive`). */
  abandon: Set<() => void>;
}

/** 지금 열려 있는 프로젝트에 쓰고 읽는 길. 편집 화면이 살아 있는 동안만 있습니다. */
const targets = new Map<string, Target>();

/**
 * 등록이 풀린 뒤 «갱신 함수가 영영 안 불린다» 고 보기까지의 유예(ms).
 *
 * React 는 fiber 에 대기 중인 갱신이 있으면 `setState(fn)` 의 함수를 바로 돌리지 않고 다음
 * 렌더까지 미루는데, 그 사이 화면이 언마운트되면 그 갱신을 **버리고 함수를 영영 부르지 않습니다.**
 * 그러면 `writeLive` 의 Promise 가 매달려 작업 줄(media 레인)이 앱을 다시 켤 때까지 멈춥니다
 * (2026-09-22 검토). 등록 해제 자체로는 «버려졌다» 와 «열쇠만 바뀌었다»(첫 저장으로 id 가 생겨
 * 같은 화면이 다시 등록) 를 못 가릅니다 — 뒤의 경우 갱신은 곧 렌더에서 돌아 정상으로 풀립니다.
 * 살아 있는 fiber 는 커밋 뒤 남은 갱신을 바로 다음 렌더에 처리하니, 이만큼 지나도 안 불렸으면
 * 화면은 없는 것입니다. 창이 뒤로 가 타이머가 늦춰지면 판정도 늦어질 뿐 앞당겨지진 않습니다.
 */
const LIVE_WRITE_GRACE_MS = 3000;

/** 편집 화면이 «나 여기 있다» 고 알립니다. 돌려받은 함수를 부르면 등록이 풀립니다. */
export function registerProjectTarget(
  projectId: string,
  apply: (updater: Updater) => void,
  read: () => ProjectDraft,
): () => void {
  const target: Target = { apply, read, abandon: new Set() };
  targets.set(projectId, target);
  openListeners.forEach((listener) => listener(projectId));
  return () => {
    if (targets.get(projectId) === target) targets.delete(projectId);
    // 그때까지 안 불린 쓰기는 버려진 것 — 닫힌 길로 다시 가게 풀어 줍니다(`LIVE_WRITE_GRACE_MS`).
    if (target.abandon.size)
      window.setTimeout(() => target.abandon.forEach((abandon) => abandon()), LIVE_WRITE_GRACE_MS);
  };
}


/*
  화면이 열릴 때 «기다리던 일» 을 깨우는 자리입니다. 저장 전이라 파일에 쓸 수 없어
  들고 있던 결과가 여기로 옵니다.
*/
const openListeners = new Set<(projectId: string) => void>();
export function onProjectOpened(listener: (projectId: string) => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

/**
 * 그 프로젝트의 **지금** 초안.
 *
 * 열려 있으면 화면 것을, 아니면 파일에서. 순서가 중요합니다 — 파일을 먼저 보면 방금
 * 넣은 것이 아직 없어서 「찾지 못했습니다」 가 됩니다.
 */
export function readProject(projectId: string): ProjectDraft | null {
  const live = targets.get(projectId);
  if (live) return live.read();
  const saved = getLocalProject(projectId);
  if (!saved) return null;
  /*
    파일 쪽은 편집 화면이 여는 것과 **똑같이** 읽어야 합니다(`settleLoading`). 그냥
    펼쳐 넣으면 옛 파일에 없던 칸이 undefined 로 남아, 다음에 열 때 화면이 깨집니다.
  */
  return settleLoading({ ...newProjectDraft(), ...(saved.draft as Partial<ProjectDraft>) });
}

/**
 * 한 번의 쓰기에 다시 해 보는 횟수 — «다른 창이 먼저 썼다»(되읽은 판 위에 다시 만듦)와
 * «화면이 적용 전에 닫혔다»(닫힌 길로 다시)를 합쳐 셉니다. 세 번을 내리 지면 상대 창이 쉬지
 * 않고 저장하는 중입니다 — 더 돌아도 같습니다.
 */
const WRITE_ATTEMPTS = 3;

/**
 * 쓰기의 결말. `draft` 는 열린 화면에서는 적용한 판, 닫힌 작품에서는 저장한 판입니다.
 * 파일 저장 완료까지 필요한 외부 호출은 `writeProjectAndConfirm` 을 씁니다.
 *
 * 까닭을 함께 주는 이유: 예전에는 null 하나뿐이라 부른 쪽이 «프로젝트를 못 찾았거나 다른 창이
 * 먼저 저장했습니다» 로 단정해 적었는데, 파일 쓰기 실패(`error`)·폴더에 다른 작품(`blocked`)도
 * 같은 null 이라 문구가 틀렸습니다. 또 여기서 토스트를 띄우고 부른 쪽이 또 적어 같은 말이 두 번
 * 보였습니다(2026-09-22 검토). 말하는 곳은 **부른 쪽 하나**이고, 여기는 까닭만 건넵니다.
 */
export type WriteOutcome = { draft: ProjectDraft; why?: undefined } | { draft: null; why: string };

export interface ConfirmedWriteOutcome {
  /** 실패해도 화면에 적용한 편집은 남을 수 있습니다. 저장 여부와 따로 봅니다. */
  draft: ProjectDraft | null;
  persisted: boolean;
  outcome: PersistOutcome;
  why?: string;
}

/**
 * 외부 조종기는 화면에 넣었다는 응답을 파일 저장 완료로 알아들으면 안 됩니다.
 * 기존 쓰기 통로로 적용한 뒤 같은 저장 관문의 결말을 기다립니다. 실패한 편집을
 * 임의로 되풀이하지 않습니다 — 사람이 화면에서 더 고친 값을 덮을 수 있기 때문입니다.
 */
export async function writeProjectAndConfirm(projectId: string, updater: Updater): Promise<ConfirmedWriteOutcome> {
  if (!getLocalProject(projectId)) {
    return { draft: null, persisted: false, outcome: "blocked", why: "프로젝트를 먼저 저장한 뒤 조종해 주세요." };
  }
  const applied = await writeProject(projectId, updater);
  if (!applied.draft) return { ...applied, persisted: false, outcome: "blocked" };
  const { outcome } = await saveLocalProjectAndConfirm(applied.draft, projectId);
  if (outcome === "written" || outcome === "same") return { draft: applied.draft, persisted: true, outcome };
  return { draft: applied.draft, persisted: false, outcome, why: whyNotWritten(outcome) };
}

/** 저장 관문의 결말을 사람 말로 — 부른 쪽이 「…에 못 붙였습니다 — {why}」 처럼 이어 적습니다. */
function whyNotWritten(outcome: Exclude<PersistOutcome, "written" | "same">): string {
  switch (outcome) {
    case "rejected":
      return "다른 창이 계속 먼저 저장했습니다.";
    case "blocked":
      return "저장이 막혀 있습니다 — 저장 폴더에 같은 이름의 다른 작품이 있거나 파일을 읽을 수 없습니다.";
    case "error":
      return "프로젝트 파일을 쓰지 못했습니다 — 다른 프로그램이 project.json 을 잡고 있거나 권한·경로 문제입니다.";
  }
}

/**
 * 프로젝트를 고칩니다. **지금 값을 받아 다음 값을 만드는 함수**여야 합니다(CLAUDE.md).
 *
 * # 돌려주는 것은 «실제로 적용한 그 판» 입니다
 *
 * 넣는 함수가 카드 id 를 **그 안에서 만듭니다**(`uid()`). 그래서 같은 함수를 밖에서 한 번
 * 더 돌려 «방금 넣은 것» 을 얻으려 하면, 글자는 같아도 **id 가 다른** 딴 물건이 나옵니다.
 * 그 id 로 그림을 뽑으라고 시키면 어느 컷에도 안 붙습니다. 실제로 「넣고 바로 뽑기」 를
 * 그렇게 짰다가 붙을 데 없는 그림이 나올 뻔했습니다. 이어서 쓸 값은 반드시 여기서 돌려받은
 * 것을 쓰세요.
 *
 * 예전에는 `after` 콜백으로 그 값을 줬고 반환은 boolean 이었습니다. 그런데 닫힌 작품에
 * 쓰는 길은 저장이 거절돼도(2026-09-21 두 창 사고의 자물쇠) 그것을 모른 채 `after` 를 부르고
 * 참을 돌려줬습니다 — 일괄 생성은 «붙였다» 로 끝났는데 파일에는 없고, 존재하지 않는 id 로
 * 뽑기가 줄에 섰습니다(검토 지적). 그래서 지금은 **저장 결말을 본 뒤** 돌려줍니다.
 *
 * `draft` 가 null 이면 **그 갱신은 어디에도 없습니다** — cache 도 물려 있습니다(`restoreBefore`).
 * 그래서 같은 함수를 나중에 다시 돌려도 두 벌이 되지 않습니다.
 */
export async function writeProject(projectId: string, updater: Updater): Promise<WriteOutcome> {
  for (let attempt = 1; ; attempt += 1) {
    /*
      매번 맨 위에서 다시 봅니다 — 거절돼 되읽는 사이 그 작품이 열렸을 수 있고, 그러면
      화면이 진짜라 열린 길로 가야 합니다.
    */
    const live = targets.get(projectId);
    if (live) {
      const written = await writeLive(live, updater);
      if (written) return { draft: written };
      // 화면이 적용 전에 닫혔습니다 — 이제 닫힌 작품이니 다음 바퀴에서 파일로 갑니다.
      if (attempt >= WRITE_ATTEMPTS) return { draft: null, why: "화면이 닫히는 도중이라 넣지 못했습니다." };
      continue;
    }

    const saved = getLocalProject(projectId);
    if (!saved) return { draft: null, why: "아직 저장 전인 프로젝트라 넣을 자리가 없습니다." };
    const current = readProject(projectId);
    if (!current) return { draft: null, why: "아직 저장 전인 프로젝트라 넣을 자리가 없습니다." };
    const next = { ...current, ...updater(current) };
    const { outcome } = await saveLocalProjectAndConfirm(next, saved.id);
    /*
      `same` 도 성공입니다 — 되읽은 판에 그 씬·컷이 이미 없으면(다른 창이 지움) 쓸 것이
      없는 것이 맞고, 다시 돌려도 같습니다.
    */
    if (outcome === "written" || outcome === "same") return { draft: next };
    /*
      `rejected` 는 다시 합니다. 이때 cache 는 이미 상대 창의 판으로 되읽혀 있으니, 그 위에
      같은 함수를 다시 돌리면 상대가 고친 것과 이번 결과가 **둘 다** 남습니다. 거절된 시도가
      안에서 만든 id 는 어디에도 남지 않습니다(cache 도 되읽기로 덮임).
    */
    if (outcome === "rejected") {
      if (attempt >= WRITE_ATTEMPTS) {
        console.warn(`[저장 막음] 다른 창이 ${WRITE_ATTEMPTS}번 연속 먼저 저장해 이번 결과를 못 붙였습니다.`, projectId);
        return { draft: null, why: whyNotWritten(outcome) };
      }
      continue;
    }
    /*
      `blocked`·`error` 는 다시 해도 같으므로 그만둡니다. 다만 결말을 기다리는 사이 그 작품이
      열렸으면 얘기가 다릅니다 — 화면은 마운트할 때 cache 를 읽는데, 그때 cache 에는 이 갱신을
      올린 판이 있었습니다(물리기는 결말이 난 뒤). 즉 **화면이 이미 이 갱신을 들고 있습니다.**
      여기서 null 을 주면 부른 쪽은 「열면 들어갑니다」 로 들고 있다가 닫았다 열 때 한 번 더 부어
      두 벌이 됩니다(2026-09-22 검토).

      화면 것이 진짜이니 **빈 갱신**을 한 번 보내 화면이 든 판을 받아 «들어갔다» 로 돌려줍니다.
      빈 갱신이라도 초안이 새 객체가 되어 화면의 자동 저장이 그것을 파일로 씁니다 — 안 그러면
      «디스크에서 막 읽은 객체» 로 보여 손대기 전까지 저장이 안 나가고, cache 는 이미 물려 있어
      화면을 닫는 순간 이 갱신이 사라집니다. 그새 화면이 닫혔으면 정말 어디에도 없는 것입니다.
    */
    const opened = targets.get(projectId);
    if (opened) {
      const held = await writeLive(opened, () => ({}));
      if (held) return { draft: held };
    }
    return { draft: null, why: whyNotWritten(outcome) };
  }
}

/**
 * 열린 화면에 씁니다. 저장 거절은 여기서 다루지 않습니다 — 편집 화면이 되읽기 알림을 받아
 * 초안을 갈아 끼우고 사람에게 말합니다(NewProjectPage `onProjectReloaded`).
 *
 * 값은 **다음 틱**에 돌려줍니다(`resolve` 의 `.then` 은 마이크로태스크). 갱신 함수는 React 가
 * 상태를 계산하는 도중에 불리는데, 그 안에서 줄에 일을 세우면(`enqueueTasks` → 구독자들
 * 다시 그리기) 「그리는 도중에 다른 부품을 고쳤다」 는 경고가 나고 드물게 갱신이 빠집니다
 * (2026-09-17 점검). 값은 여기서 잡아 두고 이어 쓰는 일만 미뤄집니다.
 *
 * @returns 적용된 판. null 이면 화면이 갱신을 돌리기 전에 닫혀 **적용되지 않은** 것입니다 —
 * 부른 쪽이 닫힌 길로 다시 갑니다. 예전에는 이때 Promise 가 영영 매달렸습니다
 * (`LIVE_WRITE_GRACE_MS` 의 까닭).
 */
function writeLive(live: Target, updater: Updater): Promise<ProjectDraft | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abandon = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
    live.abandon.add(abandon);
    live.apply((current) => {
      let patch: Partial<ProjectDraft>;
      try {
        patch = updater(current);
      } catch (error) {
        // 생성이 끝나기 전에 사람이 대상을 지울 수 있습니다. 갱신 오류로 React 화면까지 깨뜨리면 안 됩니다.
        settled = true;
        live.abandon.delete(abandon);
        reject(error);
        return {};
      }
      if (!settled) {
        settled = true;
        live.abandon.delete(abandon);
        resolve({ ...current, ...patch });
      }
      return patch;
    });
  });
}
