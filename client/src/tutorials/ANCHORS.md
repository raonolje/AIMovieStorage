# 튜토리얼 앵커 — `data-tour="…"` 를 어디에 다는가

튜토리얼 걸음(`full.ts` · `pages.ts` · `planner.ts`)의 `anchor` 값과 화면 요소를 잇는 표입니다.
화면 쪽은 표의 요소에 `data-tour="<앵커>"` 속성을 달기만 하면 됩니다. 이름은 여기와 자료가
**한 글자도 다르면 안 됩니다** — `tutorials.test.ts` 가 «걸음이 부르는 앵커 ⊆ 이 표» 와
«이 표의 앵커 ⊆ 걸음이 부르는 앵커» 를 양쪽으로 셉니다. 표의 첫 칸(`` `앵커` ``)만 읽으므로
설명 칸은 자유롭게 고쳐도 됩니다.

줄 번호는 2026-09-22 기준 «그 언저리» 입니다 — 다른 작업이 파일을 고치면 밀립니다. 요소는 **문구로**
찾으세요(단추 이름 · `title=` · `aria-label=` 을 그대로 적어 두었습니다).

규칙:

- `data-tour-switch`는 보기 탭(`data-tour-switch-kind="tab"`)과 접기/펴기
  (`data-tour-switch-kind="expand"`, `aria-expanded`)에만 씁니다. 튜토리얼이 대신 눌러도
  작품 데이터가 바뀌지 않아야 합니다. 생성·저장·선택·창 열기는 `data-tour-open`으로
  안내만 하며, 실제 실행은 사용자가 직접 누를 때만 합니다.
- 목록 안에 같은 요소가 여럿이면(인물 패널 · 컷 카드 · 장면 줄) **모든 것**에 같은 앵커를 달아도
  됩니다. 띄우는 쪽이 첫 번째 것을 잡습니다.
- 접이식 안에 있는 요소(«수치 입력 · 색», «위치 · 회전 숫자»)는 접혀 있으면 못 잡습니다 — 접이식의
  **머리 단추**에 다세요.
- 같은 조건에서 하나만 그려지는 두 요소(빈 상태의 «첫 캐릭터 추가하기» 와 목록 끝의 «캐릭터 추가»)는
  둘 다에 다세요.
- `settings-language` 는 «언어» 와 «튜토리얼» 두 Section 을 싸는 `div` 하나에 답니다 — 걸음 «언어 · 튜토리얼» 이
  둘을 한 번에 가리킵니다. 앵커를 못 찾는 걸음은 가운데 카드로 뜹니다(`TutorialOverlay` 가 그렇게 물러납니다).

## 전역 띠 (`client/src/components/GlobalNav.tsx` · `TaskQueuePanel.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `nav-settings` | `GlobalNav.tsx` | 위 띠 항목 map 의 «설정» 단추 — `item.path === "/settings"` (L41-80) |
| `nav-ai-ready` | `GlobalNav.tsx` | «AI 최적화 준비됨 / 필요» 칩 `<span>` (L91) |
| `nav-tasks` | `TaskQueuePanel.tsx` | 위 띠의 «작업» 단추 — `title="돌고 있는 일과 기다리는 일"` (L90) |

## 프로젝트 보드 (`client/src/pages/ProjectsPage.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `projects-stats` | `ProjectsPage.tsx` | 요약 숫자 네 칸을 싸는 `div.flex.items-center.gap-6` (L192) |
| `projects-new` | `ProjectsPage.tsx` | 오른쪽 위 «새 프로젝트» `Button` (L160); 빈 상태 «첫 프로젝트 만들기» (L268) 에도 |
| `projects-search` | `ProjectsPage.tsx` | `placeholder="프로젝트 검색..."` 입력칸 (L206) |
| `projects-grid` | `ProjectsPage.tsx` | 카드 그리드/목록 컨테이너 `div` (L246, `viewMode === "grid" ? "grid …" : "flex …"`) |
| `projects-card-hide` | `ProjectsPage.tsx` | 카드 안 숨기기 단추 `aria-label="… 숨기기"` (`EyeOff`, L300) — 카드마다 달아도 됨 |
| `projects-hidden` | `ProjectsPage.tsx` | «숨긴 프로젝트 (N)» 펼치기 단추 (L339) |
| `projects-reload` | `ProjectsPage.tsx` | `aria-label="폴더 다시 읽기"` 단추 (L232) |

## 프로젝트 껍데기 (`client/src/pages/NewProjectPage.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `project-progress` | `NewProjectPage.tsx` | 전역 프로그래스 바 — `STEPS.map` 을 싸는 `div` (L548 언저리) |
| `project-next` | `NewProjectPage.tsx` | 하단 «다음» 단추 (L696) |
| `project-finish` | `NewProjectPage.tsx` | 마지막 단계의 «프로젝트 목록으로» 단추 (L677) |

## 주제 설정 (`client/src/components/project/StepBasics.tsx` · `ProjectBootstrapDialog.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `basics-bootstrap` | `StepBasics.tsx` | «AI 로 일괄 생성» — 빈 상태 `section` (L112) 과 접힌 단추 (L142) 둘 다 |
| `basics-info` | `StepBasics.tsx` | `<Panel title="작품 정보">` 뿌리 (L165) — Panel 에 `data-tour` 를 넘기거나 싸는 `div` |
| `basics-title` | `StepBasics.tsx` | «제목» 입력칸 `placeholder="수화의 숲"` (L173) |
| `basics-genre` | `StepBasics.tsx` | «장르» 칩 Panel (L248) |
| `basics-style` | `StepBasics.tsx` | «비주얼 스타일» 칩 Panel (L256) |
| `basics-era` | `StepBasics.tsx` | `<Panel title="시대 배경">` (L263) |
| `basics-cover` | `StepBasics.tsx` | «대표 그림» Panel — `<Panel title="대표 그림" tour="basics-cover">`. 안의 내용은 `ProjectCoverPanel.tsx` 입니다 |
| `basics-preview` | `StepBasics.tsx` | `<Panel title="프롬프트에 이렇게 들어갑니다">` (L346) |
| `bootstrap-scenario` | `ProjectBootstrapDialog.tsx` | «시나리오 · 설정 · 기획안» textarea (L257) |
| `bootstrap-mode` | `ProjectBootstrapDialog.tsx` | «어떻게 넣을까요» 블록 — «이미 있는 것에 덧붙이기 / 비우고 새로» (L381) |
| `bootstrap-run` | `ProjectBootstrapDialog.tsx` | «만들기 / 다시 만들기» 단추 (L586); «상세만 다시 만들기» 는 그 옆 (L567). «카드마다 프롬프트 자세히 쓰기 (4/4)» 체크(L638)도 같은 아래 띠라 4/4 걸음이 이 앵커를 같이 씁니다 |

