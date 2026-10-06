# 대화로 AIMovieStorage 조종하기

구도잡기의 실내 방에는 `composition_apply`의 `floorplan.wall_upsert`/`floorplan.wall_remove` 명령으로 실측 벽과 문·창을 편집할 수 있습니다. 먼저 `room.add`로 실내 방을 만들고 반환된 방 ID를 `roomId`에 넣으세요. 평면도 좌표는 방 중심 기준 미터(`x`, `z`)이며, 문·창은 벽 중앙의 개구부입니다. 같은 데이터가 환경 탭의 2D 편집 화면, 3D 뷰포트, 레퍼런스 영상 캡처에 쓰입니다. 벽을 놓은 뒤 `composition_commit`으로 저장하고 재열기 때 값을 확인하세요. 기존 여섯 면 이미지는 방 배경으로 별도 유지됩니다.

`project_update`의 `scene.move`·`cut.move`는 장면과 컷 순서를 0부터 지정합니다. 컷 이동 후 `order`를 다시 매기며 저장된 이미지·영상·구도는 그대로 둡니다.

이 문서는 현재 개발 소스의 앱 조종기를 설명합니다. 설치본마다 기능이 다를 수 있으므로 연결 후 `tools/list`와 `app_status`를 먼저 확인하세요. 실제 Tauri/WebView 앱과 stdio MCP 사이의 편집·저장·모캡·영상 내보내기를 확인했고, 로컬 H3·LTX 영상 생성도 실측했습니다. 모든 버튼이 API로 연결되거나 모든 모델·입력 조합의 검증이 끝난 것은 아닙니다. 큰 모캡 프로젝트의 WebView 메모리 오류를 줄이기 위한 변경 후, 실제 대형 프로젝트의 저장·수동 되돌리기·오래된 편집 거절을 한 차례 확인했습니다. 재열기와 장시간 반복 부하는 추가 검증 대상입니다.

## 연결 방식

대화는 Claude Desktop 또는 Codex에서 이어갑니다. AIMovieStorage 실행 파일을 `--mcp` 인자로 실행하는 로컬 MCP 서버가 켜져 있는 앱의 편집기에 명령을 전달합니다. 이 연결을 위해 AIMovieStorage에 별도 LLM API 키를 넣을 필요는 없습니다. 대화 서비스 계정·이용 조건은 사용하는 클라이언트를 따릅니다.

앱이 제공하는 기능 목록과 입력 규격을 먼저 조회한 뒤, 프로젝트 읽기 → 변경 → 결과 확인 순서로 작업합니다. 앱의 편집기를 거치므로 MCP 프로세스가 프로젝트 저장 파일을 별도로 직접 덮어쓰지 않습니다.

## 설정에서 연결하기

1. AIMovieStorage 데스크톱 앱을 열고 **설정 → 대화로 앱 조종하기**로 이동합니다.
2. 조종기는 앱 시작 시 편집 명령을 받을 준비가 끝난 뒤 자동으로 켜집니다. 설정에서 **앱 조종 끄기**를 누르면 이후 실행에서도 꺼진 상태를 유지하며, 다시 켤 수 있습니다.
3. **대화 앱 연결 설정**에서 Claude Desktop 또는 Codex를 고르고 설정을 복사합니다. 복사한 실행 파일 경로는 현재 실행 중인 앱의 경로입니다.
4. 사용하는 대화 앱의 MCP 설정에 추가합니다. 기존 서버 설정은 유지하세요. AIMovieStorage는 다른 앱의 설정 파일을 자동으로 바꾸지 않습니다.
5. 대화 앱의 MCP 연결을 다시 시작한 뒤 AIMovieStorage의 도구 목록을 확인합니다. 작업하는 동안 AIMovieStorage를 켜 둡니다.

앱을 실행하면 저장소에 포함된 [Codex 스킬](../skills/aimoviestorage-control/SKILL.md)을 `CODEX_HOME/skills`(설정하지 않았다면 `~/.codex/skills`)에 자동 등록합니다. 기존 스킬을 사용자가 고쳤거나 직접 만든 경우에는 덮어쓰지 않습니다. 스킬 설치와 MCP 연결 설정은 별개입니다.

Codex에서는 스킬 이름을 길게 적지 않고 `사용자올제 국호 프로젝트 만들어줘`처럼 요청해도 됩니다. `국호`는 앱에서 찾거나 새로 만들 프로젝트 이름이며, 이미 있으면 그 프로젝트를 이어서 작업합니다. 다른 프로젝트도 같은 방식으로 이름만 바꾸면 됩니다.

연결 후 첫 요청 예시:

> AIMovieStorage에서 지금 사용할 수 있는 기능과 열린 프로젝트 상태를 먼저 확인해 줘. 수정하기 전에 필요한 객체와 현재 값을 읽어 줘.

### Claude Desktop

설정창의 JSON은 `mcpServers.aimoviestorage` 항목입니다. 기존 `mcpServers`에 다른 서버가 있다면 새 항목만 합칩니다. 실행 파일 경로와 `args`는 앱에서 복사한 값을 사용합니다. 플랫폼별 설정과 재시작 방법은 [Claude 공식 로컬 MCP 안내](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)를 참고하세요.

### Codex

