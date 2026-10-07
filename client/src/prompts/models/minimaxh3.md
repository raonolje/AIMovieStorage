---
id: minimaxh3
label: MiniMax-H3 로컬·Comfy 역할
provider: MiniMax open weights
variant: MiniMax-H3
status: project authorization and exact workflow admission required
connectorSlug: 없음
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 공개 라이선스의 제한과 프로젝트별 사용자 사용 허가 기록을 구분합니다. 사용자가 확보했다고 진술한 허가는 선택한 projectId·category·정확 파일명·전체 SHA와 H3 역할에만 적용하며 독립 법률 검증으로 표시하지 않습니다. 다른 프로젝트·파일·버전으로 확대하거나 자동 fallback으로 선택하지 않습니다.
- 장면의 인물·장소·빛·카메라와 한 번의 관찰 가능한 동작을 명확히 씁니다. 음성·효과음이 있으면 화자·대사·비대사 소리를 구분합니다. 구체적인 대사 태그는 선택한 H3 variant의 가이드와 실제 graph 역할에 확인된 문법만 사용합니다. 별도 negative 역할이 없으면 네거티브 문장을 생성하지 않습니다.
- 프레임·identity·audio 입력은 workflow에 검사된 슬롯이 있을 때만 연결합니다. 고정 0/1/2/N 변형을 따로 선택하고 참조를 임의로 생략·복제하지 않습니다. reference 입력만으로 고유 인물 ID 또는 native 인페인팅을 보장하지 않습니다. 현재 실행·대표 장면 검증 여부는 library의 정적 검사와 별도로 확인합니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://huggingface.co/MiniMaxAI/MiniMax-H3)
