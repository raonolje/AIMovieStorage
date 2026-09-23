import { coverOf } from "@/lib/projectCover";
import { toast } from "sonner";
import { migrateProjectLayout, whenAppSettingsReady } from "@/lib/mediaLibrary";
import { applyMovedPaths } from "@/lib/ownerFolders";
import { PROJECT_SCHEMA_VERSION, migrateSavedProject, schemaVersionOf } from "@/lib/projectMigrate";
import { sameImmutableJson } from "@/lib/immutableJson";
import { createProjectSerializer } from "@/lib/projectSerialization";
import {
  canUseProjectFiles,
  PROJECT_FILE_NAME,
  folderOf,
  readAllProjectFiles,
  toFolderName,
  writeDataFile,
} from "@/lib/projectFiles";

const STORAGE_KEY = "frameforge.local.projects.v1";
const MIGRATED_KEY = "frameforge.local.projects.migrated.v1";
const HIDDEN_KEY = "frameforge.local.projects.hidden.v1";

export interface LocalProjectSummary {
  id: string;
  title: string;
  genre: string;
  logline: string;
  style: string;
  createdAt: string;
  updatedAt: string;
  sceneCount: number;
  assetCount: number;
  /** 보드 카드에 띄울 그림. 사람이 정한 것이 없으면 작품 안에서 찾은 한 장입니다. */
  coverPath?: string;
  /** 저장 폴더 안의 프로젝트 폴더 이름. 파일로 저장된 경우에만 있습니다. */
  folder?: string;
}

export interface LocalProject extends LocalProjectSummary {
  /**
   * 저장 형식의 **판**. 없으면 판을 매기기 전의 저장본(0 판)입니다.
   *
   * 초안(`draft`) 안이 아니라 여기 둡니다 — 아래 「내용이 그대로면 쓰지 않습니다」 검사가
   * 초안을 통째로 견주기 때문에, 판이 초안 안에 있으면 옛 저장본을 열기만 해도 전부
   * «달라졌다» 가 되어 켤 때마다 작품 수만큼 파일 쓰기가 나갑니다. 자세한 까닭은
   * `lib/projectMigrate.ts`.
   */
  schemaVersion?: number;
  draft: Record<string, unknown>;
}

type DraftLike = {
  title?: string;
  genre?: string;
  logline?: string;
  style?: string;
  scenes?: Array<{ cuts?: unknown[] }>;
  // 아래 셋은 «내용이 있는가» 를 세는 데만 씁니다 (wouldWipe).
  characters?: unknown[];
  backgrounds?: unknown[];
  sharedAssets?: unknown[];
};

/**
 * 메모리 캐시.
 *
 * 파일 읽기는 비동기인데 화면 곳곳에서 동기로 목록을 꺼내 씁니다.
 * 앱을 켤 때 한 번 읽어 여기 담아두고, 저장할 때마다 파일과 함께 갱신합니다.
 */
let cache: LocalProject[] | null = null;

function readLocalStorage(): LocalProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const projects = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(projects)) return [];
    // 거울에도 옛 판이 남아 있습니다(폴더를 안 쓰는 브라우저 실행에서는 여기가 본체).
    return projects.map((project: LocalProject) => migrateSavedProject(project, project?.id));
  } catch {
    return [];
  }
}

function writeLocalStorage(projects: LocalProject[]) {
  if (typeof window === "undefined") return;
  try {
    // 파일 이행 뒤에는 디스크가 본체입니다. 수백 MB 전체를 quota 실패 전에 복제하지 않습니다.
    // 옛 거울은 삭제·요약 덮어쓰기하지 않아 최초 이행 입력과 브라우저 실행을 보존합니다.
    if (canUseProjectFiles() && window.localStorage.getItem(MIGRATED_KEY)) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // 용량 초과 등으로 실패해도 파일 저장이 본체이므로 넘어갑니다.
  }
}

