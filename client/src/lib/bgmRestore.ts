import { invoke } from "@tauri-apps/api/core";
import { BGM_ROOT } from "@/lib/bgmLibrary";
import { createBgmProject, createBgmTrack, loadBgmProjects, saveBgmProjects, type BgmProject } from "@/lib/bgmProjects";
import { isDesktopApp } from "@/lib/llm";
import { getMediaLibrarySettings, whenAppSettingsReady } from "@/lib/mediaLibrary";

/*
  **BGM 을 폴더에서 되살립니다.**

  영상 프로젝트는 폴더마다 `project.json` 이 있어 저장 폴더만 있으면 통째로 되살아납니다.
  그런데 BGM 기록은 **브라우저 저장소에만** 있었습니다. 그래서 폴더(`BGM/곡/<프로젝트>/`)에 곡이
  멀쩡히 있어도 화면은 「프로젝트가 없습니다」 였습니다 — 앱을 다시 깔거나 저장소가 비면 그렇게 됩니다.
  «폴더가 진실» 이라는 이 앱의 규칙과도 어긋났습니다.

  그래서 목록을 읽을 때 폴더를 한 번 훑어 **기록에 없는 것만** 채웁니다.

  - 폴더 이름이 곧 BGM 프로젝트 이름입니다(`곡/TEST/` → 「TEST」).
  - 파일 이름은 `<프로젝트>_<곡 이름>_<번호>.wav` 라 가운데가 곡 이름입니다. 같은 곡의 여러 판
    (`TEST_곡_001.wav` · `TEST_곡_001_001.wav`)은 한 곡으로 묶습니다 — 목록에 같은 이름이 줄줄이
    늘어서면 무엇이 무엇인지 알 수 없습니다.
  - 이미 기록에 있는 프로젝트는 **건드리지 않습니다.** 사람이 적어 둔 프롬프트·분위기·가사를
    폴더에서 읽은 껍데기로 덮어쓰면 그게 더 큰 손해입니다. 곡 파일만 빠져 있으면 그것만 붙입니다.
*/

/** `list_sub_folders` 가 돌려주는 한 폴더. */
interface SubFolder {
  name: string;
  files: string[];
}

/** 곡 폴더에서 온 기록만 폴더 삭제에 따라 걷습니다. 파일이 아직 없는 새 기획 프로젝트는 보존합니다. */
export function reconcileBgmDeletedFolders(projects: BgmProject[], folders: readonly SubFolder[]) {
  const present = new Set(folders.map((folder) => folder.name.toLocaleLowerCase()));
  const removedIds = new Set<string>();
  const kept = projects.filter((project) => {
    const fromSongFolder = project.tracks.some((track) => (track.resultPaths || []).some((file) =>
      file.replace(/\\/g, "/").toLocaleLowerCase().includes(`/bgm/곡/${project.name.toLocaleLowerCase()}/`)));
    if (fromSongFolder && !present.has(project.name.toLocaleLowerCase())) {
      removedIds.add(project.id);
      return false;
    }
    return true;
  });
  return { kept, removedIds };
}

/** 곡 파일에서 «곡 이름» 을 읽습니다 — `<프로젝트>_<곡 이름>_<번호>[_<번호>].wav`. */
export function trackNameOf(filePath: string, projectName: string): string {
  const base = (filePath.split(/[\\/]/).pop() || "").replace(/\.[^.]+$/, "");
  const withoutPrefix = base.startsWith(`${projectName}_`) ? base.slice(projectName.length + 1) : base;
  // 꼬리의 번호들(`_001`, `_001_001`)을 뗍니다. 남는 것이 곡 이름입니다.
  const name = withoutPrefix.replace(/(_\d{3,})+$/, "").trim();
  return name || withoutPrefix || base;
}

/**
 * 저장 폴더의 `BGM/곡/` 을 훑어 기록에 없는 것을 채워 넣습니다.
 *
 * 돌려주는 것은 **채운 뒤의 목록**입니다. 바뀐 것이 없으면 읽은 것을 그대로 돌려줍니다 —
 * 매번 저장하면 `updatedAt` 만 흔들려 목록 차례가 뒤집힙니다.
 */
