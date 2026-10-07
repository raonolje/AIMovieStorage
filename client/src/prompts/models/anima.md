---
id: anima
label: Anima Base
provider: CircleStone Labs open weights
variant: circlestone-labs/Anima 2B Base
status: workflow; 라이선스 확인
connectorSlug: 없음
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- lowercase 태그와 영어 서술을 결합합니다. 기본 품질 태그 masterpiece, best quality, score_7, safe를 검토하며 negative conditioning을 지원합니다. Aesthetic/Turbo 판의 규칙은 Base와 별개입니다.
- 기본 생성만으로 ID 고정/인페인팅을 보장하지 않습니다. workflow에 실제 입력과 모델이 필요합니다. 상업 이미지 이용과 상업 hosting/embedding 약관은 다릅니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://huggingface.co/circlestone-labs/Anima)
