# AIMovieStorage 앱 조종기 전수 조사 — 2026-09-29

## 판정 범위와 방법

대상은 GitLab 원본 작업 트리의 `feat/magnific-batch-compose` (`9652004`에서 시작)와 이 PC에 설치된 비공개판 v0.3.16이다. GitHub 공개판의 제외 엔진과 혼동하지 않았다. **화면 기능 목록과 저장 자료형, 조종기 등록 스키마 53개, 구도 편집 명령 69개를 모두 코드에서 대조**했다. 설치 앱의 실제 stdio MCP에도 연결해 53개 등록 여부, 읽기 명령, 다섯 종류의 프롬프트 준비, 프로젝트 수정·변경 조회·충돌 거절·원상 복구를 확인했다. 아래의 소스 수정 뒤 자동 시험은 91개 파일의 764개와 `pnpm check`가 통과했다.

표기: **실측**은 설치 앱의 실제 MCP 응답, **코드**는 실행 경로·스키마 확인, **미검증**은 해당 동작의 실제 화면/GPU/외부 서비스 결과를 이번 조사에서 얻지 못했다는 뜻이다. 도구가 등록됐다는 사실과 그 기능이 정확한 결과물을 낸다는 평가는 다르다. 프로젝트의 기존 이미지·영상과 프롬프트는 변경하지 않았다. 왕복 시험은 전용 시험 프로젝트의 배경 프롬프트를 복구했으며, 시험 기록 2건은 이력에 남는다.

## 화면 흐름 순서대로 대조