export async function restoreBgmProjectsFromDisk(): Promise<BgmProject[]> {
  /*
    **앱 데이터 폴더의 거울을 먼저 기다립니다.**

    설치본과 개발 서버는 웹뷰 origin 이 달라 `localStorage` 가 통째로 갈립니다. 기다리지
    않고 읽으면 설치본에서는 기록이 비어 있고 저장 폴더도 «없음» 이라, 폴더 훑기까지
    건너뛰고 「프로젝트가 없습니다」 로 끝납니다. 화면은 이 함수를 기다리는 동안 먼저
    읽은 목록을 띄우고 있으므로, 여기서 기다려도 빈 화면이 보이지는 않습니다.
  */
  await whenAppSettingsReady();
  const projects = loadBgmProjects();
  if (!isDesktopApp() || !getMediaLibrarySettings().baseDirectory.trim()) return projects;

  let folders: SubFolder[] = [];
  try {
    folders = await invoke<SubFolder[]>("list_sub_folders", {
      baseDirectory: getMediaLibrarySettings().baseDirectory.trim(),
      relativePath: `${BGM_ROOT}/곡`,
      extensions: ["wav", "mp3", "flac", "m4a", "ogg"],
    });
  } catch {
    // 폴더가 아직 없거나 읽지 못하면 기록 그대로 씁니다 — 되살리기는 «있으면 좋은 것» 입니다.
    return projects;
  }

  /*
    **폴더를 읽은 뒤에 기록을 다시 읽습니다.**

    앞에서 뜬 사본에 얹어 저장하면, 폴더를 훑는 몇 초 사이에 사람이 고친 프롬프트·가사가
    통째로 옛 값으로 되돌아갑니다. 훑기는 «어떤 파일이 있더라» 만 알아 오는 일이고,
    **무엇에 얹을지는 그때의 최신 기록**이어야 합니다.
  */
  const { kept, removedIds } = reconcileBgmDeletedFolders(loadBgmProjects(), folders);
  let changed = removedIds.size > 0;
  const next = [...kept];

  for (const folder of folders) {
    if (!folder.files.length) continue;
    const already = next.find((item) => item.name === folder.name);
    const known = new Set((already?.tracks || []).flatMap((track) => track.resultPaths || []));
    const missing = folder.files.filter((file) => !known.has(file));
    if (!missing.length) continue;

    // 곡 이름으로 묶습니다 — 같은 곡의 여러 판이 한 줄로 모입니다.
    const byName = new Map<string, string[]>();
    for (const file of missing) {
      const name = trackNameOf(file, folder.name);
      byName.set(name, [...(byName.get(name) || []), file]);
    }

    const owner = already ?? createBgmProject(folder.name);
    const tracks = [...(owner.tracks || [])];
    for (const [name, files] of byName) {
      const at = tracks.findIndex((track) => (track.name || "").trim() === name);
      if (at >= 0) {
        /*
          **찾은 곡을 제자리에서 고치지 않습니다.** 그 객체는 지금 화면이 들고 있는 것과
          같은 것일 수 있어, 손대면 사람이 적던 글이 딸려 움직입니다. 파일 목록만 더한
          새 객체로 갈아 끼웁니다 — 프롬프트·분위기·가사는 읽은 그대로 남습니다.
        */
        const had = tracks[at].resultPaths || [];
        const add = files.filter((file) => !had.includes(file));
        if (add.length) tracks[at] = { ...tracks[at], resultPaths: [...had, ...add] };
        continue;
      }
      tracks.push({
        ...createBgmTrack(),
        name,
        // 폴더에서 주워 온 것이라 프롬프트가 없습니다. 사람이 열어 채우면 됩니다.
        notes: "폴더에서 되살린 곡입니다. 프롬프트와 분위기는 비어 있습니다.",
        resultPaths: files,
      });
    }

    const filled: BgmProject = { ...owner, tracks, updatedAt: Date.now() };
    if (already) next[next.indexOf(already)] = filled;
    else next.unshift(filled);
    changed = true;
  }

  if (!changed) return next;
  /*
    저장 직전에 **한 번 더** 최신을 읽어, 우리가 더한 곡만 얹습니다. 훑는 동안 사람이 새 곡을
    만들었을 수도 있고, 그것까지 지우면 «만들자마자 사라졌다» 가 됩니다.
  */
  const latest = loadBgmProjects().filter((project) => !removedIds.has(project.id));
  const merged = next.map((item) => {
    const fresh = latest.find((other) => other.id === item.id);
    if (!fresh) return item;
    const ours = new Map(item.tracks.map((track) => [track.id, track]));
    return {
      ...fresh,
      tracks: [
        // 최신 쪽이 기준 — 사람이 고친 글이 거기 있습니다. 파일 목록만 우리 것과 합칩니다.
        ...fresh.tracks.map((track) => {
          const ourTrack = ours.get(track.id);
          if (!ourTrack) return track;
          const add = (ourTrack.resultPaths || []).filter(
            (file) => !(track.resultPaths || []).includes(file),
          );
          return add.length ? { ...track, resultPaths: [...(track.resultPaths || []), ...add] } : track;
        }),
        // 우리가 새로 만든 곡(최신에는 아직 없는 것)만 뒤에 붙입니다.
        ...item.tracks.filter((track) => !fresh.tracks.some((other) => other.id === track.id)),
      ],
    };
  });
  // 훑는 동안 사람이 새로 만든 BGM 프로젝트도 잃지 않습니다.
  for (const fresh of latest) {
    if (!merged.some((item) => item.id === fresh.id)) merged.push(fresh);
  }
  saveBgmProjects(merged);
  return merged;
}
