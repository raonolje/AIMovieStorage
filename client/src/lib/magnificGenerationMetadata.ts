import { assetSrc } from "./mediaLibrary";
import { catalogRecord, parseMagnificPayload } from "./magnificCatalog";
import { t } from "./i18n";

export interface MagnificMeasuredMedia {
  status: "measured" | "unavailable" | "pending";
  width?: number;
  height?: number;
  seconds?: number;
}
export interface MagnificGenerationMetadata {
  requested: { kind: "image" | "video"; args: Record<string, unknown> };
  /** 별칭을 실제 slug로 바꾼 뒤 보낸 값도 원래 요청과 구분해 남깁니다. */
  submitted: Record<string, unknown>;
  accepted: { identifier: string; response: unknown };
  completion?: unknown;
  measured: MagnificMeasuredMedia;
  notices: string[];
}

/** 서버 응답은 보존하되 해석할 수 없는 형식을 성공한 측정값으로 바꾸지 않습니다. */
export function generationResponse(value: unknown): unknown {
  try { return parseMagnificPayload(value); } catch { return value; }
}
export function generationNotices(value: unknown): string[] {
  const notices: string[] = [];
  const walk = (item: unknown, depth: number) => {
    if (depth > 8 || !item || typeof item !== "object") return;
    if (Array.isArray(item)) { item.forEach(child => walk(child, depth + 1)); return; }
    for (const [key, child] of Object.entries(catalogRecord(item))) {
      if (/^(modelNotice|notices?|warnings?|adjustments?)$/i.test(key) && child != null) {
        const values = Array.isArray(child) ? child : [child];
        for (const value of values) {
          if (value === false || value === "") continue;
          notices.push(typeof value === "string" ? value : JSON.stringify(value));
        }
      } else walk(child, depth + 1);
    }
  };
  walk(generationResponse(value), 0);
  return [...new Set(notices)];
}

/** 실제 내려받은 파일만 잽니다. 서버의 aspectRatio·duration은 측정치가 아닙니다. */
export async function measureMagnificMedia(path: string, kind: "image" | "video"): Promise<MagnificMeasuredMedia> {
  if (typeof document === "undefined") return { status: "unavailable" };
  return new Promise(resolve => {
    const media = kind === "image" ? new Image() : document.createElement("video");
    let settled = false;
    const finish = (value: MagnificMeasuredMedia) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      media.removeEventListener("load", loaded); media.removeEventListener("loadedmetadata", loaded); media.removeEventListener("error", failed);
      media.removeAttribute("src");
      if (media instanceof HTMLVideoElement) { media.pause(); media.load(); }
      resolve(value);
    };
    const loaded = () => {
      const video = kind === "video" ? media as HTMLVideoElement : null;
      const width = video ? video.videoWidth : (media as HTMLImageElement).naturalWidth;
      const height = video ? video.videoHeight : (media as HTMLImageElement).naturalHeight;
      if (!(width > 0 && height > 0)) return finish({ status: "unavailable" });
      finish({ status: "measured", width, height,
        ...(video && Number.isFinite(video.duration) && video.duration > 0 ? { seconds: video.duration } : {}) });
    };
    const failed = () => finish({ status: "unavailable" });
    const timer = setTimeout(failed, 10000);
    media.addEventListener(kind === "image" ? "load" : "loadedmetadata", loaded, { once: true });
    media.addEventListener("error", failed, { once: true });
    if (kind === "video") (media as HTMLVideoElement).preload = "metadata";
    media.src = assetSrc(path);
  });
}

export function measuredDifferences(args: Record<string, unknown>, measured: MagnificMeasuredMedia): string[] {
  if (measured.status !== "measured") return [t("결과 파일의 크기·길이를 측정하지 못했습니다. 요청값대로 만들어졌다고 확인한 상태가 아닙니다.")];
  const notes: string[] = [];
  const aspect = typeof args.aspectRatio === "string" ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(args.aspectRatio) : null;
  if (aspect && measured.width && measured.height) {
    const requested = Number(aspect[1]) / Number(aspect[2]), actual = measured.width / measured.height;
    // 코덱·모델의 짝수 픽셀 반올림은 허용하고, 2:1→16:9처럼 비율이 달라진 경우만 알립니다.
    if (Number.isFinite(requested) && requested > 0 && Math.abs(actual - requested) / requested > 0.02)
      notes.push(t("요청 비율 {ratio}과 결과 크기 {width}×{height}이 다릅니다.", { ratio: String(args.aspectRatio), width: measured.width, height: measured.height }));
  }
  if (typeof args.duration === "number" && measured.seconds && Math.abs(measured.seconds - args.duration) > 0.2)
    notes.push(t("요청 길이 {requested}초와 결과 길이 {actual}초가 다릅니다.", { requested: args.duration, actual: Math.round(measured.seconds * 100) / 100 }));
  return notes;
}
