import type { ProjectMedia } from "@/components/project/ProjectMediaContext";
import { projectFolderName } from "@/lib/localProjectStore";
import { projectContextOf, type ProjectContext } from "@/lib/projectContext";
import type { ProjectDraft } from "@/lib/projectTypes";

/**
 * 컨텍스트로 내려보낼 값을 만들 때 **초안에서 읽는 것 전부.**
 *
 * NewProjectPage 의 useMemo 의존성이 손으로 적혀 있었습니다. ProjectContext 에
 * 필드가 하나 늘면 요약(`summarizeProjectContext`)은 그 필드를 읽는데 의존성
 * 목록에는 없어서, 화면이 옛 요약을 든 채 조용히 낡는 구조였습니다.
 *
 * 그래서 읽을 것을 먼저 이 꼴로 뽑고, useMemo 는 뽑은 값들에만 매답니다.
 * `buildProjectMedia` 는 이 꼴만 받으므로 여기 없는 것은 읽을 수도 없습니다.
 */
export interface ProjectMediaInput extends ProjectContext {
  title: string;
  savedId: string | null;
  sharedAssets: ProjectDraft["sharedAssets"];
  imageMarks: ProjectDraft["imageMarks"];
}

/**
 * 입력의 키 전부.
 *
 * `Record<keyof …, true>` 라서 ProjectContext 나 위 인터페이스에 필드가 늘면
 * 여기서 «빠졌다» 고 타입 오류가 납니다 — 선택 필드까지 잡습니다. useMemo 의
 * 의존성은 이 순서대로 뽑으므로 길이가 늘 같고, 빠뜨릴 수가 없습니다.
 */
const PROJECT_MEDIA_INPUT_KEYS: Record<keyof ProjectMediaInput, true> = {
  genres: true,
  styles: true,
  eras: true,
  eraRanges: true,
  eraUnspecified: true,
  title: true,
  savedId: true,
  sharedAssets: true,
  imageMarks: true,
};

/** 초안에서 읽을 것만 뽑습니다. 객체 리터럴이라 필수 필드가 늘면 여기서도 오류가 납니다. */
export function pickProjectMediaInput(draft: ProjectDraft, savedId: string | null): ProjectMediaInput {
  return {
    genres: draft.genres,
    styles: draft.styles,
    eras: draft.eras,
    eraRanges: draft.eraRanges,
    eraUnspecified: draft.eraUnspecified,
    title: draft.title,
    savedId,
    sharedAssets: draft.sharedAssets,
    imageMarks: draft.imageMarks,
  };
}

/** useMemo 에 줄 의존성. 입력의 값들을 정해진 순서로 — React 는 길이가 같은 배열만 받습니다. */
export function projectMediaDeps(input: ProjectMediaInput): unknown[] {
  return (Object.keys(PROJECT_MEDIA_INPUT_KEYS) as (keyof ProjectMediaInput)[]).map(
    (key) => input[key],
  );
}

/**
 * 컨텍스트 값을 만드는 순수 함수.
 *
 * 바꾸는 쪽(commitProject·setImageMarks)은 초안이 아니라 페이지의 ref 와 setState 에
 * 매여 있어서 입력이 아니라 따로 받습니다. 둘 다 렌더마다 같은 것을 가리킵니다.
 */
export function buildProjectMedia(
  input: ProjectMediaInput,
  actions: Pick<ProjectMedia, "commitProject" | "setImageMarks" | "renamePaths">,
): ProjectMedia {
  return {
    // 제목이 아니라 **프로젝트 폴더 이름**입니다.
    // 제목으로 갈라 두었더니, 제목을 한 번 고치면 project.json 은 옛 폴더에,
    // 새로 뽑은 그림은 새 폴더에 남아 「프로젝트 하나 = 폴더 하나」가 깨졌습니다.
    projectId: input.savedId || undefined,
    projectName: projectFolderName(input.savedId, input.title),
    projectContext: projectContextOf(input),
    sharedAssets: input.sharedAssets || [],
    commitProject: actions.commitProject,
    imageMarks: input.imageMarks || {},
    setImageMarks: actions.setImageMarks,
    renamePaths: actions.renamePaths,
  };
}
