---
id: seedance-2.5
label: Seedance 2.5
provider: BytePlus ModelArk
variant: 2.5
status: provider 활성; relay 확인
connectorSlug: seedance-2-5-pro
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- shot 번호 또는 정수 초 timestamps를 사용합니다. 음악 (music), 효과음 <effects>, 대사 {dialogue}, 자막 〖subtitles〗를 분리하고 비중국어 발화를 명시합니다.
- provider 30 images/10 videos/10 audio와 Magnific 실제 adapter 제한을 분리합니다. ref 수용만으로 얼굴 ID/입모양/음성 복제가 보장되지 않습니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://docs.byteplus.com/en/docs/modelark/seedance-2-5-prompt-guide)
- [공식 자료](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5)
