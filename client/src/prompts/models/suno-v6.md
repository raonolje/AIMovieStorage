---
id: suno-v6
label: Suno v6
provider: Suno web Custom
variant: v6 / v6-wild / v6-mini
status: active; 플랜별 접근 확인
connectorSlug: 없음 — 앱은 프롬프트 작성만 지원
verifiedAt: 2026-10-07 KST (2026-10-06 UTC)
---

## 핵심 규칙

- 문서화: v6는 Pro/Premier, v6-mini는 무료, v6-wild는 실험적입니다. 이전 모델은 retired. Variety 0은 스타일 태그 유지, Max Mode는 곡 안의 보컬·스타일 일관성에 도움이 됩니다. 과거 Weirdness/Style Influence 기본값을 v6 사실로 사용하지 마세요.
- 추천: 한 리드는 single-tracked, close-miked, centered, dry, clear diction. 음색은 질감·공명·음역·발음·비브라토·창법으로 구체화하고 같은 프로필을 곡마다 재사용합니다. Personas 재사용은 보컬·스타일 일관성에 도움이 되지만 동일 화자 보장은 아닙니다.
- Exclude 칸에 필요할 때 backing vocals, doubled lead, harmonies, choir, gang vocals, adlibs, chorus effect, delay, long reverb, howling, shrill wails를 적습니다. 곡 구조 [Chorus]와 합창 또는 코러스 효과를 구분합니다. 사용자가 원하는 합창은 임의로 지우지 않습니다.
- 6명 이상: 고정 멤버 프로필과 구간별 파트 배분을 유지하고 한 번에 한 리드를 권장합니다. [Singer A]는 실험적 서술이며 공식 화자 ID가 아닙니다. 필수 고유 보컬은 개별 녹음·생성·청취 검수 후 편집 결합을 검토합니다. Custom Models의 소유 곡 6개 요건은 가수 6명 지원을 뜻하지 않습니다.
- Voices 문서의 v5.5-only와 모델 retirement 공지가 충돌하므로 v6 호환은 실제 UI에서 확인합니다. Instrumental은 가사 없이 사용합니다. 가사 마지막 literal [end]는 사용자 저장 형식이며 모델 종료 보장이 아닙니다.

## 적용 경계

문서화한 지원, 실무 추천, 실험적 지시, 사용자 저장 형식을 구별합니다. 선택한 provider/endpoint/variant와 실제 workflow 입력을 확인합니다. 프롬프트만으로 ID·음색·종료·모션·native 인페인팅을 보장하지 않습니다. 로컬 이미지·영상은 검사한 ComfyUI workflow로 실행하고 기존 직접 실행은 보존된 legacy 경계입니다. LoRA는 ComfyUI 파일만 참조하며 앱 다운로드·복사·별도 캐시를 만들지 않습니다.

## 공식 출처 · 확인일

확인일: 2026-10-07 KST.
- [공식 자료](https://help.suno.com/en/articles/13924481)
- [공식 자료](https://help.suno.com/en/articles/3484161)
- [공식 자료](https://help.suno.com/en/articles/3161921)
- [공식 자료](https://help.suno.com/en/articles/11362497)
- [공식 자료](https://help.suno.com/en/articles/11362433)
- [공식 자료](https://help.suno.com/en/articles/3197377)
