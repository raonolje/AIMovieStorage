---
id: wan-2.2
label: Wan 2.2
provider: Alibaba hosted / local
variant: endpoint별
status: legacy hosted / local workflow
connectorSlug: 미확인
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- hosted positive 최대 800자와 negative, 별도 KF2V flash first/last를 구분합니다. 표준 무음이며 로컬 Animate/audio 특수 workflow는 별도입니다. 로컬 한도는 선택 worker/graph 계약을 따릅니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://help.aliyun.com/en/model-studio/legacy-image-to-video-by-first-and-last-frame-api-reference)
- [공식 자료](https://github.com/Wan-Video/Wan2.2)
