/**
 * 함수형 초안을 저장용 스냅샷으로 정리합니다. File/blob 주소는 재실행 때 쓸 수 없습니다.
 * 전체 JSON 문자열을 만들었다가 다시 파싱하지 않으며, 불변 하위 객체는 이전 복사를 재사용합니다.
 * 입력을 제자리에서 고치지 않는 프로젝트 편집 계약에서만 사용합니다.
 */
export function createProjectSerializer() {
  const saved = new WeakMap<object, unknown>();
  const active = new WeakSet<object>();
  const clean = (value: unknown): unknown => {
    if (typeof File !== "undefined" && value instanceof File) return undefined;
    if (typeof value === "string") return value.startsWith("blob:") ? undefined : value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint") throw new TypeError("BigInt는 프로젝트 JSON에 저장할 수 없습니다.");
    if (typeof value === "function" || typeof value === "symbol") return undefined;
    if (!value || typeof value !== "object") return value;
    if (active.has(value)) throw new TypeError("순환 참조는 프로젝트 JSON에 저장할 수 없습니다.");
    if (saved.has(value)) return saved.get(value);
    // 날짜·포장 객체 등 JSON 전용 변환이 있는 드문 값은 기존 JSON 의미를 유지합니다.
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
      const json = JSON.stringify(value, (_key, child) => {
        if (typeof File !== "undefined" && child instanceof File) return undefined;
        return typeof child === "string" && child.startsWith("blob:") ? undefined : child;
      });
      const result: unknown = json === undefined ? undefined : JSON.parse(json);
      saved.set(value, result);
      return result;
    }
    active.add(value);
    try {
      let result: unknown;
      if (Array.isArray(value)) {
        const entries: unknown[] = [];
        for (let index = 0; index < value.length; index++) entries.push(clean(value[index]) ?? null);
        result = entries;
      } else {
        const fields: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
          const child = clean((value as Record<string, unknown>)[key]);
          if (child !== undefined) Object.defineProperty(fields, key, {
            value: child, enumerable: true, configurable: true, writable: true,
          });
        }
        result = fields;
      }
      saved.set(value, result);
      return result;
    } finally { active.delete(value); }
  };
  return (draft: object): Record<string, unknown> => clean(draft) as Record<string, unknown>;
}
