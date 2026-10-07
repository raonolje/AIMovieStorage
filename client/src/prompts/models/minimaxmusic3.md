---
id: minimaxmusic3
label: ComfyUI MiniMax Music3
provider: MiniMaxAI
providerModelId: MiniMaxAI/MiniMax-Music3
variant: ComfyUI core 0.39 builtin nodes
status: experimental; actual generation unverified
connectorSlug: workflow explicit prompt role
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 작성 규칙

MiniMaxMusic3TextEncode의 caption과 lyrics를 분리합니다. caption은 Global Metadata(장르·BPM·조성·정서·프로덕션), Vocal Details(음색·발성·하모니·효과), Arrangement(구간 전개)로 작성합니다. hosted music-3.0의 is_instrumental API 옵션이나 voice ID를 이 노드에 복사하지 않습니다.

보컬이 있으면 멤버마다 고정 ID, 음색·음역·딕션·비브라토·전달 방식과 구간 파트를 반복합니다. 6명 이상도 동일한 프로필을 유지하되 분리된 여섯 화자나 동일 음색을 보장하지 않습니다. 단독 리드는 dry, close-miked, single-tracked와 명시적 파트 배분을 요청합니다. 리드의 하울링·중복·합창 효과 억제는 확률적 지시입니다. 곡의 [Chorus] 섹션 태그는 합창 효과와 별개입니다.

사용자의 보컬 원본 가사는 마지막 독립 줄에 literal [end]를 정확히 한 번 저장합니다. 이 문자열은 확인된 모델 EOS가 아닙니다. 원본과 모델 입력을 별도로 기록하며 종료·길이·발음 제어를 보장하지 않습니다.

연주 BGM 원본은 가사를 비웁니다. Comfy 어댑터는 이 명시 Music3 역할에서만 빈 원본을 모델 조건 [Instrumental]로 변환해 기록합니다. 이는 사용자 가사 생성이나 확실한 무보컬 스위치가 아닙니다. 결과를 듣고 보컬 유무·끝부분·실제 길이를 확인합니다.

max_duration과 샘플러 설정은 해당 그래프의 검토된 슬롯·범위를 사용합니다. 설치 파일이 있어도 현재 서버 enum, exact SHA, 공개 라이선스와 프로젝트별 사용자 허가, core/source/schema 재검사가 필요합니다. 정적 검사는 실제 생성·등록 검증과 구분합니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST (2026-10-06 UTC).
- [ComfyUI MiniMax Music3](https://docs.comfy.org/tutorials/audio/minimax/minimax-music-3)
- [공식 모델·라이선스](https://huggingface.co/MiniMaxAI/MiniMax-Music3)
- [공식 로컬 배포 API](https://platform.minimax.io/docs/guides/local-deploy-music-3)
