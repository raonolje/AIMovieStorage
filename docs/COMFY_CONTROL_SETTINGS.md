# 공식 조종기로 ComfyUI 설정하기

`comfy_settings_get`은 설정 revision, 로컬 서버 주소, 이미지/영상 워크플로의 구성 여부와 매핑 수를 반환합니다. 파일 경로와 매핑의 고정 값은 반환하지 않습니다.

`comfy_settings_set`은 일반 앱 설정 저장 경로를 사용하며 디스크 저장 확인 후 `persisted`, `persistedLatest`, 새 revision, 워크플로 SHA-256을 반환합니다. 먼저 읽은 `expectedRevision`을 지정해야 합니다. 저장 도중 UI에서 설정을 바꾸면 최신 변경을 덮어쓰지 않습니다.

인수는 `kind` (`image` 또는 `video`), 선택적 `baseUrl`, `workflowPath`, `mappings`, `outputNodeIds`입니다. 서버 주소는 인증 정보와 경로가 없는 HTTP localhost/127.0.0.1/[::1] 주소여야 합니다. 워크플로는 ComfyUI API JSON 형식이며 기존 노드·입력·출력과 연속된 referenceIndex를 공유 검증합니다. 다른 종류의 워크플로 설정은 보존합니다.

저장 후 `comfy_status`와 `comfy_workflow_get`으로 연결·매핑을 확인합니다. 프로젝트를 읽고 `prompt_prepare`를 수행한 뒤, 같은 프로젝트의 자산 ID로 `comfy_generate`를 요청합니다. 접수만으로 성공을 판단하지 말고 `job_get`의 `done`, 결과 파일, 프로젝트 후보 등록과 실제 이미지를 확인합니다. 설정 저장은 모델 다운로드나 이미지 생성을 실행하지 않습니다.
