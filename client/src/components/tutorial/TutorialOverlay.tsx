import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { BookOpen, ChevronDown, ChevronUp, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { isTypingTarget } from "@/lib/isTypingTarget";
import { confirmDialog } from "@/components/ConfirmDialog";
import { listLocalProjects } from "@/lib/localProjectStore";
import { ensureTutorialSample } from "@/lib/tutorialSample";
import {
  PROJECT_STEP_PAGES,
  autoStartTutorial,
  cardWantFor,
  cutWantFor,
  closeTutorial,
  nextStep,
  prevStep,
  requestTutorialCard,
  requestTutorialCut,
  requestTutorialPage,
  routeMatches,
  useTutorial,
} from "@/lib/tutorialStore";
import {
  stepAdvanceMode,
  tutorialById,
  type Tutorial,
  type TutorialStep,
} from "@/tutorials";

/**
 * **안내 창** — 지금 걸음의 자리를 화면에서 찾아 그 둘레만 밝히고, 옆에 카드를 붙입니다.
 *
 * 앱 뿌리(`App`)에 하나만 둡니다. 걸음이 다른 화면에 있으면 먼저 그 주소로 가고, 프로젝트 껍데기의
 * 단계(주제 설정·캐릭터·씬 구성·확인)면 껍데기에 그 단계를 열어 달라고 부탁합니다.
 *
 * # 어둡게 덮되 막지 않습니다
 *
 * 걸음마다 「해 볼 것: «설정» 을 누르세요」 처럼 **직접 눌러 보라** 고 시킵니다. 덮개가 클릭을 삼키면
 * 시키는 대로 할 수가 없습니다. 그래서 어두운 층은 `pointer-events: none` 이고, 밝은 구멍은 자리
 * 요소 위에 얹은 상자의 그림자(`box-shadow` 9999px)로 만듭니다 — 판 네 장으로 두르는 것보다 요소가
 * 움직일 때 따라가기가 쉽습니다.
 *
 * # 자리를 못 찾으면
 *
 * 구도잡기 창이 안 열려 있거나 목록이 비어 있으면 `data-tour` 요소가 없습니다. 그때는 가운데 카드로
 * 물러나 «그 화면을 열면 표시됩니다» 라고 적고 «다음» 은 그대로 둡니다 — 여기서 막히면 튜토리얼을
 * 끝까지 못 갑니다. 요소는 계속 다시 찾습니다(DOM 바뀜 · 크기 바뀜 · 스크롤 · 0.4초마다) —
 * 사람이 안내대로 창을 열면 그 순간 카드가 그리로 옮겨 갑니다.
 */
export default function TutorialOverlay() {
  const { enabled, active } = useTutorial();

  // 앱을 켠 뒤 한 번 — 한 바퀴를 본 적이 없으면 저절로 시작합니다.
  useEffect(() => {
    autoStartTutorial();
  }, []);

  const tutorial = active ? tutorialById(active.tutorialId) : undefined;
  const step = tutorial && active ? tutorial.steps[active.stepIndex] : undefined;
  if (!enabled || !tutorial || !step || !active) return null;

  /*
    **걸음이 바뀌어도 갈아 끼우지 않습니다.**

    

    예전에는 `key={step.id}` 로 걸음마다 통째로 새로 만들었습니다. 그러면 잰 자리가 함께 버려져
    다음 걸음이 «자리 없음»(화면 전체 덮개)부터 시작하고, React 가 그 덮개 div 를 밝은 상자로
    **재사용**하면서 `inset-0`(0,0)에서 목적지까지 미끄러졌습니다. 걸음마다 왼쪽 위에서 상자가
    날아오는 꼴입니다.

    이제 한 번 만들어 두고 걸음만 갈아 끼웁니다 — 잰 자리가 남아 있으니 상자가 **이전 자리에서**
    새 자리로 미끄러집니다. 걸음마다 새로 해야 하는 것(«왜?» 펼침·스크롤·접이식 폈는지)은
    `ActiveStep` 안에서 `step.id` 가 바뀔 때 손수 되돌립니다.
  */
  return <ActiveStep tutorial={tutorial} step={step} index={active.stepIndex} />;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function sameBox(a: Box, b: Box): boolean {
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * 문에 적힌 이름 — 「먼저 «…» 을 누르세요」 에 넣을 글자.
 *
 * 화면에 보이는 글자를 그대로 씁니다. 사람이 찾을 것은 코드의 이름이 아니라 단추에 적힌 말입니다.
 * 아이콘만 있는 단추는 `title`·`aria-label` 에 이름이 들어 있습니다.
 */
function labelOf(element: HTMLElement): string {
  /*
    **적어 둔 이름이 먼저입니다.** 사용자 2026-09-22 에 문 이름이 「@keyframes sp-dolly { 0%…」 로
    떴습니다 — 무빙 아이콘 안에 `<style>` 이 들어 있어 `textContent` 가 그 CSS 까지 긁어 온 탓입니다.
    그래서 `title`·`aria-label` 을 먼저 보고, 글자를 읽을 때는 style·script 를 뺀 것만 셉니다.
  */
  const said = element.getAttribute("aria-label") || element.getAttribute("title");
  if (said) return said.length > 24 ? `${said.slice(0, 24)}…` : said;
  const copy = element.cloneNode(true) as HTMLElement;
  for (const junk of copy.querySelectorAll("style, script")) junk.remove();
  const text = (copy.textContent || "").replace(/\s+/g, " ").trim();
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

/**
 * 걸음의 주소로 갈 실제 주소.
 *
 * `/project/:id` 는 «어느 작품인지» 가 없습니다. 프로젝트 화면 밖에서 그 걸음에 이르면
 * **연습용 예시 작품**을 엽니다 — 없으면 그 자리에서 만듭니다.
 *
 *
 * 「이미지가 등록된게 없으니까...시트에서 칸 잘라내기 같은 경우 볼 수가 없잖아」.
 * 예전에는 «가장 최근에 고친 작품» 을 열었는데, 그것이 갓 만든 빈 작품이면 가위도 시트도 뽑은
 * 그림도 없어 걸음 절반이 「자리가 지금 화면에 없습니다」 로 헛돌았습니다.
 *
 * 이미 프로젝트 안에서 튜토리얼을 열었으면 여기 오지 않습니다(`routeMatches` 가 먼저 참) —
 * 일하던 작품에서 끌어내지 않습니다.
 */
async function projectTarget(): Promise<string> {
  try {
    return `/project/${await ensureTutorialSample()}`;
  } catch {
    // 저장 폴더가 아직 없으면 예시를 못 만듭니다. 그때는 손에 있는 작품이라도.
    const latest = listLocalProjects()[0];
    return latest ? `/project/${latest.id}` : "/new-project";
  }
}

function ActiveStep({ tutorial, step, index }: { tutorial: Tutorial; step: TutorialStep; index: number }) {
  const t = useT();
  const [location, navigate] = useLocation();
  const [rect, setRect] = useState<Box | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState({ w: 384, h: 240 });
  /** 이 걸음에서 화면을 끌어온 횟수. 세 번까지만 — 매번 끌면 사람이 스크롤을 못 합니다. */
  const pulls = useRef(0);
  /** 지금 «보이게» 표시해 둔 요소. 걸음이 바뀌면 떼어 줘야 원래대로 숨습니다. */
  const lit = useRef<Element | null>(null);
  /** 이 걸음에서 이미 눌러 본 문들. 같은 것을 두 번 누르면 도로 접힙니다. */
  const clicked = useRef(new Set<HTMLElement>());
  /** 자리가 문 뒤에 있을 때, 그 문에 적힌 이름. 없으면 문이 없다는 뜻입니다. */
  const [doorLabel, setDoorLabel] = useState<string | null>(null);
  /** `until` 을 적어 둔 걸음에서, 기다리던 자리가 생겼는가. */
  const [made, setMade] = useState(false);

  /*
    **끝낼 때 한 번 묻습니다.**

    «건너뛰기» 와 X 는 안내 카드의 단추 두 개 중 둘이라 손이 미끄러지기 쉽습니다. 게다가 끝내는 것은
    «봤음» 으로 기록되어 처음 켤 때 저절로 뜨는 한 바퀴가 다시는 안 뜹니다 — 되돌리려면 설정까지
    가야 합니다. 한 번 묻는 값은 그만합니다.
  */
  const askThenClose = () => {
    void confirmDialog({
      title: t("튜토리얼을 끝낼까요?"),
      description: t(
        "지금 걸음까지 본 것으로 기록됩니다. 다시 보려면 위 띠의 «튜토리얼» 에서 고르거나, 설정에서 «처음부터 다시 보기» 를 누르세요.",
      ),
      confirmLabel: t("끝내기"),
      cancelLabel: t("계속하기"),
    }).then((yes) => {
      if (yes) closeTutorial();
    });
  };

  // ── 0. 걸음이 바뀌면 걸음별 상태만 되돌립니다(자리는 남겨 둡니다 — 위 주석) ──
  useEffect(() => {
    setShowWhy(false);
    setDoorLabel(null);
    setMade(false);
    pulls.current = 0;
    clicked.current = new Set();
  }, [step.id]);

  // ── 1. 다른 화면의 걸음이면 그 주소로 — 걸음이 켜질 때 **한 번만** ─────────
  // 주소가 바뀔 때마다 다시 보내면 안 됩니다. 「해 볼 것: «설정» 을 누르세요」 걸음은 프로젝트 보드에
  // 서 있는데, 사람이 시키는 대로 «설정» 을 누르는 순간 도로 보드로 끌려와 시키는 것을 할 수 없습니다.
  useEffect(() => {
    if (!step.route || routeMatches(step.route, location)) return;
    if (step.route !== "/project/:id") {
      navigate(step.route);
      return;
    }
    // 예시 작품을 만드는 동안 잠깐 걸립니다(그림 넉 장 복사). 그 사이 걸음이 바뀌면 버립니다.
    let alive = true;
    void projectTarget().then((path) => {
      if (alive) navigate(path);
    });
    return () => {
      alive = false;
    };
    // 걸음이 바뀔 때만 — 주소가 바뀔 때마다 다시 보내면 시키는 것을 할 수 없습니다(위 주석).
  }, [step.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
    ── 2.5 인물 카드 창을 이 걸음에 맞춰 열거나 닫아 달라고 ──────────────────
    

    캐릭터 걸음은 카드 창 «안» 과 그 아래 «패널» 두 층에 걸쳐 있는데, 창을 사람이 손으로 맞춰야
    했습니다. 창이 덮고 있으면 «캐릭터 시트 제작» 이 안 보이고, 닫혀 있으면 «가위» 가 없습니다.
    어느 쪽인지는 앵커 이름이 이미 말해 줍니다(`cardWantFor`).

    걸음이 바뀔 때마다 부탁하는 까닭 — 사람이 도중에 창을 닫아 버릴 수 있고, 페이지가 다시 그려지면
    앞의 부탁은 아무도 못 들었습니다.
  */
  useEffect(() => {
    if (step.page === "characters") {
      const want = cardWantFor(step.anchor);
      if (want) requestTutorialCard(want);
      return;
    }
    // 씬 구성도 같은 사정 — `cut-…` 자리는 컷을 펴야 생깁니다.
    // 장소 카드는 부탁을 받지 않고 제가 걸음을 봅니다(`StepBackgrounds`) — 그 창이
    // 구도잡기 안에서 뒤늦게 태어나 부탁을 못 듣기 때문입니다.
    if (step.page === "scenes" && cutWantFor(step.anchor)) requestTutorialCut();
  }, [step.page, step.anchor, location]);

  // ── 2. 프로젝트 껍데기의 단계면 그 단계를 열어 달라고 ─────────────────────
  // 주소가 바뀐 뒤에도 다시 부탁합니다 — 껍데기가 새로 그려지면 앞의 부탁은 아무도 못 들었습니다.
  useEffect(() => {
    if (!step.page || !routeMatches("/project/:id", location)) return;
    if (PROJECT_STEP_PAGES.includes(step.page)) {
      requestTutorialPage(step.page);
      return;
    }
    /*
      **구도잡기 걸음이면 먼저 씬 구성으로.**

      구도잡기는 네 단계 중 하나가 아니라 **컷 카드에서 여는 창**입니다. 그래서 «그 단계를 열어 줘»
      라고 부탁할 데가 없고, 확인 단계에 서 있으면 구도잡기를 여는 «구도잡기» 단추조차 화면에
      없었습니다. 씬 구성으로 먼저 보내면 컷 카드가 서고, 그 머리줄의 문을 안내 창이 찾아 엽니다.
    */
    if (step.page === "planner") requestTutorialPage("scenes");
  }, [step.page, location]);

  /*
    ── 시킨 것을 **실제로 해야** 넘어갑니다 ──────────────────────────────────
    「이건 그냥 설명이잖아」.

    밝혀 둔 자리를 진짜로 누르거나(누르기 걸음), 그 칸에 글자가 들어가면(적기 걸음) 저절로 다음으로
    갑니다. 듣는 자리는 **문서 전체**이고 그 안에 앵커가 들어 있는지만 봅니다 — 단추가 다시 그려지거나
    안쪽 아이콘을 눌러도 놓치지 않으려는 것입니다. 잡는 단계(capture)에서 듣되 **막지는 않습니다**:
    눌린 것은 그대로 제 일을 해야 튜토리얼이 «따라하기» 가 됩니다.

    막히면 못 빠져나오는 일이 없게 «건너뛰고 다음» 은 늘 함께 둡니다.
  */
  const advance = stepAdvanceMode(step);
  useEffect(() => {
    if (!step.anchor || advance === "manual") return;
    const selector = `[data-tour="${step.anchor}"]`;
    const inAnchor = (target: EventTarget | null) =>
      target instanceof Node && Boolean((target as Element).closest?.(selector) ?? null);
    const onClick = (event: MouseEvent) => {
      if (advance !== "click" || !inAnchor(event.target)) return;
      /*
        **고르는 묶음에서는 안 넘어갑니다.**

        자리가 단추 하나면 «그것을 누르면 다음» 이 맞습니다. 그런데 «앵커 지점 · 사각형 · 원 ·
        자유선» 처럼 **고르는 줄 전체**를 가리키는 자리도 있습니다. 거기서는 모양을 바꿔 보는 것이
        정상인데, 아무거나 누르면 넘어가 버려 정작 시킨 일을 해 보지도 못하고 다음으로 갔습니다.

        그래서 자리 안에 누를 수 있는 것이 둘 이상이면 «고르는 묶음» 으로 보고 «다음» 으로만
        넘깁니다. 걸음마다 따로 적지 않아도 화면 모양으로 저절로 갈립니다.
      */
      const spot = (event.target as Element).closest(selector);
      const controls = spot?.querySelectorAll("button, [role='button'], a, select") ?? [];
      if (controls.length > 1) return;
      // 누른 것이 제 일을 마친 뒤에 넘깁니다 — 화면이 바뀌는 중에 걸음을 바꾸면 다음 자리를 못 찾습니다.
      window.setTimeout(() => nextStep(), 220);
    };
    const onInput = (event: Event) => {
      if (advance !== "input" || !inAnchor(event.target)) return;
      const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value ?? "";
      if (value.trim().length >= 2) window.setTimeout(() => nextStep(), 400);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onInput, true);
    };
  }, [step.anchor, advance, nextStep]);

  /*
    ── 굳어 버린 «아무것도 못 누름» 풀기 ─────────────────────────────────────
    

    Radix 모달(구도잡기 창 · 확인 창 · 프롬프트 창)은 열려 있는 동안 **body 에
    `pointer-events: none`** 을 겁니다. 창 둘이 겹쳐 뜨거나 빠르게 닫히면 닫은 쪽이 그것을
    지우지 못하고 남습니다 — 그러면 화면 전체가 안 눌리고, 시킨 것을 할 수도 «다음» 을 누를
    수도 없어 튜토리얼에 갇힙니다.

    열려 있는 모달이 **하나도 없을 때만** 풉니다. 구도잡기 갈래는 창 안에서 도니까
    열려 있는 창의 것까지 건드리면 안 됩니다.
  */
  useEffect(() => {
    const repair = () => {
      if (document.body.style.pointerEvents !== "none") return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      document.body.style.removeProperty("pointer-events");
    };
    repair();
    const timer = window.setInterval(repair, 500);
    return () => window.clearInterval(timer);
  }, []);

  /*
    ── **밝혀 둔 자리 말고는 안 눌립니다** ───────────────────────────────────
    

    맞는 지적입니다. 걸음이 «이 자리를 누르세요» 라고 해 둔 동안 다른 단추가 눌리면 화면이 엉뚱한
    데로 가고, 그때부터 남은 걸음이 전부 어긋납니다 — 지금까지 «자리가 없습니다» 로 보였던 것의
    상당수가 그것이었습니다.

    그래서 도는 동안에는 **네 가지만** 받습니다: 지금 밝혀 둔 자리, 그 걸음의 앵커, 안내 카드와
    메뉴 판, 그리고 튜토리얼이 띄운 확인·프롬프트 창(`data-tutorial-layer`).

    튜토리얼이 스스로 누르는 것(문 열기)은 `isTrusted` 가 거짓이라 그대로 지나갑니다. 사람이
    누른 것만 막습니다. 갇히지 않게 «건너뛰기» 는 안내 카드 안에 있어 늘 눌립니다.
  */
  /*
    **갇히지 않게.**

    가리킬 자리도 못 찾고 눌러 줄 문도 없으면, 막기만 남습니다 — 안내 창은 「그 화면을 열면
    표시됩니다」 라고 적어 놓고 정작 그 화면을 여는 단추까지 막아 버린 꼴입니다. 그래서 **길을 잃은
    동안에는 아무것도 막지 않습니다.** 손으로 찾아갈 수 있어야 합니다.
  */
  const stranded = Boolean(step.anchor) && !rect && !doorLabel;

  useEffect(() => {
    const allowed = (target: EventTarget | null) => {
      if (stranded) return true;
      if (!(target instanceof Element)) return true;
      if (target.closest("[data-tutorial-layer]")) return true;
      if (target.closest("[data-tutorial-lit]")) return true;
      if (step.anchor && target.closest(`[data-tour~="${step.anchor}"]`)) return true;
      /*
        **막는 것은 «다른 단추» 뿐입니다.**

        처음에는 밝혀 둔 자리 밖을 통째로 막았는데, 그러면 시킨 일 자체를 못 합니다 — 표시하기에서
        그림 위를 끌어 사각형을 그리는 것도, 목록을 스크롤하는 것도 막혔습니다. 화면을 엉뚱한 데로
        보내는 것은 «눌러서 무언가 일어나는 것»(단추·링크·고르개·입력칸)이지 그림 면이 아닙니다.
        그래서 그쪽만 막고 나머지는 그대로 둡니다.
      */
      return !target.closest("button, a, select, input, textarea, [role='button'], [role='tab']");
    };
    const block = (event: Event) => {
      if (!event.isTrusted || allowed(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const types = ["pointerdown", "mousedown", "mouseup", "click"] as const;
    for (const type of types) document.addEventListener(type, block, true);
    return () => {
      for (const type of types) document.removeEventListener(type, block, true);
    };
  }, [step.anchor, stranded]);

  // ── 3. 자리 찾기 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!step.anchor) {
      setRect(null);
      return;
    }
    const selector = `[data-tour="${step.anchor}"]`;
    let frame = 0;
    const measure = () => {
      frame = 0;

      /*
        **탭은 자리가 보이든 말든 한 번 눌러 줍니다.**

        가위 창의 오른쪽 판(그리기 면·저장될 파일·업스케일)은 «자르기»·«표시하기»·«동선» 세 탭에서
        **다 그려집니다.** 그래서 동선 탭에 서 있어도 업스케일 자리가 «있다» 로 잡혀, 자리를 못
        찾을 때만 돌던 탭 전환이 영영 안 걸렸습니다 — 걸음은 자르기 이야기를 하는데 화면은 동선입니다.

        탭을 다시 누르는 것은 같은 값을 넣는 일이라 아무 일도 안 일어납니다(무해). 그래서 자리를
        찾기 **전에** 한 번 눌러 제 탭에 세워 둡니다. 한 걸음에 한 번뿐입니다.
      */
      const tabDialogs = document.querySelectorAll('[role="dialog"][data-state="open"]');
      const tabScope: ParentNode = tabDialogs.length ? tabDialogs[tabDialogs.length - 1] : document;
      const tab = tabScope.querySelector<HTMLElement>(`[data-tour-switch~="${step.anchor}"]`);
      if (tab && !clicked.current.has(tab)) {
        clicked.current.add(tab);
        tab.click();
      }

      /*
        **보이는 것 중 첫 번째**를 잡습니다.

        `querySelector` 하나만 쓰다가 화면에는
        «구도잡기» 단추가 여럿 보이는데 「이 단계의 자리가 지금 화면에 없습니다」 가 떴습니다.
        같은 앵커가 컷마다·인물마다 붙어 있고(ANCHORS.md 가 «모든 것에 달아도 된다» 고 합니다),
        문서에서 첫 번째인 것이 하필 접힌 장면 안이라 크기가 0 이었습니다. 하나 보고 포기하면
        나머지가 멀쩡히 보이는데도 갇힙니다.
      */
      let element: Element | null = null;
      let box: DOMRect | undefined;
      for (const candidate of document.querySelectorAll(selector)) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        element = candidate;
        box = rect;
        break;
      }
      if (!element || !box) {
        /*
          ── 자리가 없으면 **문을 가리킵니다** ─────────────────────────────────
          「왜 자꾸 똑같은 수정을 반복하는거지?」.

          걸음의 자리 중 여럿은 **문 뒤**에 있습니다 — 창을 띄워야, 판을 펴야, 탭을 옮겨야 그려집니다.
          예전에는 그냥 「자리가 지금 화면에 없습니다」 라고만 적고 «다음» 으로 넘겼습니다. 그러면
          사람은 무엇을 해야 할지 모른 채 안내만 흘려보냅니다.

          이제 문을 찾아 **그 문을 밝히고** 「먼저 이것을 누르세요」 라고 적습니다. 문은 스스로
          `data-tour-open="<열면 생기는 앵커들>"` 로 밝히고, 규칙은 여기 한 곳뿐입니다 — 새 창이
          생기면 그 창을 여는 단추에 속성 하나만 달면 됩니다(`tutorials.test.ts` 가 이름을 셉니다).

          문을 대신 눌러 주지는 않습니다. 튜토리얼은 «따라하는 것» 이고, 대신 눌러 버리면 다음에
          혼자 할 때 그 단추를 찾지 못합니다.
        */
        /*
          **탭은 대신 눌러 주고, 창은 안내합니다.**

          둘을 한 가지로 다루었던 것이 잘못이었습니다. 탭이나 접이식은 **그 자리에서 보는 것만
          바뀝니다** — 공짜이고 되돌리기도 쉬우니 튜토리얼이 대신 눌러 줘도 됩니다
          (`data-tour-switch`). 창은 다릅니다 — 뜨면 화면을 덮고, 마그니픽처럼 밖으로 나가거나
          돈이 드는 것도 있습니다. 그래서 창은 문을 밝히고 «먼저 이것을 누르세요» 라고만 합니다
          (`data-tour-open`).

          `~=` 는 «띄어쓰기로 나눈 목록에 그 낱말이 있는가» 입니다.
        */
        /*
          **겹쳐 뜬 창이 있으면 그 안에서만 찾습니다.** 구도잡기가 이미 열려 있는데 그 아래 가려진 «구도잡기» 단추를 밝히고 「먼저 이것을
          누르세요」 라고 했습니다. 가려진 것도 크기는 있어서 «보인다» 로 셌던 탓입니다.

          그래서 창이 떠 있으면 찾는 범위를 그 창 안으로 좁힙니다 — 창 밖의 문은 지금 손이 닿지
          않으니 가리켜 봐야 헛일입니다.
        */
        const dialogs = document.querySelectorAll('[role="dialog"][data-state="open"]');
        // 창이 겹쳐 떠 있으면 **맨 위의 것**만 손이 닿습니다 — 문서에서 첫 번째가 아니라 마지막입니다.
        const scope: ParentNode = dialogs.length ? dialogs[dialogs.length - 1] : document;

        /*
          **한 걸음에 여러 번 눌러 줍니다.** 「왜 자꾸 같은 수정을 계속 하게 만드는거야?」.

          예전에는 걸음마다 딱 한 번만 눌렀습니다. 그런데 자리에 닿는 데 두 번이 필요한 경우가
          흔합니다 — 구도잡기를 열고 «환경» 탭으로, 가위 창을 열고 «자르기» 탭으로. 한 번에서
          멈추니 나머지 절반은 늘 «자리가 없습니다» 였습니다.

          그래서 이미 누른 것을 기억해 두고, 다음 차례를 한 번씩 눌러 나갑니다. 같은 것을 두 번
          누르지 않으므로 탭이 폈다 접혔다 하지 않고, 네 번에서 멈춰 무한히 누르지도 않습니다.
        */
        const candidates = [
          ...scope.querySelectorAll<HTMLElement>(`[data-tour-switch~="${step.anchor}"]`),
          ...scope.querySelectorAll<HTMLElement>(`[data-tour-open~="${step.anchor}"]`),
        ];
        const next = candidates.find((item) => !clicked.current.has(item));
        if (next && clicked.current.size < 4) {
          clicked.current.add(next);
          setDoorLabel(labelOf(next));
          window.setTimeout(() => next.click(), 200);
          return;
        }
        // 더 누를 것이 없으면 마지막 문을 밝혀 «먼저 이것을 누르세요» 라고 적습니다.
        const opener = candidates[candidates.length - 1];
        const openerBox = opener?.getBoundingClientRect();
        if (opener && openerBox && (openerBox.width > 0 || openerBox.height > 0)) {
          /*
            **창도 저절로 엽니다.**

            여는 것 자체는 공짜입니다 — 돈이 드는 것은 창 안에서 «만들기» 를 누를 때이고, 그 자리는
            따로 «설명만» 으로 묶어 두었습니다(`COSTLY_ANCHORS`). 그래서 한 번 눌러 열어 주고,
            열리는 동안 무엇을 눌렀는지 보이게 문 이름은 그대로 적어 둡니다.

            한 번만 누릅니다 — 못 찾을 때마다 누르면 0.4초마다 열었다 닫았다 합니다.
          */
          if (lit.current !== opener) {
            lit.current?.removeAttribute("data-tutorial-lit");
            opener.setAttribute("data-tutorial-lit", "");
            lit.current = opener;
          }
          if (pulls.current < 3) {
            pulls.current += 1;
            opener.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
          }
          setDoorLabel(labelOf(opener));
          const next = {
            top: openerBox.top,
            left: openerBox.left,
            width: openerBox.width,
            height: openerBox.height,
          };
          setRect((current) => (current && sameBox(current, next) ? current : next));
          return;
        }
        setDoorLabel(null);
        setRect((current) => (current ? null : current));
        return;
      }
      setDoorLabel(null);
      /*
        **가리키는 동안은 보이게 합니다.**

        그림 위의 단추들(가위·복사·폴더 열기)은 평소에 `opacity: 0` 으로 숨어 있다가 마우스를
        올려야 뜹니다. 자리는 DOM 에 있어서 튜토리얼이 찾기는 하는데, **밝혀 놓은 자리에 아무것도
        안 보입니다.** 표시만 붙이고 실제로 보이게 하는 것은 CSS 한 줄(`index.css`)이 합니다 —
        여기서 style 을 직접 만지면 원래 값으로 되돌릴 때 무엇이었는지 알 수 없습니다.
      */
      if (lit.current !== element) {
        lit.current?.removeAttribute("data-tutorial-lit");
        element.setAttribute("data-tutorial-lit", "");
        lit.current = element;
      }

      /*
        **편한 자리에 올 때까지 끌어옵니다.** ,
        2026-09-23 「안내려가」.

        두 번 고쳤는데 두 번 다 조건이 너무 짰습니다. 처음에는 «완전히 화면 밖인가», 다음에는
        «세로로 48px 이상 드러났는가» — 가위 창 아래 띠(닫기·미리보기 새로 고침·저장)는 화면
        **맨 아래 모서리에 딱 걸쳐** 있어서 둘 다 «보인다» 로 셌습니다. 보이기는 하는데 안내 카드가
        들어설 자리가 없고, 정작 눌러야 할 단추는 창 끝에 붙어 있습니다.

        그래서 «보이는가» 가 아니라 **«편한가»** 로 봅니다 — 위아래로 여유(`EASE`)를 두고, 그 띠
        안에 안 들어오면 가운데로 끌어옵니다. 사람이 손으로 스크롤해 둔 것을 영영 빼앗지 않도록
        걸음마다 세 번까지만 합니다.
      */
      const EASE = 96;
      const uneasy = box.top < EASE || box.bottom > window.innerHeight - EASE;
      if (uneasy && pulls.current < 3) {
        pulls.current += 1;
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }
      const next = { top: box.top, left: box.left, width: box.width, height: box.height };
      // 같은 자리면 같은 객체를 돌려줘 다시 그리지 않습니다 — 0.4초마다 재는데 매번 그리면 헛돕니다.
      setRect((current) => (current && sameBox(current, next) ? current : next));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    /*
      **«그리면 생기는 것» 을 지켜봅니다.**
      누르는 것이 아니라 그리는 걸음은 클릭으로 셀 수 없어, 걸음에 적어 둔 `until` 자리가 화면에
      나타나면 «했다» 로 봅니다. 나타나기 전에는 «다음» 이 잠깁니다.
    */
    const watchUntil = () => {
      if (!step.until) return;
      const target = document.querySelector(`[data-tour~="${step.until}"]`);
      const box = target?.getBoundingClientRect();
      setMade(Boolean(target && box && (box.width > 0 || box.height > 0)));
    };
    watchUntil();
    const untilTimer = window.setInterval(watchUntil, 400);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    // 펼침 애니메이션처럼 DOM 은 그대로인데 자리만 옮겨 가는 것을 받치는 그물입니다.
    const timer = window.setInterval(schedule, 400);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.clearInterval(timer);
      window.clearInterval(untilTimer);
      if (frame) window.cancelAnimationFrame(frame);
      lit.current?.removeAttribute("data-tutorial-lit");
      lit.current = null;
    };
  }, [step.anchor]);

  // ── 4. 카드 크기 — 어느 쪽에 붙일지 정하려면 알아야 합니다 ─────────────────
  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const update = () => {
      const box = element.getBoundingClientRect();
      setCard((current) =>
        Math.abs(current.w - box.width) < 1 && Math.abs(current.h - box.height) < 1
          ? current
          : { w: box.width, h: box.height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ── 5. 키 — → / Enter 다음, ← 이전, Esc 닫기. 입력란 안에서는 물러납니다 ──
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const target = event.target instanceof Element ? event.target : null;
      // 단추에 초점이 있을 때의 Enter 는 그 단추의 것입니다 — 가로채면 두 번 넘어가거나 단추가 안 눌립니다.
      const onControl = Boolean(target?.closest("button, a, [role='button'], [role='menuitem'], summary"));
      if (event.key === "Escape") {
        // 잡기(capture)에서 멈춥니다 — 구도잡기 창도 Esc 로 닫히는데, 안내를 닫으려다 창까지 닫히면 자리를 잃습니다.
        event.preventDefault();
        event.stopPropagation();
        closeTutorial();
      } else if (event.key === "ArrowRight" || (event.key === "Enter" && !onControl)) {
        event.preventDefault();
        event.stopPropagation();
        nextStep();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        prevStep();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (typeof document === "undefined") return null;

  // ── 카드 자리 — 아래 → 위 → 옆 순으로, 자리 요소를 가리지 않게 ─────────────
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const GAP = 12;
  const MARGIN = 12;
  let top: number;
  let left: number;
  if (rect) {
    const below = rect.top + rect.height + GAP;
    const above = rect.top - GAP - card.h;
    /*
      **넓은 자리는 가운데에 맞춥니다.** 「타임라인쪽은 포지션 다
      틀어졌네」.

      아래 타임라인·무빙 아이콘 줄·눈금자는 화면 폭을 꽉 채웁니다. 그런 자리에 왼쪽 끝을 맞추면
      카드가 화면 왼쪽 구석으로 날아가 «무엇을 가리키는지» 가 안 보입니다. 카드보다 한참 넓은
      자리면 그 한가운데에 놓습니다.
    */
    const wide = rect.width > card.w * 1.5;
    const aim = wide ? rect.left + rect.width / 2 - card.w / 2 : rect.left;
    left = clamp(aim, MARGIN, Math.max(MARGIN, viewportWidth - card.w - MARGIN));
    if (below + card.h <= viewportHeight - MARGIN) {
      top = below;
    } else if (above >= MARGIN) {
      top = above;
    } else {
      // 위아래 다 안 들어가는 큰 요소(카드 그리드·3D 화면) — 옆에 붙이고, 그것도 안 되면 겹칩니다.
      top = clamp(rect.top, MARGIN, Math.max(MARGIN, viewportHeight - card.h - MARGIN));
      const right = rect.left + rect.width + GAP;
      const leftSide = rect.left - GAP - card.w;
      if (right + card.w <= viewportWidth - MARGIN) left = right;
      else if (leftSide >= MARGIN) left = leftSide;
    }
  } else {
    top = Math.max(MARGIN, (viewportHeight - card.h) / 2);
    left = Math.max(MARGIN, (viewportWidth - card.w) / 2);
  }

  const total = tutorial.steps.length;
  const last = index >= total - 1;
  // 문을 밝히고 있는 동안은 «자리 없음» 이 아닙니다 — 무엇을 눌러야 하는지 알려 주고 있으니까요.
  const missing = stranded;
  // 자리가 화면에 보일 때만 «누르면 갑니다» 라고 합니다 — 없는 자리를 누르라고 하면 갇힙니다.
  const waiting = advance !== "manual" && !missing;

  return createPortal(
    <>
      {rect ? (
        <div
          key="tutorial-spot"
          aria-hidden
          className="pointer-events-none fixed z-[1000] rounded-xl"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px oklch(0 0 0 / 55%), 0 0 0 2px oklch(0.78 0.18 290)",
            transition: "top 0.2s, left 0.2s, width 0.2s, height 0.2s",
          }}
        />
      ) : (
        <div
          key="tutorial-dim"
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[1000]"
          style={{ background: "oklch(0 0 0 / 30%)" }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        data-tutorial-layer=""
        aria-label={t(tutorial.title)}
        className="fixed z-[1001] w-[min(24rem,calc(100vw-1.5rem))] space-y-2.5 rounded-xl p-4 shadow-2xl"
        style={{
          top,
          left,
          background: "oklch(0.15 0.01 265)",
          border: "1px solid oklch(0.62 0.22 290 / 45%)",
          transition: "top 0.2s, left 0.2s",
          /*
            

            카드는 `document.body` 로 내보냅니다. 그런데 Radix 의 모달은 열려 있는 동안
            **body 에 `pointer-events: none`** 을 겁니다. 카드도 body 의 자식이라 같이 죽습니다 —
            창 안쪽은 멀쩡히 눌리니 «화면은 되는데 안내 카드만 안 눌리는» 꼴이 됩니다.

            실제로 걸린 데: 캐릭터 카드(`StepCharacters` 의 Dialog)를 펼친 채 캐릭터 튜토리얼을
            돌리면 3/14 에서 «다음» 이 먹지 않았습니다. 구도잡기 창 · 확인 창 · 프롬프트 창도
            같은 Dialog 라 마찬가지입니다. 튜토리얼은 갇히면 빠져나올 길이 없으므로 카드는
            제 몫을 스스로 되살립니다(메뉴 판도 같은 까닭으로 `TutorialMenu` 에서).
          */
          pointerEvents: "auto",
        }}
      >
        <div className="flex items-center gap-2">
          <BookOpen className="h-3.5 w-3.5 shrink-0" style={{ color: "oklch(0.78 0.18 290)" }} />
          <span className="min-w-0 flex-1 truncate text-[10px] font-bold tracking-wider" style={{ color: "oklch(0.62 0.15 290)" }}>
            {t(tutorial.title)}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums" style={{ color: "oklch(0.55 0.01 265)" }}>
            {t("단계 {n}/{total}", { n: index + 1, total })}
          </span>
          <button
            type="button"
            onClick={askThenClose}
            aria-label={t("튜토리얼 닫기")}
            className="shrink-0 rounded-md p-1 hover:bg-white/10"
            style={{ color: "oklch(0.62 0.01 265)" }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="text-sm font-semibold text-white">{t(step.title)}</p>
        <p className="text-xs leading-relaxed" style={{ color: "oklch(0.74 0.01 265)" }}>
          {t(step.body)}
        </p>

        {step.action && (
          <p
            className="rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{
              background: "oklch(0.62 0.22 290 / 12%)",
              border: "1px solid oklch(0.62 0.22 290 / 30%)",
              color: "oklch(0.88 0.08 290)",
            }}
          >
            {t(step.action)}
          </p>
        )}

        {step.why && (
          <div>
            <button
              type="button"
              onClick={() => setShowWhy((value) => !value)}
              aria-expanded={showWhy}
              className="flex items-center gap-1 text-[11px] font-semibold"
              style={{ color: "oklch(0.70 0.14 200)" }}
            >
              {showWhy ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {t("왜?")}
            </button>
            {showWhy && (
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "oklch(0.58 0.01 265)" }}>
                {t(step.why)}
              </p>
            )}
          </div>
        )}

        {missing && (
          <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.78 0.14 60)" }}>
            {t("이 단계의 자리가 지금 화면에 없습니다 — 안내대로 그 화면을 열면 표시됩니다")}
          </p>
        )}

        {/*
          자리가 문 뒤에 있을 때. 밝혀 둔 것은 그 **문** 이고, 누르면 자리가 생기면서 안내가
          저절로 그리로 옮겨 갑니다. 
        */}
        {doorLabel && (
          <p
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold"
            style={{ background: "oklch(0.72 0.16 60 / 16%)", color: "oklch(0.86 0.14 60)" }}
          >
            <span className="tutorial-pulse h-2 w-2 shrink-0 rounded-full" style={{ background: "oklch(0.82 0.16 60)" }} />
            {t("먼저 «{door}» 을 누르세요 — 그래야 이 자리가 생깁니다", { door: doorLabel })}
          </p>
        )}

        {/* 무엇을 해야 넘어가는지 한 줄로 — 이것이 «읽는 안내문» 과 «따라하기» 를 가릅니다. */}
        {waiting && (
          <p
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold"
            style={{ background: "oklch(0.62 0.22 290 / 14%)", color: "oklch(0.84 0.16 290)" }}
          >
            <span className="tutorial-pulse h-2 w-2 shrink-0 rounded-full" style={{ background: "oklch(0.78 0.18 290)" }} />
            {advance === "input" ? t("여기에 적으면 다음으로 갑니다") : t("여기를 누르면 다음으로 갑니다")}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={askThenClose}
            className="rounded-md px-2.5 py-1.5 text-[11px]"
            style={{ color: "oklch(0.55 0.01 265)" }}
          >
            {t("건너뛰기")}
          </button>
          <button
            type="button"
            onClick={prevStep}
            disabled={index === 0}
            className="ml-auto rounded-md px-3 py-1.5 text-[11px] font-semibold disabled:opacity-35"
            style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.01 265)" }}
          >
            {t("이전")}
          </button>
          <button
            type="button"
            onClick={nextStep}
            disabled={Boolean(step.until) && !made}
            className={
              waiting
                ? "rounded-md px-3 py-1.5 text-[11px] font-semibold"
                : "rounded-md px-3.5 py-1.5 text-[11px] font-semibold text-white gradient-primary"
            }
            style={waiting || (step.until && !made) ? { background: "oklch(1 0 0 / 6%)", color: "oklch(0.60 0.01 265)" } : undefined}
          >
            {/*
              누르기를 기다리는
              동안에도 글자는 «다음» 입니다. «건너뛰고» 를 붙이면 «하지 말고 넘어가라» 로 읽혀,
              시킨 일을 해 보지 않고 지나가게 부추깁니다.
            */}
            {step.until && !made ? t("해야 넘어갑니다") : last ? t("끝") : t("다음")}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
