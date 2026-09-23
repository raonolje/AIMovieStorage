import { t } from "@/lib/i18n";

/** 카탈로그의 중첩 제약을 보존합니다. 이름 목록만 읽으면 영상 미지원·상호 배타 입력을 놓칩니다. */
export interface MagnificModel {
  slug: string;
  name: string;
  resolutions: string[];
  qualities: string[];
  durations: number[];
  aspectRatios: string[];
  details?: Record<string, unknown>;
}

export const catalogRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const catalogStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** TOON의 따옴표 안 쉼표·이스케이프는 값의 일부입니다. 단순 split으로 제약을 잘라서는 안 됩니다. */
function cells(text: string): string[] {
  const out: string[] = [];
  let start = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quoted) { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  out.push(text.slice(start).trim());
  return out;
}

function scalar(text: string): unknown {
  const value = text.trim();
  if (value.startsWith('"')) { try { return JSON.parse(value); } catch { return value; } }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** 서버가 쓰는 TOON 객체·배열·표 형식 배열을 같은 데이터 트리로 읽습니다. */
function parseToon(text: string): unknown {
  const lines = text.split(/\r?\n/).filter(line => line.trim()).map(line => ({
    indent: line.length - line.trimStart().length, text: line.trim(),
  }));
  let cursor = 0;
  function property(target: Record<string, unknown>, text: string, indent: number) {
    const match = /^("(?:[^"\\]|\\.)*"|[^\s:\[{}]+)(?:\[(\d+)\])?(?:\{([^}]+)\})?:\s*(.*)$/.exec(text);
    if (!match) throw new Error(t("마그니픽 모델 목록의 필드를 읽지 못했습니다."));
    const key = String(scalar(match[1]));
    if (["__proto__", "prototype", "constructor"].includes(key)) return;
    const [count, header, inline] = [match[2], match[3], match[4]];
    if (count !== undefined) {
      const length = Number(count);
      const values: unknown[] = [];
      if (inline) values.push(...cells(inline).map(scalar));
      else if (header) {
        const names = cells(header);
        while (cursor < lines.length && lines[cursor].indent > indent) {
          const row = cells(lines[cursor++].text);
          if (row.length !== names.length) throw new Error(t("마그니픽 모델 목록의 표가 올바르지 않습니다."));
          values.push(Object.fromEntries(names.map((name, i) => [name, scalar(row[i])])));
        }
      } else {
        while (cursor < lines.length && lines[cursor].indent > indent) {
          const line = lines[cursor++];
          if (!line.text.startsWith("- ")) throw new Error(t("마그니픽 모델 목록의 배열을 읽지 못했습니다."));
          const entry: Record<string, unknown> = {};
          property(entry, line.text.slice(2), line.indent + 2);
          while (cursor < lines.length && lines[cursor].indent > line.indent) {
            const child = lines[cursor++];
            property(entry, child.text, child.indent);
          }
          values.push(entry);
        }
      }
      if (values.length !== length) throw new Error(t("마그니픽 모델 목록의 항목 수가 맞지 않습니다."));
      target[key] = values;
    } else if (inline) target[key] = scalar(inline);
    else {
      const entry: Record<string, unknown> = {};
      while (cursor < lines.length && lines[cursor].indent > indent) {
        const child = lines[cursor++];
        property(entry, child.text, child.indent);
      }
      target[key] = entry;
    }
  }
  const root: Record<string, unknown> = {};
  while (cursor < lines.length) {
    const line = lines[cursor++];
    property(root, line.text, line.indent);
  }
  return root;
}

/** 생성 접수 응답도 같은 JSON·TOON 규칙을 쓰므로 파서를 두 벌 두지 않습니다. */
export function parseMagnificPayload(reply: unknown): unknown {
  let value = reply;
  if (typeof value === "string") {
    const text = value;
    try { value = JSON.parse(text); } catch { value = parseToon(text); }
  }
  return value;
}

export function parseMagnificCatalog(reply: unknown): MagnificModel[] {
  const value = parseMagnificPayload(reply);
  const record = catalogRecord(value);
  const rows = Array.isArray(value) ? value : ["models", "data", "items", "results"].map(key => record[key]).find(Array.isArray) ?? [];
  return rows.map(item => {
    const row = catalogRecord(item);
    const durations = row.durations ?? row.durationOptions;
    return {
      slug: String(row.slug ?? row.id ?? row.model ?? ""),
      name: String(row.name ?? row.label ?? row.slug ?? ""),
      resolutions: catalogStrings(row.resolutions), qualities: catalogStrings(row.qualities),
      durations: Array.isArray(durations) ? durations : [],
      aspectRatios: catalogStrings(row.aspectRatios), details: row,
    };
  }).filter(item => item.slug).map(item => ({ ...item, durations: item.durations.map(Number).filter(n => Number.isFinite(n) && n > 0) }));
}
