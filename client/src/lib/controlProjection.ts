import { z } from "zod";

export const controlDetailSchema = z.enum(["summary", "full"]).default("summary");
export type ControlDetail = z.infer<typeof controlDetailSchema>;
export interface ControlProjection {
  detail: ControlDetail;
  omitted: Array<{ path: string; reason: string; count?: number; firstTime?: number; lastTime?: number }>;
  truncated: boolean;
}

/** 저장·충돌 검사용 원본은 그대로 두고 조종기 응답 사본에서만 무거운 자료를 줄입니다. */
export function projectControlValue<T>(value: T, detail: ControlDetail): { value: T; projection: ControlProjection } {
  const projection: ControlProjection = { detail, omitted: [], truncated: false };
  if (detail === "full") return { value: JSON.parse(JSON.stringify(value)) as T, projection };
  let remaining = 250_000;
  const omit = (path: string, reason: string, extra: Partial<ControlProjection["omitted"][number]> = {}) => {
    projection.truncated = true;
    if (projection.omitted.length < 200) projection.omitted.push({ path: path || "/", reason, ...extra });
  };
  const part = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");
  const walk = (current: unknown, path: string, depth: number): unknown => {
    if (remaining <= 0 || depth > 24) { omit(path, "summary_budget"); return null; }
    if (typeof current === "string") {
      if (/^data:[^,]*;base64,/i.test(current)) { omit(path, "inline_media", { count: current.length }); return ""; }
      const length = Math.min(4000, remaining);
      const next = current.slice(0, length);
      remaining -= JSON.stringify(next).length;
      if (next.length < current.length) omit(path, "string_length", { count: current.length });
      return next;
    }
    if (Array.isArray(current)) {
      if (/\/(?:keys|customKeys)$/.test(path) && current.length > 100) {
        const times = [current[0]?.time, current.at(-1)?.time];
        omit(path, "keyframes", { count: current.length,
          ...(Number.isFinite(times[0]) ? { firstTime: times[0] } : {}), ...(Number.isFinite(times[1]) ? { lastTime: times[1] } : {}) });
        return [];
      }
      const next: unknown[] = [];
      for (let index = 0; index < Math.min(current.length, 100); index += 1) {
        if (remaining <= 0) break;
        remaining -= 1;
        next.push(walk(current[index], `${path}/${index}`, depth + 1));
      }
      if (next.length < current.length) omit(path, "array_length", { count: current.length });
      return next;
    }
    if (current && typeof current === "object") {
      const next: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(current)) {
        if (remaining <= 0) { omit(path, "summary_budget"); break; }
        remaining -= JSON.stringify(key).length + 2;
        next[key] = walk(child, `${path}/${part(key)}`, depth + 1);
        if ((key === "keys" || key === "customKeys") && Array.isArray(child)) {
          next[key === "keys" ? "keyCount" : "customKeyCount"] = child.length;
          if (child.length && Number.isFinite(child[0]?.time) && Number.isFinite(child.at(-1)?.time))
            next[key === "keys" ? "keyTimeRange" : "customKeyTimeRange"] = [child[0].time, child.at(-1).time];
        }
      }
      return next;
    }
    remaining -= 12;
    return current;
  };
  return { value: walk(value, "", 0) as T, projection };
}
