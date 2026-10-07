import { NANO_BANANA_21, assertNanoBanana21MagnificMapping, isNanoBanana21 } from "./nanoBanana21Profile";

/** Existing native tools/list, 2026-10-06T19:28:14Z. This is the MCP transport. */
export const MAGNIFIC_MCP_IMAGE_MAX_REFERENCES = 12;
export function assertMagnificMcpImageReferenceCount(count: number): void {
  if (!Number.isInteger(count) || count < 0 || count > MAGNIFIC_MCP_IMAGE_MAX_REFERENCES)
    throw new Error("magnific_image_reference_limit: images_generate는 참조 최대 12개입니다. 임의로 버리거나 합치지 않습니다.");
}
export function assertMagnificMcpImageInputs(args: Record<string, unknown>): void {
  const references = args.references;
  if (references !== undefined && !Array.isArray(references)) throw new Error("magnific_image_references_array_required");
  assertMagnificMcpImageReferenceCount(Array.isArray(references) ? references.length : 0);
  const count = args.count === undefined ? 1 : args.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 8) throw new Error("magnific_image_count: 1..8 정수만 지원합니다.");
  const mode = typeof args.mode === "string" ? args.mode : undefined;
  if (isNanoBanana21(mode)) {
    assertNanoBanana21MagnificMapping(mode, mode);
    if (args.brandKitId) throw new Error("nano_banana_21_brand_kit_model_switch: Brand Kit은 Magnific One으로 모델을 바꾸므로 선택한 2.1에 함께 보내지 않습니다.");
    if (args.thinking !== undefined || args.thinkingLevel !== undefined || args.thinkingConfig !== undefined)
      throw new Error("nano_banana_21_magnific_thinking_unconfirmed");
    if (args.resolution !== undefined && !(NANO_BANANA_21.magnificResolutions as readonly unknown[]).includes(args.resolution)) throw new Error("nano_banana_21_magnific_resolution: 1k, 2k, 4k 중에서 고르세요.");
    if (args.aspectRatio !== undefined && !["1:1","21:9","16:9","9:16","4:3","4:5","5:4","3:4","3:2","2:3"].includes(String(args.aspectRatio))) throw new Error("nano_banana_21_magnific_aspect_ratio");
  }
  for (const ref of Array.isArray(references) ? references : []) {
    if (!ref || typeof ref !== "object" || typeof ref.identifier !== "string" || !ref.identifier.trim()) throw new Error("magnific_image_reference_identifier_required");
    const types = isNanoBanana21(mode) ? NANO_BANANA_21.magnificReferenceTypes : ["image","style","character","product","locations"];
    if (!(types as readonly unknown[]).includes(ref.type)) throw new Error("magnific_image_reference_type_unsupported");
  }
}
