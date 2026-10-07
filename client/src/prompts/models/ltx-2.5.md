---
id: ltx-2.5
label: LTX 2.5
provider: Lightricks
variant: hosted / local Comfy 별도
status: active endpoint 확인
connectorSlug: 미확인
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 시간 순서 현재형 4–8문장으로 한 shot, camera-subject 관계·끝 구도·언어·악센트·쉼을 적습니다. 명시 cuts는 2–4 shots로 간결하게.
- hosted negative 필드 없음, 로컬 Comfy negative conditioning은 별도. I2V last/A2V 지원 경로를 구분하고 autoDuration+lastframe은 함께 쓰지 않습니다. generate_audio=false는 hosted 무음 설정입니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://docs.ltx.io/api-documentation/implementation-guides/prompting-guide)
- [공식 자료](https://docs.ltx.io/models/ltx-2-5)
