/** 이 창은 튜토리얼이 닫지 않습니다. 확인 창처럼 튜토리얼 자신이 띄우는 것에 씁니다. */
export const ALWAYS_KEEP = "*";

/*
  **창마다 «내가 품은 것».** 딸린 것이 없는 파일이라, 누구든 읽어도 동그라미가 생기지 않습니다.

  사용자 2026-09-22 에 같은 고장이 거듭났습니다 — 「구도잡기 자동으로 안열리네」 「이미지 편집 화면으로
  자동으로 들어가야지」. 그때마다 «앵커 이름이 card- 로 시작하면 카드를 연다» 처럼 **이름 앞머리로
  짐작**하고 있었던 것이 원인입니다. 새 앵커가 다른 이름으로 생기면 그 짐작에서 새어 나갑니다.

  그래서 판단의 근거를 목록 하나로 모읍니다. 창을 열지 닫을지(`tutorialStore.cardWantFor`)도,
  창이 스스로 물러날지(`useTutorialPanel`)도 전부 이 목록을 봅니다.
*/

/* ── 창마다 «내가 품은 것» ────────────────────────────────────────────────────

   한 곳에 모아 둡니다. 창 쪽에 흩어 적으면 앵커를 하나 더할 때 어느 창의 목록에 넣어야 하는지
   알 수 없고, 빠뜨려도 읽어서는 못 찾습니다(이 저장소에서 반복해 터진 모양입니다).
   `tutorials.test.ts` 가 여기 이름이 전부 ANCHORS.md 표에 있는지 셉니다.                        */

/**
 * 인물·배경·에셋 카드 창 — 프롬프트 카드 몸통이 품은 자리 전부.
 *
 * 아래에서 `HOLDS_CROPPER` 를 덧붙입니다(선언 순서 때문에 파일 끝에서). 가위 창은 **카드 안의
 * 그림**에서 열리므로, 가위를 보는 걸음에서 카드가 닫히면 그 아래 가위까지 함께 사라집니다.
 */
/** 그림 편집 창(가위) — 탭 다섯이 품은 자리 전부. */
export const HOLDS_CROPPER =
  "cropper-tabs cropper-surface cropper-undo cropper-box-list cropper-box-row cropper-upscale cropper-upscale-now " +
  "cropper-footer cropper-mark-shapes cropper-mark-made cropper-motion " +
  "cropper-pano-howto cropper-pano-fix cropper-pano-faces cropper-cross-lines cropper-cross-tools";

const HOLDS_ENTITY_CARD_OWN =
  "card-references card-basics card-analysis card-profile card-blueprint card-prompt-write " +
  "card-first-reference card-compose card-local-generate card-generated-images card-image-crop " +
  // 그림 위 모서리 아이콘(복사·빼기·폴더·마그니픽·가위·정체성 기준)도 카드 안의 그림에 붙습니다.
  "image-actions";

/** 카드 창은 그 안에서 여는 가위 창까지 품습니다 — 가위는 카드 안의 그림에 붙어 있습니다. */
export const HOLDS_ENTITY_CARD = `${HOLDS_ENTITY_CARD_OWN} ${HOLDS_CROPPER}`;

/**
 * 변형 시트 창 — 카드 몸통이 그대로 들어오고, 창 제 것으로 «모델 문법» 과 «부모 그림 줄» 이 더 있습니다.
 *
 * `HOLDS_ENTITY_CARD` 를 따로 적지 않고 이어 붙이는 까닭: 변형 창은 원본 카드와 **같은 몸통**
 * (`PromptCardBody`)을 그립니다. 두 벌로 적어 두면 카드 자리를 하나 더할 때 한쪽만 고쳐
 * 「원본에서는 밝혀지는데 변형에서만 창이 닫힌다」 가 됩니다(규칙 1 과 같은 모양의 사고).
 */
export const HOLDS_VARIATION = `${HOLDS_ENTITY_CARD} variation-model variation-parent-images lineage-alternate-editor`;

/** AI 로 일괄 생성 창. */
export const HOLDS_BOOTSTRAP = "bootstrap-scenario bootstrap-mode bootstrap-run";

/** 영상에서 모션 가져오기 창. */
export const HOLDS_MOCAP =
  "mocap-add-video mocap-analyze mocap-cleanup mocap-match mocap-apply " +
  "mocap-sources mocap-preview mocap-close";

/**
 * 구도잡기 창 — 안에 있는 자리가 가장 많습니다.
 *
 * 모캡 창의 자리까지 넣는 까닭 — 그 창은 구도잡기 **안**에서 뜹니다. 빼면 모캡 걸음에 이르는 순간
 * 구도잡기가 «내 것이 아니네» 하며 닫혀, 그 안의 모캡 창까지 함께 사라집니다.
 */
