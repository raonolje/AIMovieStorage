---
id: minimax-music-api
label: MiniMax hosted Music API
provider: MiniMax /v1/music_generation
variant: music-3.0 / music-2.6
status: existing eligible paid accounts; 신규 접근 제한
connectorSlug: 앱 직접 호출 미구현
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 2026-08-20부터 신규 사용자의 유료 Music/Lyrics API 접근 불가, 기존 유료 사용자는 계속 가능, 무료 API 중단 공지가 우선입니다. 아래 enum/M Plan 설명만 보고 모든 계정에서 가능하다고 안내하지 않습니다.
- 문서화: prompt 최대 2000자, vocal lyrics 1–3500자, lyrics_optimizer=false는 가사 원문 보존. BGM은 is_instrumental=true로 lyrics를 생략합니다. local Music3의 필드와 다릅니다.
- voice_id/singer_count/negative_prompt/seed는 이 endpoint에 문서화되지 않았습니다. 6명 그룹·리드 분리·특색 음색은 서술 지시이며 고유 보컬 보장은 없습니다. cover_feature_id는 커버 참고이고 동일 화자 복제 증명이 아닙니다.
- literal [end] 사용자 규칙은 길이 계산에 포함하며 공식 stop token이라고 설명하지 않습니다. 가사 자동 최적화를 끈 상태로 저장 원문을 유지하고 provider 정책 변환이 필요하면 원본/효과 입력을 명시합니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://platform.minimax.io/docs/api-reference/music-generation)
- [공식 자료](https://platform.minimax.io/docs/api-reference/music-cover-preprocess)
