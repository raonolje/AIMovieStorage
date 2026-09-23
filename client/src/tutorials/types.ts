/*
  튜토리얼 자료의 모양.

  «무엇을 보여 줄까» 만 여기 둡니다. 화면에 어떻게 띄울지(말풍선·가운데 카드·다음 단추)는
  띄우는 쪽의 일입니다.

  언어는 자료를 갈아 끼우지 않습니다 — 여기 적힌 **한국어 문장이 그대로 사전의 열쇠**이고,
  띄우는 쪽이 보여 주는 순간 `t(step.body)` 로 지금 언어의 번역을 찾습니다(`lib/i18n.ts`).
  그래서 걸음 하나를 고치면 이 파일 한 곳과 `locales/{en,ja,zh}.json` 의 그 열쇠 세 곳이
  함께 바뀌어야 하고, 빠뜨리면 그 걸음만 한국어로 뜹니다. 읽어서는 못 찾는 어긋남이라
  `tutorials.test.ts` 가 모든 제목·요약·본문·해 볼 것·까닭에 세 언어 번역이 있는지 셉니다.

  `anchor` 는 화면 요소에 붙을 `data-tour="…"` 값입니다. 어느 요소에 붙는지는
  `ANCHORS.md` 표가 정합니다. 앵커가 없는 걸음은 화면 한가운데 카드로 띄웁니다.
*/

/**
 * 이 걸음을 **무엇으로 넘기는가.**
 *
 *
 * 읽고 «다음» 을 누르는 안내문이 아니라, **시킨 것을 실제로 해야** 넘어갑니다.
 *
 * - `click` — 밝혀 둔 자리를 누르면 넘어갑니다.
 * - `input` — 그 칸에 글자가 들어가면 넘어갑니다.
 * - `manual` — 설명만 하는 걸음. «다음» 으로 넘깁니다.
 *
 * 안 적으면 `action` 문구와 앵커로 짐작합니다(`stepAdvanceMode`) — 걸음 210개에 일일이 적지 않으려고
 * 그렇게 뒀습니다. 짐작이 틀리는 걸음에만 적어 주면 됩니다.
 */
export type TutorialAdvance = "click" | "input" | "manual";

/** 이 걸음이 서는 화면의 주소. */
export type TutorialRoute = "/" | "/settings" | "/new-project" | "/bgm" | "/project/:id";

/**
 * 이 걸음이 서는 화면(탭).
 * `/project/:id` 는 네 단계를 한 주소로 쓰므로 주소만으로는 어느 단계인지 모릅니다 —
 * 그래서 단계 이름을 따로 둡니다. `planner` 는 컷 카드에서 여는 구도잡기 창입니다.
 */
export type TutorialPage =
  | "projects"
  | "basics"
  | "characters"
  | "scenes"
  | "finish"
  | "settings"
  | "bgm"
  | "planner";

export interface TutorialStep {
  /** 모든 튜토리얼을 통틀어 하나뿐인 이름. «어디까지 봤나» 를 이 이름으로 적어 둡니다. */
  id: string;
  route?: TutorialRoute;
  page?: TutorialPage;
  /** 화면 요소의 `data-tour` 값. 없으면 가운데 카드. */
  anchor?: string;
  title: string;
  /** 두서너 문장. 처음 쓰는 사람에게 하는 말입니다. */
  body: string;
  /** 「해 볼 것: …」 — 지금 눌러 볼 것. */
  action?: string;
  /** 무엇으로 넘어가는가. 안 적으면 `action` 과 앵커로 짐작합니다. */
  advanceOn?: TutorialAdvance;
  /**
   * **이 자리가 생겨야 넘어갑니다.** `data-tour` 이름을 적습니다.
   *
   *
   * «그림 위를 끌어 표시해 보세요» 같은 걸음은 누르는 것이 아니라 **그리는 것**이라 클릭으로는
   * 셀 수 없습니다. 대신 «그리면 생기는 것»(표시 목록·저장 줄)을 적어 두고, 그것이 화면에
   * 나타나면 넘깁니다. 그 전에는 «다음» 이 잠깁니다 — 다만 «건너뛰기» 는 늘 열려 있습니다.
   */
  until?: string;
  /** 왜 이렇게 되어 있는가. 있으면 카드 아래에 작게. */
  why?: string;
}

export type TutorialKind = "full" | "page" | "planner";

export interface Tutorial {
  id: string;
  kind: TutorialKind;
  title: string;
  summary: string;
  /** 이 튜토리얼이 속한 화면. «작업하다 막혔을 때» 그 화면의 것만 골라 보여 주려고 둡니다. */
  page?: TutorialPage;
  /**
   * **여러 화면에서 열리는 갈래**는 여기에 화면을 죽 적습니다.
   *
   * 가위(이미지 편집)·시트 합성·
   * 계보·생성 결과 선반은 캐릭터에만 있는 것이 아니라 장소·에셋·컷 어디서나 같은 창이 열립니다
   * (규칙 1). 그런데 갈래가 화면 하나만 가리키고 있어서, 씬 구성에서 목록을 열면 «이 페이지 기능»
   * 에 안 떴습니다 — 기능은 있는데 설명이 없는 것처럼 보였습니다.
   */
  pages?: TutorialPage[];
  steps: TutorialStep[];
}