| 순서 | 화면·기능 | 조종기 경로 | 판정과 범위 |
| --- | --- | --- | --- |
| 1 | 프로젝트 목록·열기·새 작품 | `projects_list`, `project_get`, `project_create`, `project_open` | **실측/코드**. 목록·읽기 정상. 삭제, 순서 변경, 폴더 동기화는 명령 없음. |
| 2 | 프로젝트 기본 정보·시나리오 | `project_update`의 `project.update`, `scene.add/update`, `cut.add/update` | **코드**. 제목·로그라인·시놉시스·톤·런타임, 씬·컷 주요 칸을 수정한다. UI의 프로젝트 부트스트랩 일괄 생성, 삭제·재배열, 시나리오 가져오기와 씬 구조의 모든 편집은 제공하지 않는다. |
| 3 | 인물 카드·정체성 | `character.add/update`, `prompt_prepare`, `prompt.apply`, `media_register`, `asset_set_primary` | **실측/코드**. 이름·설명·체형·선택한 구성 칩·프롬프트·대표 결과를 처리한다. 레퍼런스 이미지 추가·삭제·순서·분석, 프로필 JSON, 변형/대안/계보와 시트 자르기·배치는 조종기로 편집할 수 없다. 생성 이미지를 등록한다고 기존 얼굴 일치가 자동 검증되지는 않는다. |
| 4 | 장소 카드·6면 전개도 | `background.add/update`, `prompt_prepare`, `media_register`, `asset_set_primary` | **실측/코드**. 이름·공간 종류·구성 칩과 프롬프트, 결과 등록은 가능. 전개도 템플릿은 `prompt_prepare`가 필요한 경우 앱과 같이 생성·저장한다. 다만 파노라마 공간 세부값, 전개도 면별 자르기·배치·원본 참조 선택·레퍼런스 분석은 편집 명령에 없다. |
| 5 | 컷·스토리보드·프롬프트 | `cut.add/update`, 다섯 `prompt_prepare` 대상, `prompt.apply`, `media_register` | **실측/코드**. 컷 인물은 이름 문장만으로 이어지지 않으므로 `characterIds`가 필수다. 씬 영상·컷 이미지·컷 영상 요청 및 이력 저장이 된다. 그러나 컷의 세밀한 레퍼런스 선택, 스타일 칩·기법·마스크 그리기·스토리보드 시트 굽기는 화면 전용이다. |
| 6 | 구도잡기 기본 장면 | `composition_list/open/get/apply/commit`, `capture` | **코드**. 카메라, 방 추가·크기·면 이미지·파노라마, 인물·마네킹·포즈·손가락, 물체·그룹·샷·키프레임을 편집한다. 69개 명령 목록은 아래 부록 참조. 방을 장소 카드의 `backgroundId`에 연결, UV 배경 흐름(`room.drift`), 면 영상(`room.video`), 물체/그룹 스왑 시트(`swapRef`) 설정은 저장 자료형과 화면에는 있지만 명령에는 없다. 방 템플릿, GLB 새 파일 가져오기, 음악 새 파일 가져오기도 없다. |
| 7 | 구도잡기 타임라인·모캡 | `composition_apply` 카메라/모션/가림 키, `mocap_*`, `composition_apply_mocap`, `composition_export_video` | **코드**. 키와 트랙 편집, 몸 분석과 손 추가 추적, 배치와 영상 내보내기 경로가 있다. 이번 감사에서는 69개 편집 명령을 각각 실제 화면에서 실행하거나 다인·장시간 GPU 결과를 재검증하지 못했다. 타임라인 높이, 재생 UI 같은 화면 상태는 조종기 명령이 아니다. |
| 8 | BGM 프로젝트·곡 | `bgm_projects_list/get/create/update/changes/generate` | **실측/코드**. 곡 필드 편집과 로컬 생성 경로가 있다. **BGM API 버튼의 `bgm-prompt` 요청 자료를 만드는 `prompt_prepare`가 없다.** 기존 설치본의 조종기 곡 편집은 이력을 쌓지 않았고, 이번 소스 수정에서 보완했다. 삭제·폴더 동기화와 구도에 음원 파일 가져오기도 없다. |
| 9 | 로컬 모델·LoRA·이미지/영상 생성 | `engines_list`, `loras_list`, `creation_options`, `media_generate`, `media_upscale`, `jobs_*` | **실측/코드**. 설치된 모델·LoRA를 읽고 생성 작업을 보낼 수 있다. LoRA 목록은 실제 호환성/화질 인증이 아니다. 모델 설치·다운로드, 정밀도/메모리 정책 변경, 전 엔진·LoRA 조합의 실제 GPU 품질은 이 도구에서 다루거나 이번에 검증하지 않았다. |
| 10 | Magnific 구성·후보 선택 | 두 `magnific_*_preview`, `magnific_compose`, `magnific_compose_batch`, `magnific_results_list`, `magnific_result_register` | **실측/코드**. 실제 배경 카드 이미지 구성 미리보기는 저장 프롬프트·모델·16:9·기본 4장을 돌려줬다. 이미지 배치의 `runAfterCompose`는 화면에서 2K와 무제한 표시를 확인할 때만 자동 제출하도록 구현되어 있다. 영상 구성 후 자동 실행, 모든 결과의 자동 품질 선택은 없다. 이번 감사에서 유료/외부 생성은 실행하지 않았다. 공급자 자동화 허용 여부는 별도 검토 대상이다. |
| 11 | ComfyUI | `comfy_status`, `comfy_workflow_get`, `comfy_generate` | **실측/코드**. 이 PC의 127.0.0.1:8188은 연결되지 않아 실제 생성 검증 불가. 앱 설정에 API 형식 워크플로를 등록해야 한다. |
| 12 | 설정·가이드·관리 | `app_status`, 작업 조회/취소 | **코드**. 조종기 시작 상태와 작업 상태는 읽을 수 있다. 앱 언어·업데이트 채널·API 키·튜토리얼·로컬 모델 설치 및 설정값 변경은 조종 명령에 없다. |

## 프롬프트 API 버튼과 LLM 조종기의 동일성

| 화면의 요청 | 조종기 | 판정 |
| --- | --- | --- |
| 인물 카드, 장소 카드, 컷 이미지, 컷 영상, 씬 영상 | `prompt_prepare` → `project_update`의 `prompt.apply` | **요청 형식은 동일한 공통 함수 사용**. `appPromptRequest`가 카드 자료와 선택 칩을 만들고 `buildPromptRequestText`가 화면 버튼과 조종기 요청문을 만든다. 최대 4장의 레퍼런스를 같은 순서로 첨부한다. 이번 설치 앱에서 다섯 대상의 요청문 생성 성공. 같은 요청문이라도 Codex/Claude와 앱 API 모델의 출력이 같다는 뜻은 아니다. |
| 캐릭터 프로필 JSON, 카드 레퍼런스 분석·첫 레퍼런스 요청 | 해당 명령 없음 | **불일치**. 화면 버튼만 API로 요청한다. |
| 장소 6면 전개도 틀 자체의 프롬프트 외 세부 편집 | 준비 시 틀 저장만 가능 | **부분 지원**. 배경 카드 프롬프트 요청과 면별 시트 작업은 다른 기능이다. |
| BGM 스타일·가사 | 해당 요청 준비 명령 없음 | **불일치**. 조종기는 곡 필드를 수동 기입할 수 있지만 UI API 버튼과 같은 `bgmRequestData`를 전달하지 않는다. |
| 시나리오 부트스트랩/일괄 생성 | 해당 요청 준비 명령 없음 | **불일치**. 프로젝트 필드를 개별 편집할 수는 있다. |

