import { loadBgmProjects } from "@/lib/bgmProjects";
import { importProjectMediaAsset, safeFileName } from "@/lib/mediaLibrary";

/**
 * **BGM 은 따로 삽니다.**
 *
 *
 *
 * 저장 폴더 안에 영상 프로젝트들과 **나란히** `BGM/` 하나를 둡니다.
 *
 * <저장 폴더>/BGM/곡/<BGM 프로젝트>/… ← BGM 화면에서 뽑은 곡
 * <저장 폴더>/BGM/업로드/<영상 프로젝트>/… ← 구도잡기에서 올린 음원
 *
 * 곡을 영상 프로젝트 폴더에 넣지 않는 까닭: 한 곡을 여러 프로젝트에서 돌려 씁니다. 프로젝트 폴더에 두면 그 프로젝트를
 * 지울 때 곡까지 사라지고, 같은 곡이 프로젝트마다 복사본으로 늘어납니다.
 */
export const BGM_ROOT = "BGM";

/** 구도잡기에서 고를 수 있는 곡 하나 — BGM 화면에서 뽑아 둔 결과물입니다. */
export interface BgmChoice {
  /** 어느 BGM 프로젝트의 곡인가. 목록 머리줄이 됩니다. */
  projectName: string;
  /** 곡 이름(없으면 파일 이름). */
  trackName: string;
  path: string;
}

/**
 * BGM 화면에서 뽑아 둔 곡 전부. 구도잡기 «BGM에서 고르기» 가 이 목록을 씁니다.
 *
 * 곡 기록은 BGM 화면과 같은 곳(브라우저 저장소)에서 읽습니다 — 폴더를 훑지 않는 까닭은 곡마다 «어느 프로젝트의 무슨 곡» 인지가
 * 파일 이름이 아니라 그 기록에 있기 때문입니다.
 */
export function listBgmChoices(): BgmChoice[] {
  return loadBgmProjects().flatMap((project) =>
    (project.tracks || []).flatMap((track) =>
      (track.resultPaths || []).map((path) => ({
        projectName: project.name || "이름 없는 BGM",
        trackName: track.name?.trim() || path.split(/[\\/]/).pop() || "곡",
        path,
      })),
    ),
  );
}

/**
 * 구도잡기에서 고른 음원을 **BGM 업로드 폴더로 복사**합니다. 돌려주는 것은 새 경로.
 *
 * 사람이 고른 자리(바탕화면·다운로드)를 그대로 가리키면, 그 파일을 옮기거나 지우는 순간 컷의 노래가 사라집니다.
 * 어느 씬·컷에서 올린 것인지는 **파일 이름**에 적습니다 — 폴더를 더 깊게 파면 탐색기에서 곡 하나 찾는 데 두 겹을 더 들어가야 합니다.
 */
export async function importMusicToBgm(
  /** 사람이 고른 원본 경로(`choose_audio_files` 가 준 것). */
  sourcePath: string,
  where: { projectName: string; sceneTitle?: string; cutOrder?: number },
): Promise<{ path: string; name: string } | null> {
  const fileName = sourcePath.split(/[\\/]/).pop() || "음원";
  const dot = fileName.lastIndexOf(".");
  const stemPart = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "mp3";

  const scene = where.sceneTitle?.trim() ? safeFileName(where.sceneTitle.trim()) : "";
  const cut = where.cutOrder ? `컷${String(where.cutOrder).padStart(2, "0")}` : "";
  const stem = [scene, cut, safeFileName(stemPart)].filter(Boolean).join("_");
  if (!/^(mp3|wav|m4a|flac|ogg|aac)$/.test(ext)) throw new Error("지원하는 음원 파일을 고르세요.");
  // 영상 길이의 음원을 JS 바이트로 복제하면 RAM이 크게 뛰므로 앱의 Rust 복사 길을 씁니다.
  const saved = await importProjectMediaAsset(sourcePath, {
      projectName: BGM_ROOT,
      assetType: "bgm-upload",
      // 업로드는 **어느 영상 프로젝트의 것인가**로 묶습니다 — 프로젝트를 정리할 때 그 폴더만 보면 됩니다.
      ownerName: where.projectName || "프로젝트",
      stem,
    });
  return saved?.path ? { path: saved.path, name: fileName } : null;
}
