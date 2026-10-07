---
id: nano-banana
label: Nano Banana 표시 모델
provider: Google / Magnific relay
variant: Pro=gemini-3-pro-image; 2=gemini-3.1-flash-image
status: provider 활성; relay 동일성 미확인
connectorSlug: imagen-nano-banana-2
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 앱 표시명 Nano Banana Pro와 slug imagen-nano-banana-2의 공식 모델 동일성은 확인되지 않았습니다. 실제 제공자의 모델·variant를 확인하고 Pro/2 기능을 섞지 않습니다.
- 자연어로 reference별 역할, 바꾸는 부분, 보존할 부분, 출력 프레이밍·빛·정확한 글자를 적습니다. SD식 negative_prompt 필드는 없으므로 원하는 결과를 긍정으로 설명합니다. 모델이 임의로 얼굴을 완전히 고정한다고 약속하지 않습니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://ai.google.dev/gemini-api/docs/image-generation)
- [공식 자료](https://deepmind.google/models/gemini-image/prompt-guide/)
