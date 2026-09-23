import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { missingKeys, placeholderNames } from "@/lib/i18n";
import en from "@/locales/en.json";
import ja from "@/locales/ja.json";
import chromeKeys from "@/locales/keys.chrome.json";
import zh from "@/locales/zh.json";
import {
  ALL_ANCHORS,
  FULL_TUTORIAL,
  PAGE_TUTORIALS,
  PLANNER_TUTORIALS,
  TUTORIALS,
  allSteps,
  stepAdvanceMode,
  tutorialsFor,
} from "./index";
import type { TutorialPage } from "./types";

/*
  튜토리얼 자료의 «모양» 을 지킵니다.

  걸음 이름이 겹치면 «어디까지 봤나» 가 엉뚱한 걸음을 가리키고, 앵커 이름이 표(ANCHORS.md)와
  어긋나면 화면에 `data-tour` 를 단 쪽과 자료가 서로 다른 이름을 부릅니다 — 읽어서는 못 찾는
  종류의 어긋남이라 여기서 셉니다.

  번역도 같은 종류입니다. 한국어 문장이 사전의 열쇠라, 걸음 하나를 고치고 세 사전 중 한 곳을
  빠뜨리면 그 언어에서 그 걸음만 한국어로 뜹니다(«여덟 곳은 맞고 한 곳만 틀리다»). 아래
  「튜토리얼 번역」 이 모든 문장에 세 언어 번역이 있는지, 세 사전의 열쇠가 같은지 셉니다.
*/

/** 화면에 나가는 문장 전부 — 제목 · 요약 · 걸음의 제목 · 본문 · 해 볼 것 · 까닭. 중복 없이. */
function tutorialTexts(): string[] {
  const texts = new Set<string>();
  for (const tutorial of TUTORIALS) {
    texts.add(tutorial.title);
    texts.add(tutorial.summary);
    for (const step of tutorial.steps) {
      texts.add(step.title);
      texts.add(step.body);
      if (step.action) texts.add(step.action);
      if (step.why) texts.add(step.why);
    }
  }
  return [...texts];
}

const ANCHOR_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PAGES: TutorialPage[] = ["projects", "basics", "characters", "scenes", "finish", "settings", "bgm", "planner"];

function documentedAnchors(): Set<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const text = readFileSync(join(here, "ANCHORS.md"), "utf8");
  const found = new Set<string>();
  // 표의 첫 칸 — `| \`anchor-id\` | …`
  for (const match of text.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)) found.add(match[1]);
  return found;
}