## 캐릭터 (`client/src/components/project/*` · `client/src/components/*`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `characters-add` | `StepCharacters.tsx` | 목록 끝 «캐릭터 추가» (L269); 빈 상태 «첫 캐릭터 추가하기» (L127) 에도 |
| `character-panel` | `EntityLineagePanel.tsx` | 인물 패널 뿌리 `<section>` (파일 앞부분, 이름 줄을 싸는 것) — 첫 패널만 잡혀도 됨 |
| `character-variation` | `LineageTree.tsx` | 원본 카드 아래 «이 카드에서 변형» 단추 (L371) |
| `character-sheet-compose` | `EntityLineagePanel.tsx` | «캐릭터 시트 제작» 단추 (L402; 배경이면 «배경 시트 제작») |
| `card-references` | `PromptCardBody.tsx` | 머리 왼쪽 레퍼런스 스트립 — `ReferenceImageUploader` 를 싸는 칸 (L260 언저리) |
| `card-basics` | `StepCharacters.tsx` | 이름·역할·형태·성별·키·체격 `Field` 들을 싸는 2열 grid (L673) |
| `card-analysis` | `PromptCardBody.tsx` | «이미지 분석» 제목 줄 `div.flex` (L457-463) |
| `card-profile` | `CharacterProfilePanel.tsx` | «특징 정하기» 단추 (L133) |
| `card-blueprint` | `BlueprintTogglePanel.tsx` | 구성 판 뿌리 — «캐릭터 레퍼런스 구성» 제목이 있는 상자 (L194) |
| `card-prompt-write` | `PromptCardBody.tsx` | «프롬프트 작성» 단추 (L780) |
| `card-first-reference` | `PromptCardBody.tsx` | «첫 레퍼런스 프롬프트» 접이식 머리 (L1266) |
| `card-compose` | `PromptResultPanels.tsx` | 프롬프트 칸의 «구성» 단추 (L169) — 한글 칸 것에 달면 첫 번째로 잡힘 |
| `card-local-generate` | `LocalGenerateButton.tsx` | 모델 고르는 칸과 «로컬로 뽑기» 를 싸는 줄 (L256) — «구성»(마그니픽)과 **다른 단추**입니다 |
| `card-generated-images` | `GeneratedImageShelf.tsx` | «생성 결과 이미지» 선반 뿌리 (L277 제목이 든 상자) |
| `card-image-crop` | `ImageActions.tsx` | 가위 `ActionButton corner="crop"` — `label="… 에서 칸 잘라내기"` (L135) |

## 씬 구성 (`client/src/components/project/*` · `MagnificInboxPanel.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `scenes-add` | `StepScenes.tsx` | 목록 끝 «장면 추가» (L148); 빈 상태 «첫 장면 추가하기» (L117) 에도 |
| `scene-summary` | `StepScenes.tsx` | 장면 요약 textarea `placeholder="이 장면에서 무슨 일이 일어나는지"` (L274) |
| `scene-cut-add` | `StepScenes.tsx` | «컷 추가» 단추 (L357) |
| `scene-storyboard` | `SceneStoryboard.tsx` | «스토리보드» 제목 줄 (L382) 을 싸는 상자 |
| `scene-storyboard-make` | `SceneStoryboard.tsx` | «스토리보드 만들기 / 다시 만들기» 단추 (L412) |
| `cut-open-planner` | `CutCard.tsx` | 머리줄 «구도잡기» 단추 (L1311) |
| `cut-import-composition` | `CutCard.tsx` | «구도 불러오기» 단추 (L1330) |
| `cut-frame` | `CutCard.tsx` | 펼친 컷의 프레임 그림 상자 — «구도를 잡으면 프레임이 붙습니다» 가 뜨는 곳 (L1433 언저리) |
| `cut-switches` | `CutCard.tsx` | «구도 쓰기» «레퍼런스 영상 쓰기» 스위치 줄 `div.flex.flex-wrap` (L1478-1489 의 두 스위치를 싸는 것) |
| `cut-summary` | `CutCard.tsx` | «구도에서 읽음» 상자 (L1539) |
| `cut-refs` | `CutCard.tsx` | «캐릭터 / 배경 / 레퍼런스» 탭 묶음을 싸는 `div` (탭 라벨 L1712-1722) |
| `cut-style-toggles` | `CutStyleToggles.tsx` | 연출 칩 판 뿌리 — 그룹은 스타일 · 촬영 · 조명 · 색감 · «질감 · 실사» (`lib/cutStyle.ts`); CutCard 에서 부르는 자리 L1846 |
| `cut-dialogue` | `CutCard.tsx` | «대사 · 연기 지시» 제목이 든 블록 (L1862) |
| `cut-background-motion` | `CutCard.tsx` | «배경 움직임» 제목이 든 블록 — VFX 칸 바로 위. 구름·지나가는 차처럼 «배경이 스스로 하는 움직임» 을 적는 칸 |
| `cut-prompt-section` | `CutPromptSection.tsx` | «컷 프롬프트» 제목 줄 `div.flex.flex-wrap` (L68) |
| `cut-prompt-write` | `CutPromptSection.tsx` | «프롬프트 작성» 단추 (L100) |
| `cut-video-section` | `CutVideoSection.tsx` | «영상 프롬프트» 제목 줄 `div.flex.flex-wrap` (L72-74) |
| `cut-video-prompt` | `CutVideoSection.tsx` | «영상 프롬프트» 단추 (L122) |
| `cut-ref-video-list` | `CutVideoSection.tsx` | «구도잡기에서 뽑은 영상 (N)» 목록 상자 (L198) |
| `inbox-panel` | `MagnificInboxPanel.tsx` | 후보함 머리 — «마그니픽에서 온 것 N개 …» 줄 (L253) |

