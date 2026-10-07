---
id: wan-2.5
label: Wan 2.5 Preview
provider: Alibaba hosted
variant: 2.5 preview
status: legacy endpoint
connectorSlug: 미확인
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- positive 최대 1500자, negative 지원, prompt_extend는 기본 on. first I2V+audio_url와 5/10초 길이 안내가 있습니다. shot_type/R2V/end는 다른 버전에서 상속하지 않습니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://www.alibabacloud.com/help/en/model-studio/legacy-wan-text-to-video-api-reference)
