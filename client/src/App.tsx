import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { syncPromptDefaults } from "@/lib/promptLibrary";
import { hookLlmUsage } from "@/lib/llmActivity";
import ProjectsPage from "@/pages/ProjectsPage";
import BgmProjectsPage from "@/pages/BgmProjectsPage";
import SettingsPage from "@/pages/SettingsPage";
import NewProjectPage from "@/pages/NewProjectPage";
import NotFound from "@/pages/NotFound";
import ErrorBoundary from "@/components/ErrorBoundary";
import { PromptDialogHost } from "@/components/PromptDialog";
import TutorialOverlay from "@/components/tutorial/TutorialOverlay";
import { allowStorageDirectory } from "@/lib/mediaLibrary";
import { checkForUpdate } from "@/lib/appUpdate";
import { initializeAppControl } from "@/lib/appControl";

/**
 * 화면 배치.
 *
 * 작업실(`/workspace/:id`)은 **걷어냈습니다**(). 프로젝트를 골라 들어가면 곧장
 * `/project/:id` 의 네 단계로 가고, 고치는 일도 거기서 합니다 — 같은 컷을 두 화면에서
 * 만질 수 있으면 어느 쪽이 맞는지 알 수 없어집니다.
 */
export default function App() {
  const [, navigate] = useLocation();
  useEffect(() => {
    void initializeAppControl(navigate).catch(() => undefined);
  }, [navigate]);
  /*
    저장 폴더를 asset 프로토콜에 열어 둡니다.

    이 허용은 앱을 껐다 켜면 사라집니다. 안 열면 폴더에 저장한 그림 주소를
    웹뷰가 못 읽어서 썸네일이 전부 깨지고, 그 주소를 fetch 하는 이미지 분석도
    「Failed to fetch」 로 죽습니다. 화면이 그려지기 전에 한 번 걸어 둡니다.
  */
  useEffect(() => {
    void allowStorageDirectory();
    // 요청마다 쓴 토큰을 받아 적습니다 — 「API 기록」이 얼마 썼는지 보여 주는 근거입니다.
    void hookLlmUsage();
  }, []);

  /*
    **켤 때 새 판이 있는지 봅니다.**

     처음에는 설정 화면에만 두었는데, 그러면 **설정을 열어야** 알게
    됩니다 — 「자동으로 감지」 가 아닙니다.

    새 판이 있을 때만 말풍선을 띄웁니다. 없으면 아무 말도 안 합니다 — 켤 때마다
    「최신입니다」 가 뜨면 잔소리입니다. 실패해도 조용합니다(네트워크가 없는 자리에서
    켤 때마다 우는 것도 같습니다).

    말풍선은 **손으로 닫을 때까지** 둡니다. 몇 초 만에 사라지면 자리를 비운 사이에
    지나가 버려 「감지가 안 된다」 가 됩니다.
  */
  useEffect(() => {
    let alive = true;
    void checkForUpdate()
      .then((found) => {
        if (!alive || !found) return;
        toast.info(`새 판 ${found.version} 이 나왔습니다 (지금 ${found.current})`, {
          duration: Infinity,
          description: "설정 화면에서 받을 수 있습니다.",
          action: {
            label: "설정 열기",
            onClick: () => {
              window.location.hash = "";
              navigate("/settings");
            },
          },
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [navigate]);

  /*
    **앱이 고친 프롬프트 문구를 폴더에 흘려보냅니다.**

    문구는 저장 폴더의 사본이 이깁니다(`loadRequestTemplate`). 그래서 옛 사본이 있으면
    앱이 아무리 고쳐도 영영 안 갑니다 — 2026-09-18 에 컷의 대사·연출 칸을 붙였는데
    09-15 자 사본에 가려 **한 컷도 안 들어왔습니다.** 코드도 프롬프트도 멀쩡해 보여서
    원인을 찾는 데 한참 걸립니다.

    **손대지 않은 사본만** 갈아 끼웁니다(머리말의 «기준» 도장으로 가립니다). 사람이
    고친 문구는 건드리지 않고, 기본값이 바뀌었다는 것만 알립니다.
  */
  useEffect(() => {
    void syncPromptDefaults()
      .then((result) => {
        if (result.refreshed.length)
          toast.success(`프롬프트 문구 ${result.refreshed.length}개를 새 기본값으로 맞췄습니다.`, {
            description: result.refreshed.join(", "),
          });
        if (result.kept.length)
          toast.message("고쳐 둔 프롬프트 문구가 있어 그대로 두었습니다.", {
            description:
              `${result.kept.join(", ")} — 앱 기본값이 바뀌었습니다. ` +
              "설정 → 프롬프트 라이브러리에서 «기본값으로 되돌리기» 로 받을 수 있습니다.",
            duration: 12000,
          });
      })
      .catch(() => null);
  }, []);

  return (
    <ErrorBoundary>
      <Switch>
        <Route path="/" component={ProjectsPage} />
        <Route path="/bgm" component={BgmProjectsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/new-project" component={NewProjectPage} />
        <Route path="/project/:id" component={NewProjectPage} />
        <Route component={NotFound} />
      </Switch>
      <Toaster />
      {/*
        값 입력 창은 **앱 뿌리에 하나만** 둡니다.

        `notify` 가 모듈 단위 하나라 두 군데 놓으면 나중에 마운트된 쪽이 앞선 것을
        덮어씁니다. 처음에는 작업실 화면에만 달았는데, 구도잡기는 컷 카드
        (`/project/:id`)에서 열려서 **입력 창이 아예 안 떴습니다** — 단추를 눌러도
        아무 일이 없었습니다(,
        「키프레임 이동량 키 눌렀을 때 값은 어디에 입력해?」).
      */}
      <PromptDialogHost />
      {/*
        튜토리얼 안내 창도 **뿌리에 하나**입니다. 걸음이 화면을 옮겨 다니는데(설정 → 보드 → 프로젝트 →
        구도잡기) 화면마다 두면 화면이 바뀌는 순간 창이 사라졌다 다시 떠서 어디까지 왔는지 잃습니다.
        상태는 `lib/tutorialStore` 가 들고, 설정의 스위치가 꺼져 있으면 아무것도 그리지 않습니다.
      */}
      <TutorialOverlay />
    </ErrorBoundary>
  );
}
