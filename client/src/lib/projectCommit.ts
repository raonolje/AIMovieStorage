import { canUseProjectFiles } from "./projectFiles";
import { stageLocalProject } from "./localProjectStore";
import { writeProject } from "./projectWrite";
import { whenAppSettingsReady } from "./mediaLibrary";
import type { ProjectDraft } from "./projectTypes";

export interface ProjectChangeCommitResult {
  projectId: string;
  persisted: true;
}
export type ProjectChangeCommit = (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => Promise<ProjectChangeCommitResult>;

/** 새 마법사도 열린 초안을 먼저 고친 뒤 같은 ID로 파일 저장을 확인합니다. */
export async function commitOpenProjectChange(
  owner: { targetKey: () => string; projectId: () => string | undefined; adoptId: (id: string) => void },
  updater: (current: ProjectDraft) => Partial<ProjectDraft>,
): Promise<ProjectChangeCommitResult> {
  await whenAppSettingsReady();
  if (!canUseProjectFiles()) throw new Error("프로젝트 파일을 저장할 폴더를 먼저 설정해 주세요.");
  const applied = await writeProject(owner.targetKey(), (current) => {
    if (!current.title.trim()) throw new Error("프로젝트 제목을 먼저 적어 주세요. 구도를 저장할 폴더 이름이 됩니다.");
    return updater(current);
  });
  if (!applied.draft) throw new Error(applied.why);
  // React가 저장 갱신을 계산하는 동안 자동 저장이 먼저 ID를 만들 수도 있으므로 지금 읽습니다.
  const staged = stageLocalProject(applied.draft, owner.projectId());
  // 파일을 기다리는 동안 자동 저장·다른 편집이 새 id를 또 만들지 않도록 먼저 공유합니다.
  owner.adoptId(staged.project.id);
  const outcome = await staged.persisted;
  if (outcome !== "written" && outcome !== "same")
    throw new Error("편집 내용은 화면에 있지만 프로젝트 파일 저장을 확인하지 못했습니다. 창을 닫지 말고 다시 저장해 주세요.");
  return { projectId: staged.project.id, persisted: true };
}