// 반환 타입을 string 으로 못박습니다.
// randomUUID 의 템플릿 리터럴 타입이 그대로 새어 나가면
// 저장된 id 를 다시 넘길 때 "string 은 UUID 가 아니다" 로 막힙니다.
function makeId(): string {
  return globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const toSerializableDraft = createProjectSerializer();

function folderFor(project: LocalProject) {
  return project.folder || toFolderName(project.title, project.id);
}

// ── 두 창이 같은 작품을 열었을 때 ─────────────────────────────────────────
/*
  2026-09-21 국호 컷 1 사고. 같은 프로젝트를 연 창이 둘이었고, B 창의 마그니픽 후보함
  스캔이 «되돌아온 파일» 표시 하나를 초안에 찍자 자동 저장이 **B 가 들고 있던 낡은 초안
  전체**를 project.json 에 썼습니다. A 창에서 고친 구도·characterRefs·@태그 프롬프트가
  그 한 번에 날아갔습니다. 파일 감시가 없으니 A 는 자기 것이 지워진 줄도 몰랐습니다.

  규칙은 하나입니다 — **디스크가 이 창이 마지막으로 읽거나 쓴 것과 다르면 덮어쓰지 않는다.**
  덮어쓰는 대신 디스크 것을 다시 읽어 화면을 갈아 끼우고, 사람에게 알립니다.
  비교 자체는 Rust `save_data_file` 이 한 명령 안에서 합니다(한 벌). 여기서는 «기준 판» 을
  기억해 넘기고, 졌을 때 되읽는 일만 합니다.
*/

/**
 * 이 창이 마지막으로 디스크에서 읽었거나 디스크에 쓴 판 — id → `updatedAt`.
 *
 * `cache` 항목의 `updatedAt` 을 그대로 쓰지 않는 이유: `saveLocalProject` 는 파일 쓰기가
 * 끝나기 전에 cache 를 먼저 갈아 끼웁니다. 그 뒤 곧바로 한 번 더 저장하면 «아직 디스크에
 * 없는 내 도장» 이 기준이 되어, 상대 창이 그 사이에 쓴 것을 못 알아봅니다.
 */
const diskVersion = new Map<string, string>();

/**
 * 디스크와 내용이 같은 cache 항목 — 켤 때 읽은 것, 되읽은 것, 쓰기가 끝난 것.
 *
 * «이미 디스크에 있다» 를 `updatedAt` 으로 가리지 않는 까닭: 같은 밀리초에 만들어진 두 판은
 * 도장이 같아, 앞 판을 쓴 뒤 뒤 판을 «이미 있다» 로 버리게 됩니다. 객체 그 자체로 봅니다.
 */
const onDisk = new WeakSet<LocalProject>();
/** 같은 초안을 다시 저장해도 첫 파일 쓰기가 끝나기 전에는 성공으로 답하면 안 됩니다. */
const pendingPersists = new WeakMap<LocalProject, Promise<PersistOutcome>>();
function trackPersistence(project: LocalProject, persisted: Promise<PersistOutcome>): Promise<PersistOutcome> {
  pendingPersists.set(project, persisted);
  void persisted.then(() => {
    if (pendingPersists.get(project) === persisted) pendingPersists.delete(project);
  });
  return persisted;
}

/** 디스크가 달라서 다시 읽었을 때 알립니다. 편집 화면이 초안을 갈아 끼우는 데 씁니다. */
const reloadListeners = new Set<(project: LocalProject) => void>();
export function onProjectReloaded(listener: (project: LocalProject) => void): () => void {
  reloadListeners.add(listener);
  return () => reloadListeners.delete(listener);
}

/**
 * 파일 쓰기 한 번의 **결말**.
 *
 * - `written` 디스크에 썼습니다.
 * - `same` 쓸 것이 없었습니다 — 같은 본문이 이미 디스크에 있습니다.
 * - `rejected` 다른 창이 먼저 써서 못 썼고, **cache 는 디스크 판으로 되읽었습니다.**
 * 그 위에 다시 만들어 저장하면 됩니다.
 * - `blocked` 못 썼고 되읽지도 못했습니다(폴더에 다른 작품 · 읽을 수 없는 파일 ·
 * 내용을 비우는 저장). 다시 해도 같습니다.
 * - `error` 쓰기 자체가 실패했습니다(권한·경로 등).
 *
 * `written`·`same` 이 아니면 **cache 에도 그 본문이 없습니다** — `rejected` 는 디스크 판으로
 * 되읽혔고, `blocked`·`error` 는 올리기 전 판으로 물렸습니다(`restoreBefore`).
 *
 * 왜 밖으로 내는가: 2026-09-21 검토에서 잡힌 구멍입니다. 닫힌 작품에 쓰는 길
 * (`writeProject` → `saveLocalProject`)은 저장이 거절돼도 그 사실을 몰랐습니다 —
 * `persistToFile` 의 Promise 를 `void` 로 버렸고, 되읽기 알림은 편집 화면만 듣습니다.
 * 일괄 생성이 붙인 영상은 «붙였다» 로 끝났는데 파일에는 없었습니다.
 */
export type PersistOutcome = "written" | "same" | "rejected" | "blocked" | "error";

/**
 * 작품마다 «cache 를 내 손 밖의 판으로 갈아 끼운 횟수».
 *
 * 줄에 선 쓰기가 자기 결말을 바르게 말하려면 이것이 필요합니다. 앞 쓰기가 거절돼
 * `adoptFromDisk` 가 cache 를 디스크 판으로 갈아 끼우면, **뒤에 줄 서 있던 쓰기가 올려
 * 둔 본문도 함께 버려집니다**(뒤 쓰기는 차례가 와도 «이미 디스크와 같다» 만 보게 됨).
 * 그때 뒤 쓰기가 `same` 이라고 하면 부른 쪽은 붙은 줄 압니다. 줄 설 때의 횟수와 차례가
 * 왔을 때의 횟수가 다르면 내 본문은 사라진 것이므로 `rejected` 로 말합니다.
 *
 * 갈아 끼우는 길은 셋이고 **셋 다** 셉니다 — 되읽기(`adoptFromDisk`) · 목록 읽기(`loadProjects`) ·
 * 못 쓴 본문 물리기(`restoreBefore`). 2026-09-22 검토: 목록 읽기만 안 세어, 닫힌 작품에 붙이는
 * 중에 목록 화면을 오가면 줄에 선 쓰기가 본문을 잃고도 `same`(성공)으로 끝났습니다.
 */
const reloadCount = new Map<string, number>();

/**
 * 디스크에서 읽은 판을 **이 창의 기준**으로 삼습니다 — 되읽기와 목록 읽기가 같은 도장을 찍습니다.
 * 두 곳에 따로 적혀 있다가 `reloadCount` 를 한쪽만 올리는 모양이 됐습니다(위 주석).
 */
function markReadFromDisk(project: LocalProject) {
  if (project.updatedAt) diskVersion.set(project.id, project.updatedAt);
  onDisk.add(project);
  reloadCount.set(project.id, (reloadCount.get(project.id) ?? 0) + 1);
}

/**
 * 못 쓴 본문을 cache 에서 **물립니다** — 올렸던 자리에 올리기 전의 판을 되돌려 놓습니다.
 *
 * 2026-09-22 검토: `rejected` 만 `adoptFromDisk` 가 cache 를 디스크 판으로 갈아 끼워 깨끗했고,
 * `blocked`(폴더에 다른 작품·읽을 수 없는 파일)와 `error`(파일 쓰기 실패)는 되돌리는 코드가
 * 없었습니다. 그러면 부른 쪽은 「못 넣었다」 로 알고 나중에 같은 갱신을 다시 돌리는데, 그 «나중»
 * 의 현재 값은 이미 한 번 적용된 cache 판이라 **씬이 두 벌**이 됩니다(일괄 생성 답을 닫힌 작품에
 * 붓다 파일 쓰기가 실패 → 열면 cache 판 위에 다시 부음). 물리고 나면 «null 이면 어디에도 없다»
 * 가 참이 됩니다.
 *
 * 올리기 전 판이 없으면(첫 저장) 손대지 않습니다 — 항목을 지우면 화면이 «저장된 작품» 으로
 * 알고 있는 id 가 사라집니다. 편집 화면은 자기 초안을 들고 있으니 되읽기 알림은 보내지 않습니다
 * (보내면 화면의 안 저장된 편집이 옛 판으로 덮입니다).
 */
function restoreBefore(id: string, previous: LocalProject | undefined) {
  if (!previous) return;
  reloadCount.set(id, (reloadCount.get(id) ?? 0) + 1);
  const next = [previous, ...currentProjects().filter((item) => item.id !== id)];
  cache = next;
  writeLocalStorage(next);
}

/**
 * 파일 쓰기는 한 줄로 섭니다.
 *
 * 저장 둘이 앞뒤로 나가면(단계 넘기기 직후 자동 저장 등) 둘 다 같은 기준 판을 들고
 * 출발합니다. 앞 것이 쓰고 나면 디스크는 앞 것의 도장인데 뒤 것은 옛 기준을 대니
 * «다른 창이 썼다» 로 잘못 잡혀 방금 고친 것을 스스로 되돌립니다. 그래서 기준은
 * **쓰는 순간에** 보고, 쓰기는 앞 것이 끝난 뒤에 시작합니다. 본문도 마찬가지로
 * 쓰는 순간의 것입니다(`persistToFile` 의 까닭).
 */
let persistQueue: Promise<void> = Promise.resolve();

/**
 * 디스크에 다른 창의 판이 있어 못 썼을 때 — 그것을 이 창의 것으로 삼습니다.
 *
 * @returns 같은 작품을 되읽어 cache 를 갈아 끼웠으면 참. 거짓이면 손대지 않은 것이라
 * 다시 저장해도 또 거절됩니다(`blocked`).
 */
function adoptFromDisk(mine: LocalProject, contents: string | null | undefined): boolean {
  if (!contents) return false;
  let parsed: LocalProject;
  try {
    parsed = JSON.parse(contents) as LocalProject;
  } catch {
    console.warn("[저장 막음] 디스크의 project.json 이 더 새로운데 읽을 수 없습니다.", mine.id);
    return false;
  }
  if (parsed.id !== mine.id) {
    /*
      같은 폴더에 다른 작품이 있습니다. 어느 쪽도 지우면 안 되니 손대지 않습니다.

      다만 **말없이** 돌아가면 안 됩니다 — 이 뒤로 이 작품의 저장은 전부 거절되는데
      화면·cache 에는 편집이 남아 사람은 저장되는 줄 압니다(2026-09-21 검토: 두 창이
      같은 제목으로 새 작품을 만들면 폴더가 겹쳐 이렇게 됩니다). 앱을 끄는 순간 다 사라지므로
      지금 알려서 제목을 바꿔 다른 폴더로 옮기게 합니다.
    */
    console.warn("[저장 막음] 폴더의 project.json 이 다른 작품입니다.", mine.id, parsed.id);
    toast.error("이 작품을 저장하지 못했습니다 — 저장 폴더에 같은 이름의 다른 작품이 있습니다.", {
      id: `save-blocked:${mine.id}`,
      description: "제목을 바꿔 다른 폴더로 옮긴 뒤 다시 저장하세요. 그 전까지는 이 작품의 변경이 파일에 남지 않습니다.",
      duration: 15000,
    });
    return false;
  }
  // 되읽는 길도 목록 읽기와 **같은 판 올리기**를 거칩니다 — 한쪽만 올리면 같은 작품이
  // 어느 길로 들어왔느냐에 따라 다른 모양이 됩니다.
  const fromDisk: LocalProject = migrateSavedProject({ ...parsed, folder: folderFor(mine) }, mine.id);
  markReadFromDisk(fromDisk);
  const next = [fromDisk, ...currentProjects().filter((item) => item.id !== fromDisk.id)];
  cache = next;
  writeLocalStorage(next);
  console.warn("[저장 막음] 다른 창이 먼저 저장해 디스크 것을 다시 읽었습니다.", mine.id);
  reloadListeners.forEach((listener) => listener(fromDisk));
  return true;
}

/**
 * @param guard 있으면 «기준 판» 을 대고 씁니다 — 이 창이 기억하는 판, 없으면 `previous` 의 도장.
 * 없으면(옮기기 등 첫 쓰기) 검사 없이 씁니다. `previous` 는 cache 에 올리기 전에 있던 항목 —
 * 못 쓰면 그 자리로 물립니다(`restoreBefore`).
 * @returns 이 호출이 올려 둔 본문의 결말(`PersistOutcome`). 줄에 선 것이라 차례가 와야 압니다.
 */
function persistToFile(
  project: LocalProject,
  guard?: { previous: LocalProject | undefined },
): Promise<PersistOutcome> {
  // 폴더를 안 정한 상태는 거울(localStorage)이 본체입니다 — cache 에 넣은 것으로 끝입니다.
  if (!canUseProjectFiles()) return Promise.resolve("written");
  const reloadsWhenQueued = reloadCount.get(project.id) ?? 0;
  const run = async (): Promise<PersistOutcome> => {
    // 검사 없이 쓰는 길은 물릴 «전 판» 도 없습니다 — 받은 것을 그대로 썼을 뿐입니다.
    const undo = () => guard && restoreBefore(project.id, guard.previous);
    try {
      /*
        줄 서 있는 동안 앞 쓰기가 거절돼 되읽었으면 내 본문은 이미 버려졌습니다(`reloadCount`
        의 까닭). 그래도 아래는 그대로 갑니다 — cache 에 남의 새 본문이 있으면 그것을 쓰는 것이
        맞습니다. 다만 **내 결말은 `rejected`** 입니다. 부른 쪽이 되읽은 판 위에 다시 만들게.
      */
      const dropped = () => (reloadCount.get(project.id) ?? 0) !== reloadsWhenQueued;
      /*
        쓸 본문은 줄 설 때 받은 것이 아니라 **차례가 왔을 때 cache 에 있는 것**입니다.

        기준 판만 그 순간에 보고 본문은 줄 설 때 것을 쓰면, 앞 쓰기가 «디스크가 다르다» 로
        거절돼 `adoptFromDisk` 가 기준을 상대 창의 판으로 바꾼 뒤, 뒤 쓰기가 그 새 기준을
        대고 **되읽기 전의 낡은 본문**을 통과시킵니다 — 막으려던 사고가 줄을 타고 그대로 납니다
        (한 틱에 저장이 둘 나가는 길이 정상적으로 있습니다: 「프로젝트 목록으로」 의 commit 과
        unmount flush, 닫힌 작품에 연달아 닿는 attachImage, syncFolders 안의 저장).
        cache 는 되읽는 순간 디스크 것으로 바뀌어 있으니 그것을 씁니다. 그 항목이 이미 디스크와
        같으면(방금 되읽었거나, 앞 쓰기가 같은 본문을 이미 썼으면) 쓸 것이 없습니다 — 도장만
        새로 찍는 되쓰기는 상대 창의 다음 편집을 버리게 합니다.

        기준 없이 쓰는 길(켤 때 옮기기)은 cache 가 아직 없으니 받은 것을 그대로 씁니다.
      */
      const latest = guard ? (getLocalProject(project.id) ?? project) : project;
      if (guard && onDisk.has(latest)) return dropped() ? "rejected" : "same";
      const base = guard ? (diskVersion.get(latest.id) ?? guard.previous?.updatedAt) : undefined;
      const result = await writeDataFile(
        `${folderFor(latest)}/${PROJECT_FILE_NAME}`,
        // 큰 모캡의 들여쓰기는 IPC 문자열까지 부풀립니다. 스키마·CAS는 그대로 두고 공백만 뺍니다.
        JSON.stringify(latest),
        base,
      );
      if (result.written) {
        diskVersion.set(latest.id, latest.updatedAt);
        onDisk.add(latest);
        return dropped() ? "rejected" : "written";
      }
      if (adoptFromDisk(latest, result.current)) return "rejected";
      // 되읽지도 못했으면 cache 에 남은 내 본문은 어디에도 없는 판입니다 — 물립니다(`restoreBefore`).
      undo();
      return "blocked";
    } catch (error) {
      console.warn("프로젝트를 파일로 저장하지 못했습니다.", error);
      undo();
      return "error";
    }
  };
  // 내 차례의 결말은 나에게, 줄 자체는 결말과 상관없이 다음으로.
  const turn = persistQueue.then(run);
  persistQueue = turn.then(() => undefined);
  return turn;
}

/**
 * 앱을 켤 때 한 번 부릅니다.
 *
 * 파일에 있는 프로젝트를 읽어 캐시를 채우고, localStorage 에만 있던 예전
 * 프로젝트가 있으면 파일로 옮깁니다. 옮긴 뒤에도 localStorage 는 지우지 않습니다.
 * 잘 옮겨졌는지 확인하기 전에 원본을 없애면 되돌릴 수 없습니다.
 */
export async function loadProjects(options: { requiredProjectId?: string } = {}): Promise<LocalProject[]> {
  /*
    **저장 폴더가 정해진 뒤에 읽습니다.**

    설치본과 개발 서버는 웹뷰 origin 이 달라 `localStorage` 가 통째로 갈립니다. 진짜 저장
    폴더는 거울 파일에 있고, 그것을 읽어 오는 데 한 틱이 걸립니다. 기다리지 않고 읽으면
    **옛 폴더에서 목록을 읽고, 그다음 저장은 새 폴더로** 나갑니다 — 목록과 저장이 서로
    다른 폴더를 보는 상태입니다(2026-09-23 재현: 목록은 `D:/old`, 저장은 `D:/new`).

    기다리는 자리는 **화면이 아니라 여기**입니다. 부르는 쪽이 둘(작품 목록 화면·튜토리얼
    표본)이라, 화면마다 적으면 한 곳을 빠뜨립니다. 앞선 판례가 `bgmRestore.ts` 에 있습니다.

    실패해도 반드시 풀립니다(`whenAppSettingsReady` 가 `.catch` 로 받습니다) — 여기서
    앱이 멈추지는 않습니다. 브라우저로 열었으면 곧장 돌아옵니다.
  */
  await whenAppSettingsReady();
  const stored = readLocalStorage();

  if (!canUseProjectFiles()) {
    cache = stored;
    return cache;
  }

  /*
    줄에 선 쓰기가 다 착지한 뒤에 읽습니다. 닫힌 작품에 일괄 생성이 붙이는 중에 목록 화면으로
    오는 것이 이 앱의 정상 사용법인데, 쓰기가 날아가는 도중에 읽으면 옛 파일을 «디스크 판» 으로
    삼아 cache 를 그것으로 갈아 끼웁니다 — 방금 붙은 그림이 목록에도, 다음에 열 때도 없습니다
    (2026-09-22 검토). 읽는 동안 새로 줄 선 쓰기는 아래 `markReadFromDisk` 의 횟수로 `rejected`
    를 받아 새 판 위에 다시 만듭니다.
  */
  await persistQueue.catch(() => undefined);

  let fromFiles: LocalProject[] = [];
  const brokenFiles: string[] = [];
  try {
    const files = await readAllProjectFiles();
    fromFiles = files
      .map((file): LocalProject | null => {
        try {
          const parsed = JSON.parse(file.contents) as LocalProject;
          // 폴더 이름은 파일이 실제로 있던 자리를 그대로 씁니다.
          // 저장된 값과 폴더가 다르면 다음 저장이 엉뚱한 곳으로 갑니다.
          //
          // 판 올리기는 **읽는 이 자리 한 곳**에서 합니다 — 화면·`readProject` 는 전부 cache 를
          // 거쳐 가므로, 여기서 한 번 올려 두면 읽는 쪽마다 다시 보정할 일이 없습니다.
          // 여기서 올린 것을 곧바로 되쓰지는 않습니다(도장만 새로 찍는 쓰기는 상대 창의 다음
          // 편집을 버리게 합니다). 다음 진짜 저장이 나갈 때 판이 함께 파일로 갑니다.
          if (!looksLikeProject(parsed)) {
            // 문법은 맞는데 속이 빈 파일(`{}`)은 **id 없는 항목**으로 목록에 들어갑니다.
            // 그러면 id 로 찾는 자리마다 엉뚱한 것을 집고, 그런 파일이 둘이면 서로 겹칩니다.
            // 건너뛰되 **그 파일만** 건너뜁니다 — 나머지 작품은 그대로 열립니다.
            console.warn(`프로젝트 파일의 모양이 아닙니다(건너뜁니다): ${file.relativePath}`);
            brokenFiles.push(file.relativePath);
            return null;
          }
          return migrateSavedProject({ ...parsed, folder: folderOf(file) }, file.relativePath);
        } catch {
          console.warn(`프로젝트 파일을 읽지 못했습니다: ${file.relativePath}`);
          brokenFiles.push(file.relativePath);
          return null;
        }
      })
      .filter((project): project is LocalProject => project !== null);
  } catch (error) {
    console.warn("프로젝트 폴더를 읽지 못했습니다.", error);
    // 직접 주소로 편집기를 열 때는 실패한 파일 대신 옛 브라우저 사본을 열면 안 됩니다.
    // 그 사본이 실시간 편집 대상으로 등록되면 다음 자동 저장이 최신 파일을 덮을 수 있습니다.
    if (options.requiredProjectId) throw error;
  }
  if (brokenFiles.length) {
    // 조용히 사라지면 「작품이 없어졌다」 로 보입니다. 무엇을 건너뛰었는지는 남겨 둡니다.
    console.warn(`읽지 못한 프로젝트 파일 ${brokenFiles.length}개:`, brokenFiles);
    lastBrokenProjectFiles = brokenFiles;
  }

  // 삭제·손상된 파일을 옛 localStorage에서 되살리지 않습니다. 예전 프로젝트의 최초
  // 파일 이행은 프로젝트 목록의 기존 경로에서 하고, 직접 열기는 실제 파일을 요구합니다.
  if (options.requiredProjectId && !fromFiles.some(project => project.id === options.requiredProjectId)) {
    throw new Error("저장 폴더에서 그 프로젝트를 읽지 못했습니다.");
  }

  /*
    브라우저 저장소에만 있던 예전 프로젝트를 파일로 옮깁니다.

    **딱 한 번만 합니다.** 예전에는 켤 때마다 돌았고, 그래서 폴더를
    탐색기에서 지워도 다음에 앱을 켜면 브라우저 저장소에 남은 항목을
    «아직 파일로 안 옮긴 것» 으로 보고 폴더를 다시 만들었습니다.
    지워도 지워도 되살아나는 상태였어요.

    폴더가 원본입니다. 한 번 옮기고 나면 그다음부터는 폴더만 봅니다.
  */
  if (!window.localStorage.getItem(MIGRATED_KEY)) {
    const knownIds = new Set(fromFiles.map(project => project.id));
    const pending = stored.filter(project => !knownIds.has(project.id));
    for (const project of pending) {
      await persistToFile(project);
      fromFiles.push({ ...project, folder: folderFor(project) });
    }
    window.localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
    if (pending.length) console.info(`프로젝트 ${pending.length}개를 파일로 옮겼습니다.`);
  }

  /*
    옛 폴더 구조를 새 구조로 옮깁니다.

        <프로젝트>/character-reference/여울/여울_001.png
          → <프로젝트>/character/여울/ref/ref_여울_001.png

    갈래가 위, 인물이 아래였던 것을 인물이 위, 갈래가 아래로 뒤집습니다.
    한 인물의 것이 한 폴더에 모여야 탐색기로 봐도, 이름을 바꿔도, 지워도
    한 곳만 건드리면 됩니다.

    파일을 옮기면 프로젝트가 들고 있던 filePath 가 전부 어긋나므로 **같은
    자리에서 함께 고칩니다.** 나눠 두면 그 사이에 앱이 꺼졌을 때 화면은
    없는 자리를 가리키게 됩니다. 이미 옮긴 프로젝트에서는 아무 일도
    일어나지 않습니다.
  */
  for (const [index, project] of fromFiles.entries()) {
    const moved = await migrateProjectLayout(folderFor(project));
    if (!moved.size) continue;
    const fixed = {
      ...project,
      draft: applyMovedPaths(project.draft as never, moved) as unknown as Record<string, unknown>,
    };
    fromFiles[index] = fixed;
    await persistToFile(fixed);
    console.info(`${project.folder}: 파일 ${moved.size}개를 새 폴더 구조로 옮겼습니다.`);
  }

  cache = fromFiles.sort(byNewest);
  // 방금 읽은 판이 이 창의 기준입니다. 옮기며 쓴 것도 같은 도장을 그대로 썼습니다.
  cache.forEach(markReadFromDisk);

  // 브라우저 전용/최초 이행 전만 거울을 씁니다. 파일 이행 뒤의 삭제·목록은 폴더가 결정합니다.
  writeLocalStorage(cache);
  return cache;
}

function currentProjects(): LocalProject[] {
  return cache ?? readLocalStorage();
}

// ── 숨기기 ────────────────────────────────────────────────────────────────

/**
 * 목록에서 감춥니다. **지우지 않습니다.**
 *
 * 이 앱은 프로젝트 폴더도 함께 관리합니다. 그 안에 그림과 영상이 들어 있어요.
 * 목록에서 뺐다고 그 폴더를 지우면, 몇 시간씩 뽑아 놓은 결과물이 클릭 한 번에
 * 사라집니다. 되돌릴 방법도 없고요.
 *
 * 그래서 규칙을 이렇게 둡니다.
 *
 * - **숨기기** — 목록에서만 안 보이게. 폴더는 그대로.
 * - **진짜 삭제** — 탐색기에서 폴더를 지우는 것. 그게 유일한 삭제입니다.
 *
 * 폴더를 지우면 다음에 목록을 읽을 때 그 프로젝트가 없으니, 숨김 표시도
 * 같이 정리됩니다(`prunedHidden`). 숨김 목록이 유령으로 불어나지 않습니다.
 */
function readHidden(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeHidden(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
  } catch {
    /* 저장 실패가 작업을 막으면 안 되므로 조용히 넘어갑니다. */
  }
}

/**
 * 지금 존재하는 프로젝트에 대한 숨김만 남깁니다.
 *
 * 폴더째 지운 프로젝트의 id 가 계속 남아 있으면, 나중에 같은 id 가 다시
 * 생겼을 때(백업 복원 등) 이유 없이 숨겨진 채로 나타납니다.
 */
function prunedHidden(projects: LocalProject[]): string[] {
  const alive = new Set(projects.map(project => project.id));
  const kept = readHidden().filter(id => alive.has(id));
  if (kept.length !== readHidden().length) writeHidden(kept);
  return kept;
}

export function hideProject(id: string) {
  const hidden = readHidden();
  if (!hidden.includes(id)) writeHidden([...hidden, id]);
}

export function unhideProject(id: string) {
  writeHidden(readHidden().filter(item => item !== id));
}


/**
 * 겹치지 않는 폴더 이름을 고릅니다.
 *
 * 폴더 이름은 제목에서 만듭니다. 그런데 **제목이 같은 프로젝트를 둘 만드는
 * 것은 정상적인 일입니다** — 같은 이야기를 다시 짜 보는 중이거나, 판을
 * 나눠 두는 중이거나. 그때 폴더가 겹치면 한쪽을 저장할 때 다른 쪽의
 * project.json 을 덮어쓰고, 한쪽을 지우면 둘 다 사라집니다.
 *
 * 그래서 이미 쓰이는 이름이면 뒤에 번호를 붙입니다.
 */
function uniqueFolderName(title: string, id: string, projects: LocalProject[]): string {
  const base = toFolderName(title, id);
  const taken = new Set(
    projects.filter(project => project.id !== id).map(project => project.folder).filter(Boolean),
  );
  if (!taken.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} (${index})`;
    if (!taken.has(candidate)) return candidate;
  }
  // 여기까지 오면 이름으로는 못 가립니다. id 는 반드시 다릅니다.
  return `${base}_${id}`;
}

/**
 * 내용이 있던 프로젝트를 **빈 것으로 덮어쓰지 않습니다.**
 *
 * 2026-09-04 에 실제로 일어난 일입니다. 자동 저장을 붙인 뒤, 프로젝트를
 * 읽어 오기 전의 «빈 초안» 이 저장으로 나가 「수화의 숲」 의 인물·배경·씬이
 * 통째로 0 이 됐습니다. 그림 파일은 폴더에 남았지만 그것을 묶고 있던
 * 프로젝트 파일이 비어서 화면에서는 사라진 것과 같았습니다.
 *
 * 자동 저장은 «언제 나가는지 사람이 모르는» 저장입니다. 그래서 나가는 값이
 * 이상할 때 막아 줄 것이 필요합니다. 지우는 것은 사람이 명시적으로 할 때만
 * 일어나야 합니다.
 *
 * 판단은 **내용이 있었는데 전부 사라졌는가** 하나뿐입니다. 하나를 지우거나
 * 이름을 바꾸는 정상적인 편집은 막지 않습니다.
 */
function wouldWipe(previous: LocalProject | undefined, draft: DraftLike): boolean {
  if (!previous) return false;
  const count = (value: DraftLike) =>
    (value.characters?.length || 0) +
    (value.backgrounds?.length || 0) +
    (value.scenes?.length || 0) +
    (value.sharedAssets?.length || 0);
  const before = count(previous.draft as DraftLike);
  return before > 0 && count(draft) === 0;
}

/*
  사람이 마지막 항목을 일부러 지웠을 때.

  wouldWipe 는 «내용이 있었는데 0 이 됐다» 만 보기 때문에, 인물 하나짜리
  프로젝트에서 그 인물을 지우면 저장이 막혔습니다. 폴더는 이미 지웠는데
  project.json 에는 남아 다음에 열면 카드가 되살아났습니다. (2026-09-05 검증)
  지우는 쪽이 미리 알려 주면 그 다음 «전부 0» 저장 한 번은 통과시킵니다.
*/
/** 미래 판이라 막았다고 **작품마다 한 번만** 말합니다 — 자동 저장이 돌 때마다 뜨면 안 됩니다. */
const futureWarned = new Set<string>();

/**
 * 지금 이 창이 마지막으로 저장한 작품. «빈 저장 한 번 허용» 을 여기에 **묶습니다.**
 *
 * 지우는 화면(장면·인물 목록)은 작품 id 를 모릅니다 — 초안과 갱신 함수만 받습니다.
 * 그래서 id 를 타고 내리는 대신, 저장소가 아는 «지금 다루는 작품» 에 묶습니다.
 */
let lastStagedId: string | null = null;

/**
 * 허용의 임자. `null` 이면 허용이 없는 것입니다.
 *
 * 예전에는 그냥 참/거짓 하나였습니다. A 에서 장면을 지우고 **곧바로 B 로 옮기면**,
 * 그 허용이 B 의 첫 자동 저장을 통과시켜 B 를 빈 값으로 덮을 수 있었습니다 —
 * 허용은 한 번만 쓰이지만 **누구의 한 번인지**가 없었기 때문입니다(2026-09-23 검토).
 */
let emptySaveFor: string | null = null;

export function expectEmptyProjectSave(): void {
  emptySaveFor = lastStagedId;
}

/**
 * 작품 목록의 **차례** — 나중에 고친 것이 앞입니다.
 *
 * 세 곳이 같은 줄을 적고 있었습니다(`loadProjects` · `listLocalProjects` 둘). 그런데
 * `updatedAt` 이 없는 항목이 하나라도 섞이면 `localeCompare` 가 **그 자리에서 터져**
 * 목록 읽기가 통째로 실패합니다 — 작품 하나가 이상해서 **나머지 작품이 전부 안 보이는**
 * 모양이 됩니다(2026-09-23 검토).
 *
 * 위쪽 관문(`looksLikeProject`)이 이미 이상한 파일을 거르지만, 정렬은 옛 저장본·손으로
 * 고친 파일도 지납니다. 두 겹으로 둡니다 — 규칙은 한 벌로.
 */
function byNewest(a: { updatedAt?: string }, b: { updatedAt?: string }): number {
  return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
}

/**
 * 이것이 **프로젝트 저장본의 모양인가.** 문법만 맞는 파일을 목록에 들이지 않습니다.
 *
 * `JSON.parse` 는 `{}` 도 통과시킵니다. 그걸 그대로 들이면 **id 없는 항목**이 목록에
 * 앉고, id 로 찾는 자리마다 엉뚱한 것을 집습니다. 그런 파일이 둘이면 서로 겹칩니다
 * (2026-09-23 검토).
 *
 * 무엇을 필수로 볼까 — **id 와 draft 둘뿐**입니다. 나머지(제목·폴더·판)는 없어도
 * 채워 넣을 수 있지만, 이 둘이 없으면 «어느 작품인지» 와 «무엇이 들었는지» 가 없습니다.
 * 필수를 넓게 잡으면 옛 저장본이 통째로 안 열립니다.
 */
function looksLikeProject(value: unknown): value is LocalProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<LocalProject>;
  if (typeof item.id !== "string" || !item.id.trim()) return false;
  return Boolean(item.draft) && typeof item.draft === "object";
}

/** 마지막 폴더 읽기에서 건너뛴 파일들. 화면이 「이 파일들은 못 읽었습니다」 를 띄울 때 씁니다. */
let lastBrokenProjectFiles: string[] = [];
export function brokenProjectFiles(): string[] {
  return [...lastBrokenProjectFiles];
}

/**
 * 저장의 몸통 — cache 에 올리고 파일 쓰기를 줄에 세웁니다.
 *
 * `saveLocalProject`(결말을 안 기다림 — 편집 화면의 자동 저장)와
 * `saveLocalProjectAndConfirm`(결말까지 — 창 밖에서 닫힌 작품에 쓰는 길)이 **같은 이 몸통**을
 * 씁니다. 따로 두면 «비우기 막기» 나 «같으면 안 쓰기» 규칙 하나를 고칠 때 한쪽을 빠뜨립니다.
 *
 * 새 작품의 id를 곧바로 화면에 공유하면서 결말도 기다릴 때는 이 반환값의 project와
 * persisted를 함께 씁니다. 저장 함수 두 개를 연달아 부르면 같은 큰 초안을 다시
 * 직렬화·복제하게 됩니다. persisted는 이 호출이 올린 판의 실제 쓰기 결과입니다.
 */
export function stageLocalProject(
  draft: DraftLike,
  id = makeId(),
): { project: LocalProject; persisted: Promise<PersistOutcome> } {
  const now = new Date().toISOString();
  const scenes = draft.scenes || [];
  const projects = currentProjects();
  const previous = projects.find(project => project.id === id);
  /*
    **작품이 바뀌면 남은 허용은 버립니다.**

    A 에서 장면을 지워 놓고 저장이 나가기 전에 B 로 옮기면, 그 허용이 B 의 빈 저장을
    통과시킵니다. 허용은 한 번만 쓰이지만 «누구의 한 번인가» 가 없었습니다.
  */
  if (lastStagedId !== id) {
    emptySaveFor = null;
    lastStagedId = id;
  }

  /*
    **이 앱보다 새로운 판에는 쓰지 않습니다.**

    두 대에 판이 다른 앱이 깔려 있는 일은 정상입니다(한쪽만 먼저 올립니다). 읽기는
    이미 손대지 않고 그대로 씁니다(`migrateSavedProject`) — 그런데 쓰기는 이 앱이 아는
    칸만 적어 내보냈습니다. 새 판에만 있는 칸이 **말 없이 사라지고**, 판 도장까지 내려
    찍혀서 다음에 새 앱으로 열어도 되살릴 근거가 없어집니다.

    막고 한 번 알립니다. 자동 저장이 돌 때마다 뜨지 않게 작품마다 한 번만 말합니다.
  */
  const theirs = schemaVersionOf(previous);
  if (previous && theirs > PROJECT_SCHEMA_VERSION) {
    if (!futureWarned.has(id)) {
      futureWarned.add(id);
      toast.error(
        `이 작품은 더 새로운 판(${theirs})으로 저장돼 있습니다. ` +
          "덮어쓰면 새 판의 내용이 사라져서 저장하지 않았습니다 — 앱을 올린 뒤 여세요.",
      );
    }
    return { project: previous, persisted: Promise.resolve("blocked") };
  }

  if (wouldWipe(previous, draft)) {
    // 허용은 **그 작품의 다음 저장 한 번**에만 듭니다. 임자가 다르면 그냥 막습니다.
    if (emptySaveFor !== null && emptySaveFor === lastStagedId && lastStagedId === id) {
      emptySaveFor = null;
    } else {
      // 조용히 넘어갑니다. 알림을 띄우면 자동 저장이 돌 때마다 뜹니다.
      console.warn("[저장 막음] 내용이 있던 프로젝트를 빈 값으로 덮어쓰려 했습니다.", id);
      return { project: previous!, persisted: Promise.resolve("blocked") };
    }
  }

  const serialized = toSerializableDraft(draft);
  /*
    **내용이 그대로면 쓰지 않습니다.** 열기만 한 창, 충돌로 되읽은 창이 도장만 새로 찍어
    디스크에 되쓰면 상대 창의 다음 진짜 편집이 «디스크가 다르다» 로 버려집니다 —
    두 창이 서로를 되돌리는 핑퐁입니다(2026-09-21). 편집 화면의 객체 동일성 검사가 먼저
    막고, 이건 그 검사를 지나친 길(단계 넘기기·폴더 맞추기·창 밖 결과)의 보험입니다.
  */
  if (previous && sameImmutableJson(previous.draft, serialized)) {
    const pending = pendingPersists.get(previous);
    return {
      project: previous,
      persisted: pending ?? (!canUseProjectFiles() || onDisk.has(previous)
        ? Promise.resolve("same")
        : trackPersistence(previous, persistToFile(previous, { previous }))),
    };
  }

  const project: LocalProject = {
    id,
    /*
      판은 **새로 쓰는 저장본에만** 찍습니다. 바로 위 「내용이 그대로면 쓰지 않습니다」 를
      지나온 뒤라, 열기만 한 작품에는 판이 찍히지 않고 파일도 그대로 남습니다. 옛 판 파일은
      다음 진짜 편집 때 판과 함께 갱신됩니다 — 판을 붙이겠다고 멀쩡한 파일을 되쓰면 그 사이
      다른 창이 한 편집을 버리게 됩니다.
    */
    schemaVersion: PROJECT_SCHEMA_VERSION,
    title: draft.title?.trim() || "Untitled project",
    genre: draft.genre || "",
    logline: draft.logline || "",
    style: draft.style || "",
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    sceneCount: scenes.length,
    assetCount: scenes.reduce((count, scene) => count + (scene.cuts?.length || 0), 0),
    // 보드 카드에 띄울 한 장. 사람이 정한 것이 없으면 작품 안에서 찾습니다(`projectCover`).
    coverPath: coverOf(draft as Parameters<typeof coverOf>[0]),
    // 폴더 이름은 처음 저장할 때 정하고 이후 바꾸지 않습니다.
    // 제목을 고칠 때마다 폴더가 따라 움직이면 이미지 경로가 전부 끊깁니다.
    folder: previous?.folder || uniqueFolderName(draft.title?.trim() || "", id, projects),
    draft: serialized,
  };

  const next = [project, ...projects.filter(item => item.id !== id)];
  cache = next;
  writeLocalStorage(next);
  /*
    기준 판은 이 창이 기억하는 것, 그것도 없으면(목록을 안 거치고 바로 연 창) 거울에 있던
    `updatedAt`. 둘 다 없으면 새 작품이거나 옛 파일이라 검사 없이 씁니다. `previous` 는 못 썼을 때
    물릴 자리이기도 합니다.
  */
  const persisted = persistToFile(project, { previous });
  return { project, persisted: trackPersistence(project, persisted) };
}

/**
 * 저장합니다. 돌려주는 것은 **cache 에 올린 것**이지 «디스크에 쓴 것» 이 아닙니다 — 파일
 * 쓰기는 줄에 서고, 거절되면 되읽기 알림(`onProjectReloaded`)으로 화면에 옵니다.
 * 결말이 필요하면 `saveLocalProjectAndConfirm`.
 */
export function saveLocalProject(draft: DraftLike, id = makeId()): LocalProject {
  return stageLocalProject(draft, id).project;
}

/**
 * 저장하고 **파일 쓰기의 결말까지** 기다립니다.
 *
 * 되읽기 알림을 아무도 듣지 않는 닫힌 작품에 쓸 때 씁니다(`writeProject`). `rejected` 면
 * cache 는 이미 디스크 판으로 바뀌어 있으니, 그 위에 다시 만들어 저장하면 됩니다.
 */
export async function saveLocalProjectAndConfirm(
  draft: DraftLike,
  id = makeId(),
): Promise<{ project: LocalProject; outcome: PersistOutcome }> {
  const { project, persisted } = stageLocalProject(draft, id);
  return { project, outcome: await persisted };
}

/** 목록에 보일 것. 숨긴 것은 빠집니다. */
export function listLocalProjects(): LocalProjectSummary[] {
  const projects = currentProjects();
  const hidden = new Set(prunedHidden(projects));
  return projects
    .filter(project => !hidden.has(project.id))
    .sort(byNewest)
    .map(({ draft: _draft, ...summary }) => summary);
}

/** 숨긴 것만. 다시 보이게 하려면 이 목록에서 고릅니다. */
export function listHiddenProjects(): LocalProjectSummary[] {
  const projects = currentProjects();
  const hidden = new Set(prunedHidden(projects));
  return projects
    .filter(project => hidden.has(project.id))
    .sort(byNewest)
    .map(({ draft: _draft, ...summary }) => summary);
}

/**
 * 그림·영상이 들어갈 폴더 이름.
 *
 * **project.json 이 놓인 폴더와 반드시 같아야 합니다.** 예전에는 미디어만
 * 제목으로 갈라져서, 제목을 한 번 고치면 project.json 은 옛 폴더에, 새로
 * 뽑은 그림은 새 폴더에 남았습니다. 「프로젝트 하나 = 폴더 하나」가 깨져요.
 */
export function projectFolderName(id: string | null | undefined, title: string): string {
  const saved = id ? currentProjects().find(project => project.id === id) : undefined;
  return saved?.folder || toFolderName(title.trim(), "");
}

export function getLocalProject(id: string): LocalProject | null {
  return currentProjects().find(project => project.id === id) || null;
}