## 확인 (`client/src/components/project/StepFinish.tsx` · `BatchGeneratePanel.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `finish-counts` | `StepFinish.tsx` | 인물·장소·컷·스토리보드·영상 다섯 칸을 싸는 줄 (L125-148) |
| `finish-batch` | `BatchGeneratePanel.tsx` | «한 번에 뽑기» 판 뿌리 (L74 제목이 든 상자) |
| `finish-scene-row` | `StepFinish.tsx` | 장면마다 한 줄 — 첫 장면 블록 (L180 언저리, «인쇄» 단추가 있는 상자) |
| `finish-print` | `StepFinish.tsx` | «인쇄» 단추 (L205) |
| `finish-scene-video` | `StepFinish.tsx` | `label="씬 영상 — 밖에서 뽑아 온 것도 여기로"` 의 `CutVideoShelf` (L233) |
| `finish-cut-videos` | `StepFinish.tsx` | «컷 영상 N개» 상자 (L259) |

## 설정 (`client/src/pages/SettingsPage.tsx`)

`Section` 부품에 `data-tour` 를 넘길 수 있게 하거나(`{...rest}`), Section 을 싸는 `div` 에 답니다.

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `settings-profile` | `SettingsPage.tsx` | `<Section title="프롬프트 작성 프로필">` (L409) |
| `settings-folders` | `SettingsPage.tsx` | `<Section title="폴더">` (L458) |
| `settings-base-folder` | `SettingsPage.tsx` | «기본 저장 폴더» `FolderRow` (L459-461) |
| `settings-api-keys` | `SettingsPage.tsx` | `<Section title="API 키">` (L492) |
| `settings-language` | `SettingsPage.tsx` | «언어» + «튜토리얼» 두 Section 을 싸는 `div.space-y-4` — 프롬프트 작성 프로필 바로 아래 |
| `settings-auto-unfold` | `SettingsPage.tsx` | `<Section title="전개도 자동 6면 커팅">` (L606) |
| `settings-lora` | `SettingsPage.tsx` | `<Section title="로라 (엔진별로 찾고 받기)">` (L647) |
| `settings-magnific` | `SettingsPage.tsx` | `<Section title="마그니픽 (MCP 로 끝까지 뽑기)">` (L651) |
| `settings-local-engines` | `SettingsPage.tsx` | `<Section title="로컬 모델 (그림·영상·음악)">` (L655) |
| `settings-upscale` | `SettingsPage.tsx` | `<Section title="업스케일 엔진">` (L660) |
| `settings-prompt-docs` | `SettingsPage.tsx` | `<Section title="가이드 문서 관리">` (L908) |
| `settings-task-models` | `SettingsPage.tsx` | `<Section title="작업별 모델">` (L912) |

## BGM (`client/src/pages/BgmProjectsPage.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `bgm-project-add` | `BgmProjectsPage.tsx` | «프로젝트 추가» 단추 (L518) |
| `bgm-track-add` | `BgmProjectsPage.tsx` | «+ 곡 추가» 단추 (L600) |
| `bgm-chips` | `BgmProjectsPage.tsx` | 칩 묶음 — «분위기» `ChipGroup` 부터 «곡 구조» 까지를 싸는 `div` (L711-751); 없으면 «분위기» 것에 |
| `bgm-tempo-length` | `BgmProjectsPage.tsx` | «템포 (BPM)» · «길이 (초)» 줄 (L767-790) |
| `bgm-tool` | `BgmProjectsPage.tsx` | «생성 도구» 라벨이 든 칸 (L806) |
| `bgm-instrumental` | `BgmProjectsPage.tsx` | «가사 없는 연주곡» 스위치 라벨 (L849) |
| `bgm-write` | `BgmProjectsPage.tsx` | «스타일 · 가사 뽑기» 단추 (L949) |
| `bgm-style-panels` | `BgmProjectsPage.tsx` | «곡 스타일 (한글) / Style» 두 칸 `PromptResultPanels` 을 싸는 상자 (L995) |
| `bgm-history` | `BgmProjectsPage.tsx` | `title="받아 둔 곡 스타일"` 의 `PromptHistoryShelf` (L1076) |
| `bgm-local-generate` | `BgmProjectsPage.tsx` | «바로 뽑기 / 줄에 섰습니다» 단추 (L1122) |
| `bgm-tracks-list` | `BgmProjectsPage.tsx` | 뽑은 곡 목록 상자 — «목록에서 뺍니다» 단추가 든 곳 (L1140 언저리) |

## 구도잡기 — 껍데기 (`client/src/components/CompositionPlanner.tsx` · `composition/planner/PlannerChrome.tsx` · `ShotBar.tsx` · `CameraBar.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `planner-header` | `PlannerChrome.tsx` | 머리줄 `div` — «구도 잡기» 글자가 든 줄 (L100-108) |
| `planner-undo` | `PlannerChrome.tsx` | `title="되돌리기 (Ctrl+Z)"` 단추 (L121) |
| `planner-ratio-chips` | `PlannerChrome.tsx` | «3D 배치» + 비율 칩 줄 (L181-205) |
| `planner-tabs` | `PlannerChrome.tsx` | «배치 / 환경 / 타임라인» 탭 띠 — `PANEL_TABS.map` 을 싸는 `div` (L236) |
| `planner-viewport` | `CompositionPlanner.tsx` | 3D 화면(`CompositionViewport`)을 싸는 `div` (L700 언저리) |
| `planner-ground-place` | `PlannerChrome.tsx` | «바닥에 세우기» 단추 (L362) |
| `planner-floor-toggle` | `PlannerChrome.tsx` | «바닥면» 단추 (L415) |
| `planner-save` | `PlannerChrome.tsx` | «구도 저장» 단추 (L429) |
| `planner-camera-hint` | `PlannerChrome.tsx` | `CameraHelpHint` — «화면에서 눌러 고르기 · 왼쪽 끌기 회전 …» 안내 (L572) |
| `planner-shot-save` | `ShotBar.tsx` | «지금 구도 저장» 단추 (L92) |
| `planner-camera-fov` | `CameraBar.tsx` | «샷 크기 — 렌즈 화각» 줄 (L72) |
| `planner-camera-speed` | `CameraBar.tsx` | «조작 속도 — 회전·이동·줌» 줄 (L127) |

