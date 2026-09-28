# Seedance 2.5 직접 API 연결 검토

2026-09-28 기준. 이 문서는 **구현 설계**이며, Volcengine 계정으로 과금 API를 호출한 결과 보고서는 아니다.

## 결론

Volcengine Ark의 `doubao-seedance-2-5-260628`을 앱에 직접 연결할 수 있다. 공식 API는 텍스트·이미지·영상·오디오의 동시 입력과 각 소재의 `reference_image`, `reference_video`, `reference_audio` 역할을 지원한다. 따라서 현재 Magnific 보드에서 시도한 구도잡기 영상 + 인물·배경 이미지 + 타임라인 음원의 구성을 API 요청 하나로 표현할 수 있다. 다만 **입력 가능**이 곧 시간·얼굴·동작의 완벽한 재현을 뜻하지는 않는다. 먼저 짧은 실측을 통과시켜야 한다.

공식 자료: [모델 목록](https://docs.volcengine.com/docs/ark/model-list?lang=zh), [영상 생성 작업 생성 API](https://api.volcengine.com/api-docs/view?action=CreateContentsGenerationsTasks&serviceCode=ark&version=2024-01-01), [Seedance 2.5 프롬프트 가이드](https://docs.volcengine.com/docs/ark/seedance-2-5-prompt-guide?lang=zh).

## 앱에서 보낼 구성

1. 구도잡기에서 선택한 구간을 영상 레퍼런스로 렌더링한다. 컷 시작 시각과 길이를 함께 기록한다.
2. 같은 구간의 타임라인 음원을 영상에 합치고, 정확히 같은 시작·종료 시각의 음원 파일도 만든다. 원본 음원 전체를 각 구간의 별도 노드에 연결하지 않는다.
3. 인물·배경 이미지를 선택하고, 역할과 순서를 고정한다. 텍스트에는 `@video1`, `@image1`, `@audio1`처럼 API의 *모달리티별 순서*에 맞춰 명시한다. Magnific의 사용자 정의 `@파일이름` 표기는 API에 그대로 복사하지 않는다.
4. `generate_audio`는 별도 선택값으로 둔다. 이 값은 출력 영상의 동기 음향 생성 여부이며, `reference_audio` 입력이나 음악 저작권·사용 권한을 대신하지 않는다.
5. Rust 백엔드에서 API 키를 보관하고 비동기 작업을 생성·조회한다. 완료 영상은 앱 프로젝트 폴더로 즉시 저장하고, 작업 ID·모델 ID·입력 파일 해시·프롬프트·옵션·비용 정보를 컷 기록에 붙인다. 실패 시 API 오류 코드와 요청 ID를 보존한다.

현재 앱의 구간별 MP4+동일 구간 WAV 내보내기와 미디어 등록 도구는 이 흐름의 출발점이다. Ark가 받아들일 HTTPS 소재 URL 또는 공식 업로드 경로, 재시도·중복 과금 방지, 취소, URL 만료 전 저장 기능은 직접 API 어댑터를 만들 때 추가해야 한다. 공식 예시는 API 요청의 `content`에 `video_url`, `image_url`, `audio_url`을 함께 넣는다.

## 인물 Asset ID

공식 문서에 따르면 Seedance 2.0/2.5는 **실존 인물 얼굴이 들어간 임의의 참조 이미지·영상 직접 업로드를 허용하지 않는다.** 같은 Ark 계정에서 생성한 신뢰 대상 원본 산출물에는 종류·기간 제약이 있고, 다른 플랫폼 결과물이나 편집본은 이 경로에 해당하지 않는다. 실제 배우를 쓰려면 본인 인증·동의와 플랫폼 등록을 거쳐 소재별 Asset ID를 받은 뒤 `asset://<ID>`를 해당 이미지·영상·오디오 URL 필드에 전달해야 한다. 프롬프트에서는 Asset ID 문자를 쓰는 대신 `@image1` 등 소재 순서로 지칭한다. 앱에는 등록된 Asset ID·소유 계정·사용 가능 상태만 연결하고 인증 절차 자체는 Ark에서 완료하도록 설계한다.

공식 자료: [인물 소재 사용 가이드](https://docs.volcengine.com/docs/ark/seedance-portrait-asset-guide?lang=zh), [실존 인물 소재 등록](https://docs.volcengine.com/docs/ark/upload-real-person-portrait-assets?lang=zh).

## 실측 기준과 순서

1. 같은 8~15초 컷으로 `영상+이미지`, `영상+이미지+구간 음원` 두 요청을 비교한다. 장면·카메라·인물·음악 싱크를 프레임과 오디오 파형으로 확인한다.
2. `generate_audio` 켜기/끄기를 각각 확인한다. 성공·실패와 생성 결과의 오디오 스트림 유무를 기록한다.
3. 실존 인물, 애니메이션 인물, 인증 Asset ID를 섞어 취급하지 않는다. 각 경로의 입력 승인 여부를 구분해 기록한다.
4. 모델·해상도·길이별 예상 비용을 작업 전에 표시하고, 완료 응답의 토큰 사용량으로 실제 비용을 남긴다. API 가격은 바뀔 수 있으므로 앱에 정액을 박아 넣지 않는다.
5. 실측에 성공한 입력 조합만 앱 UI의 기본 프리셋으로 올린다. Magnific에서 관찰된 오류 원인을 Ark API의 동작으로 단정하지 않는다.

공식 자료: [가격표](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh), [작업 조회 API](https://docs.volcengine.com/docs/ark/list-video-generation-tasks-api?lang=zh).
