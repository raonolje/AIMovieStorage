import { createContext, useContext } from "react";
import type { ImageMark } from "@/components/ImageMarkupEditor";
import type { VisualAsset } from "@/lib/visualAsset";
import type { ProjectContextSummary } from "@/lib/projectContext";
import type { ProjectChangeCommit } from "@/lib/projectCommit";

/**
 * 프로젝트 편집 화면 어디서나 꺼내 쓰는 것들.
 *
 * 캐릭터 카드 안의 시트 창, 그 안의 자르기 창처럼 **여러 겹 안쪽에서도**
 * 프로젝트 이름과 설정이 필요합니다. props 로 내려보내면 중간의 모든
 * 컴포넌트가 자기와 상관없는 값을 받아 넘기게 되고, 하나만 빠뜨려도
 * 안쪽에서 조용히 «저장 폴더 없음» 이 됩니다.
 */
export interface ProjectMedia {
  /** 외부 조종기 저장도 현재 프로젝트의 같은 저장 경로를 사용합니다. */
  projectId?: string;
  /** 저장 폴더 안의 프로젝트 폴더 이름이 되는 값 */
  projectName: string;
  /** 장르·스타일·시대 요약. 없으면 아직 아무것도 안 골랐다는 뜻입니다. */
  projectContext: ProjectContextSummary | null;
  /** 프로젝트 전체가 함께 쓰는 에셋. 시트 창에서는 가져다 쓰기만 합니다. */
  sharedAssets: VisualAsset[];
  /**
   * 지금까지 넣은 것을 프로젝트 파일로 씁니다.
   *
   * 편집 창을 닫는 순간처럼 «여기까지는 지켜야 하는» 지점에서 부릅니다.
   * 실수로 X 를 눌렀을 때 방금 넣은 이미지와 프롬프트가 날아가면 안 됩니다.
   */
  commitProject: () => void;
  /** 구도처럼 «저장됨»을 표시할 편집은 현재 초안에 적용하고 파일 쓰기까지 기다립니다. */
  commitProjectChange?: ProjectChangeCommit;
  /**
   * 그림마다 그려 둔 표시. 열쇠는 **파일 경로**입니다.
   *
   * 배경 카드에 붙여 두었더니, 같은 공간에서 앵커만 옮겨 다른 씬을 만들 때
   * 원본을 다시 뽑거나 표시를 지웠다 다시 찍어야 했습니다. 그림마다 따로
   * 두면 「관측소_앵커 A」 「관측소_앵커 B」 가 각자의 표시를 들고 남습니다.
   *
   * 파일 경로를 열쇠로 쓰는 이유는 폴더가 진짜이기 때문입니다. blob 주소는
   * 세션이 끝나면 죽고, 카드 안의 id 는 그 카드를 지우면 같이 사라집니다.
   */
  imageMarks: Record<string, ImageMark[]>;
  setImageMarks: (filePath: string, marks: ImageMark[]) => void;
  /**
   * 폴더에서 파일 이름이 바뀌었을 때 «옛 경로 → 새 경로» 를 초안 전체에 반영합니다.
   *
   * 변형 창이 변형 이름을 바꾸면 그 변형의 파일(`냥이_겨울_001`)이 `냥이_밤_001` 로
   * 바뀝니다. 그런데 그 파일을 가리키는 것은 변형 하나가 아닙니다 — 자식 변형의
   * 정체성 기준, 부모가 빌려 쓴 레퍼런스, 그 그림에 그려 둔 표시(imageMarks)까지.
   * 창 안에서 제 것만 고치면 나머지가 없는 경로를 가리켜 썸네일이 깨집니다.
   */
  renamePaths: (moved: Map<string, string>) => void;
}

export const ProjectMediaContext = createContext<ProjectMedia>({
  projectName: "",
  projectContext: null,
  sharedAssets: [],
  commitProject: () => {},
  imageMarks: {},
  setImageMarks: () => {},
  renamePaths: () => {},
});

export function useProjectMedia() {
  return useContext(ProjectMediaContext);
}
