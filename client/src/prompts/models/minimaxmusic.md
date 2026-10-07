---
id: minimaxmusic
label: 로컬 MiniMax-Music3
provider: MiniMaxAI open weights
variant: MiniMaxAI/MiniMax-Music3
status: local; 실제 adapter/설치 지원 확인
connectorSlug: 없음
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- hosted music-3.0 API와 로컬 오픈 모델을 분리합니다. 스타일은 Global Metadata(genre/BPM/key/emotion/production), Vocal Details(timbre/delivery/harmony/effects), Arrangement(구간 발전)로 씁니다. 가사 태그는 독립 줄에 둡니다.
- 추천: 같은 멤버 프로필과 구간 파트 배분을 반복하고 한 리드는 dry, close-miked, single-tracked로 요청합니다. 하울링·겹침·합창 억제는 확률적 스타일 지시이며 고유 화자 고정 제어가 아닙니다. 6명 고유 보컬은 보장되지 않습니다.
- 공식 로컬 배포는 /v1/audio/speech input=lyrics, instructions=style, wav/stream=false를 사용합니다. nonempty input/instructions가 필요하고 voice/reference audio 입력은 거절합니다. seed는 재현성용이며 화자 ID가 아닙니다.
- 앱 기존 worker는 diffusers ModularPipeline(prompt, lyrics, audio_duration)입니다. 공식 로컬 서버와 동일한 API라고 단정하지 않습니다. 무가사 BGM을 현재 worker가 [instrumental]로 변환하지만 실제 무보컬 능력은 검증되지 않았습니다. hosted is_instrumental을 로컬에 복사하지 마세요.
- 원본 가사는 마지막 줄 literal [end]를 한 번 저장합니다. 현재 앱은 vocal 전송에도 이 문자열을 유지합니다. 공식 EOS/stop으로 확인되지 않았으며 종료·발음·길이를 보장하지 않습니다. 향후 model-native 변환은 원본과 효과 입력을 별도로 기록해야 합니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://huggingface.co/MiniMaxAI/MiniMax-Music3)
- [공식 자료](https://platform.minimax.io/docs/guides/local-deploy-music-3)