설정창의 TOML은 `[mcp_servers.aimoviestorage]` 항목입니다. 기존 `config.toml`의 다른 설정을 유지하면서 이 서버 항목을 추가하거나, MCP 서버 추가 화면에서 같은 실행 명령과 인자를 입력합니다. Codex의 MCP 설정은 로컬 stdio 서버의 `command`와 `args`를 지원합니다. [OpenAI 공식 MCP 안내](https://developers.openai.com/codex/mcp)

로컬 실행 파일을 사용하는 연결입니다. 웹·모바일 대화가 PC의 실행 파일에 직접 접속한다고 가정하지 않습니다. 원격 연결은 별도 구현·검증 범위입니다.

## 현재 소스의 API 범위

현재 개발 소스의 [도구 등록부](../client/src/lib/appControlRegistry.ts)에는 **MCP 도구 85개**, `composition_apply`가 받는 [구도 명령](../client/src/lib/compositionControlCommands.ts)은 **84종**입니다. 평면도 벽 추가·수정과 삭제 명령은 실행 중인 개발 앱의 `app_status`와 실제 호출로 확인했습니다. 음악을 놓는 명령은 LLM이 길이를 추측할 수 없게 별도 `composition_music_use`로 분리했습니다. 도구 수와 그 안의 편집 명령 수는 별개입니다. [프로젝트 명령](../client/src/lib/projectControl.ts)과 [BGM 명령](../client/src/lib/controlBgm.ts)도 각각 입력 규격을 검증합니다.

아래 표는 코드에 등록된 범위입니다. 모든 기능의 실제 앱 검증이 끝났다는 뜻은 아닙니다. 실행 중인 판의 `tools/list`와 `app_status`가 실제로 사용할 수 있는 규격입니다.

| 영역 | 현재 등록된 기능 | 범위와 조건 |
| --- | --- | --- |
| 프로젝트 | 목록·생성·열기·현재 초안 조회, 제목·이야기·인물·배경·씬·컷의 추가·수정, 씬·컷 순서 이동, 저장된 컷의 방 프리셋 등록·제거 | `project_update`는 읽은 `expectedRevision`을 요구합니다. 씬·컷·카드 삭제는 아직 제공하지 않으며, 파일을 가진 인물·배경의 이름 변경은 앱에서 처리합니다. |
| 캐릭터·배경 시트 | `project_update`의 `sheet.layout.upsert`로 공용 배치도, `sheet.fill`로 카드별 이미지 선택, `sheet_bake`로 앱과 같은 합성·프로젝트 폴더 저장 | 배치도는 픽셀 좌표, 이미지는 해당 카드의 시트 재료 ID를 사용합니다. 굽기는 새 판으로 저장하며 기존 시트의 교체·삭제는 아직 화면에서 합니다. |
| 구도 열기·확인 | 열린 편집기와 컷 대상 조회, 구도 열기, 상태·에셋 ID 조회, 가이드·배경판 이미지 캡처, 저장 | 구도 열기는 현재 프로젝트의 씬 화면에 등록된 컷을 대상으로 합니다. 앱을 켜 둔 채 편집기를 사용합니다. |
| 카메라·공간 | 카메라 위치·시선·화각, 방 생성·크기·배치·장소 연결·면 이미지·파노라마·배경 흐름·면 영상·방 프리셋 적용·저장, 로컬 배경/HDRI/파노라마 가져오기와 선택, 샷 저장·이동 | 미터·도·초 등 규격에 명시한 단위를 사용합니다. 새 프리셋은 `composition_commit` 뒤 `project_update`의 `room_preset.save_from_cut`으로 프로젝트 라이브러리에 담습니다. `composition_background_import`는 파노라마를 전용 폴더에 복사합니다. |
| 인물·소품 | 인물·마네킹 배치, 포즈·뼈 회전·손가락 접기, 소품·조명·그룹, 장착·부착·피벗, GLB 파일 가져오기·기존 트랙 편집 | 앱의 구도 편집 함수를 사용합니다. `composition_glb_import`는 파일을 프로젝트에 복사한 다음 트랙을 추가합니다. GLTF가 별도 외부 리소스를 참조하면 그 파일까지 복사하지 않으므로 GLB를 권합니다. |
| 타임라인·카메라 | 카메라 동작의 프리셋·순서·앵커 잠금, 카메라·동작량·모션·관절별 자세·접힌 자세·가림 키프레임 편집과 이징, 길이·FPS·레이어 구간, BGM 등록곡 사용·새 음원 가져오기·오프셋·BPM·박자 분석·마디 나누기·자르기·제거 | `composition_music_use`와 `composition_music_import`가 음원 파일의 실제 길이를 측정합니다. `composition_music_analyze`가 BPM·박자 후보를 기록하고 `music.update`의 `downbeatIndex`로 첫 박을 확인한 뒤 `music.split_detected_bars`로 구간을 나눕니다. 모캡 흔들림은 기존 다듬기 명령으로 처리합니다. UI 재생 버튼과 타임라인 높이 조절은 별도 MCP 명령이 없습니다. |
| 레퍼런스 영상 | `composition_export_video`로 열린 구도를 MP4로 내보내고 컷에 연결 | 기본 15초·1920×1080·24fps입니다. 타임라인에 음악이 있으면 해당 구간을 MP4에 합치고 같은 구간의 WAV도 저장합니다. 파일 생성과 컷 경로 저장을 확인한 뒤 완료됩니다. 구도 자체 저장은 `composition_commit`으로 별도 확인합니다. |
| 모션 캡처·군무 | 원본 목록·몸 분석·MediaPipe 손 추가 추적·결과 조회·캐릭터 타임라인 적용, KIMODO SOMA BVH 가져오기, 음악 구간별 동일 춤을 여러 캐릭터에 적용 | `mocap_analyze`는 등록된 로컬 영상만 분석합니다. `mocap_import_kimodo`는 이미 생성한 BVH를 프로젝트에 복사하고 관절 JSON으로 변환합니다. `composition_apply_dance`는 저장된 한 사람의 자세를 선택한 노래 구간과 여러 캐릭터에 적용하고 자리·카메라 키는 보존합니다. `kimodo_install`과 `kimodo_generate`는 설정·음악 탭과 같은 설치/생성 경로로 SOMA 모델을 실행하고 프롬프트·설정을 저장합니다. 모델 설치와 안무 품질·구간 경계의 자연스러운 연결은 실제 GPU/UI 검증이 아직 필요합니다. |
| 편집 협업 | 프로젝트·BGM·구도의 변경 내역과 변경 기다리기, 구도의 되돌리기·다시 실행 | 구도는 앱과 같은 이력을 사용하므로 수동 편집도 되돌릴 수 있습니다. 먼저 최신 상태를 확인합니다. |
| 에셋·로컬 생성 | 에셋 목록·이미지 미리보기, 로컬 이미지·영상 생성, 이미지 업스케일, 작업 조회·취소, `media_register`로 외부 생성 파일과 프롬프트 가져오기, `asset_set_primary`로 대표 선택 | 해당 판의 엔진만 실행합니다. 결과를 인물·배경·컷에 연결하며, 영상 생성 대상은 컷입니다. 지원되는 엔진에는 모캡 포즈 또는 LTX Canny 기준을 전달할 수 있습니다. |
| LoRA | `loras_list`로 실제 내려받은 파일 조회, `media_generate.loras`로 선택 | 경로 대신 불투명 ID와 세기를 받으며 실행 전 목록을 다시 확인합니다. 목록에 있다는 사실은 기반 모델·워크플로 호환성이 검증됐다는 뜻이 아닙니다. 다운로드·임의 파일 경로는 제공하지 않습니다. |
| BGM | 별도 음악 프로젝트 목록·조회·생성, 곡 추가·프롬프트·가사·스타일 수정, 변경 내역·기다리기, 로컬 음악 생성 | `bgm_generate`는 MiniMax-Music3 또는 ACE-Step을 사용해 BGM 곡에 결과를 연결합니다. `bgm_update`에는 `expectedRevision`이 필요합니다. 음악이 있는 프로젝트 이름 변경은 폴더 확인이 필요합니다. |
| 아직 남은 연결 | 모델 설치·가중치 및 LoRA 다운로드, 픽셀 단위 이미지 자르기, 카드/씬/컷 삭제, 전체 폴더 동기화, API·전역 설정 | 앵커와 움직임 마스크의 **좌표 자료**는 `image.marks`로 저장할 수 있지만, 자른 결과 이미지 파일 자체를 만드는 화면 도구는 별도입니다. Magnific 영상 생성 버튼의 자동 실행도 제공하지 않습니다. 기존 앱 기능이나 네이티브 내부 명령이 있어도 MCP `tools/list`에 노출된 것과는 다릅니다. |

작업 단위 명령을 묶어 제공하는 방식입니다. 모든 버튼을 동일한 이름의 API로 복제하지 않습니다. 새 기능은 입력 규격, 상태 조회, 적용, 결과 확인과 실패 처리를 함께 연결해야 합니다.

캐릭터·장소 시트는 먼저 `project_get`으로 이미지 ID를 읽고 `project_update`의 `sheet.layout.upsert`로 프로젝트 공용 배치도를 저장합니다. `sheet.fill`로 해당 카드에 각 칸의 이미지 ID를 연결한 뒤 새 리비전을 읽어 `sheet_bake`를 호출합니다. 합성은 화면의 `composeSheet` 함수를 사용하고 결과 파일·편집 가능한 배치 스냅샷을 카드에 등록합니다. 실패 응답을 받으면 같은 `operationId`로 다시 확인하되, 이미 화면에 적용된 파일은 자동 삭제하지 않습니다. 기존 시트를 교체하거나 파일을 지우는 명령은 제공하지 않습니다.

### 앱과 같은 프롬프트 요청·Magnific 구성

생성 방식을 정하기 전에 `creation_options`로 앱에서 현재 고를 수 있는 로컬 모델, Magnific 데스크톱 구성 모델, 설정된 ComfyUI 경로와 프로젝트 선택값을 확인합니다. 사용자가 이미지·영상의 모델 또는 경로를 지정하지 않았다면 작업에 필요한 선택만 한 번 묻습니다. “알아서 해”라고 맡겼다면 앱의 현재 설정과 작업 목적에 맞춰 정하고 사용한 모델·경로를 알립니다. 이미지 모델은 `project_update`의 `character.update`/`background.update`에서 `fields.promptModel`로, 영상 모델은 `project.update`에서 `fields.videoModel`로 저장한 뒤 새 revision을 읽고 프롬프트와 구성을 진행합니다. 로컬 생성은 선택한 엔진을 `media_generate`에 전달하고 ComfyUI는 설정된 워크플로를 선택합니다. 컷마다 같은 질문을 반복하지 않습니다. 구성만 완료된 상태를 생성 결과로 취급하지 않습니다.

Codex와 Claude는 인물·장소·컷 이미지·컷 영상·장면 영상을 작성할 때 `prompt_prepare`를 먼저 호출합니다. `target`은 `{kind:"character"|"background",id}` 또는 `{kind:"cutImage"|"cutVideo",sceneId,cutId}` 또는 `{kind:"sceneVideo",sceneId}`입니다. 이 명령은 현재 프로젝트의 카드 값, 구도·등장인물, 선택한 시트 칸, 모델·플랫폼·공통 규칙과 실제 이미지 순서를 앱의 API 버튼과 같은 함수로 조립해 반환합니다. 실내 6면 전개도 틀이 필요한 장소는 먼저 틀을 프로젝트에 저장하므로 반환된 새 `revision`을 사용합니다. 답변은 한국어·영어 프롬프트와 두 네거티브를 별도로 작성하고 `project_update`의 `prompt.apply`로 저장합니다. 이때 API 버튼과 같은 카드 이력에 이전 값과 새 값을 남깁니다. 사용자가 그 사이 앱에서 고쳤다면 `revision_conflict`가 나며 최신 상태로 다시 준비해야 합니다.

`project_prompt_status`와 `project_prompt_history`는 작품의 인물·장소·장면·컷 그림·컷 영상 프롬프트와 이력을 페이지별로 점검합니다. 추가 요청문도 화면과 같은 자료 함수를 사용합니다. `prompt_prepare_extra`는 인물 프로필·인물/장소 레퍼런스 분석·첫 레퍼런스·장소 6면, `natural_prompt_prepare`는 카드·씬·컷의 자연어 설명과 연기·배경 움직임·VFX, `bgm_prompt_prepare`는 BGM 스타일·가사를 준비합니다. `bootstrap_input_update`로 일괄 생성의 시나리오·원하는 수를 기록하고, 기존 입력은 `bootstrap_input_get`으로 읽습니다. `bootstrap_document_import`는 시나리오 파일을 앱 추출기로 읽어 원본과 함께 기록하며, `bootstrap_reference_register`는 이미지·영상에 앱과 같은 `@ref_img_N`·`@ref_mov_N` 이름표와 사용 메모를 붙입니다. 그 뒤 `bootstrap_prompt_prepare`를 작품 목록 → 상세 → 컷 구도 순서로 호출합니다. 답을 검토하고 `bootstrap_apply`를 호출하면 화면의 일괄 생성 해석·구도 조립 함수를 통해 저장하며 같은 `operationId`의 중복 적용을 막습니다. 반환된 카드별 4단계 작업표는 `bootstrap_prompt_targets`로 다시 읽을 수 있습니다. 각 인물·장소·컷 그림·컷 영상의 상세 요청은 `prompt_prepare`로 만들고, 한·영 본문과 네거티브를 `project_update`의 `prompt.apply`로 저장해야 완료로 표시됩니다. 완성된 장소 십자 전개도는 `background_unfold`가 화면과 같은 안전 판정·6면 커팅·세트 저장을 실행합니다. 이미지가 이미 있는 컷을 모아 `storyboard_bake`로 시트를 굽고 그 씬의 영상 요청을 준비할 수 있습니다. 이 경로들은 0.3.21의 도구 목록에 있지만 실제 화면에서의 전체 동작 검증은 별개입니다.

이미지 생성에 앱의 Magnific «구성»을 쓰려면 인물·장소 카드에는 `magnific_sheet_compose_preview`, 컷에는 `magnific_compose_preview`를 호출합니다. 이미지 미리보기의 `count`는 기본 4장, 선택 범위는 1~4장입니다. 생성기 하나의 Magnific `numberOfGenerations`에 이 값을 넣어 한 번 실행으로 여러 선택지를 받습니다. 이미지가 여러 개라면 각각 미리보기를 확인한 뒤 `magnific_compose_batch`에 `previewIds`를 원하는 순서로 보냅니다. `runAfterCompose`를 켜면 각 구성 직후 **방금 만든 이미지 생성기만** 선택해 순차 실행합니다. Magnific 화면에서 2K와 무한대(크레딧 없음) 표시를 모두 확인하지 못하거나 정확한 선택에 실패하면 누르지 않고 멈춥니다. 생략하면 생성기를 구성만 합니다. `Ctrl+A`로 기존 보드 전체를 실행하지 않습니다. 카드의 저장 프롬프트·선택 모델·`@`로 연결된 참조와 배경 비율을 그대로 사용하며, 같은 보드·페이지에 이전에 올린 같은 내용의 레퍼런스 파일은 업로드 ID를 재사용합니다. 실행 제출은 결과 완성을 뜻하지 않습니다. 완료된 후보는 `magnific_results_list`에서 확인하고, 고른 결과 ID만 `magnific_result_register`로 인물·장소·컷에 저장합니다. 대표 이미지만 `makePrimary`로 지정합니다. 영상 및 유료 모델의 자동 실행은 이 경로에서 지원하지 않습니다.

배경 구성의 출력 비율은 프롬프트 문장보다 `blueprint` 칩이 우선합니다. 조종기 `background.add`/`background.update`에서 칩을 지정할 수 있으며, 기본 실외 마스터 `master-birdseye`는 1:1, 일반 실외 눈높이 `view-eye-exterior`는 16:9입니다. 미리보기의 `aspectRatio`를 확인하세요. 프롬프트가 다른 비율 하나를 명시하면 구성 전에 `aspect_ratio_conflict`로 중단합니다.

Magnific의 [허용 사용 정책](https://www.magnific.com/legal/acceptable-use-policy)은 외부 도구를 통한 자동 조작을 금지합니다. `runAfterCompose`는 생성 버튼을 자동으로 누르는 기능이므로, 이 경로를 계속 운영하거나 배포하기 전에 공급자의 허가 또는 공식적으로 허용된 연동 방식인지 확인해야 합니다.

`cut.add`는 화면에 사람이 없는 컷도 `characterIds: []`를 명시해야 합니다. 인물이 있다면 먼저 `project_get`에서 캐릭터 ID를 확인해 이 배열에 넣으세요. 컷 제목·대사에 이름만 적고 ID를 빠뜨리면 생성 프롬프트의 인물 시트와 `@` 참조가 연결되지 않으므로 요청을 거절합니다. `cut.update`로 등장인물을 바꾸면 기존 프롬프트의 참조 부분도 함께 갱신되며, 저장 후 컷의 `characterIds`와 프롬프트를 다시 읽어 확인하세요.

한 장면의 두 번째 이후 컷은 `cut.update.fields.cutContinuity`를 `independent`, `continue`, `same-space-new-angle` 중 하나로 지정할 수 있습니다. 연결 모드에서는 앞 컷을 먼저 생성·등록한 뒤 `asset_set_primary`로 대표영상을 **명시적으로** 고르세요. 앱이 마지막 프레임을 프로젝트에 저장합니다. 그 전에는 다음 컷의 `prompt_prepare`, `magnific_compose_preview`, `media_generate`가 멈춥니다. 준비되면 API와 조종기의 영상 프롬프트 재료에 앞 영상·끝 프레임의 실제 `@` 태그가 들어가고, Magnific 구성에도 해당 파일이 같이 올라갑니다. `continue`는 마지막 프레임부터 이어 찍기를 지시하고, `same-space-new-angle`은 인물·공간을 유지하면서 다음 컷의 구도잡기 카메라를 따릅니다. H3 Ref2VA는 앞 영상과 끝 그림을 레퍼런스로 받을 수 있지만 해당 워크플로에서는 첫 프레임 픽셀의 정확한 고정을 보장하지 않습니다. Wan·LTX에는 영상 레퍼런스 입력이 없어 끝 그림을 첫 프레임으로 전달하며, 카메라·동작 재현을 보장하지 않습니다. 앞 컷의 대표를 바꾸면 다음 구성·생성 시 현재 대표를 다시 읽습니다.

LLM 조종기로 인물을 추가하거나 수정할 때는 `character.add` / `character.update`의 `blueprint`에 화면의 캐릭터 레퍼런스 구성 항목 ID를 넣습니다. 별도 선택이 없으면 앱의 기본 구성을 씁니다. 조종기는 선택한 칸 설명을 한글·영문 프롬프트에 함께 잇고, 구성이 바뀌면 옛 설명을 교체합니다. `promptKo`/`promptEn` 및 `negativeKo`/`negativeEn`은 한 쌍으로 채웁니다. 저장 후 `project_get`에서 선택 항목과 두 프롬프트를 확인하고, 이미지 생성·대표 이미지 지정까지 완료해야 인물 레퍼런스가 실제 컷에 이어집니다.

`media_generate`로 캐릭터 이미지를 만들 때는 카드의 현재 구성을 생성기에 보내는 프롬프트에도 자동으로 붙이고 실제 사용한 프롬프트를 결과 이미지에 기록합니다. 기존 이미지는 프롬프트 수정만으로 다시 생성되지 않습니다. 현재 로컬 Qwen·Z-Image·Krea 이미지 워커는 기존 인물 그림을 이미지 편집 레퍼런스로 읽지 않으므로, 기존 얼굴을 그대로 유지하는 새 시트가 필요하면 해당 기능을 지원하는 생성 경로에서 만든 뒤 `media_register`로 넣고 품질을 확인해 대표 이미지로 지정하세요.

컷의 이미지·네거티브·영상 프롬프트는 각각 한글과 영문을 한 쌍으로 보냅니다(`promptKo`/`promptEn`, `negativeKo`/`negativeEn`, `videoPromptKo`/`videoPromptEn`). LLM 조종기가 한쪽만 적어 다른 쪽을 비워 두는 요청은 거절합니다. 기존 컷에서 한글만 빠졌다면 `cut.update`로 그 칸을 보완하고 영문과 `@` 참조를 그대로 보존하세요.

장면 스토리보드도 `storyboardPromptKo`/`storyboardPromptEn`을 함께 쓰며, 한글 칸 본문이 대부분 영어면 저장을 거절합니다. 컷·캐릭터의 한글 프롬프트에도 같은 검사를 적용합니다. 장면 요약이나 영문 프롬프트를 한글 칸에 복사하지 말고, 실제 한국어 문장으로 별도 작성하세요.

BGM 작업은 `bgm_projects_list` → `bgm_get` / `bgm_create` → `bgm_prompt_prepare` → `bgm_update` → `bgm_generate` 순서로 이어갑니다. 생성 결과는 BGM 곡에 연결됩니다. 구도에는 `composition_music_use`로 저장곡을 올리거나 `composition_music_import`로 로컬 파일을 복사해 올립니다. 두 명령 모두 실제 길이 측정이 끝나야 구도를 바꿉니다.

## 공개판과 비공개판

현재 실행 중인 판의 연결 설정을 사용해야 합니다. 공개판에서 제공하지 않는 엔진은 도구 조회·실행에서도 같은 제한을 적용합니다. 다른 판에서 만든 작품의 자료를 보존하는 것과 해당 엔진을 실행할 수 있는 것은 구분합니다.

앱 설치 위치 또는 사용 중인 판이 바뀌었다면 설정창에서 연결 설정을 다시 복사합니다. 같은 판의 앱 여러 개가 동시에 조종 연결을 맡는 경우는 차단되며, 상태 화면에 이유가 표시됩니다.

## 작업 상태와 변경

- 기능 목록에 있는 명령과 규격만 사용합니다. 지원하지 않는 작업은 가능한 것처럼 처리하지 않습니다.
- 먼저 `project_get`, `bgm_get` 또는 `composition_get`으로 현재 상태와 리비전을 읽습니다. 수정 요청에는 그 `expectedRevision`을 넣습니다. 사람이 도중에 편집하면 오래된 리비전의 요청을 거절하므로, 변경을 읽고 다시 판단합니다.
- `project_changes`, `bgm_changes`, `composition_changes`는 마지막으로 읽은 리비전 이후의 필드·이전 값·새 값을 반환합니다. 프로젝트와 BGM의 `source`는 `app` 또는 `controller`, 구도는 `editor`·`controller`·`undo`·`redo`입니다. `app`은 앱 안의 변경을 뜻하며 수동 조작뿐 아니라 다른 앱 작업 결과도 포함할 수 있습니다. 조회 시점 사이의 상태 차이를 기록하므로 모든 클릭이나 중간 상태의 감사 로그는 아닙니다.
- `project_wait_changes`, `bgm_wait_changes`, `composition_wait_changes`는 최대 20초 동안 기다렸다가 변경 또는 제한 시간 종료를 반환합니다. 계속 지켜볼지는 대화 클라이언트가 판단하며, 이 도구만으로 대화가 자동으로 영구 감시 상태가 되지는 않습니다.
- `fullSnapshotRequired`가 참이면 기록 범위를 벗어났거나 내역이 생략된 것이므로 전체 상태를 다시 읽습니다. 구도 저장 결과의 `persistedLatest`도 확인합니다. 캡처 중에 더 최신 편집이 생겼다면 그 변경은 아직 저장되지 않았을 수 있습니다.
- 생성 작업은 요청과 완료를 구분합니다. 반환된 작업 ID로 진행·결과·실패를 확인하고, 대화가 끊겼다는 이유로 같은 생성을 바로 재요청하지 않습니다.
- 생성·업스케일·프로젝트 생성의 응답을 잃고 재요청할 때는 같은 `operationId`와 같은 입력을 사용합니다. BGM 프로젝트 생성·음악 생성에도 같은 규칙이 적용됩니다. 의도적으로 새 작업을 시작할 때만 새 ID를 만듭니다.
- **앱 조종 끄기**는 새 조종 요청을 막습니다. 이미 실행 중인 생성 작업을 취소하는 명령과는 별개입니다.
- 앱이 LLM API를 직접 호출하는 기존 기능과 이 연결은 구분됩니다. MCP 연결 자체에 API 키가 필요 없다는 설명이 기존 유료 API 호출을 무료로 바꾼다는 뜻은 아닙니다.

## 로컬 생성 뒤 RAM·VRAM 정리

설정의 로컬 모델 영역에서 고릅니다. 화면에서 시작한 생성과 MCP의 이미지·영상·BGM 생성은 같은 저장된 설정을 사용합니다. 실행 중인 설치본의 설정 화면에서 지원 여부를 확인하세요.

| 정책 | 동작 | 고려할 점 |
| --- | --- | --- |
| 생성 후 메모리 비우기 — 기본값 (`release`) | 생성이 끝나면 사용한 로컬 워커를 종료해 그 프로세스의 RAM·VRAM을 해제합니다. | 다음 생성은 모델을 다시 불러오므로 시간이 더 걸릴 수 있습니다. |
| 사용량이 기준 이상이면 비우기 (`adaptive`) | 생성 후 임시 객체·캐시를 정리하고 시스템 RAM과 현재 GPU의 VRAM 사용률을 확인합니다. 어느 하나라도 기준 이상이거나 사용률을 읽지 못하면 해당 워커를 종료합니다. | 기준은 각각 기본 85%, 설정 범위는 1~99 정수입니다. 기준 미만이면 모델을 유지합니다. |
| 빠른 연속 생성을 위해 모델 유지 (`retain`) | 정상 생성 후 모델을 남겨 다음 생성의 로딩 시간을 줄입니다. | RAM·VRAM 점유가 계속될 수 있습니다. 실행 중 오류로 끝난 생성도 이 설정과 별개로 해당 워커를 정리합니다. |

자동 정리는 **생성이 끝난 뒤** 수행합니다. 생성 도중 사용률을 감시해 작업을 끊거나, 모델 가중치를 일부씩 제거하는 방식은 아닙니다. 다른 프로그램이 쓰는 메모리는 해제하지 않습니다. 설정은 다음 생성부터 적용되며, 이미 남아 있는 로컬 모델은 **워커 내리기**로 종료할 수 있습니다. 수동 종료는 진행 중인 생성에도 영향을 줄 수 있습니다. 업스케일러의 워커 유지 설정은 별도입니다.

## 카메라·캐릭터 동작을 영상으로 잇기

1. `project_open` 후 `composition_list`에서 컷을 찾고 `composition_open`으로 구도를 엽니다. `composition_get`의 현재 ID·리비전을 읽습니다.
2. `composition_apply`로 인물을 배치하고 방·카메라 동작·키프레임을 수정합니다. `camera_key.add` / `camera_key.update`는 시각별 위치·시선·화각을 다룹니다. 움직이는 인물의 클로즈업에는 그 인물의 위치에 맞춘 카메라 키가 필요합니다.
3. 이미 등록한 영상은 `mocap_analyze` → `job_get`으로 몸 분석을 기다립니다. 필요하면 `mocap_track_hands`를 이어서 실행합니다. 손 추적 결과의 `handTracking.appliedHands`와 `handsOutcome`을 확인하세요. 추가 손이 0이면 기존 값을 유지한 것이며 개선됐다고 설명하지 않습니다.
4. `composition_apply_mocap`으로 사람·캐릭터·원본 구간을 선택해 적용하고 `composition_commit`으로 저장합니다. `sourceStartSeconds`는 원본 영상 시각이고 `timelineStartSeconds`는 구도 안의 배치 시각입니다. 거울 반전은 분석 결과를 따르며 중복 반전하지 않습니다.
5. `composition_export_video`를 요청하고 `job_get`에서 `done`, 실제 프레임 수·크기·길이와 `persisted`를 확인합니다. 프레임 격자 때문에 실제 길이는 요청 초와 조금 다를 수 있습니다.
6. 저장된 영상의 에셋 ID를 읽어 지원하는 로컬 모델에 전달합니다. 레퍼런스 전체·첫 그림·Canny·포즈는 서로 다른 입력입니다. 입력 수락이나 생성 완료만으로 카메라·안무·얼굴이 정확히 재현됐다고 판단하지 말고 결과 영상을 확인합니다.

### 로컬 제어 옵션

- **H3 Ref2VA:** 영상 에셋에는 `options.reference_video_range`를 `first5s` 또는 `full`로 명시합니다. `full`도 생성 길이에 따른 실제 조건 프레임 제한은 남습니다. 결과의 `meta.reference_videos`에서 읽은 길이와 조건에 사용한 길이를 구분합니다.
- **H3 그림 크기:** `options.h3_reference_resize_mode: "match"`는 레퍼런스 이미지를 출력 면적으로 제한하고 작은 그림을 확대하지 않습니다. `diffusers`는 기존 2048픽셀 짧은 변 전처리입니다. 영상 시각 선택과는 별개입니다.
- **H3 4회 프리셋:** `options.h3_lora_preset: "lightx2v-ref2va-4step-v0.1"`는 검증한 Ref2VA 파일 하나·세기 1·`steps` 생략 또는 4·`match` 전처리 조건입니다. 워커가 파일 SHA를 확인한 뒤 5개 스케줄 지점으로 4회 평가합니다. 일반 LoRA나 다른 워크플로용 파일에 자동 적용하지 않습니다.
- **LTX Canny:** `structureSource`는 같은 프로젝트의 레퍼런스 영상과 원본 시작·길이를 받습니다. 출력 FPS로 표본을 고르되 시간 늘이기·끝 프레임 반복으로 부족한 구간을 감추지 않습니다. 같은 요청에서 `poseSource`와 함께 쓸 수 없습니다. 현재 LTX 2.5 기반 모델에는 공식 재사용 경로의 LTX 2.3 Union LoRA를 사용합니다. [정확한 가중치·입력 규약](ltx-union-canny-control.md)을 확인하세요.
- **LTX 두 단계:** `options.ltx_quality: "two-stage"`는 명시 선택입니다. 기본 `single`은 기존 8회 생성입니다. 두 단계는 최종 크기의 절반에서 8회 생성 → 2배 latent 확대 → 3회 정제하며 LoRA와 구조 기준은 첫 단계에만 적용합니다. 최종 크기는 Union 사용 시 128, 그 외 64픽셀 배수로 맞추고 실제 결과를 `meta.two_stage`에 기록합니다. 실제 MCP→GPU 실행으로 2048×1152 결과와 컷 연결을 확인했습니다. 세부 품질과 카메라·동작 보존은 결과 영상으로 따로 판단합니다.

화면의 H3 레퍼런스 생성에서도 그림 크기를 선택할 수 있습니다. 실제 선택한 LoRA 하나·세기 1을 비동기 해시 검사한 뒤에만 Ref2VA 4회 선택지가 나타납니다. 선택하면 `match`와 4회를 함께 적용하며, 실행 직전 워커가 파일을 다시 검증합니다. 기본값은 기존 그림 처리·일반 생성입니다.

`media_generate`의 `loras`를 생략하면 이 MCP 요청에는 LoRA를 넣지 않습니다. 화면에서 선택해 둔 목록을 몰래 가져오지 않습니다. `loras_list`의 파일 ID는 같은 엔진에서만 사용할 수 있습니다.

## 캐릭터 음성 레퍼런스

첫 영상 전에도 캐릭터 카드에서 로컬 Qwen3-TTS로 대사와 목소리 특징을 입력해 음성 WAV를 만들 수 있습니다. 설정의 로컬 모델에서 Qwen3-TTS를 설치하거나 조종기의 `voice_engine_install`을 작업 대기열에 넣은 뒤 VoiceDesign 1.7B(자유로운 음색 설명), CustomVoice 1.7B 또는 0.6B(고정 화자)를 고르고 배우·가수·아이돌·아나운서·기상캐스터·라디오 진행자·일반인 중 연기 분위기, 목소리 성별·나이대, 언어를 지정합니다. 가수·아이돌은 말하는 대사의 톤이며 노래 합성은 아닙니다. VoiceDesign은 성별·나이대 설명을 생성 지시에 넣지만 결과 음색은 실측으로 확인해야 합니다. CustomVoice의 고정 화자는 성별·나이대 지시로 바뀌지 않을 수 있습니다. 한국어 모국어 옵션은 Sohee이며 다른 화자는 한국어도 말할 수 있지만 모국어 품질과 다를 수 있습니다. 조종기는 `voice_models_list`로 설치 상태·옵션을 읽고, `voice_generate`에 현재 리비전·고유 작업 ID·대사·특징·모델·분위기·`gender`·`ageRange`를 전달합니다. 긴 생성은 작업으로 접수되므로 `job_get`으로 완료를 확인합니다.

이미 대표 영상이 있으면 «목소리 레퍼런스»에서 한 인물만 말하는 대사 시작·끝 시각을 지정해 WAV로 추출하거나, 조종기의 `voice_extract`에 캐릭터·컷·대표영상 ID와 구간을 전달합니다. 여러 명이 말하는 영상은 화자를 자동 식별하지 않습니다. 두 방식 모두 WAV를 `<프로젝트>/character/<캐릭터>/voice/`에 저장하고 여러 후보 중 대표 하나를 선택합니다(`voice_select`). `project_update`의 `character.update`로 첫 등장 목소리 특징을 한글·영문에 각각 기록하면, 앱 API 버튼과 조종기 `prompt_prepare`가 같은 규칙을 사용합니다. 영상 «구성»과 `magnific_compose_preview`는 캐릭터 시트와 대표 음성을 함께 싣고 실제 파일 이름으로 `@`를 잇습니다. 선택한 음성을 바꾸면 이미 저장된 컷의 음성 연결문도 갱신됩니다. 음성 레퍼런스 입력이 실제 모델에서 안정적으로 목소리 복제·립싱크되는지는 결과 영상에서 별도로 확인하세요.

## 큰 응답과 작업 조회

프로젝트·구도 응답은 기본 `detail: "summary"`입니다. 생략된 큰 모캡 키는 원본에서 삭제되지 않으며 충돌 검사는 전체 상태를 기준으로 합니다. `full`은 작은 자료에만 사용하세요. `response_too_large` 오류가 나면 편집이 이미 적용됐을 수 있으므로 같은 편집을 반복하기 전에 요약 상태를 다시 읽습니다. [요약 필드·응답 제한·재조회 규약](CONTROL_RESPONSE_LIMITS.md)을 확인하세요.

`job_get`과 `jobs_list`는 요청 시점에 잡은 저장 작업까지만 기다린 뒤 내구성 있게 저장된 상태를 반환합니다. 이후 진행률 저장이 계속 생긴다고 모든 후속 쓰기를 기다리지는 않습니다. 읽은 직후 작업이 더 진행할 수 있으므로 필요하면 다시 조회합니다. 작업 취소는 협조적이며 실행 중인 GPU 호출이 먼저 끝날 수 있습니다. 결과 파일·연결 여부까지 확인하세요.

## 확인한 범위와 남은 검증

2026-09-23~24의 개발 빌드·현재 소스 검증을 구분합니다. 대화 클라이언트 설정을 자동 설치한 시험이 아니라 **실제 Tauri/WebView 앱 ↔ 실행 파일의 stdio MCP 프로토콜**을 직접 연결한 시험입니다. 아래 수치는 해당 시험 자료의 결과이며 일반 성능 보장이 아닙니다.

| 검증 단계 | 확인한 결과 |
| --- | --- |
| 실제 앱·MCP 협업 | 프로젝트 생성의 같은 `operationId` 재요청이 중복을 만들지 않았습니다. 수동 프로젝트·BGM·구도 편집의 이전·새 값과 변경 출처 조회, 오래된 리비전 거절, 후속 편집의 수동 변경 보존을 확인했습니다. 구도 undo/redo·가이드/배경판 캡처·저장도 확인했습니다. |
| 실제 대형 프로젝트 저장 | 338,807,039바이트의 프로젝트(인물 6명·씬 8개)에서 인물 5명과 카메라 동작 29개가 있는 구도를 열었습니다. 실제 UI의 되돌리기로 리비전 1→2가 바뀌고 오래된 편집이 거절됐으며, MCP 저장은 약 10.9초 후 완료되고 후속 조회에도 응답했습니다. 저장 파일은 공백을 줄인 JSON으로 149,807,872바이트가 됐고, 카메라·인물을 포함한 전체 구도 데이터가 저장 전과 정확히 같음을 별도로 확인했습니다. 한 번의 시험이며 재열기·반복 부하 성공을 뜻하지 않습니다. |
| 실제 레퍼런스 내보내기 | 두 구도에서 각각 15초·1920×1080·24fps·360프레임 MP4와 컷 경로 저장을 확인했습니다. 긴 구도는 69.134초 요청에서 1659프레임·69.125초 결과와 저장을 확인했습니다. |
| 실제 모캡·손 추가 추적 | SAM 3D Body 몸·손 분석과 MediaPipe 추가 추적을 실행했습니다. 1983표본의 한 시험에서 몸 기준 확대 영역을 함께 사용해 손 2623회를 적용하고 결과를 저장했습니다. 이 수치는 손 자세의 정확도 점수가 아니며 가림·다인 대응은 계속 확인해야 합니다. [손 추적의 사용법·제약](MOCAP_HANDS.md) |
| 실제 LTX 단일 단계 GPU | LTX 2.5 + Union Canny로 8회 생성한 영상 3건이 완료됐습니다. 결과는 1280×704·24fps이며 두 건은 113프레임, 구간 선택 시험은 65프레임입니다. 원본 구간과 실제 조건 길이를 결과 메타데이터로 확인했습니다. |
| 실제 LTX 두 단계 GPU | MCP `media_generate`로 1024×576·8회 생성 → 2배 확대 → 2048×1152·3회 정제, 24fps·65프레임 약 2.71초 출력을 완료하고 컷에 연결했습니다. 결과에서 첫 단계만 LoRA·구조 기준을 사용한 메타데이터를 확인했습니다. 완료 후 워커 종료를 확인했고 별도 후속 측정의 시스템 RAM 사용률은 21.8%, GPU 전체 사용량은 약 4.6GiB였습니다. 다른 앱의 메모리도 포함하므로 엔진 단독 사용량으로 해석하지 않습니다. |
| 실제 H3 GPU | Ref2VA·int8·검증 Turbo 4회·`match`로 카메라 기준 영상 두 건을 생성했습니다. 각각 124프레임·24fps 약 5.17초이며 오디오를 포함합니다. 이 시험은 네이티브 로컬 실행 명령을 사용했습니다. 동일 프리셋의 `media_generate` 경로와 화면 조작까지 모두 실측했다는 뜻은 아닙니다. 모델 이용 허용은 별도로 확보한 시험 환경에 한정됩니다. |
| 자동 시험·CPU 계약 | 스키마·판 제한·리비전 충돌·저장 확인·구간/FPS·손 좌표·메모리 설정·LoRA 재검증·H3 프리셋 및 LTX 두 단계 경계를 시험했습니다. 모의 파이프라인 시험은 GPU 품질 검증이 아닙니다. |

남아 있는 검증:

- Claude Desktop·Codex 각각에서 설정 추가 후 실제 대화·연결 종료·재시작·복구
- 새 소스의 82개 구도 명령 전체를 실제 화면에서 왕복하고 복합 편집을 검증하는 일, 모든 모델·LoRA 조합과 음악 생성 전체 흐름
- LTX 두 단계의 다양한 장면·긴 영상 품질과 카메라·동작 보존, 장시간 반복 생성·메모리와 취소·오류 뒤 복구
- 큰 다인 모캡 프로젝트의 재열기·카메라 타임라인 연속 편집·장시간 반복 저장 안정성: 변경 후 한 차례의 실제 저장·무결성·충돌 거절은 통과했으나 재열기와 반복 부하는 아직 확인하지 않았습니다. 이전 OOM 문제가 모든 조건에서 해결됐다고 보지 않습니다.
- 이 최신 소스가 반영된 최종 공개 설치본·무설치본의 구성과 실제 연결

도구 등록, 자동 시험, 직접 stdio 연결, 대화 클라이언트 연결, GPU 출력과 시각 품질은 서로 다른 검증 단계입니다.

## 공식 LTX-2.5 LoRA 다운로드 조종기 (2026-10-05)

`lora_download`는 승인된 파일 하나만 앱의 기존 인증·다운로드 서비스를 통해 받습니다.

```json
{"operationId":"ltx25-official-distilled-lora-20261005","engine":"ltx25","repo":"Lightricks/LTX-2.5","file":"loras/ltx-2.5-22b-distilled-lora-450-bf16.safetensors"}
```

반환된 `jobId`를 `job_get`으로 조회하고 `job_cancel`로 취소합니다. 같은 `operationId`는 기존 작업을 반환하며, 실패 후 다시 시도하려면 먼저 오류와 부분 파일 상태를 확인하고 새 ID를 사용합니다. 취소한 부분 파일은 기존 정책대로 이어받을 수 있도록 남깁니다. 다운로드는 현재 media 작업 줄에서 직렬 실행되며 GPU 모델을 실행하지 않습니다.

임의 URL·제공자·경로·다른 모델·토큰 입력은 받지 않습니다. 기존 등록 인증은 앱 내부에서만 사용하며 조회·반환·로그 도구를 추가하지 않습니다. 공식 HEAD 응답에서 크기와 원본 SHA-256을 확인하고, 새 파일은 크기·원본 해시·safetensors 구조를 확인한 뒤 완료 이름을 만듭니다. 공급자 해시를 확인할 수 없으면 새 가중치를 받지 않습니다. HTTP 401/403은 추가 가중치 요청이나 자동 재시도 없이 오류로 끝납니다.

같은 파일에 쓰는 UI·조종기 다운로드는 파일 잠금을 공유합니다. 조종기는 기존 완료 파일을 덮어쓰지 않으며, 기존 파일의 크기·구조·제공된 기대 해시를 검사합니다. 기대 해시 없이 기존 파일을 재사용한 경우 결과의 `expectedSha256Verified`는 false입니다. 결과에는 실제 SHA-256과 크기·재사용 여부를 반환합니다. 파일 수신은 기본 LoRA 선택이나 native LTX 모델 설치·생성 가능 여부를 바꾸지 않습니다. 실제 영상 생성과 품질 검수는 별도 검증 단계입니다.


### Native model component download
`model_component_download` accepts operationId, engine `ltx25`, repo `Lightricks/LTX-2.5`, and component transformer/text_encoder/video_vae/audio_vae/spatial_upsampler. Uses existing model downloader and registered internal auth; tokens, arbitrary URLs and LoRA paths are excluded. Download jobs are serialized separately from GPU media jobs. Completed files remain unselected until their native contracts are verified. Existing or partial files are preserved; checksum/size/structure checks precede promotion. Cancellation owns only its transfer.

## Experimental native A2V (QA only)

Read `native_a2v_status` before submission. Only if it is ready, use `media_generate` with `engine:"ltx25"`, `options.ltx_a2v:"experimental"`, same-project `audioAssetId`, explicit `audioDurationSeconds`, optional `audioStartSeconds` (default 0), and optional `imageAssetId`/`endImageAssetId`. Audio must be local stereo PCM16 WAV. Offset and length round to the nearest sample (Python round-to-even ties); duration clamps at EOF. Visible frames are ceil(actual sample duration * fps); generation uses the next 8n+1 frame count at least as large. End image conditions the last visible frame, before zero audio padding. Both native stages freeze original conditioned audio; final MP4 uses lossless ALAC from the original selected samples and crops only the last video packet duration. Additional LoRA selections, masks, pose/structure guides, references, precision, seconds, steps, guidance, and ltx_quality are rejected rather than ignored. Omitted ltx_a2v preserves existing LTX defaults. This is not approved general production or proven lip sync; generated file creation is not quality review. Native cancellation waits for the isolated process to finish and skips attachment; no forced termination. OOM is a normal failed job, with only the own-process CUDA cache released. No automatic downloads or runtime install.

Audio asset IDs include existing saved composition music.path entries. If importing new local audio, reuse composition_music_import and composition_commit, then assets_list; native A2V does not add another importer.


## CPU planar overlay (prepared candidate)

Read planar_overlay_status first. media_planar_overlay uses same-project video/image IDs, exact source/replacement SHA256, complete frame-indexed TL/TR/BR/BL quads and actual CFR specs. It uses the independent CPU lane, never downloads tools or uses GPU, preserves original input and publishes a derivative. Results remain unregistered with registrationRequired:true; honor the current explicit registration/install hold. Review before separately authorized media_register(makePrimary:false). S02 non-text is allowed; S03 requires declared exact 한국사 raster, which still needs human glyph review. See docs/PLANAR_OVERLAY.md.


## 원본 보호 CPU 편집 (준비 후보)

protected_edit_status를 읽고 media_local_edit를 사용한다. 명시적 같은 프로젝트 선택/보호 이미지 ID와 SHA256, 원본/crop 매핑이 필요하다. 보호가 우선하며 정확 문자 레이어가 보호에 걸리면 자르지 않고 거절한다. 자동 의미 분할·글자 인식·새 모델·GPU 사용은 없다. 결과는 비대표·미등록이고 검수 후 별도 허가된 media_register(makePrimary:false) 또는 기존 comfy_masked_compose를 재사용한다. 현재 앱 쓰기/설치 보류를 지킨다. docs/LOCAL_PROTECTED_EDIT.md 참고.
