---
id: krea2
label: Krea 2 Turbo
provider: Krea open weights
variant: krea/Krea-2-Turbo 12B
status: workflow; distilled T2I
connectorSlug: 없음
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 자연어 장면·주제·시각적 특징·빛·화풍을 적습니다. CFG off 8-step 경로에서 negative conditioning은 기본 비활성입니다. native negative 칸을 자동 생성하지 않습니다.
- 로컬 T2I/LoRA와 hosted Krea 멀티 레퍼런스를 구분합니다. hosted identity/reference 기능을 로컬 모델에 복제하지 않습니다.
- 가중치는 Community License, 코드는 Apache 계열로 조건이 다릅니다. 회사 연 매출 100만 달러 기준 등 약관을 확인하며 사용자 매출을 추정하지 않습니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://huggingface.co/krea/Krea-2-Turbo)
- [공식 자료](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md)
- [공식 자료](https://github.com/krea-ai/krea-2/blob/main/docs/KREA-2-COMMUNITY-LICENSE)
