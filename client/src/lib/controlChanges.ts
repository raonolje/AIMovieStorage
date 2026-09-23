const pathPart = (value: string) => value.replaceAll("~", "~0").replaceAll("/", "~1");
export function diffControlValues(before: unknown, after: unknown, path = ""): Array<{ path: string; before: unknown; after: unknown; truncated?: boolean }> {
  const DIFF_LIMIT = 200;
  const changes: Array<{ path: string; before: unknown; after: unknown; truncated?: boolean }> = [];
  const compact = (value: unknown) => {
    const serialized = JSON.stringify(value);
    return serialized && serialized.length > 4000 ? { value: serialized.slice(0, 4000), truncated: true } : { value: value ?? null, truncated: false };
  };
  const add = (a: unknown, b: unknown, at: string) => {
    const left = compact(a), right = compact(b);
    changes.push({ path: at || "/", before: left.value, after: right.value, ...(left.truncated || right.truncated ? { truncated: true } : {}) });
  };
  const walk = (a: unknown, b: unknown, at: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (changes.length >= DIFF_LIMIT) return;
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((item) => item && typeof item === "object" && typeof item.id === "string")) {
      const left = new Map(a.map((item) => [item.id, item])), right = new Map(b.map((item) => [item.id, item]));
      for (const key of new Set([...left.keys(), ...right.keys()])) walk(left.get(key), right.get(key), `${at}/${pathPart(key)}`);
      if (JSON.stringify(a.map((item) => item.id)) !== JSON.stringify(b.map((item) => item.id))) add(a.map((item) => item.id), b.map((item) => item.id), `${at}/@order`);
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(left[key], right[key], `${at}/${pathPart(key)}`);
      return;
    }
    add(a, b, at);
  };
  walk(before, after, path);
  return changes;
}
