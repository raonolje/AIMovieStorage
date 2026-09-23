import {
  releaseEmptyProjectAsset,
  safeFileName,
  saveProjectMediaAsset,
  type ProjectAssetType,
} from "@/lib/mediaLibrary";
import { runLocal, type LocalEngineId, type LocalRunOptions } from "@/lib/localEngines";

/**
 * **로컬 엔진이 뽑은 것을 프로젝트 폴더에 놓습니다.**
 *
 * # 왜 «자리» 를 먼저 잡는가
 *
 * 로컬 워커는 «어디에 쓸지» 를 받아야 합니다. 그런데 폴더·이름·번호 규칙(규칙 5)은
 * `saveProjectMediaAsset` 한 곳이 쥐고 있어야 합니다. 그래서 **빈 파일로 자리를 한 번
 * 잡고** 그 경로를 워커에게 줍니다.
 *
 * # 그 자리에 쓰이지 **않습니다**
 *
 * 2026-09-17 에 라고 한 것이
 * 이 이야기입니다. Rust 쪽(`generate_blocking`)은 **비어 있는 자리에만** 놓습니다 —
 * 같은 이름이 있으면 번호를 올려 원본을 지킵니다. 그런데 우리가 방금 만든 빈 파일이 바로
 * 그 «같은 이름» 이라, 결과는 늘 한 칸 옆(`소녀_로컬_001_001.png`)에 떨어집니다.
 *
 * 그래서 **돌려받은 경로(`result.output`)가 진짜**입니다. 자리 경로를 카드에 붙이면
 * 0바이트 파일을 가리켜 그림이 깨지고(액박), 그 그림으로 굽는 스토리보드는 하얗게 나옵니다.
 *
 * 남은 빈 파일도 성공·실패·취소 뒤에 치웁니다. 정리가 성공 뒤에만 있으면 엔진을
 * 올리다 실패한 자리가 계속 남습니다. 네이티브에서 아직 0바이트인지 확인해 결과는 지킵니다.
 */
export interface LocalOutput {
  /** 실제로 뽑힌 파일의 경로. 카드에 붙일 것은 늘 이쪽입니다. */
  path: string;
  /** 확장자 없는 파일 이름. 화면에 적고 `@태그` 로도 씁니다. */
  name: string;
  seconds: number;
  meta?: Record<string, unknown>;
}

const stemOf = (path: string) =>
  (path.replace(/\\/g, "/").split("/").pop() || "").replace(/\.[^.]+$/, "");

export async function runLocalToProject(input: {
  engine: LocalEngineId;
  /** 그림이면 png, 영상이면 mp4 처럼 — 엔진이 정한 확장자. */
  extension: string;
  kind: "image" | "video" | "audio";
  projectName: string;
  assetType: ProjectAssetType;
  /** 폴더 주인(인물·장면 이름). 규칙 5. */
  ownerName: string;
  /** 파일 이름 앞부분. `_로컬` 은 여기서 붙입니다. */
  stem: string;
  opts: LocalRunOptions;
  timeoutSecs?: number;
  onProgress?: (message: string) => void;
}): Promise<LocalOutput> {
  const stem = `${safeFileName(input.stem)}_로컬`;
  const mime = { image: "image/png", video: "video/mp4", audio: "audio/wav" }[input.kind];
  const placeholder = new File([new Uint8Array(0)], `${stem}.${input.extension}`, { type: mime });
  const saved = await saveProjectMediaAsset(placeholder, {
    projectName: input.projectName,
    assetType: input.assetType,
    ownerName: input.ownerName,
    stem,
  });
  if (!saved?.path) throw new Error("결과를 놓을 자리를 만들지 못했습니다.");

  let resultPath: string | undefined;
  try {
    const result = await runLocal(input.engine, saved.path, input.opts, {
      timeoutSecs: input.timeoutSecs,
      onProgress: input.onProgress ? (event) => input.onProgress!(event.message || "") : undefined,
    });
    resultPath = result.output;
    return { path: result.output, name: stemOf(result.output) || stem, seconds: result.seconds, meta: result.meta };
  } finally {
    // 결과가 첫 자리에 놓였다면 보존합니다. 실패·취소도 빈 자리만 해제하며,
    // 정리 오류 때문에 원래 엔진 오류나 이미 받은 결과가 가려져서는 안 됩니다.
    if (resultPath !== saved.path) {
      await releaseEmptyProjectAsset(input.projectName, saved.path).catch((error) => {
        console.warn("로컬 생성의 빈 예약 파일을 정리하지 못했습니다.", error);
      });
    }
  }
}
