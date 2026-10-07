/** 기존 설정과 파일은 보존하며 생성 실행만 Comfy workflow로 전환합니다. */
export const COMFY_MIGRATED_ENGINES = ["qwenimage", "zimage", "krea2", "anima", "minimaxh3", "wanvideo", "ltx25", "minimaxmusic", "acestep", "qwentts"] as const;
export function isLegacyGenerationEngine(id: string): boolean { return (COMFY_MIGRATED_ENGINES as readonly string[]).includes(id); }
export function assertDirectGenerationEnabled(id: string): void {
  if (isLegacyGenerationEngine(id)) throw new Error(`legacy_generation_disabled: ${id} 직접 생성·다운로드는 Comfy workflow로 전환되었습니다. 기존 설정·모델 파일은 보존됩니다. 검사한 workflow와 입력 역할을 명시 선택하세요.`);
}
export function assertAppLoraExecutionDisabled(): void { throw new Error("legacy_lora_disabled: 앱 전용 LoRA 실행·받기는 종료되었습니다. Comfy에 이미 설치된 LoRA 파일명과 model/clip 강도 역할을 검사해 선택하세요. 기존 파일은 보존됩니다."); }
