import { fileStemOf } from "@/components/ReferenceTagBar";
import type { Cut, Scene, SceneVideoAsset } from "./projectTypes";

export type CutContinuityMode = "independent" | "continue" | "same-space-new-angle";

export interface CutContinuity {
  mode: Exclude<CutContinuityMode, "independent">;
  sourceCut: Cut;
  video: SceneVideoAsset;
  videoPath: string;
  endFramePath?: string;
}

/** 현재 장면의 컷 순서가 기준입니다. 컷을 옮겨도 예전 ID나 파일을 붙잡지 않습니다. */
export function resolveCutContinuity(scene: Scene, cut: Cut): CutContinuity | null {
  if (!cut.cutContinuity || cut.cutContinuity === "independent") return null;
  const index = scene.cuts.findIndex((item) => item.id === cut.id);
  if (index <= 0) throw new Error("이어지는 컷은 같은 장면의 두 번째 컷부터 설정할 수 있습니다.");
  const sourceCut = scene.cuts[index - 1];
  const video = sourceCut.videos.find((item) => item.isPrimary && item.filePath);
  if (!video?.filePath) throw new Error(`앞 컷 ${sourceCut.order}의 대표영상을 먼저 선택해 주세요. 앞 컷이 완성되기 전에는 이 컷의 영상을 생성하지 않습니다.`);
  if (cut.cutContinuity === "continue" && !video.endFramePath)
    throw new Error(`앞 컷 ${sourceCut.order}의 마지막 프레임이 준비되지 않았습니다. 앞 컷 영상에서 대표 ★을 다시 선택해 주세요.`);
  return { mode: cut.cutContinuity, sourceCut, video, videoPath: video.filePath, endFramePath: video.endFramePath };
}

export function continuityPromptLine(link: CutContinuity, lang: "ko" | "en"): string {
  const video = `@${fileStemOf(link.videoPath)}`;
  if (link.mode === "continue") {
    const frame = `@${fileStemOf(link.endFramePath!)}`;
    return lang === "ko"
      ? `앞 컷의 대표영상 ${video} 다음에 바로 이어지는 컷입니다. ${frame} 는 그 영상의 마지막 프레임이며 이 컷의 첫 프레임입니다. 인물·의상·소품·조명·공간을 정확히 이어받고, 이 컷의 구도잡기 영상이 있으면 그 카메라 동선과 타이밍으로 계속 촬영하세요.`
      : `This shot continues directly after the previous shot's selected video ${video}. ${frame} is its final frame and the first frame of this shot. Preserve cast, clothing, props, lighting and space exactly; follow this shot's own blocking video for its camera path and timing when provided.`;
  }
  return lang === "ko"
    ? `앞 컷의 대표영상 ${video} 와 같은 장소·시간·인물이지만 새로운 카메라 구도로 시작하는 컷입니다. 앞 영상의 외형과 공간을 유지하되 이전 카메라 경로를 복제하지 말고 이 컷의 구도잡기 영상·배치도를 따르세요.`
    : `This shot starts from a new camera angle in the same place and time as the previous shot's selected video ${video}. Preserve its cast and environment, but use this shot's own blocking video or layout instead of copying the previous camera path.`;
}

/** 대표영상이 바뀌면 이전 대표영상의 @태그도 현재 선택으로 바꿉니다. */
export function relinkContinuityTags(text: string, sourceCut: Cut, selected: SceneVideoAsset): string {
  if (!selected.filePath) return text;
  const next = `@${fileStemOf(selected.filePath)}`;
  const replacements = sourceCut.videos
    .filter(video => video.id !== selected.id && video.filePath)
    .flatMap(video => [
      { old: `@${fileStemOf(video.filePath!)}`, now: next },
      ...(video.endFramePath && selected.endFramePath
        ? [{ old: `@${fileStemOf(video.endFramePath)}`, now: `@${fileStemOf(selected.endFramePath)}` }] : []),
    ])
    .sort((a, b) => b.old.length - a.old.length);
  let hidden = text;
  replacements.forEach((item, index) => { hidden = hidden.split(item.old).join(`\u0000CUT_VIDEO_${index}\u0000`); });
  replacements.forEach((item, index) => { hidden = hidden.split(`\u0000CUT_VIDEO_${index}\u0000`).join(item.now); });
  return hidden;
}