describe("튜토리얼 자료", () => {
  it("튜토리얼 id 와 걸음 id 가 전부 다릅니다", () => {
    const tutorialIds = TUTORIALS.map((tutorial) => tutorial.id);
    expect(new Set(tutorialIds).size).toBe(tutorialIds.length);

    const stepIds = allSteps().map((step) => step.id);
    const seen = new Set<string>();
    const dupes = stepIds.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    expect(dupes).toEqual([]);
  });

  it("걸음마다 제목과 본문이 있고, 걸음 id 는 튜토리얼 id 로 시작합니다", () => {
    for (const tutorial of TUTORIALS) {
      expect(tutorial.title.trim()).not.toBe("");
      expect(tutorial.summary.trim()).not.toBe("");
      expect(tutorial.steps.length).toBeGreaterThan(0);
      for (const step of tutorial.steps) {
        expect(step.title.trim(), step.id).not.toBe("");
        expect(step.body.trim(), step.id).not.toBe("");
        expect(step.id.startsWith(`${tutorial.id}-`), `${step.id} ← ${tutorial.id}`).toBe(true);
        if (step.action) expect(step.action.startsWith("해 볼 것: "), step.id).toBe(true);
      }
    }
  });

  it("앵커 이름은 kebab-case 이고 route 가 있으면 page 도 있습니다", () => {
    for (const step of allSteps()) {
      if (step.anchor) expect(step.anchor, step.id).toMatch(ANCHOR_ID);
      if (step.route) expect(step.page, step.id).toBeDefined();
    }
    for (const anchor of ALL_ANCHORS) expect(anchor).toMatch(ANCHOR_ID);
    expect(new Set(ALL_ANCHORS).size).toBe(ALL_ANCHORS.length);
    expect([...ALL_ANCHORS].sort()).toEqual(ALL_ANCHORS);
  });

  it("한 바퀴는 25걸음 이상이고 걸음마다 «해 볼 것» 이 있습니다", () => {
    expect(FULL_TUTORIAL.kind).toBe("full");
    expect(FULL_TUTORIAL.steps.length).toBeGreaterThanOrEqual(25);
    expect(FULL_TUTORIAL.steps.length).toBeLessThanOrEqual(80);
    for (const step of FULL_TUTORIAL.steps) expect(step.action, step.id).toBeDefined();
    // 설정 → 새 작품 → 캐릭터 → 씬(구도잡기) → 확인 순서를 지납니다.
    const order = FULL_TUTORIAL.steps.map((step) => step.page).filter(Boolean);
    const firstOf = (page: TutorialPage) => order.indexOf(page);
    expect(firstOf("settings")).toBeLessThan(firstOf("basics"));
    expect(firstOf("basics")).toBeLessThan(firstOf("characters"));
    expect(firstOf("characters")).toBeLessThan(firstOf("scenes"));
    expect(firstOf("scenes")).toBeLessThan(firstOf("planner"));
    expect(firstOf("planner")).toBeLessThan(firstOf("finish"));
  });

  it("페이지별 튜토리얼은 화면마다 하나, 구도잡기는 여러 갈래", () => {
    /*
      예전에는 «화면마다 하나» 였습니다. 뒤로, 한 화면에서 여는 창마다 갈래를 하나씩 두었습니다 — 캐릭터 화면만
      해도 계보·시트 합성·생성 결과 선반·이미지 편집이 저마다 열 몇 걸음입니다. 그래서 «화면마다
      하나» 가 아니라 «화면이 하나라도 갈래를 가진다» 를 셉니다.
    */
    const pagesCovered = PAGE_TUTORIALS.map((tutorial) => tutorial.page);
    expect(new Set(pagesCovered).size).toBeGreaterThanOrEqual(6);
    for (const page of PAGES.filter((item) => item !== "planner")) {
      expect(tutorialsFor(page).length, page).toBeGreaterThanOrEqual(1);
    }
    expect(tutorialsFor("planner").length).toBeGreaterThanOrEqual(5);
    for (const tutorial of [...PAGE_TUTORIALS, ...PLANNER_TUTORIALS]) {
      expect(tutorial.steps.length, tutorial.id).toBeGreaterThanOrEqual(5);
      expect(tutorial.steps.length, tutorial.id).toBeLessThanOrEqual(16);
      expect(tutorial.page, tutorial.id).toBeDefined();
    }
    for (const tutorial of PLANNER_TUTORIALS) {
      expect(tutorial.kind).toBe("planner");
      expect(tutorial.page).toBe("planner");
    }
    // 한 바퀴는 «막혔을 때» 목록에 안 섞입니다.
    for (const page of PAGES) expect(tutorialsFor(page).some((tutorial) => tutorial.kind === "full")).toBe(false);
  });

  /*
    **접이식이 «내가 열면 이것들이 생긴다» 고 적은 목록**도 표와 맞아야 합니다.

    접힌 판은 속을 아예 안 그려서 튜토리얼이 찾을 길이 없습니다. 그래서 여는 단추에
    `data-tour-open="앵커 앵커 …"` 를 달아 두고 안내 창이 눌러 줍니다. 그 목록에 오타가 하나
    있으면 그 걸음 하나만 조용히 안 열립니다 — 읽어서는 못 찾는 종류라 여기서 셉니다.
  */
  /*
    **여는 문과 닫는 창이 짝이 맞아야 합니다.**

     그 반복의 모양이 늘 같았습니다 — 창을 여는
    쪽만 고치고 닫는 쪽을 빠뜨리거나, 그 반대이거나. 한 짝이 빠지면 그 걸음 하나만 조용히 어긋나
    읽어서는 못 찾습니다.

    그래서 규칙을 셉니다: **문이 «열면 생긴다» 고 적은 이름은, 어느 창이든 «내가 품었다» 고도
    적어야 합니다.** 그래야 걸음이 그 창 밖으로 나갈 때 창이 스스로 물러납니다.
  */
  it("여는 문이 부르는 이름은 품은 창의 목록에도 있습니다", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, "..");

    const documented = documentedAnchors();
    const opens = new Set<string>();
    /** `{HOLDS_PLANNER}` 처럼 이름으로 부른 것 — 아래에서 그 상수의 내용을 펴 넣습니다. */
    const constants = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const text = readFileSync(full, "utf8");
        /*
          여는 쪽은 두 가지입니다 — `data-tour-open`(창: 밝혀 놓고 사람이 누릅니다)과
          `data-tour-switch`(탭·접이식: 튜토리얼이 대신 누릅니다). 둘 다 «이 자리에 닿는 길» 이므로
          짝을 셀 때는 함께 봅니다.

          값이 `{HOLDS_PLANNER}` 처럼 **상수 이름**일 때도 잡습니다. 글자를 그대로 적은 것만 세다가
          구도잡기가 통째로 빠졌습니다().
        */
        for (const hit of text.matchAll(/(?:data-tour-(?:open|switch)|opens)=(?:"([^"]*)"|\{([^}]*)\})/g)) {
          const raw = hit[1] ?? hit[2] ?? "";
          for (const name of raw.split(/[\s"'`]+/)) {
            // 표에 있는 이름만 앵커로 셉니다 — `opens={…}` 처럼 prop 이름이 섞여 들어왔습니다.
            if (documented.has(name)) opens.add(name);
            // 상수 이름이면 그 상수가 품은 이름을 전부 더합니다.
            else if (/^(HOLDS_[A-Z_]+|TAB_OPENS)/.test(name)) constants.add(name.replace(/\[.*$/, ""));
          }
        }
      }
    };
    walk(root);

    // 창들이 «내가 품었다» 고 적어 둔 것 — 상수 한 파일에 모여 있습니다.
    const panels = readFileSync(join(root, "lib/tutorialPanels.ts"), "utf8");
    const held = new Set<string>();
    /*
      상수 본문에서 앵커 이름을 긁습니다. 겹따옴표뿐 아니라 **백틱**도 보고, 상수가 다른 상수를
      `${HOLDS_ENTITY_CARD}` 처럼 품고 있으면 **끝까지 따라 들어갑니다**. 한 겹만 펴다가
      card-* 열다섯 개가 통째로 «여는 문이 없다» 로 잘못 걸렸습니다(두 겹이었습니다).
    */
    const namesIn = (text: string, into: Set<string>, seen = new Set<string>()) => {
      for (const hit of text.matchAll(/["`]([^"`]*)["`]/g)) {
        for (const name of hit[1].split(/[\s${}]+/)) {
          if (documented.has(name)) into.add(name);
        }
      }
      for (const hit of text.matchAll(/\$\{([A-Z_]+)\}/g)) {
        if (seen.has(hit[1])) continue;
        seen.add(hit[1]);
        const inner = panels.match(new RegExp(`const ${hit[1]}[^;]*;`, "s"));
        if (inner) namesIn(inner[0], into, seen);
      }
    };
    namesIn(panels, held);

    /*
      이름으로 부른 상수를 펴 넣습니다. `HOLDS_*` 는 위 파일에, `TAB_OPENS` 는 구도잡기 껍데기에
      있습니다. 상수가 품은 이름이 곧 «그 문이 열어 주는 자리» 입니다.
    */
    for (const name of constants) {
      if (name.startsWith("HOLDS_")) {
        const block = panels.match(new RegExp(`const ${name}[^;]*;`, "s"));
        if (block) namesIn(block[0], opens);
      } else if (name === "TAB_OPENS") {
        const chrome = readFileSync(join(root, "components/composition/planner/PlannerChrome.tsx"), "utf8");
        const block = chrome.match(/const TAB_OPENS[^;]*;/s);
        if (block) namesIn(block[0], opens);
      }
    }

    /*
      탭과 «제자리에서 펴지는 것»(컷 카드·곡 고르기·인물 고르기)은 화면을 덮지 않습니다 —
      닫을 창이 없으니 짝을 요구하지 않습니다. 다만 «원래 없는 것» 과 «빠뜨린 것» 이 구분되게
      `INLINE_REVEAL` 에 적어 두게 했습니다(그것도 위 정규식에 걸려 held 에 들어옵니다).
    */
    const orphans = [...opens].filter((anchor) => !held.has(anchor)).sort();
    expect(orphans, "여는 문만 있고 품은 창이 없습니다").toEqual([]);

    /*
      **반대 방향도 셉니다.**
      「왜 계속 이렇게 누락되는거지?」.

      한 방향만 보고 있었던 것이 누락이 반복된 까닭입니다. «여는 문이 부르는 이름은 품은 창에도
      있어야 한다» 만 세고, «품은 창은 여는 문도 있어야 한다» 는 안 셌습니다. 그래서 구도잡기는
      스스로 닫을 줄은 아는데 **여는 법을 아무도 안 알려 주어**, 걸음이 창 안을 가리키면
      「자리가 화면에 없습니다」 만 떴습니다.

      창은 «닫는 법» 과 «여는 법» 이 늘 한 쌍입니다. 한쪽만 적으면 여기서 걸립니다.
    */
    const unopenable = [...held].filter((anchor) => !opens.has(anchor)).sort();
    expect(unopenable, "품은 창은 있는데 여는 문이 없습니다").toEqual([]);
    expect(held.size).toBeGreaterThan(60);
  });

  /*
    **창 안의 자리는 그 창이 품어야 합니다.**

     걸음의 앵커를 `cropper-mark-shapes` 에서
    `cropper-mark-made`(이름 칸이 있는 줄)로 옮겼는데, 그 이름을 `HOLDS_CROPPER` 에 안 넣어서
    그 걸음에 이르는 순간 가위 창이 「내 것이 아니네」 하며 **스스로 닫혔습니다**. 앞의 두 시험은
    «문 ↔ 창» 짝만 보므로 이것을 못 잡습니다 — 아무도 그 이름을 문으로 부르지 않았으니까요.

    그래서 **이름 앞머리**로 한 번 더 셉니다. 앞머리로 «동작» 을 정하는 것은 금지지만(그건
    새 이름이 새어 나갑니다) 시험은 반대입니다 — 새 이름이 새어 나가면 **여기서 걸려야** 합니다.
  */
  it("창 안의 자리는 그 창의 «품은 목록» 에 있습니다", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const panels = readFileSync(join(here, "../lib/tutorialPanels.ts"), "utf8");
    const listOf = (name: string) => {
      const found = new Set<string>();
      const read = (constant: string, seen = new Set<string>()) => {
        if (seen.has(constant)) return;
        seen.add(constant);
        const block = panels.match(new RegExp(`const ${constant}[^;]*;`, "s"));
        if (!block) return;
        for (const hit of block[0].matchAll(/["`]([^"`]*)["`]/g)) {
          for (const word of hit[1].split(/[\s${}]+/)) if (word.includes("-")) found.add(word);
        }
        for (const hit of block[0].matchAll(/\$\{([A-Z_]+)\}/g)) read(hit[1], seen);
        for (const hit of block[0].matchAll(/^\s*([A-Z_]{4,}),$/gm)) read(hit[1], seen);
      };
      read(name);
      return found;
    };

    /** 앞머리 → 그 자리를 품어야 하는 창. */
    const HOME: [string, string][] = [
      ["cropper-", "HOLDS_CROPPER"],
      ["mocap-", "HOLDS_MOCAP"],
      ["sheet-", "HOLDS_SHEET"],
      ["bottom-", "HOLDS_PLANNER"],
      ["layout-", "HOLDS_PLANNER"],
      ["env-", "HOLDS_PLANNER"],
      ["timeline-", "HOLDS_PLANNER"],
      ["planner-", "HOLDS_PLANNER"],
    ];
    const lists = new Map(HOME.map(([, constant]) => [constant, listOf(constant)]));

    const missing: string[] = [];
    for (const anchor of ALL_ANCHORS) {
      const home = HOME.find(([prefix]) => anchor.startsWith(prefix));
      if (!home) continue;
      if (!lists.get(home[1])!.has(anchor)) missing.push(`${anchor} → ${home[1]}`);
    }
    expect(missing.sort(), "창 안의 자리인데 품은 목록에 없습니다").toEqual([]);
  });

  it("data-tour-open 이 부르는 이름도 전부 표에 있습니다", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, "..");
    const named = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const text = readFileSync(full, "utf8");
        for (const hit of text.matchAll(/data-tour-open=(?:"([^"]*)"|\{[^}]*"([^"]*)"[^}]*\})/g)) {
          /*
            앵커 모양이 아닌 것은 거릅니다 — 주석의 설명(«<그 안의 앵커>»)과, 값이 삼항식일 때
            딸려 오는 `draggable` · `undefined` 같은 JSX 조각입니다. 하이픈이 든 이름만 셉니다.
          */
          for (const name of (hit[1] ?? hit[2] ?? "").split(/[\s${}?:]+/)) {
            // 날짜(2026-09-14)처럼 숫자만인 것도 거릅니다 — 앵커는 늘 글자로 시작합니다.
            if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) named.add(name);
          }
        }
      }
    };
    walk(root);

    // 상수로 빼 둔 목록(PlannerChrome 의 TAB_OPENS)도 같이 셉니다.
    const chrome = readFileSync(join(root, "components/composition/planner/PlannerChrome.tsx"), "utf8");
    for (const hit of chrome.matchAll(/^\s{2}(?:camera|layout|environment|timeline):\s*"([^"]*)"/gm)) {
      for (const name of hit[1].split(/\s+/).filter(Boolean)) named.add(name);
    }

    const documented = documentedAnchors();
    const unknown = [...named].filter((anchor) => !documented.has(anchor)).sort();
    expect(unknown, "표에 없는 이름을 열어 주겠다고 적었습니다").toEqual([]);
    // 적어도 몇 개는 있어야 합니다 — 정규식이 조용히 아무것도 못 잡으면 이 시험이 무의미해집니다.
    expect(named.size).toBeGreaterThan(20);
  });

  it("걸음이 부르는 앵커는 전부 ANCHORS.md 표에 있고, 표의 앵커는 전부 쓰입니다", () => {
    const documented = documentedAnchors();
    /*
      걸음이 «가리키는» 자리뿐 아니라 «기다리는» 자리(`until`)도 쓰는 것으로 셉니다 — 그리는
      걸음은 누르는 자리와 «그리면 생기는 자리» 가 다릅니다().
    */
    const used = new Set([...ALL_ANCHORS, ...allSteps().map((step) => step.until).filter(Boolean)]);
    const missing = ALL_ANCHORS.filter((anchor) => !documented.has(anchor));
    const unused = [...documented].filter((anchor) => !used.has(anchor)).sort();
    expect(missing, "표에 없는 앵커").toEqual([]);
    expect(unused, "쓰이지 않는 앵커").toEqual([]);
  });
});

