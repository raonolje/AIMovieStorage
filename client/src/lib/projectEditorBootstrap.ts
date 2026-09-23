import { loadProjects, type LocalProject } from "./localProjectStore";

export type ProjectEditorLoadState =
  | { status: "loading" }
  | { status: "ready"; project: LocalProject }
  | { status: "error"; error: unknown };

/**
 * 직접 주소로 들어와도 파일을 다 읽은 뒤에만 편집기를 엽니다. 목록 캐시가 나중에
 * 바뀌어도 이미 시작한 수동 편집을 새 로딩 결과로 덮지 않도록 한 번만 완료합니다.
 */
export function createProjectEditorBootstrap(projectId: string) {
  let state: ProjectEditorLoadState = { status: "loading" };
  let generation = 0;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: ProjectEditorLoadState) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start(): Promise<void> {
      if (state.status === "ready") return Promise.resolve();
      if (pending) return pending;
      const turn = ++generation;
      publish({ status: "loading" });
      pending = loadProjects({ requiredProjectId: projectId }).then(projects => {
        if (turn !== generation) return;
        const project = projects.find(item => item.id === projectId);
        if (!project) throw new Error("그 프로젝트를 찾지 못했습니다.");
        publish({ status: "ready", project });
      }).catch(error => {
        if (turn === generation) publish({ status: "error", error });
      }).finally(() => {
        if (turn === generation) pending = null;
      });
      return pending;
    },
    cancel() {
      // 경로를 바꾸거나 닫은 뒤 도착한 답으로 이전 작품의 편집기가 다시 열리지 않습니다.
      generation += 1;
      pending = null;
    },
  };
}
