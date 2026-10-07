---
id: comfyui
label: ComfyUI explicit workflow role
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

프롬프트는 선택한 workflow SHA·roleId·modelRuleId와 실제 positive/negative 슬롯을 대상으로 작성합니다. 프로젝트의 일반 영상 모델보다 실제 로더 역할을 우선합니다. 복수 로더의 역할은 모두 명시하며 하나를 임의로 선택하지 않습니다. 미지원 negative·참조·화자 ID·LoRA·mask 제어를 문장만으로 만들어내지 않습니다.

참조는 등록된 같은 프로젝트의 자료를 역할별 순서와 개수에 맞게 선택합니다. UI 목록의 길이가 모델의 다중 참조 능력을 뜻하지 않습니다. 지원하는 fixed 0/1/2/N 그래프 변형을 각각 검사하고 선택합니다. 역할과 다른 타입, 초과, 누락, 시간·mask 규약 불일치는 실행 전에 해결합니다.

설치·업데이트 시 core/node 의존성의 호환성이 달라질 수 있습니다. 앱은 검토된 source/schema/version 기록이 바뀌면 재검사를 요구하며 자동 설치·업데이트·승인을 하지 않습니다. 기존 Desktop 서버와 앱 소유 backend는 별도로 선택합니다. 정적·설치 검사 통과는 실제 생성·수집·등록 성공과 다릅니다.

확인일: 2026-10-07 KST (2026-10-06 UTC).
- [공식 업데이트 안내](https://docs.comfy.org/installation/update_comfyui)
- [노드와 링크](https://docs.comfy.org/basic-concepts/comfyui-workflows)
- [Music3 caption·lyrics 경계](https://docs.comfy.org/tutorials/audio/minimax/minimax-music-3)