## 구도잡기 — 배치 탭 (`composition/planner/LayoutPanel.tsx` 외)

포즈 판 둘(`PosePanel.tsx` · `PoseFromImageField.tsx`)은 `planner/` 가 아니라 **한 칸 위 `components/composition/`** 에 있습니다 — 파일 칸에 경로를 그대로 적어 두었습니다.

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `layout-characters` | `LayoutPanel.tsx` | `<PanelSection title="인물">` (L314) |
| `layout-character-fields` | `LayoutPanel.tsx` | 고른 인물의 «인물 이름 · 키 (cm) · 체격» 칸 (L482) |
| `layout-body-color` | `LayoutPanel.tsx` | «몸 색» 줄 (L560) |
| `layout-gizmo-mode` | `GizmoModeRow.tsx` | «수치 입력» 줄 — 이동·회전·크기 / 자유·바닥·높이 (L28) |
| `layout-path` | `LayoutPanel.tsx` | «캐릭터 동선 (N)» 줄 (L664) |
| `layout-objects` | `LayoutPanel.tsx` | `<PanelSection title="소품 · 조명">` (L753) |
| `layout-object-kinds` | `LayoutPanel.tsx` | 벽·박스·구·실린더·핀 조명·LED 조명 2열 단추 grid (L773) |
| `layout-object-group` | `ObjectList.tsx` | «함께 잡은 N개를 한 덩어리로» 단추 (L182) — 여럿 잡았을 때만 뜸 |
| `layout-object-swap` | `LayoutPanel.tsx` | «무엇으로 바꿔 그릴까 — 만들어 둔 시트» 라벨이 든 칸 (L900) |
| `layout-object-asset` | `LayoutPanel.tsx` | «이 소품의 에셋 만들기 — 시트를 뽑아 바로 잇습니다» 단추 (L958) |
| `layout-attach-bone` | `LayoutPanel.tsx` | «인물에 붙이기 — 포즈를 따라 함께 움직입니다» 칸 (L981) |
| `layout-light` | `LayoutPanel.tsx` | 조명 종류(하늘·포인트·스팟·면광)·세기·색 칸 (L1096-1125) |
| `layout-wall-image` | `LayoutPanel.tsx` | «이 벽의 그림» 칸 (L1157) |
| `layout-pose-from-image` | `composition/PoseFromImageField.tsx` | «그림에서 포즈 가져오기» 상자 (L100) |
| `layout-joints` | `composition/PosePanel.tsx` | «관절을 고르면 3D 화면에 기즈모가 붙습니다» 안내가 든 관절 판 (L137) |
| `layout-hands` | `composition/PosePanel.tsx` | «손 모양» 판 — 왼손/오른손 토글 2열 grid (L330); 그 아래 «현재 각도 (Y / Z°)» 표와 «이 손 전체 펴기» (L385-405). 내장 손 프리셋·폄/반/접음은 없습니다 |
| `layout-presets` | `composition/PosePanel.tsx` | «내 프리셋» 제목 줄 (L599) |
| `layout-mocap-cleanup` | `MotionCleanupPanel.tsx` | «모캡 키 다듬기» 판 뿌리 (L124) — 모션을 넣은 인물에서만 뜸 |
| `bone-picker` | `BonePicker.tsx` | 파이 메뉴 뿌리 (L120 «한 걸음 뒤로 / 닫기» 단추가 든 상자) — Tab 을 눌렀을 때만 뜸 |

## 구도잡기 — 환경 탭 (`composition/planner/EnvironmentPanel.tsx` · `RoomList.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `env-room-add-indoor` | `RoomList.tsx` | «실내» 단추 (L114); «실외» (L123) «호리존» (L138) 은 같은 줄 |
| `env-room-list` | `RoomList.tsx` | 방 목록 `div` — 방 이름 줄들을 싸는 것 (L170 언저리) |
| `env-room-size` | `EnvironmentPanel.tsx` | 가로·깊이·층고(또는 반지름) 숫자 칸 줄 (L498-540) |
| `env-room-drift` | `EnvironmentPanel.tsx` | «배경 흐름 — 그림을 흘려 배경을 움직입니다» 체크와 그 아래 방향·속도를 싸는 `div` — 치수 설명 바로 아래. 호리존 방에는 없습니다(그림 대신 색 하나라 흐를 것이 없음) |
| `env-room-video` | `EnvironmentPanel.tsx` | «배경 영상 — 면에 영상을 걸어 실제로 움직입니다» 체크와 그 아래 면 고르기·영상 고르기·«이 면 그림으로 영상 만들기» 를 싸는 `div` — «배경 흐름» 바로 아래. 호리존 방과 프로젝트 밖에서 연 창에는 없습니다 |
| `env-horizon-color` | `EnvironmentPanel.tsx` | «호리존 색» 줄 (L561) — 호리존 방에서만 |
| `env-outdoor-shape` | `EnvironmentPanel.tsx` | «무엇으로 두를까» — 돔/방형 (L625) — 실외 방에서만 |
| `env-occlude-faces` | `EnvironmentPanel.tsx` | «뒤를 가릴 면 — 누른 면만 벽이 됩니다» (L659) — 실내 방에서만 |
| `env-room-make-image` | `EnvironmentPanel.tsx` | «전개도 만들기 / 파노라마 만들기» 단추 (L789) |
| `env-panoramas` | `EnvironmentPanel.tsx` | «파노라마 그림» 접이 머리 (L816) — 실외 방에서만 |
| `env-face-sets` | `EnvironmentPanel.tsx` | «6면 세트» 접이 머리 (L934) — 실내 방에서만 |
| `env-room-props` | `EnvironmentPanel.tsx` | «이 방의 소품» 제목 줄 (L1038) |
| `env-room-library` | `EnvironmentPanel.tsx` | `<PanelSection title="방 라이브러리">` (L256); «장소 라이브러리» 단추는 바로 위 (L245) |
| `env-display` | `EnvironmentPanel.tsx` | `<PanelSection title="화면">` (L333) |
| `env-shadows` | `planner/ShadowPanel.tsx` | 환경 탭의 그림자 판 — 자동 · 접지 그늘 · 방향광 · 끄기, 세기·부드러움 손잡이 |

