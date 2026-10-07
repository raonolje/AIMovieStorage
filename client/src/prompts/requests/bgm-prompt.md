---
id: bgm-prompt
title: 선택 음악 모델의 스타일과 가사
---
선택 generationTarget.modelId와 역할의 모델 가이드를 먼저 적용합니다. 임의의 다른 음악 모델이나 영상 MiniMax 가이드로 대체하지 않습니다.
장르·편성·템포·조성·질감·전개를 ko/en 스타일에 적고 사용자의 곡 목적과 구조를 보존합니다.
instrumental=true이면 lyricsKo와 lyricsEn은 빈 문자열입니다. 편곡 구간은 스타일에 적습니다. 구간 태그만으로 불필요한 가사 칸을 채우지 않습니다.
보컬곡은 실제로 부를 가사를 쓰며 마지막 독립 줄에 소문자 literal [end]를 중복 없이 한 번만 둡니다. 이는 사용자 저장 규칙이며 모델 EOS나 오디오 종료 보장이 아닙니다. 모델 고유 종료 규칙이 다르면 원본 가사와 모델 변환 단계를 명시합니다.
같은 멤버의 안정된 음색·음역·발음·비브라토·창법과 파트 배정을 유지합니다. 6명 이상의 프로필도 개별 ID와 파트를 보존하며 한 구간에 한 리드를 배정합니다. 실험적인 Singer A 표기를 공식 화자 제어로 주장하지 않습니다.
single lead는 single-tracked, close-miked, dry centered lead, clear diction을 권합니다. chorus effect·겹친 리드·합창·군중 보컬·애드리브·긴 잔향·하울링 억제는 모델의 공식 Exclude 입력이 있으면 그 입력에 권고합니다. [Chorus] 후렴 구조와 chorus effect는 구분합니다. 모델이 제공하지 않는 negative_prompt나 voice_id를 만들어내지 않습니다.
Suno v6: Variety/Max 모드와 공식 확인된 범위만 적용합니다. 이전 Style Influence/Weirdness 규칙을 v6의 검증된 설정으로 복사하지 않습니다. Personas/Voices 호환성은 현재 UI 확인이 필요합니다.
MiniMax Music 3: Global Metadata / Vocal Details / Arrangement의 스타일 구조를 사용합니다. 로컬 경로와 유료 API의 is_instrumental 지원은 구분합니다. ACE-Step은 해당 버전/워크플로의 별도 스타일·가사·설정 계약을 따릅니다.
순수 JSON만 답합니다: {"ko":"한국어 스타일","en":"English style","negativeKo":"","negativeEn":"","lyricsKo":"한국어 가사 또는 빈 문자열","lyricsEn":"English lyrics or empty string"}.
