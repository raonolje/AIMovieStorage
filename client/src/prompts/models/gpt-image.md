---
id: gpt-image
label: GPT Image 표시 모델
provider: OpenAI / Magnific relay
variant: gpt-image-2.5-flare / gpt-image-2.5-sunburst
status: provider 활성; relay 동일성 미확인
connectorSlug: gpt-2
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 공식 GPT Image 2.5 모델과 앱 gpt-2 slug의 동일성이 확인되지 않았습니다. 표시명만으로 실제 API modelId를 추정하지 않습니다.
- reference 역할과 보존/변경 조건을 구체적으로 쓰고 중요한 물체·수량·관계를 앞에 둡니다. 이미지의 정확한 글자는 따옴표, 그림 속 배치는 자연어로. SD식 별도 negative conditioning을 자동 만들어 보내지 않습니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://openai.com/index/introducing-chatgpt-images-2-5/)
- [공식 자료](https://developers.openai.com/api/docs/guides/image-prompting)
