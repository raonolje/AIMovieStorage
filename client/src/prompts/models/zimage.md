---
id: zimage
label: Z-Image Turbo
provider: Tongyi-MAI open weights
variant: Tongyi-MAI/Z-Image-Turbo 6B
status: workflow; distilled T2I
connectorSlug: 없음
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 간결한 자연어로 대상·프레이밍·동작·배경·빛·질감을 적습니다. Turbo는 CFG 0 증류 경로이며 standard negative prompt를 자동으로 만들지 않습니다.
- 기본 T2I에 Edit/Omni 능력을 상속하지 않습니다. 인물 스왑·마스크 편집·포즈 제어는 해당 workflow에 검증된 노드와 conditioning이 있을 때만 요청합니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)
