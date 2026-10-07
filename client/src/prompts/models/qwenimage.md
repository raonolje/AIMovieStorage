---
id: qwenimage
label: Qwen-Image
provider: Qwen open weights
variant: Qwen/Qwen-Image 20B
status: workflow; T2I base
connectorSlug: 없음
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 기본 20B T2I와 Qwen-Image-2512, Qwen-Image-Edit/2511을 분리합니다. 대상·수량·위치·의상·재질·빛을 자연어로 구체화하고 화면 글자는 정확히 따옴표에 넣습니다.
- 기본 T2I에 편집·참고 인물 ID 고정·인페인팅을 상속하지 않습니다. 실제 workflow의 loader/conditioning/편집 노드를 검사해야 합니다. 이미지 프롬프트에는 단일 순간만 적습니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://huggingface.co/Qwen/Qwen-Image)