`prompt.apply`는 한글·영문과 양쪽 네거티브를 함께 요구하고 프롬프트 이력을 남긴다. 수정 간 리비전이 바뀌면 다시 읽어야 한다. 이번 실제 왕복에서 저장 뒤 재조회가 일치했고, 사람이 편집한 것으로 가정한 낡은 리비전은 `revision_conflict`로 거절됐다. 기존 버전의 장소 직접 `background.add/update`에는 인물·컷과 같은 한글/영문 검사도 빠져 있었으므로 이번 소스 수정에서 맞췄다.

**확인된 오류:** 화면의 장소 카드 API 요청은 6면 전개도 템플릿을 막 만든 직후 이전 `references` 배열을 참조했다. 요청문에 틀 설명은 있는데 실제 첨부 그림은 빠질 수 있다. `usePromptCard`가 새 배열에서 첨부를 고르게 수정했다. 설치된 v0.3.16에는 아직 이 수정이 들어 있지 않다.

**이력 예외와 수정:** 설치된 v0.3.16의 `media_register`는 생성 프롬프트를 에셋 출처와 현재 카드/컷 칸에는 쓰지만 `promptHistory`에는 추가하지 않는다. `bgm_update`도 스타일을 바꾸지만 UI API 버튼처럼 이력을 쌓지 않는다. 이번 소스 수정에서 이미지·영상 결과 등록과 BGM 스타일/프롬프트 수정이 이전 판과 새 판을 이력에 남기도록 고쳤다. 테스트는 통과했으나 설치본 실측은 새 빌드 배포 전이므로 완료로 세지 않는다. `prompt.apply`는 원래 이력을 기록한다.

**남은 입력 경계:** `media_register`와 `magnific_result_register`는 한글 또는 영문 프롬프트 한쪽만 받아도 현재 카드/컷의 그쪽 칸을 바꿀 수 있다. `project_update`의 한영 쌍 검사와 다르며, 이 경로를 쓴 결과는 한글 칸이 빈 채 남을 수 있다. 결과의 원문 출처 보관과 카드의 이중언어 프롬프트 갱신을 분리하거나, 두 언어를 함께 받도록 계약을 통일해야 한다.

## 설치 앱 실측 기록

1. `tools/list`에 **53개 도구**가 등록되어 있었고 `app_status`는 비공개판 v0.3.16을 반환했다.
2. `projects_list`, `project_get`, `bgm_projects_list/get`, `composition_list`, `engines_list`, `loras_list`, `assets_list`, `mocap_sources_list`, `jobs_list`, `comfy_status`를 실제 호출했다. 현재 구도 세션이 열려 있지 않아 편집 명령은 실제 호출하지 않았다.
3. 기존 국호 작품에서 인물·장소·컷 이미지·컷 영상·씬 영상 다섯 `prompt_prepare`가 성공했다. 대상의 저장 레퍼런스가 비어 있어 그림 0장이 반환된 경우가 있었고, 이것만으로 첨부 기능 실패라고 판단하지 않는다.
4. 전용 시험 프로젝트에서 현재 리비전 조회 → `prompt_prepare` → 한영 프롬프트 적용 → 저장 재조회 → 변경 출처 조회 → 낡은 리비전 거절 → 기존 문구 복구를 수행했다. 적용은 `persisted: true`, 변경 6건과 출처 `controller`를 확인했다.
5. Magnific 이미지 구성 미리보기는 모델 `imagen-nano-banana-2`, 16:9, 후보 4개와 `paidGeneration:false`를 돌려줬다. 이는 미리보기 결과이며 Magnific 화면에서 실제 업로드·생성 완료를 이번에 확인했다는 뜻이 아니다.

## 다음 구현 순서

