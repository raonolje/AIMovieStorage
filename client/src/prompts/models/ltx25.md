---
id: ltx25
label: 로컬 LTX 2.5
provider: Lightricks open weights
variant: LTX-2.5
status: workflow; selected graph 확인
connectorSlug: 없음
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 한 샷을 현재형 4–8문장으로 시간 순서대로 설명합니다. camera-subject 관계와 끝 구도를 정하고 대사는 언어·악센트·쉼을 별도로 적습니다. 입력 오디오·모델 생성 오디오·원본 유지·후처리 mux를 구별합니다.
- hosted에는 negative 필드가 없지만 로컬 Comfy conditioning은 있을 수 있습니다. workflow의 positive/negative 연결을 따릅니다. first/end/A2V/IC-LoRA는 선택 그래프와 설치 노드·가중치의 실제 지원을 확인합니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://docs.ltx.io/models/ltx-2-5)
- [공식 자료](https://docs.ltx.io/api-documentation/implementation-guides/prompting-guide)
- [공식 자료](https://docs.ltx.io/open-source-model/usage-guides/image-to-video)
