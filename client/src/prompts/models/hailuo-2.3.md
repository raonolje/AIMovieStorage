---
id: hailuo-2.3
label: Hailuo 2.3
provider: MiniMax hosted video
variant: 2.3; Hailuo 02 별도
status: active endpoint 확인
connectorSlug: 미확인
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- positive 최대 2000자, native negative 필드 없음. first-frame I2V와 Hailuo02 전용 first+last를 구분합니다.
- [Push in], [Tracking shot], [Static shot], [Pan left], [Tilt up] 등은 한 괄호에 동시에 세 개 이하. 순차 동작·표정을 명확히 쓰고 optimizer=false로 원문 보존을 검토합니다. native audio는 이 문서로 확인되지 않습니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://platform.minimax.io/docs/api-reference/video-generation-i2v)
- [공식 자료](https://platform.minimax.io/docs/api-reference/video-generation-fl2v)
