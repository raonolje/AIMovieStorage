---
id: wanvideo
label: 로컬 Wan 2.2 A14B
provider: Wan open weights
variant: T2V / I2V A14B
status: workflow; native 입력은 선택 그래프 확인
connectorSlug: 없음
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 장면·인물·행동·카메라·빛을 시간 순서대로 씁니다. I2V는 첫 프레임을 유지하고 움직임과 끝 구도를 설명합니다. 표준 2.2는 무음이며 대사를 생성한다고 요청하지 않습니다.
- hosted Wan 2.5 audio_url, Wan Animate, S2V, KF2V 기능을 표준 A14B에 상속하지 않습니다. first/end/pose/mask/identity는 workflow 그래프와 노드·가중치로 검증합니다. 후처리 정적 합성은 native 인페인팅이 아닙니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://github.com/Wan-Video/Wan2.2)