## 구도잡기 — 타임라인 탭 (`composition/planner/TimelinePanel.tsx` · `MusicSection.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `timeline-music` | `MusicSection.tsx` | `<PanelSection title="노래">` (L127) |
| `timeline-music-pick` | `MusicSection.tsx` | «BGM에서 고르기 — 뽑아 둔 곡» select (L144) 와 «음원 올리기» 단추 (L162) 를 싸는 줄 |
| `timeline-music-sections` | `MusicSection.tsx` | «빠르기 · 마디씩 · 구간 나누기 · N초에서 자르기» 줄 (L231-279) |
| `timeline-mocap-open` | `TimelinePanel.tsx` | «영상 올려서 캐릭터에 모션 입히기» 단추 (L176) |
| `timeline-glb` | `TimelinePanel.tsx` | `<PanelSection title="GLB 애니메이션">` (L186) |
| `timeline-blender-prompt` | `TimelinePanel.tsx` | «블렌더 작업 지시문 만들기» 단추 (L219) |
| `timeline-render` | `TimelinePanel.tsx` | `<PanelSection title="레퍼런스 영상">` (L470) |
| `timeline-render-split` | `TimelinePanel.tsx` | 통째로 · 5초 · … · 노래 N구간 선택 줄 (L490-523) |
| `timeline-render-run` | `TimelinePanel.tsx` | «● 레퍼런스 영상 만들기 (MP4)» 단추 (L572) |
| `timeline-renders-list` | `TimelinePanel.tsx` | «뽑아 둔 영상 N편 — 누르면 이 컷이 그것을 씁니다» 목록 (L586) |

## 구도잡기 — 화면 아래 타임라인 (`composition/planner/MoveTimeline.tsx` · `TimelineRoomRows.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `bottom-timeline` | `MoveTimeline.tsx` | 펼친 판의 뿌리 `div` (L905 언저리, «접기» 단추가 걸친 상자) |
| `bottom-play` | `MoveTimeline.tsx` | «재생 / 멈춤» 단추 — 접힌 줄 (L873) 과 펼친 줄 (L1190) 둘 다 |
| `bottom-collapse` | `MoveTimeline.tsx` | `title="타임라인을 아래로 접기 (Ctrl+Space) …"` 단추 (L927) |
| `bottom-duration` | `MoveTimeline.tsx` | `title="타임라인 총 길이를 정합니다"` 단추 (L1619) |
| `bottom-fps` | `MoveTimeline.tsx` | `title="초당 프레임 수를 정합니다"` 단추 («24f», L1641) |
| `bottom-shot-presets` | `MoveTimeline.tsx` | 무빙 아이콘 가로 줄 — `SHOT_PRESETS.map` 을 싸는 `div.composition-scroll` (L1442) |
| `bottom-clip-start` | `MoveTimeline.tsx` | 클립 왼쪽 «이어서 / 구도 없음» 출발 구도 select (L2210) — 첫 클립 것 |
| `bottom-anchor` | `MoveTimeline.tsx` | 앵커 X/Y/Z · 따라가기 · 손으로 · 「앵커: …」 묶음 (L1220-1410) |
| `bottom-clip-amount` | `MoveTimeline.tsx` | 고른 클립의 «이동량» 칸 (L1804) |
| `bottom-clip-length` | `MoveTimeline.tsx` | 고른 클립의 «길이» 칸 (L1840); «+ 키 전부» 는 그 옆 (L1886) |
| `bottom-axis` | `MoveTimeline.tsx` | «축: 수평/수직/나선» · «앵커 보기» · «앵커 표시» · «손떨림» 묶음 (L1940-2037) |
| `bottom-easing` | `MoveTimeline.tsx` | «속도 그래프» 단추 (L2095) |
| `bottom-layers` | `MoveTimeline.tsx` | «인물 · 소품» 레이어 묶음 — `gutterStyle` 의 「인물 · 소품」 라벨이 든 블록 (L2523) |
| `bottom-room-rows` | `TimelineRoomRows.tsx` | «방 · 가릴 면 · 소품» 라벨(`gutterStyle`)이 든 블록 (L104) |

## 구도잡기 — 영상에서 모션 가져오기 창 (`composition/planner/MotionCaptureDialog.tsx`)

| 앵커 | 파일 | 요소 (줄 힌트) |
| --- | --- | --- |
| `mocap-add-video` | `MotionCaptureDialog.tsx` | «영상 추가» 단추 (L807) |
| `mocap-analyze` | `MotionCaptureDialog.tsx` | «1 · 분석» 제목이 든 블록 (L897) |
| `mocap-cleanup` | `MotionCaptureDialog.tsx` | «2 · 다듬기» 블록 (L1012) — 분석이 끝난 뒤에만 뜸 |
| `mocap-match` | `MotionCaptureDialog.tsx` | «3 · 번호 ↔ 캐릭터 (N명)» 블록 (L1068) — 분석이 끝난 뒤에만 뜸 |
| `mocap-apply` | `MotionCaptureDialog.tsx` | «타임라인에 넣기» 단추 (L1158) |

## 창 안의 자리 — 2026-09-22 에 한 번에 채운 것

기능 점검에서 «설명이 없다» 고 나온 자리들입니다. 창마다 갈래를 하나씩 두었습니다
(`page-image-editor` · `page-sheet` · `page-lineage` · `page-shelf`, 구도잡기는 `planner-*` 다섯).

