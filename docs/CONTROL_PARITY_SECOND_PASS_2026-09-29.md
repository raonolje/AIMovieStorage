# AIMovieStorage 조종기 기능 대조 — 두 번째 조사 (2026-09-29)

후속 변경: `project_update`에 `scene.move`·`cut.move`를 추가했다. 위치는 0부터 세며 컷을 옮기면 `order`를 다시 매긴다. 공용 시트 배치도(`sheet.layout.upsert`), 카드별 이미지 선택(`sheet.fill`), 실제 시트 합성·등록(`sheet_bake`)도 개발 소스에 연결했다. 설치판 검증 전까지는 소스 시험 결과로만 본다.

이 문서는 **개발 소스**와 PC에 이미 설치된 v0.3.16을 구분한다. 설치판의 53개 MCP 도구·69개 구도 명령은 앞선 조사에서 실제 stdio 연결로 확인했다. 아래의 추가 기능은 개발 소스의 75개 도구·81개 명령이며, 설치본에 적용해 실제 조종한 결과로 읽으면 안 된다.

| 앱 화면의 작업 | 개발 소스의 조종 경로 | 이번 확인 |
| --- | --- | --- |
| 프로젝트 기본값·인물·장소·씬·컷, 모델 선택 | `project_update`, `creation_options` | 타입·저장·리비전 자동 시험. 사용자가 앱에서 고친 판을 덮지 않음. |
| 인물 정체성, 레퍼런스 순서·메모, 얼굴/6면 구성, 컷 등장인물과 `@` 참조 | `project_update`의 카드·레퍼런스·이미지 표시 명령 | 공통 앱 자료형과 프롬프트 조립기를 사용. 화면과 동시 편집 충돌·프롬프트 이력 시험. |
| 카드·컷 이미지·컷 영상·장면 영상의 API 프롬프트 | `project_prompt_status`, `project_prompt_history`, `prompt_prepare` → `prompt.apply` | 화면 버튼과 `appPromptRequest`/`buildPromptRequestText` 공유. 한·영 본문과 두 네거티브를 분리해 저장. |
| 프로필·레퍼런스 분석·첫 그림·6면 배경, 자연어 지시, BGM 문구 | `prompt_prepare_extra`, `natural_prompt_prepare`, `bgm_prompt_prepare` | 화면의 입력 조립 함수를 공용화. 응답 적용은 현재 리비전으로 `project_update`/`bgm_update`. |
| 시나리오 일괄 생성과 참조 파일·대본 | `bootstrap_input_*`, `bootstrap_reference_*`, `bootstrap_document_import`, `bootstrap_prompt_prepare`, `bootstrap_apply`, `bootstrap_prompt_targets` | 화면의 3단계 요청·답 파서·구도 조립기 공유. 적용 후 카드별 4단계 상세 프롬프트 작업표를 프로젝트에 저장해 다른 채팅에서 이어감. 참고 파일의 `@ref_img_N`·`@ref_mov_N`, 중복 재시도, 문서 추출 시험. |
| 씬 스토리보드 굽기 | `storyboard_bake` | 화면과 같은 시트 생성·한영 규칙 프롬프트 저장 시험. |
| 인물·장소 시트 제작 | `sheet.layout.upsert` → `sheet.fill` → `sheet_bake` | 화면의 공용 배치도·카드별 채우기·`composeSheet`를 공유. 파일/프로젝트 저장 및 중복 재시도 자동 시험. 설치판의 실제 이미지 품질 실측은 남음. |
| 구도 방·장소·6면·파노라마·HDRI·UV 흐름·면 영상·스왑 | `background_unfold`, `composition_background_import`, `composition_apply` | 화면 편집 함수를 사용. 배경 파일 복사·파노라마 전용 폴더·중복 선택 자동 시험. 완성 십자 전개도의 6면 판정·안전 검사·세트 저장은 조종기에도 연결했으나 실제 앱 파일 실측은 남음. |
| 다인 배치·포즈·손가락·소품·카메라 이동·타임라인 | `composition_apply` 81개 명령, `composition_apply_mocap`, `composition_motion_cleanup_*` | 타입·핵심 변환 자동 시험. 관절 키와 접힌 자세 키 이동/삭제는 화면의 같은 함수와 대조. 실제 다인 영상 결과는 이 변경 후 미검증. |
| 타임라인 음악·GLB·영상 출력 | `composition_music_use/import`, `composition_glb_import`, `composition_export_video` | 파일 길이는 실제 오디오 메타데이터로 측정. 기존 설치판의 레퍼런스 영상 출력 실측은 이전 조사에 기록. 새 import 명령의 설치판 실측은 아직 없음. |
| 로컬/Comfy/Magnific 생성과 에셋 등록 | `media_generate`, `comfy_generate`, `magnific_*`, `media_register`, `asset_set_primary` | 제출과 결과 등록을 구분. 한 언어만 있는 생성 프롬프트는 에셋 출처에만 보관하고 카드의 한영 쌍/이력을 깨지 않게 시험. 외부 생성 품질과 모든 모델 조합은 미검증. |

**아직 조종기로 끝까지 할 수 없는 화면 작업:** 이미지 픽셀 자르기, 기존 시트 교체·삭제, 프로젝트/카드/씬/컷 삭제, 전체 폴더 동기화, 모델/LoRA 설치와 전역 설정, 화면의 재생·타임라인 높이 조절. 좌표 기반 앵커·마스크 기록은 `image.marks`로 가능하지만 픽셀 파일 제작까지 끝났다고 보지 않는다. 따라서 이 판을 “앱의 모든 버튼을 LLM이 사용한다”거나 “전 기능 실측 완료”로 판정하지 않는다.

또한 새 개발 소스를 설치한 뒤 앱의 실제 stdio 도구 목록, 구도 편집→캡처→저장→재열기, Codex/Claude 양쪽의 대화 왕복을 확인해야 한다. 자동 시험과 Rust/TypeScript 컴파일은 그 실측을 대체하지 않는다. 작업 중 사용자가 앱을 쓰고 있다면 강제로 종료하지 않는다.
