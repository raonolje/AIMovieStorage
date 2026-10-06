import type { CompositionSurfaceMaterial, ObjectComposition } from "./composition";

/** 저장본의 잘못된 값은 기존 렌더 재질로 돌아갑니다. 형상·변환·카메라는 만지지 않습니다. */
export function objectSurfaceParameters(
  item: Pick<ObjectComposition, "surfaceMaterial">,
  defaults: CompositionSurfaceMaterial,
): CompositionSurfaceMaterial {
  const surface = item.surfaceMaterial;
  if (!surface || ![surface.roughness, surface.metalness].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  )) return { ...defaults };
  return { roughness: surface.roughness, metalness: surface.metalness };
}
