# 구도 모캡 적용 조종 명령

`composition_apply_mocap`은 프로젝트에 저장된 분석 결과에서 한 사람을 골라 열린 구도의 캐릭터·마네킹에 적용한다. 원본 영상 분석은 기존 `mocap_analyze`, 결과 목록 확인은 `mocap_sources_list` / `mocap_result`를 사용한다. 경로나 관절 배열을 요청에 직접 넣지 않는다.

```json
{
  "projectId": "프로젝트 ID",
  "sessionId": "composition_list에서 얻은 세션 ID",
  "expectedRevision": 0,
  "sourceId": "mocap_sources_list에서 얻은 원본 ID",
  "personNumber": 1,
  "characterId": "현재 구도에 배치된 인물 ID",
  "sourceStartSeconds": 2,
  "durationSeconds": 3,
  "timelineStartSeconds": 5,
  "channels": { "position": true, "rotation": true, "pose": true }
}
```

이 예시는 원본 영상 2~5초의 표본을 구도 타임라인 5초부터 적용한다. 표본이 정확한 경계 시각에 없으면 실제 첫·끝 키는 그 안의 첫·끝 표본에 해당한다. 보간으로 새 표본을 만들거나 속도를 바꾸지 않는다. 응답의 `firstKeySeconds` / `lastKeySeconds`로 실제 키 범위를 확인한다.

- `sourceStartSeconds` 생략: 저장된 분석 구간 시작. `durationSeconds` 생략: 분석 구간 끝까지.
- `timelineStartSeconds` 생략: 모캡 UI가 원본별로 저장한 타임라인 시작.
- 채널 기본값: 이동·회전·관절 모두 사용. 모두 false인 요청은 거절한다.
- 평활화·발 고정은 모캡 UI의 원본 설정을 그대로 사용한다. 반전은 분석 좌표에 이미 반영되어 있어 적용 단계에서 다시 뒤집지 않는다. 반전 기록이 없는 옛 결과는 `mirroredDuringAnalysis: null`을 반환한다.
- 한 번에 표본 18,000장까지 적용한다. 명시한 길이는 최대 600초다. 큰 결과는 원본 구간과 타임라인 시작을 나눠 요청한다.

`capturedMotionApply.ts`의 내장 리그 로더와 타임라인 적용 함수를 기존 `MotionCaptureDialog`와 공유한다. 리타깃은 같은 `retargetPerson`을 사용한다. 같은 인물의 선택 채널에서는 실제 첫~끝 키 구간 안의 기존 키를 교체하고 구간 밖은 유지한다. 기존 `applyCapturedMotionIn`의 수동 손가락 보존 규칙도 그대로 적용된다. 새로운 GPU 분석이나 모델 다운로드는 실행하지 않는다.

명령은 편집기 history에 한 번만 들어가며 `composition_undo` / UI Ctrl+Z로 되돌릴 수 있다. 시작 전과 분석 결과·내장 리그를 읽은 뒤 모두 revision을 확인하므로 준비 중 사용자의 수동 편집을 덮어쓰지 않는다. 결과나 대상 프로젝트·캐릭터가 준비 도중 바뀌면 적용하지 않는다.

응답은 세션 revision, 인물·원본 ID, 표본 수, 실제 키 범위와 채널의 요약이다. 큰 관절 배열은 응답에 싣지 않는다. **이 명령은 구도 편집만 하며 `persisted: false`를 반환한다. 파일 저장은 최신 revision으로 `composition_commit`을 호출한다.**

검증: 실제 앱에 포함된 `male.glb`를 CPU에서 읽어 리타깃·UI 공통 적용 결과를 비교했다. 세 채널·원본/타임라인 시각·한 번의 undo/redo·수동 변경 중 충돌·원본 교체·세션 종료·다른 프로젝트·경로 입력·깨진 관절 거절을 회귀 시험으로 확인했다. 앱 UI를 재시작하거나 사용자 프로젝트를 수정하지 않았다. 네이티브 MCP 왕복 검증은 별도 격리 QA에서 수행한다.