1. **프롬프트 요청 범위 통일:** 프로필·레퍼런스 분석·BGM 스타일/가사·일괄 생성에 각각 앱 API 버튼과 동일한 요청 조립기를 외부 조종 경로로 노출한다. 별도 프롬프트 복사 구현을 늘리지 않는다.
2. **구도잡기 누락 명령:** 장소 카드 연결, UV 흐름, 면 영상, 스왑 시트, GLB/음원 가져오기를 앱의 기존 편집 함수로 연결하고 각 저장·되돌리기·캡처 결과를 확인한다. 화면의 모든 버튼을 1:1로 복제하기보다 저장 상태를 바꾸는 동작과 화면 전용 표시를 구분한다.
3. **결과 기록 검증:** 이번에 고친 `media_register`와 `bgm_update` 이력을 설치본에서도 확인하고, Magnific/Comfy 결과 등록이 동일한 파일 등록 경로를 거치는지 최종 판에서 재검증한다. 원문이 한 언어뿐인 에셋의 출처 보관과 카드의 한영 프롬프트 갱신 규칙을 통일한다. 에셋의 대표 여부·출처·한영 프롬프트를 재조회한다.
4. **프로젝트 운영 기능:** 삭제·순서 변경·폴더/BGM 동기화와 레퍼런스 선택·시트 편집을 조종기에서 안전하게 다루되 파일 삭제는 미리보기/명시 확인 절차를 둔다.
5. **진짜 전 기능 실사용 시험:** 각 명령마다 전용 시험 프로젝트로 UI→조종기→저장 파일→재열기→실제 영상/이미지 결과를 비교한다. 구도 69개 명령, 모델·LoRA, 다인 모캡, Magnific와 ComfyUI는 실행 비용·설치 조건 때문에 이번 정적 전수 대조만으로 통과 판정하지 않는다. Claude Desktop과 Codex 각각의 장기 대화/재연결도 별도 실측한다.

## 부록 A — 등록 도구 53개 전부

프롬프트/선택/에셋: `prompt_prepare`, `creation_options`, `media_register`, `asset_set_primary`.

Magnific: `magnific_compose_preview`, `magnific_sheet_compose_preview`, `magnific_compose`, `magnific_compose_batch`, `magnific_results_list`, `magnific_result_register`.

ComfyUI: `comfy_status`, `comfy_workflow_get`, `comfy_generate`.

구도 영상·모캡: `composition_export_video`, `mocap_sources_list`, `mocap_analyze`, `mocap_track_hands`, `mocap_result`.

BGM: `bgm_projects_list`, `bgm_get`, `bgm_create`, `bgm_update`, `bgm_changes`, `bgm_generate`, `bgm_wait_changes`.

작품: `projects_list`, `project_get`, `project_create`, `project_update`, `project_open`, `project_changes`, `project_wait_changes`.

앱/구도: `app_status`, `composition_list`, `composition_open`, `composition_get`, `composition_apply`, `composition_apply_mocap`, `composition_undo`, `composition_redo`, `composition_capture`, `composition_commit`, `composition_changes`, `composition_wait_changes`.

모델/작업: `engines_list`, `loras_list`, `assets_list`, `asset_preview`, `media_generate`, `media_upscale`, `jobs_list`, `job_get`, `job_cancel`.

## 부록 B — 구도 `composition_apply` 명령 69개 전부

카메라/방: `camera.set`, `camera.speed`, `room.add`, `room.update`, `room.select`, `room.remove`, `room.face`, `room.panorama`, `room.occlusion`, `room.face_ratio`, `room.side_crop`.

인물/포즈: `character.place`, `character.update`, `character.color`, `mannequin.add`, `mannequin.remove`, `mannequin.update`, `pose.bone`, `pose.finger`, `pose.reset`.

물체/그룹: `object.add`, `object.update`, `object.remove`, `object.mount`, `object.attach`, `object.detach`, `object.pivot`, `group.create`, `group.update`, `group.ungroup`.

샷/카메라 동선: `shot.add`, `shot.save`, `shot.goto`, `shot.rename`, `shot.remove`, `camera_move.add`, `camera_move.update`, `camera_move.remove`, `camera_move.preset`, `camera_move.reorder`, `camera_move.lock_anchors`, `camera_key.add`, `camera_key.move`, `camera_key.update`, `camera_key.remove`, `camera_key.easing`, `amount_key.add`, `amount_key.move`, `amount_key.remove`, `amount_key.easing`.

동작/가림: `timeline.set`, `motion_key.add`, `motion_key.remove`, `motion_key.move`, `motion_keys.shift`, `motion_key.easing`, `motion_track.easing`, `occlusion_key.room_toggle`, `occlusion_key.object_toggle`, `occlusion_key.move`, `occlusion_key.remove`.

레이어/GLB/음악/표시: `layer.update`, `glb.update`, `glb.remove`, `music.update`, `music.split_bars`, `music.cut`, `music.remove`, `display.update`.