| 앵커 | 파일 | 요소 |
| --- | --- | --- |
| `sheet-close` | `SheetComposerDialog.tsx` | 머리줄 오른쪽 «닫기» X 단추 — aria-label="닫기" 인 button (X 아이콘) (L620) |
| `sheet-layouts` | `SheetComposerDialog.tsx` | «배치도 (프로젝트 공용 · N)» 제목부터 «새 배치도» 단추까지를 싸는 div.mt-2.space-y-1 (L652) |
| `sheet-size-fields` | `SheetComposerDialog.tsx` | «뽑을 규격 (px)» 의 «가로»·«세로» NumberInput 두 개를 싸는 div.grid.grid-cols-2 (onBlur 로 기준 판을 버리는 그 div) (L755) |
| `sheet-selected` | `SheetComposerDialog.tsx` | «고른 칸» 제목이 든 div.mt-2.space-y-1 (selectedPlacement 가 있을 때만 그려집니다) (L806) |
| `sheet-profile-font` | `SheetComposerDialog.tsx` | «프로필 글자» 블록 — div.mt-2.rounded-md.p-2.5 (fontTarget 이 있을 때만 그려집니다) (L880) |
| `sheet-board` | `SheetComposerDialog.tsx` | 가운데 흰 캔버스 — ref={boardRef} 인 div (background "#ffffff") (L925) |
| `sheet-slot` | `SheetComposerDialog.tsx` | 칸 하나의 뿌리 div — key={placement.id}, className="group absolute cursor-move" (첫 칸만 잡혀도 됩니다) (L967) |
| `sheet-slot-label` | `SheetComposerDialog.tsx` | 칸 이름표와 인라인 입력칸을 싸는 div — className에 "absolute left-0 max-w-full" 이 든 것 (상자 밖 위) (L1041) |
| `sheet-slot-remove` | `SheetComposerDialog.tsx` | 칸 왼쪽 아래 «빼기» 단추 — aria-label="빼기" 인 button (X 아이콘) (L1086) |
| `sheet-actions` | `SheetComposerDialog.tsx` | 보드 아래 단추 줄 — «되돌리기»·«다시 하기»·«… 시트 제작» 을 싸는 div.flex.shrink-0.flex-wrap (L1165) |
| `sheet-source-groups` | `SheetSourcePanel.tsx` | 그룹 머리 단추 — title="접기"/"펼치기", «원본»·«변형 · …»·«보유 에셋» 글자와 오른쪽 개수가 든 줄. 그룹마다 있으니 전부 달아도 됩니다(첫 번째가 잡힙니다) (L131) |
| `sheet-face-set` | `SheetSourcePanel.tsx` | 6면 세트 카드 — title="{세트 이름} — 면 하나를 누르면 그 면이 시트에 놓입니다…" 를 넘기는 <FaceSetCard> 호출. 부품이라 싸는 div 를 하나 두거나, 카드 뿌리(FaceSetCard.tsx:118 의 div.group.relative.shr (L145) |
| `sheet-source-tile` | `SheetSourcePanel.tsx` | 그림 타일 단추 — title="{그림 이름} — 누르면 시트에 놓입니다. 배치된 칸 위로 끌어다 놓으면 그 칸의 그림이 바뀝니다" (className="block w-full cursor-grab active:cursor-grabbing") (L176) |
| `sheet-source-crop` | `SheetSourcePanel.tsx` | 타일의 가위 단추 — aria-label="{그림 이름} 편집 — 자르기·지우기" (Scissors, group-hover 로 뜸) (L225) |
| `cropper-tabs` | `SheetPanelCropper.tsx` | 탭 다섯(«자르기 · 지우기» · «표시하기» · «동선» · «파노라마» · «전개도 6면»)을 싸는 div.flex.gap-1.px-5 — 탭 단추마다 data-tour-open 으로 그 탭에서만 생기는 앵커를 적어 둘 자리이기도 합니다 (L635) |
| `cropper-footer` | `SheetPanelCropper.tsx` | 자르기 탭 아래 띠 div — «닫기» · «지움 뒤에 붙일 말(선택)» · «미리보기 새로 고침» · 저장 단추 (L796) |
| `cropper-surface` | `CropperSurface.tsx` | CropperSurface 뿌리 div — 그리기 면(cursor-crosshair)과 바로 아래 «자르기»/«지우기» 모드 줄, 면 오른쪽 위의 «원본»/«미리보기» 토글까지 한 덩이 (L55) |
| `cropper-undo` | `CropperSurface.tsx` | «되돌리기 Ctrl+Z» 단추(Undo2) — 옆의 «다시 하기 Ctrl+Shift+Z»(L199)는 같은 줄 (L190) |
| `cropper-box-list` | `CropperBoxList.tsx` | 빈 상태 «아직 그린 자리가 없습니다» 상자(L58)와 상자 한 줄(L70) 둘 다에 — 같은 조건에서 하나만 그려집니다 (L63) |
| `cropper-box-row` | `CropperBoxList.tsx` | 저장될 자리 한 줄 — **상자를 하나라도 그려야** 생깁니다. 빈 상태에는 안 붙으므로 걸음의 `until` 이 «그렸는가» 를 이것으로 셉니다 |
| `cropper-upscale` | `CropperSavePanel.tsx` | «업스케일» 판 뿌리 div — «업스케일해서 저장» 체크 · «엔진» 선택 · 2K/4K/6K/8K 네 단추 (L61) |
| `cropper-upscale-now` | `CropperSavePanel.tsx` | «지금 그림 업스케일 — 새 파일로» 단추(ArrowUpFromLine) (L192) |
| `cropper-mark-shapes` | `ImageMarkupEditor.tsx` | 표시하기 탭 도구줄 div.flex.flex-wrap — 앵커 지점 · 사각형 · 원 · 자유선 네 단추, 모양과 따로 켜는 «움직임 구역» 스위치, 안내 문구 (L252) |
| `cropper-motion` | `MotionLines.tsx` | 동선 탭 도구줄 div.flex.flex-wrap — 갈래 select · «구경만 하기»/«자유선»/«직선» · 되돌리기 · «굵기» · «동선 그림 저장» (L272) |
| `cropper-pano-howto` | `PanoramaWorkbench.tsx` | «6면 배경 만드는 법» HowToPanel 을 싸는 div.space-y-2 — HowToPanel 자체는 display:contents 라 속성을 못 받습니다 (L334) |
| `cropper-pano-fix` | `PanoramaWorkbench.tsx` | «이미 등장방형 파노라마 (세로 180도 — 손대지 않음)» 체크 label — 바로 아래 «세로 화각» · «세로 모형» · «지평선 위치» · «이음매 잇기» · «하늘·바닥 채우기» 가 이어집니다 (L341) |
| `cropper-pano-faces` | `PanoramaWorkbench.tsx` | «보정한 파노라마 저장» 과 «여섯 면 만들기» 두 단추를 싸는 div.space-y-1.5.pt-1 — «여섯 면 크기» 와 «작으면 업스케일» 은 바로 위(L423) (L466) |
| `cropper-cross-lines` | `CrossUnfoldWorkbench.tsx` | 전개도 그림 판 div(ref=frameRef) — 보라 세로선 셋 · 하늘색 가로선 넷 · 돋보기 노란 네모가 얹히는 면 (L312) |
| `cropper-cross-tools` | `CrossUnfoldWorkbench.tsx` | 전개도 탭 오른쪽 칸 div.space-y-2.5 — 배율 줄(축소·100%·확대) · 돋보기 캔버스 · «자리 다시 찾기» · «천장·바닥 뒤집기» · «여섯 면으로 저장» (L413) |
| `lineage-card` | `LineageTree.tsx` | 계보 카드 뿌리 div — onDragOver·onDrop 이 달린 `group relative overflow-hidden rounded-xl` (안에 그림 단추와 «이 카드에서 변형» 이 들어 있음). 카드마다 달아도 되고 첫 카드가 잡힙니다 (L276) |
| `lineage-variation-remove` | `LineageTree.tsx` | 변형 카드에만 뜨는 X — aria-label="{변형 이름} 지우기" (마우스를 올려야 보이는 오른쪽 위 단추) (L394) |
| `lineage-sheet-tile` | `EntityLineagePanel.tsx` | 시트 타일 상자 div.group.relative.aspect-square — 안에 크게 보기 그림 · 복사 · 마그니픽으로 · 폴더 열기 · 편집 연필 · 지우기 X 가 모두 들어 있습니다 (L265) |
| `lineage-sheet-name` | `EntityLineagePanel.tsx` | placeholder="이 판의 이름" 입력칸 (시트 타일 바로 아래) (L369) |
| `lineage-alternates` | `AlternateLineage.tsx` | «다른 원본» 상자 뿌리 div.mt-3.rounded-lg.p-3 — 머리줄(L171)·원본 목록·끝의 «캐릭터 생성» 단추를 다 감싸는 것 (L169) |
| `lineage-alternate-name` | `AlternateLineage.tsx` | 원본 이름 줄 div.mb-1.5.flex — placeholder="원본 이름 (예: 어린 시절)" 입력칸과 그 옆 X 를 함께 감싸는 줄 (L194) |
| `lineage-alternate-editor` | `AlternateLineage.tsx` | AlternateRootDialog 의 DialogContent (className={EDITOR_DIALOG}). 같은 자리에 tutorialHolds={`${HOLDS_ENTITY_CARD} lineage-alternate-editor`} 도 함께 달아야 합니다 — (L380) |
| `variation-model` | `VariationDialog.tsx` | title="이 변형 프롬프트를 어느 이미지 모델 문법으로 뽑을지" select. 함께: VariationDialog.tsx:577 의 DialogContent 에 tutorialHolds={HOLDS_VARIATION}(= HOLDS_ENTITY_CARD + " va (L666) |
| `variation-parent-images` | `VariationDialog.tsx` | «… 생성 이미지·레퍼런스 — 클릭해 레퍼런스에 추가» 줄을 감싸는 div.rounded-lg.p-2.5 (타일 스트립 전체). HOLDS_VARIATION 목록에도 같이 적을 것 (L683) |
| `shelf-face-set` | `FaceSetCard.tsx` | 6면 세트 카드 뿌리 — `<div className="group relative shrink-0">` (`title={label}` 이 붙은 바깥 상자, L118-123). 안쪽 3×2 격자가 아니라 이 바깥 상자에 달아야 오른쪽 위 X 와 세트 업스케일 단추까지 함 (L121) |
| `shelf-upscale` | `UpscaleButton.tsx` | «업스케일» 본 단추와 «▾» 를 싸는 `<div ref={anchorRef} className={`${position} …`}>` (L197-200). 메뉴(목표 크기 · 엔진 줄)는 `document.body` 로 포털되어 이 앵커 밖에 뜨므로, 밝힐 자리는 두 단 (L201) |
| `shelf-lightbox-nav` | `ImageLightbox.tsx` | 크게 보기 창 오른쪽의 «다음 (→)» 단추 — `aria-label="다음 (→)"` / `title="다음 (→)"` (ChevronRight, L121-130). 왼쪽의 «이전 (←)»(L111)에는 달지 마세요 — 같은 이름을 둘에 달면 띄우는 쪽이 먼저 나오는 (L126) |
| `shelf-inbox-zoom` | `MagnificInboxPanel.tsx` | 후보 타일 오른쪽 위의 «크게 보기» 단추 — `title="크게 보기"` (ExpandIcon, L298-309). 그림 후보에만 그려지므로(`file.kind === "image"`) 타일마다 달아도 됩니다. (L304) |
| `shelf-import-search` | `MagnificImportDialog.tsx` | «마그니픽에서 가져오기» 창 머리줄의 `placeholder="프롬프트로 찾기"` 입력칸 (L147-158). 바로 옆 «찾기» 단추(L159)와 × 닫기(L169)는 같은 줄이라 함께 밝혀집니다. (L151) |
| `shelf-import-grid` | `MagnificImportDialog.tsx` | 가져오기 창의 결과 타일 격자 — `<div className="grid grid-cols-4 gap-2">` (L196). 타일 하나하나(L198 의 `onClick={() => void take(item)}`)가 아니라 격자 전체에 답니다. (L198) |
| `shelf-video-big` | `CutVideoShelf.tsx` | 영상 큰 화면 아래 줄 — `<div className="flex items-center gap-2">` (L297), 이름 · «대표로 정하기 / 대표에서 내리기»(L315) · «닫기»(L319) 가 든 줄. `{big && (` 안쪽입니다 — 같은 classNam (L297) |
| `bottom-start-shot` | `MoveTimeline.tsx` | «출발: {구도 이름}» 단추 — Crosshair 아이콘이 붙은 하늘색 배지, onClick 은 onSeek(0). baseShot 이 있을 때만 섭니다(저장한 카메라가 없으면 아예 안 보입니다). 바로 오른쪽의 «0.00s / 5.0s» 시각 표시(L1202)는 같 (L1135) |
| `bottom-key-band` | `MoveTimeline.tsx` | «키 N개 잡음 · 풀기» 배지 단추 — onClick 은 setKeyBand([]). keyBand.length > 0 일 때만 섭니다. 바로 왼쪽이 같은 줄의 «끝 뒤 N개» 배지(L1688)라 한 걸음에서 둘을 같이 가리킵니다. (L1703) |
| `bottom-ruler` | `MoveTimeline.tsx` | 눈금자 — ref={trackRef} 인 div. 누르면 onSeek, 누른 채 끌면 스크럽. 재생선(빨간 세로선)과 오각형 머리(L1572)는 pointer-events-none 이라 앵커를 걸 수 없어, 시각을 옮기는 «진짜 손잡이» 인 이 눈금자에 답니다. (L1718) |
| `bottom-free-key` | `MoveTimeline.tsx` | 떠 있는 «자유 경로 · N초 키» 값 판의 뿌리 div({freeKeyEdit && ( 바로 아래) — 안에 «카메라 자리(m)» · «바라보는 곳(m)» 숫자칸과 오른쪽 위 «닫기»(X, L969). 자유 경로 키를 눌러야 생기는 판이라, 키 점을 여는 문으로 삼아 (L954) |
| `timeline-mocap` | `TimelinePanel.tsx` | «영상에서 모션 가져오기» PanelSection 의 머리줄 — L161-165 의 <PanelSection title="영상에서 모션 가져오기" open={openSections.motionCapture ?? true} onToggle={…}> 에 tour="time (L162) |
| `planner-shot-list` | `ShotBar.tsx` | «저장한 카메라» 의 구도 줄 목록 — 이름 단추 · 저장 아이콘 · × 가 한 줄씩 서는 div.composition-scroll.mt-1.5.max-h-[11rem] (L106). 구도가 하나도 없을 때만 그려지는 «아직 없습니다. 구도를 잡고 «지금 구도 저장»  (L104) |
| `layout-group-section` | `LayoutPanel.tsx` | 고른 덩어리의 «덩어리» PanelSection — 색·이름·바꿔 그릴 것·묶음 에셋이 든 카드를 싸는 <section>. 지금 tour 를 안 넘겨 data-tour 가 없습니다 (L840) |
| `layout-pose-section` | `LayoutPanel.tsx` | 고른 인물의 «포즈» PanelSection — 내 프리셋·관절 세부 조정·손 모양을 싸는 <section>. 지금 tour 를 안 넘겨 data-tour 가 없습니다 (L1254) |
| `layout-group-asset` | `ObjectGroupPanel.tsx` | «이 덩어리의 에셋 만들기 — 시트를 뽑아 바로 잇습니다» / «…» 열기 — 시트 뽑기 단추 (onCreateAsset 이 있을 때만 뜸) (L266) |
| `env-room-section` | `EnvironmentPanel.tsx` | «방» PanelSection 머리줄 — `<PanelSection title="방" open onToggle={() => undefined}>` 에 tour="env-room-section" 를 넘깁니다(PanelSection 이 뿌리 <section> 에 data- (L186) |
| `env-gallery-search` | `BackgroundGallery.tsx` | 배경 라이브러리 머리줄의 `placeholder="이름 검색..."` 입력칸. 바로 오른쪽이 `title="닫기"` X(L68)라 말풍선 하나가 둘을 같이 가립니다 — 닫기에는 따로 앵커를 두지 않습니다. (L62) |
| `env-gallery-sources` | `BackgroundGallery.tsx` | «전개도 원본 · 배경 그림» 제목과 그 아래 그리드를 싸는 `div.mt-6` — `{(sources ?? []).filter(...).length > 0 && (` 안쪽 첫 div. 원본이 한 장도 없으면 그려지지 않으므로 그때는 가운데 카드로 물러납니다. (L129) |
| `env-place-remove` | `StepBackgrounds.tsx` | BackgroundCard 머리줄의 휴지통 `<button aria-label="지우기">`(aria-label 은 L628). 구도잡기에서는 RoomPlaceDialog 가 이 카드를 창으로 띄웁니다 — 같은 단추가 씬 탭 장소 목록·장소 라이브러리 창에도 그대로 서 (L628) |
| `env-room-borrow` | `BorrowCardsDialog.tsx` | «다른 작품에서 방 끌어오기» 창의 방 줄 `<button>` — `rooms.map` 안, ✓ 와 «이름 · 작품 · 소품 N개 · 걸린 면 N장» 이 든 줄. kind === "room" 일 때만 그려지므로 구도잡기에서만 뜹니다. 줄마다 달아도 되고, 띄우는 쪽이  (L229) |
| `mocap-sources` | `MotionCaptureDialog.tsx` | 왼쪽 «영상 N개» 열의 감싸개 <div className="space-y-1.5"> — 영상 줄들과 «영상 추가» 단추(mocap-add-video)를 품습니다 (L722) |
| `mocap-preview` | `MotionCaptureDialog.tsx` | 가운데 미리보기 열의 감싸개 <div className="min-w-0 space-y-2"> — video + 뼈대 캔버스 + «재생 / 멈춤» + 재생 위치 막대 + 시간 표시 (L826) |
| `mocap-close` | `MotionCaptureDialog.tsx` | 머리줄 오른쪽 끝 × 단추 (onClick={onClose}, X 아이콘만 든 button) (L700) |
| `cut-special-background` | `CutCard.tsx` | 컷 머리줄 «특수 배경» 단추 — 도면·동선·사람 크기 기준을 뽑는 장소 카드를 엽니다 |
| `layout-mannequins` | `LayoutPanel.tsx` | «+ 남성형» «+ 여성형» 두 단추를 싸는 2열 grid |
| `image-actions` | `ImageActions.tsx` | 그림 모서리 아이콘 묶음(복사 · 빼기 · 폴더 열기 · 마그니픽 · 가위 · 정체성 기준)을 싸는 `div.pointer-events-auto.contents` |
| `cropper-mark-made` | `ImageMarkupEditor.tsx` | 표시를 하나라도 찍어야 생기는 줄(이름 칸 · «표시한 그림 저장» · «복사» · «마지막 표시 취소», 움직임 구역을 그렸으면 «움직임 마스크 저장» 도) — 걸음의 `until` 이 이것이 생기기를 기다립니다 |
