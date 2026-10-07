---
id: veo-3.1
label: Veo 3.1
provider: Google
variant: Gemini preview / Vertex 001
status: endpoint별 활성 확인
connectorSlug: 미확인
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- camera/framing → subject/action → context → style/light 순서로 쓰고 audio는 별도 문장, 대사는 화자별 원문과 톤을 지정합니다.
- reference/end/extend/negative/audio 옵션은 endpoint별로 다릅니다. Vertex negative 명사 규칙을 Gemini에 강제로 적용하지 않습니다. 자막이 항상 구워진다거나 오디오를 절대로 끌 수 없다고 단정하지 않습니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://ai.google.dev/gemini-api/docs/veo)
- [공식 자료](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1/)