describe("튜토리얼 번역", () => {
  const dictionaries = { en, ja, zh } as Record<"en" | "ja" | "zh", Record<string, string>>;
  const locales = ["en", "ja", "zh"] as const;

  it("모든 문장에 세 언어 번역이 있습니다", () => {
    const texts = tutorialTexts();
    expect(texts.length).toBeGreaterThan(400);
    for (const locale of locales) {
      expect(missingKeys(locale, texts), locale).toEqual([]);
    }
  });

  it("세 사전의 열쇠가 같습니다", () => {
    const enKeys = Object.keys(en).sort();
    expect(Object.keys(ja).sort(), "ja").toEqual(enKeys);
    expect(Object.keys(zh).sort(), "zh").toEqual(enKeys);
  });

  it("사전의 열쇠는 전부 쓰입니다 — 튜토리얼 문장이거나 크롬 키(keys.chrome.json)", () => {
    // 고친 뒤 옛 문장을 사전에서 안 지우면 여기서 걸립니다. 화면 문구를 새로 감싸면 크롬 키 목록에 더하세요.
    const used = new Set<string>([...tutorialTexts(), ...chromeKeys]);
    const orphans = Object.keys(en).filter((key) => !used.has(key));
    expect(orphans).toEqual([]);
  });

  it("번역은 원문의 자리표시자를 빠뜨리지 않습니다", () => {
    // 튜토리얼 문장은 vars 없이 부르니 «원문의 자리 ⊆ 번역의 자리» 면 됩니다. 번역이 설명용으로
    // `{scene}` 같은 이름을 더 쓰는 것은 그대로 화면에 보일 뿐 해가 없습니다. 크롬 키의
    // 엄격한 «같은 이름» 검사는 i18n.test.ts 에 있습니다.
    for (const locale of locales) {
      const dictionary = dictionaries[locale];
      for (const key of tutorialTexts()) {
        const wanted = placeholderNames(key);
        if (!wanted.length) continue;
        const got = placeholderNames(dictionary[key] ?? "");
        for (const name of wanted) expect(got, `${locale}: ${key}`).toContain(name);
      }
    }
  });
});

