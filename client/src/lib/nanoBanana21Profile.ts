/** Provider facts are separate from a verified Magnific adapter mapping. */
export const NANO_BANANA_21 = {
  id: "nano-banana-2.1", providerModelId: "gemini-nano-banana-2.1", label: "Nano Banana 2.1",
  checkedAtUtc: "2026-10-06", releaseDate: "2026-10-06", status: "GA",
  imageSizes: ["1K", "2K", "4K"] as const, defaultImageSize: "1K",
  thinkingLevels: ["minimal", "medium", "high"] as const, defaultThinkingLevel: "medium",
  maxImageReferences: 14, characterFidelityGuidance: 4, objectFidelityGuidance: 10,
  audioInput: false, audioOutput: false, negativeField: "undocumented",
  magnificMapping: "verified-authenticated-catalog", magnificSlug: "imagen-nano-banana-2-1",
  magnificName: "Google Nano Banana 2.1", magnificCheckedAtUtc: "2026-10-06T19:23:44.000Z",
  magnificResolutions: ["1k", "2k", "4k"] as const,
  magnificReferenceTypes: ["style", "character", "product", "image"] as const,
  magnificSchemaCheckedAtUtc: "2026-10-06T19:28:14.000Z", magnificMcpMaxReferences: 12,
  magnificSchemaScope: "images_generate schema observed; thinking exposure and model resolution default unconfirmed; desktop reference limit unobserved",
  directAppAdapter: "unimplemented",
  sources: ["https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1", "https://ai.google.dev/gemini-api/docs/changelog#october-6-2026", "https://ai.google.dev/gemini-api/docs/image-generation"],
} as const;
export function isNanoBanana21(id?: string | null): boolean {
  return id === NANO_BANANA_21.id || id === NANO_BANANA_21.providerModelId || id === NANO_BANANA_21.label || id === NANO_BANANA_21.magnificSlug || id === NANO_BANANA_21.magnificName;
}
export type NanoBanana21Reference = { role?: string; kind: "character" | "object" | "style" | "layout" | "scene" | "other" };
export type NanoBanana21Options = { imageSize?: string; thinkingLevel?: string; references?: NanoBanana21Reference[]; audioInput?: boolean; audioOutput?: boolean };
export function validateNanoBanana21Options(input: NanoBanana21Options = {}) {
  const imageSize = input.imageSize ?? NANO_BANANA_21.defaultImageSize;
  const thinkingLevel = input.thinkingLevel ?? NANO_BANANA_21.defaultThinkingLevel;
  if (!(NANO_BANANA_21.imageSizes as readonly string[]).includes(imageSize)) throw new Error("nano_banana_21_image_size: 1K, 2K, 4K만 지원합니다. 512px/0.5K/8K로 대체하지 않습니다.");
  if (!(NANO_BANANA_21.thinkingLevels as readonly string[]).includes(thinkingLevel)) throw new Error("nano_banana_21_thinking_level: minimal, medium, high 중에서 고르세요.");
  if (input.audioInput || input.audioOutput) throw new Error("nano_banana_21_audio_unsupported");
  const references = input.references ?? [];
  if (references.length > NANO_BANANA_21.maxImageReferences) throw new Error("nano_banana_21_reference_limit: 이미지 참조는 총 14개까지입니다. 임의로 버리거나 합치지 않습니다.");
  const warnings: string[] = [];
  if (references.filter(ref => ref.kind === "character").length > 4) warnings.push("캐릭터 참조 일관성 가이드의 4명을 넘었습니다. 등장 인원 금지 규칙은 아니며 결과의 identity drift를 확인하세요.");
  if (references.filter(ref => ref.kind === "object").length > 10) warnings.push("오브젝트 참조 fidelity 가이드의 10개를 넘었습니다. 모든 참조의 형태와 재질을 결과에서 확인하세요.");
  if (references.length > 1 && references.some(ref => !ref.role?.trim())) warnings.push("여러 참조에 인물·오브젝트·스타일·구도 등 이름 있는 역할을 지정하세요.");
  return { imageSize, thinkingLevel, references, warnings };
}
export function assertNanoBanana21MagnificMapping(id?: string | null, adapterSlug?: string | null): void {
  if (isNanoBanana21(id) && adapterSlug !== undefined && adapterSlug !== NANO_BANANA_21.magnificSlug)
    throw new Error("nano_banana_21_magnific_mapping_mismatch: 선택한 2.1은 확인된 imagen-nano-banana-2-1에만 연결합니다. 기존 Nano Banana 2/Pro로 바꾸지 않았습니다.");
}
