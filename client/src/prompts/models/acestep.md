---
id: acestep
label: ACE-Step v1
provider: ACE-Step open weights
variant: v1 / 3.5B
status: local; 실제 설치 확인
connectorSlug: 없음
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 장르·악기·BPM·음색·프로덕션은 간결한 영어 태그로, 가사는 별도 칸에 씁니다. v1을 후속 ACE-Step 모델과 혼동하지 않습니다. 무가사 연주곡은 lyrics를 비웁니다.
- 추천: 단일 리드는 single-tracked, dry, clear diction. 그룹은 멤버 음색·음역·발음 프로필과 구간 배분을 재사용합니다. 화자 ID/6명 고유 보컬/하울링 제거 보장은 없습니다.
- 가사 저장 형식은 끝에 literal [end] 한 번입니다. 공식 모델 종료 기능과 구별하고 실제 오디오를 청취 검수합니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://github.com/ace-step/ACE-Step)
