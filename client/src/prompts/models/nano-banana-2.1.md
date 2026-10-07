---
id: nano-banana-2.1
label: Nano Banana 2.1
kind: image
provider: Google Gemini API
verified: 2026-10-07 KST (2026-10-06 UTC)
status: provider GA; authenticated Magnific catalog mapping verified; direct app adapter unimplemented
---

# Nano Banana 2.1

공식 provider ID는 `gemini-nano-banana-2.1`이며 2026-10-06 GA입니다. Nano Banana 2와 Pro는 별도 모델입니다. 앱의 기존 `nano-banana`, `nbpro`, Magnific `imagen-nano-banana-2`는 이 버전의 alias가 아닙니다. 2026-10-06 19:23:44 UTC, 앱의 기존 인증 `magnific_call`→`images_models_list` 경로에서 표시명 `Google Nano Banana 2.1`, 정확 slug `imagen-nano-banana-2-1`을 확인했습니다. 현재 인증 계정의 카탈로그 확인이며 모든 계정의 접근을 보장하지 않습니다. 앱의 Google direct adapter는 미구현입니다.

이 Magnific 항목은 `1k/2k/4k`, 이미지 참조와 `style/character/product/image` 참조 역할, 필수 `prompt`를 표시합니다. 비율은 `auto/1:1/21:9/16:9/9:16/4:3/4:5/5:4/3:4/3:2/2:3`이며 custom maxAspectRatio는 8입니다. 같은 정상 native OAuth 경로의 `tools/list`에서 19:28:14 UTC `images_generate` 스키마를 확인했습니다. MCP 참조 최대는 **12개**, count는 1..8이며 모델은 `mode=imagen-nano-banana-2-1`로 지정합니다. 카탈로그의 auto 비율은 MCP aspectRatio enum에 없으므로 별개로 다룹니다. 로컬 파일은 image creation identifier이고 character/product는 사전 등록 library 자산입니다. 이 참조 종류를 임의로 바꾸지 않습니다. BrandKit은 서버가 Magnific One으로 모델을 바꾸므로 명시2.1과 함께 보내지 않습니다.

Magnific 모델별 해상도 기본값과 thinking 노출은 미확인입니다. 아래 Google provider의 14개 참조나 medium thinking 기본값을 connector에 상속하지 않습니다. MCP의 12개 제한을 확인하지 않은 desktop canvas 제한으로 주장하지 않습니다. 기존 Pro와 2의 slug를 바꾸지 않습니다.

이 버전은 다회 편집 일관성과 문자·레이아웃 정확도를 개선합니다. 새 마법 태그를 만들지 말고 목표, 참조 역할, 변경할 영역, 보존할 요소를 분명히 적습니다. 국소 편집은 “오른쪽 인물의 재킷 색만 남색으로 변경. 얼굴·헤어·포즈·배경·카메라·다른 사람·글자 배치 유지”처럼 범위를 지정합니다. 연속 편집에서는 승인된 결과와 보존 목록을 매번 명시합니다. Google Interactions의 `previous_interaction_id`는 provider 기능이며 현재 앱이나 Magnific connector가 같은 상태를 유지한다고 가정하지 않습니다.

텍스트는 정확한 한국어 문구를 따옴표로 적고 제목·본문·줄바꿈·서체 분위기·배치·대비를 구분합니다. 작은 글자나 긴 문장은 가독성과 누락을 검수합니다. 참조는 순서와 이름 있는 역할을 설명하고 서로 충돌하는 identity·스타일 지시를 피합니다. 좌우 위치·스케치 잔흔·편집 중 identity drift도 결과에서 확인합니다. 이는 출력 검수 지침이며 완전한 유지 보장이 아닙니다.

Provider 해상도 옵션은 `1K`(기본), `2K`, `4K`입니다. `512px`/`0.5K`는 구 Nano Banana 2의 옵션이고 2.1에는 적용하지 않습니다. `4K`는 옵션 이름이며 파노라마의 긴 변이 4096px을 넘을 수 있습니다. 별도 `8K` 옵션으로 해석하지 않습니다. thinking은 `minimal`/`medium`/`high`, 기본 `medium`입니다. 구2의 기본 `minimal`을 이어받지 않습니다.

이미지 참조 총수는 14개까지입니다. 캐릭터 4명·오브젝트 10개는 참조 fidelity 가이드로 다루며 5명 이상이 등장하는 프롬프트를 금지하지 않습니다. Pro의 5명/6개 기준과 섞지 않습니다. 무제한 identity 유지나 동적 UI 목록을 모델 지원으로 주장하지 않습니다. 오디오 입력/출력과 native `negative_prompt`를 생성하지 않습니다. 피하고 싶은 요소는 필요한 positive 의미 제약으로 표현합니다. Grounding도 실제 provider/connector에서 활성화됐는지 확인합니다.

확인 출처: [모델·thinking·해상도](https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1), [GA 발표](https://ai.google.dev/gemini-api/docs/changelog#october-6-2026), [참조·편집·Interactions 가이드](https://ai.google.dev/gemini-api/docs/image-generation), [프롬프트 지침](https://deepmind.google/models/gemini-image/prompt-guide/), [구2 종료 일정](https://ai.google.dev/gemini-api/docs/deprecations). 구2의 종료 표는 가장 이른 종료 가능일 2026-10-29를 안내하며 Pro를 자동 교체하지 않습니다.
