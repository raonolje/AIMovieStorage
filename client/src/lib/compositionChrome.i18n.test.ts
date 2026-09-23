import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlannerCameraBar } from "@/components/composition/planner/CameraBar";
import { PlannerHeader, PlannerTabBar, PlannerViewBar } from "@/components/composition/planner/PlannerChrome";
import { PlannerShotBar } from "@/components/composition/planner/ShotBar";
import { RoomList } from "@/components/composition/planner/RoomList";
import { normalizeComposition, type CompositionCameraSummary } from "./composition";
import { addCameraShotIn, addRoomIn, renameCameraShotIn, renameRoomIn } from "./compositionEdit";
import { setLocale, t, type Locale } from "./i18n";

// 머리줄 번역을 검증할 때 튜토리얼의 라우터·열림 상태까지 만들 필요는 없습니다.
vi.mock("@/components/tutorial/TutorialMenu", () => ({ default: () => null }));

afterEach(() => setLocale("ko"));

describe("구도 편집기 화면 번역과 작품 이름의 경계", () => {
  it.each<Locale>(["en", "ja", "zh"])("%s 화면은 주요 조작 문구를 번역해 렌더링한다", (locale) => {
    setLocale(locale);
    const state = normalizeComposition();
    const update = vi.fn();
    const summary: CompositionCameraSummary = {
      ko: "검증용 구도 요약", en: "Test composition summary", facts: {}, subjects: [], hasComposition: true,
    };
    const html = renderToStaticMarkup(createElement("main", null,
      createElement(PlannerHeader, { summary, onUndo: update, onRedo: update, onClose: update }),
      createElement(PlannerTabBar, { panelTab: "layout", setPanelTab: update, characterCount: 1 }),
      createElement(PlannerViewBar, { captureAspect: 16 / 9, setCaptureAspect: update }),
      createElement(PlannerCameraBar, { state, setState: update, setStateRaw: update, mark: update }),
      createElement(PlannerShotBar, { state, setState: update }),
      createElement(RoomList, { state, setState: update }),
    ));
    for (const key of ["구도 잡기", "배치", "환경", "타임라인", "3D 배치", "샷 크기 — 렌즈 화각", "망원", "저장한 카메라", "지금 구도 저장", "실내", "실외", "호리존"]) {
      expect(t(key), `${locale}: ${key}`).not.toBe(key);
      expect(html).toContain(t(key));
    }
    expect(html).toContain(summary.en);
    expect(html).not.toContain(summary.ko);
    expect(update).not.toHaveBeenCalled();
  });

  it.each<Locale>(["en", "ja", "zh"])("%s로 바꿔도 사용자가 붙인 방·구도 이름과 상태는 그대로다", (locale) => {
    const room = addRoomIn(normalizeComposition(), "indoor");
    const shot = addCameraShotIn(renameRoomIn(room.state, room.id, "배치"));
    const state = renameCameraShotIn(shot.state, shot.id, "지금 구도 저장");
    const before = structuredClone(state);
    const update = vi.fn();
    setLocale(locale);
    const html = renderToStaticMarkup(createElement("main", null,
      createElement(RoomList, { state, setState: update }),
      createElement(PlannerShotBar, { state, setState: update }),
    ));
    // 사전에 존재하는 단어를 이름으로 써도 데이터까지 번역하면 안 됩니다.
    expect(html).toContain("배치");
    expect(html).toContain("지금 구도 저장");
    expect(html).toContain(t("지금 구도 저장"));
    expect(state).toEqual(before);
    expect(update).not.toHaveBeenCalled();
  });
});
