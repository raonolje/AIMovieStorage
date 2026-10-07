---
id: kling-3.0
label: Kling 3.0
provider: Kling
variant: 3.0 / endpoint별
status: active; adapter 확인
connectorSlug: 미확인
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- first/last, startframe+Elements와 reference video(Omni), Motion Control은 서로 다른 경로입니다. structured MultiShot 지원 시 duration/framing/action/camera를 구간별로, 아니면 연속 서술로 씁니다.
- native 대사는 ZH/EN/JA/KO/ES 지원 안내가 있습니다. 고유 화자와 발화 순서를 분리합니다. negative_prompt는 legacy endpoint 목록과 새 endpoint가 다르므로 무조건 없다고 설명하지 않습니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://kling.ai/quickstart/klingai-video-3-model-user-guide)
- [공식 자료](https://kling.ai/document-api/guides/capability-map/video)