export const HOLDS_PLANNER = [
  "planner-header planner-undo planner-ratio-chips planner-tabs planner-viewport planner-ground-place",
  "planner-floor-toggle planner-save planner-camera-hint planner-shot-save planner-camera-fov planner-camera-speed",
  "layout-characters layout-character-fields layout-body-color layout-gizmo-mode layout-path layout-objects",
  "layout-object-kinds layout-object-group layout-object-swap layout-object-asset layout-attach-bone layout-light",
  "layout-wall-image layout-pose-from-image layout-joints layout-hands layout-presets layout-mocap-cleanup bone-picker",
  "env-room-add-indoor env-room-list env-room-size env-room-drift env-room-video env-horizon-color env-outdoor-shape env-occlude-faces",
  "env-room-make-image env-panoramas env-face-sets env-room-props env-room-library env-display env-shadows",
  "timeline-music timeline-music-pick timeline-music-sections timeline-mocap-open timeline-glb",
  "timeline-blender-prompt timeline-render timeline-render-split timeline-render-run timeline-renders-list",
  "bottom-timeline bottom-play bottom-collapse bottom-duration bottom-fps bottom-shot-presets",
  "bottom-clip-start bottom-anchor bottom-clip-amount bottom-clip-length bottom-axis bottom-easing",
  "bottom-layers bottom-room-rows bottom-start-shot bottom-key-band bottom-ruler bottom-free-key",
  "planner-shot-list layout-group-section layout-pose-section layout-group-asset layout-mannequins",
  "env-room-section env-gallery-search env-gallery-sources env-place-remove env-room-borrow timeline-mocap",
  HOLDS_MOCAP,
  // 장소 라이브러리 창은 구도잡기 **안**에서 뜹니다 — 빼면 그 걸음에 이르는 순간 구도잡기가
  // 「내 것이 아니네」 하며 닫혀, 그 안의 장소 카드와 가위까지 함께 사라집니다(모캡과 같은 사정).
  HOLDS_ENTITY_CARD,
].join(" ");

/**
 * **제자리에서 펴지는 것들** — 덮는 창이 아니라 그 자리에서 열립니다.
 *
 * 컷 카드를 펴는 것, 곡을 고르는 것, 인물이나 소품을 고르는 것. 문(단추)에 «열면 생긴다» 고
 * 적어 두지만, **닫을 창이 없습니다** — 화면을 덮지 않으니 다른 걸음을 가리는 일도 없습니다.
 *
 * 여기 적어 두는 까닭은 시험 때문입니다. 「여는 문이 부르는 이름은 품은 창에도 있어야 한다」 는
 * 규칙이 이것들에는 안 맞습니다. 그냥 빼면 «빠뜨린 것» 과 «원래 없는 것» 이 구분되지 않으므로,
 * 원래 없는 쪽을 여기 적어 둡니다 — 새 문을 달 때 둘 중 어디에 넣을지 한 번 생각하게 됩니다.
 */
export const INLINE_REVEAL = [
  // 컷 카드를 펴면 그 자리에서 아래로 늘어납니다.
  "cut-frame cut-switches cut-summary cut-refs cut-style-toggles cut-dialogue cut-background-motion",
  "cut-prompt-section cut-prompt-write cut-video-section cut-video-prompt cut-ref-video-list",
  // 곡을 고르면 오른쪽에 편집기가 붙습니다.
  "bgm-chips bgm-tempo-length bgm-tool bgm-instrumental bgm-write bgm-style-panels",
  "bgm-history bgm-local-generate bgm-tracks-list",
  // 인물·소품을 고르면 그 아래에 칸이 생깁니다(구도잡기 배치 탭 안).
  "layout-character-fields layout-body-color layout-gizmo-mode layout-path layout-pose-from-image",
  "layout-joints layout-hands layout-presets",
  "layout-light layout-object-swap layout-object-asset layout-attach-bone layout-object-group",
].join(" ");



/**
 * **그림 선반에서 여는 작은 창 둘** — «크게 보기»(라이트박스)와 마그니픽 «가져오기».
 *
 * 이 둘은 썸네일이나 «가져오기» 를
 * 눌러야 뜨는데 여는 문이 어디에도 안 적혀 있어, 그 걸음에서 안내 창이 «자리가 없습니다» 만
 * 띄우고 정작 그 단추까지 막고 있었습니다.
 */
export const HOLDS_LIGHTBOX = "shelf-lightbox-nav shelf-inbox-zoom";
export const HOLDS_MAGNIFIC_IMPORT = "shelf-import-search shelf-import-grid";

/** 시트 합성 창. */
export const HOLDS_SHEET =
  "sheet-close sheet-source-groups sheet-source-tile sheet-face-set sheet-source-crop sheet-layouts " +
  "sheet-size-fields sheet-board sheet-slot sheet-slot-label sheet-slot-remove sheet-selected " +
  "sheet-profile-font sheet-actions";

/** 변형 창 · 다른 원본 편집기. 계보 카드 자체는 창이 아니라 페이지 위에 있습니다. */