/*
   읽고 «다음» 만 누르는 걸음이
  대부분이면 튜토리얼이 아니라 설명서입니다 — 「해 볼 것」 이 적힌 걸음은 실제로 행동해야 넘어가야 합니다.
*/
describe("걸음을 무엇으로 넘기는가", () => {
  it("「누르세요」 는 누르기로, 「적으세요」 는 적기로 넘어간다", () => {
    expect(
      stepAdvanceMode({ id: "a", title: "t", body: "b", anchor: "nav-settings", action: "위 띠의 «설정» 을 누르세요." }),
    ).toBe("click");
    expect(
      stepAdvanceMode({ id: "b", title: "t", body: "b", anchor: "basics-title", action: "작품 제목을 적으세요." }),
    ).toBe("input");
  });

  it("가리킬 자리가 없으면 설명 걸음이다", () => {
    expect(stepAdvanceMode({ id: "c", title: "t", body: "b", action: "눈으로 확인하세요." })).toBe("manual");
  });

  it("적어 둔 것이 짐작을 이긴다", () => {
    expect(
      stepAdvanceMode({ id: "d", title: "t", body: "b", anchor: "x", action: "누르세요", advanceOn: "manual" }),
    ).toBe("manual");
  });

  /*
    예전에는 «절반 이상» 이었습니다. 뒤로
    돈이 나가거나 밖으로 나가는 자리(COSTLY_ANCHORS)는 일부러 «설명만» 으로 돌렸습니다 — 튜토리얼을
    보려던 사람에게 마그니픽이 열리고 크레딧이 나가면 안 됩니다. 그만큼 행동 걸음이 줄어드는 것이
    맞으므로 기준을 «셋 중 하나 이상» 으로 낮춥니다. 그래도 읽기만 하는 안내문이 되지는 않게 셉니다.
  */
  it("한 바퀴의 걸음 셋 중 하나 이상은 행동으로 넘어간다", () => {
    const acting = FULL_TUTORIAL.steps.filter((step) => stepAdvanceMode(step) !== "manual").length;
    expect(acting).toBeGreaterThan(FULL_TUTORIAL.steps.length / 3);
  });
});
