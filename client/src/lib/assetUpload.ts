import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";

/** 수백 MB 영상을 숫자 배열 JSON으로 불려 메모리에 올리지 않습니다. */
export const ASSET_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
let uploadTail: Promise<unknown> = Promise.resolve();

export function uploadProjectAsset(file: File, request: Record<string, unknown>): Promise<string> {
  // 여러 파일을 골라도 읽기·전송 버퍼는 한 조각만 유지합니다.
  const pending = uploadTail.then(() => upload(file, request));
  uploadTail = pending.catch(() => undefined);
  return pending;
}

async function upload(file: File, request: Record<string, unknown>): Promise<string> {
  const uploadId = await invoke<string>("begin_project_asset_upload", { request, totalSize: file.size });
  let complete = false;
  try {
    for (let offset = 0; offset < file.size; offset += ASSET_UPLOAD_CHUNK_BYTES) {
      const bytes = new Uint8Array(await file.slice(offset, offset + ASSET_UPLOAD_CHUNK_BYTES).arrayBuffer());
      const received = await invoke<number>("append_project_asset_upload", bytes, {
        headers: { "x-asset-upload-id": uploadId, "x-asset-upload-offset": String(offset) },
      });
      if (received !== offset + bytes.byteLength) throw new Error(t("파일 전송 크기를 확인하지 못했습니다."));
    }
    const path = await invoke<string>("finish_project_asset_upload", { uploadId });
    if (!path) throw new Error(t("저장된 파일 경로를 확인하지 못했습니다."));
    complete = true;
    return path;
  } finally {
    if (!complete) await invoke("abort_project_asset_upload", { uploadId }).catch(() => undefined);
  }
}
