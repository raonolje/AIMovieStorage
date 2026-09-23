import { copyJsonWithinLimit, sameImmutableJson } from "./immutableJson";

const pathPart = (value: string) => value.replaceAll("~", "~0").replaceAll("/", "~1");
export function diffControlValues(before: unknown, after: unknown, path = ""): Array<{ path: string; before: unknown; after: unknown; truncated?: boolean }> {
  const DIFF_LIMIT = 200;
  const changes: Array<{ path: string; before: unknown; after: unknown; truncated?: boolean }> = [];
  const compact = (value: unknown) => {
    const copied = copyJsonWithinLimit(value ?? null, 4000);
    if (!copied.exceeded) return { value: copied.value, truncated: false };
    // 모캡 트랙 추가/삭제에서는 한 항목도 수백 MB일 수 있습니다. 잘라 보여주려고
    // 먼저 전체를 stringify하지 않으며 작은 값도 원본 참조를 변경 로그에 남기지 않습니다.
    return { value: typeof value === "string" ? value.slice(0, 4000)
      : Array.isArray(value) ? { omitted: true, count: value.length } : { omitted: true }, truncated: true };
  };
  const add = (a: unknown, b: unknown, at: string) => {
    if (changes.length >= DIFF_LIMIT) return;
    const left = compact(a), right = compact(b);
    changes.push({ path: at || "/", before: left.value, after: right.value, ...(left.truncated || right.truncated ? { truncated: true } : {}) });
  };
  const walk = (a: unknown, b: unknown, at: string) => {
    if (changes.length >= DIFF_LIMIT) return;
    if (sameImmutableJson(a, b)) return;
    const identified = (item: unknown): item is { id: string } => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string");
    if (Array.isArray(a) && Array.isArray(b) && a.every(identified) && b.every(identified)) {
      const left = new Map(a.map((item) => [item.id, item])), right = new Map(b.map((item) => [item.id, item]));
      for (const key of new Set([...left.keys(), ...right.keys()])) {
        walk(left.get(key), right.get(key), `${at}/${pathPart(key)}`);
        if (changes.length >= DIFF_LIMIT) break;
      }
      if (changes.length < DIFF_LIMIT && (a.length !== b.length || a.some((item, index) => item.id !== b[index].id)))
        add(a.map((item) => item.id), b.map((item) => item.id), `${at}/@order`);
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        walk(left[key], right[key], `${at}/${pathPart(key)}`);
        if (changes.length >= DIFF_LIMIT) break;
      }
      return;
    }
    add(a, b, at);
  };
  walk(before, after, path);
  return changes;
}
