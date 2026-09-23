/**
 * 함수형 편집으로 만든 JSON 상태를 문자열 사본 없이 비교합니다.
 * 같은 하위 객체는 이미 같은 판이므로 모캡 관절 수만 개를 다시 읽지 않습니다.
 * 입력 객체를 제자리에서 바꾸지 않는 undo/편집 계약에서만 사용합니다.
 */
export function sameImmutableJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++)
      if (!sameImmutableJson(a[index] ?? null, b[index] ?? null)) return false;
    return true;
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  // JSON에 쓰이지 않는 선택 필드의 undefined와 생략은 같은 값입니다.
  const keys = Object.keys(left).filter(key => left[key] !== undefined);
  const other = Object.keys(right).filter(key => right[key] !== undefined);
  return keys.length === other.length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(right, key) && sameImmutableJson(left[key], right[key]));
}

/** 작은 변경 로그만 복사합니다. 상한을 넘을 큰 문자열/배열은 전체 stringify 전에 멈춥니다. */
export function copyJsonWithinLimit<T>(value: T, limit: number): { value?: T; exceeded: boolean } {
  let remaining = limit;
  const stop = Symbol("변경 로그 크기 제한");
  const spend = (size: number) => { remaining -= size; if (remaining < 0) throw stop; };
  const copy = (item: unknown): unknown => {
    if (typeof item === "string") {
      if (item.length > remaining) throw stop;
      spend(JSON.stringify(item).length);
      return item;
    }
    if (item === null || typeof item !== "object") {
      spend(item === undefined ? 0 : JSON.stringify(item)?.length ?? 0);
      return item;
    }
    spend(2);
    if (Array.isArray(item)) {
      const result: unknown[] = [];
      for (const child of item) { spend(1); result.push(copy(child ?? null)); }
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(item)) {
      if ((item as Record<string, unknown>)[key] === undefined) continue;
      if (key.length > remaining) throw stop;
      spend(JSON.stringify(key).length + 2);
      Object.defineProperty(result, key, { value: copy((item as Record<string, unknown>)[key]),
        enumerable: true, configurable: true, writable: true });
    }
    return result;
  };
  try { return { value: copy(value) as T, exceeded: false }; }
  catch (error) { if (error === stop) return { exceeded: true }; throw error; }
}
