import { assetSrc } from "@/lib/mediaLibrary";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import GlobalNav from "@/components/GlobalNav";
import { Button } from "@/components/ui/button";
import { Plus, Film, Clock, Layers, Eye, EyeOff, RefreshCw, Search, Grid3X3, List, Clapperboard, Sparkles, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialogHost, confirmDialog } from "@/components/ConfirmDialog";
import { localeTag, useLocale, useT } from "@/lib/i18n";
import {
  hideProject,
  listHiddenProjects,
  listLocalProjects,
  loadProjects,
  unhideProject,
  type LocalProjectSummary,
} from "@/lib/localProjectStore";
import { totalLlmJobCount } from "@/lib/llmActivity";

/**
 * 프로젝트 보드.
 *
 * # 목업을 두지 않는 이유
 *
 * 예전에는 저장된 프로젝트가 없으면 「도쿄 네온 단편」 같은 가짜 카드 세 장이
 * 떴습니다. 통계도 그 가짜 숫자를 더해 27씬·42자산으로 나왔어요. 그런데 이건
 * **내 작업이 몇 개인지 알아보는 화면**입니다. 진짜와 구분되지 않는 가짜가
 * 섞이면 그 순간부터 이 화면의 숫자를 믿을 수 없습니다. 눌러도 없는 프로젝트로
 * 넘어가서 «내 작업이 사라졌나» 싶기도 했고요.
 *
 * 그래서 비어 있으면 **비어 있다고 그대로 보여 줍니다.**
 *
 * 문구는 전부 `t()` 를 거칩니다(한국어 원문이 열쇠). 튜토리얼이 가리키는 자리에는
 * `data-tour` 가 달려 있습니다 — 이름은 `tutorials/ANCHORS.md` 표와 한 글자도 다르면 안 됩니다.
 */
/**
 * 보드 카드 격자.
 *
 * 3열에서 멈춰 있어 넓은
 * 화면에서는 카드 하나가 800px 을 넘었고, 16:9 대표 그림이 그 폭에 맞춰 늘어나며 위아래가
 * 잘렸습니다(「얼굴 짤리니까 좀 이상하네」). 칸을 늘리면 카드가 제 크기로 돌아옵니다.
 */
const BOARD_GRID =
  "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4";

export default function ProjectsPage() {
  const t = useT();
  const locale = useLocale();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [projects, setProjects] = useState<LocalProjectSummary[]>([]);

  const [hidden, setHidden] = useState<LocalProjectSummary[]>([]);
  const [showHidden, setShowHidden] = useState(false);

  const [reloading, setReloading] = useState(false);
  /** 예시 작품은 그림 넉 장을 복사하므로 잠깐 걸립니다. 그 사이 두 번 눌리면 두 번 만듭니다. */
  const [makingSample, setMakingSample] = useState(false);

  const refresh = () => {
    setProjects(listLocalProjects());
    setHidden(listHiddenProjects());
  };

  /**
   * 폴더를 다시 읽습니다.
   *
   * **폴더가 원본이라 탐색기에서 지우는 것이 진짜 삭제입니다.** 그런데 앱을
   * 켜 둔 채 지우면 화면은 그대로라, 지워졌는지 알 수가 없었습니다.
   * 이 단추가 그 간극을 메웁니다.
   */
  const reload = async () => {
    setReloading(true);
    try {
      await loadProjects();
      refresh();
      toast.success(t("폴더를 다시 읽었습니다."));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setReloading(false);
    }
  };

  useEffect(() => {
    // **폴더가 원본입니다.** 목록은 그 거울일 뿐이에요.
    // 예전에는 이 화면이 브라우저 저장소만 봤습니다. 그래서 폴더에 project.json
    // 이 멀쩡히 있어도 목록이 비어 보였고, 그 상태에서 같은 제목으로 새로
    // 만들면 남의 project.json 을 덮어썼습니다.
    let alive = true;
    void loadProjects()
      .catch(() => null)
      .finally(() => {
        if (alive) refresh();
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = projects.filter((project) =>
    project.title.toLowerCase().includes(search.toLowerCase()),
  );

  const titleOf = (project: LocalProjectSummary) => project.title || t("제목 없음");

  /**
   * 목록에서 감춥니다. **지우지 않습니다.**
   *
   * 이 앱은 프로젝트 폴더도 함께 관리하고, 그 안에 몇 시간씩 뽑은 그림과
   * 영상이 들어 있습니다. 목록에서 뺐다고 폴더까지 지우면 클릭 한 번에
   * 그게 다 사라져요. 되돌릴 방법도 없고요.
   *
   * 진짜 지우는 길은 하나뿐입니다 — **탐색기에서 폴더를 지우는 것.**
   * 그러면 다음에 목록을 읽을 때 알아서 사라집니다.
   */
  const hide = async (project: LocalProjectSummary) => {
    const ok = await confirmDialog({
      title: t("{title} 을 숨길까요?", { title: titleOf(project) }),
      description: t(
        "목록에서만 안 보이게 합니다. 프로젝트 폴더와 그 안의 그림·영상은 그대로 남습니다. 아래 «숨긴 프로젝트» 에서 언제든 다시 꺼낼 수 있습니다.",
      ),
      confirmLabel: t("숨기기"),
    });
    if (!ok) return;
    hideProject(project.id);
    refresh();
    toast.success(t("{title} 을 숨겼습니다.", { title: titleOf(project) }));
  };

  const stats = [
    {
      label: t("활성 프로젝트"),
      value: String(projects.length),
      icon: TrendingUp,
      color: "oklch(0.72 0.18 200)",
    },
    {
      label: t("총 씬"),
      value: String(projects.reduce((count, item) => count + (item.sceneCount || 0), 0)),
      icon: Film,
      color: "oklch(0.62 0.22 290)",
    },
    {
      label: t("생성된 자산"),
      value: String(projects.reduce((count, item) => count + (item.assetCount || 0), 0)),
      icon: Layers,
      color: "oklch(0.70 0.18 50)",
    },
    {
      label: t("AI 최적화 횟수"),
      value: String(totalLlmJobCount()),
      icon: Sparkles,
      color: "oklch(0.68 0.22 160)",
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: "oklch(0.12 0.008 265)" }}>
      <GlobalNav />

      {/* 위쪽 띠는 sticky 라 자리를 이미 차지합니다. 여기에 pt 를 또 주면
          띠 아래로 빈 줄이 하나 생깁니다. */}
      <main>
        {/* 머리 */}
        <div className="relative overflow-hidden px-6 py-10"
          style={{ borderBottom: "1px solid oklch(1 0 0 / 6%)" }}>
          <div className="absolute inset-0 opacity-30"
            style={{ background: "radial-gradient(ellipse at 20% 50%, oklch(0.62 0.22 290 / 20%) 0%, transparent 60%)" }} />
          {/* 필름 띠 장식 */}
          <div className="absolute right-0 top-0 bottom-0 w-64 opacity-5 pointer-events-none"
            style={{ backgroundImage: "repeating-linear-gradient(0deg, oklch(1 0 0) 0px, oklch(1 0 0) 2px, transparent 2px, transparent 40px)", backgroundSize: "100% 40px" }} />
          <div className="relative w-full">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: "oklch(0.62 0.22 290)" }}>
                  {t("AI 영상 스토리지 · 프로덕션 보드")}
                </p>
                <h1 className="font-display text-3xl font-bold text-white mb-2 tracking-tight">
                  {t("프로젝트 보드")}
                </h1>
                <p className="text-sm" style={{ color: "oklch(0.50 0.01 265)" }}>
                  {t("{count}개의 프로젝트 · 로컬 작업 공간", { count: projects.length })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {projects.length > 0 && (
                  <div className="text-right hidden md:block">
                    <p className="text-xs" style={{ color: "oklch(0.40 0.01 265)" }}>{t("최근 활동")}</p>
                    <p className="text-sm font-semibold text-white">{projects[0].title}</p>
                  </div>
                )}
                <Button
                  data-tour="projects-new"
                  onClick={() => navigate("/new-project")}
                  className="gradient-primary glow-sm text-white font-semibold px-5 py-2.5 rounded-lg border-0 hover:opacity-90 transition-opacity">
                  <Plus className="w-4 h-4 mr-2" />
                  {t("새 프로젝트")}
                </Button>
              </div>
            </div>

            {/* 요약 숫자 — 전부 실제 저장된 프로젝트에서 셉니다. */}
            <div data-tour="projects-stats" className="flex items-center gap-6 mt-6 pt-5" style={{ borderTop: "1px solid oklch(1 0 0 / 6%)" }}>
              {stats.map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
                    <Icon className="w-3.5 h-3.5" style={{ color }} />
                  </div>
                  <div>
                    <p className="text-base font-bold font-display text-white leading-none">{value}</p>
                    <p className="text-xs mt-0.5" style={{ color: "oklch(0.40 0.01 265)" }}>{label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 검색과 보기 방식 */}
        <div className="px-6 py-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "oklch(0.45 0.01 265)" }} />
            <input
              data-tour="projects-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("프로젝트 검색...")}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg outline-none transition-all"
              style={{
                background: "oklch(0.16 0.01 265)",
                border: "1px solid oklch(1 0 0 / 8%)",
                color: "oklch(0.93 0.005 265)",
              }}
            />
          </div>
          <div className="ml-auto flex items-center gap-1 p-1 rounded-lg" style={{ background: "oklch(0.16 0.01 265)", border: "1px solid oklch(1 0 0 / 8%)" }}>
            <button onClick={() => setViewMode("grid")} aria-label={t("바둑판으로 보기")}
              className={`p-1.5 rounded-md transition-all ${viewMode === "grid" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode("list")} aria-label={t("목록으로 보기")}
              className={`p-1.5 rounded-md transition-all ${viewMode === "list" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
              <List className="w-4 h-4" />
            </button>
          </div>
          <button
            data-tour="projects-reload"
            onClick={() => void reload()}
            disabled={reloading}
            aria-label={t("폴더 다시 읽기")}
            title={t("폴더를 다시 읽습니다. 탐색기에서 프로젝트 폴더를 지웠다면 이걸 누르세요")}
            className="shrink-0 rounded-lg p-2 disabled:opacity-40"
            style={{ background: "oklch(0.16 0.01 265)", border: "1px solid oklch(1 0 0 / 8%)", color: "oklch(0.62 0.01 265)" }}
          >
            <RefreshCw className={`w-4 h-4 ${reloading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* 카드 */}
        <div className="px-6 pb-12">
          {projects.length === 0 ? (
            <div
              className="flex flex-col items-center gap-3 rounded-xl px-4 py-16"
              style={{ border: "2px dashed oklch(1 0 0 / 10%)" }}
            >
              <Clapperboard className="h-8 w-8" style={{ color: "oklch(0.35 0.01 265)" }} />
              <p className="text-xs" style={{ color: "oklch(0.52 0.01 265)" }}>
                {t("아직 만든 프로젝트가 없습니다")}
              </p>
              {/* 빈 상태에서는 위의 «새 프로젝트» 가 없을 수 있어 같은 앵커를 여기에도 답니다(ANCHORS.md). */}
              <button
                type="button"
                data-tour="projects-new"
                onClick={() => navigate("/new-project")}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-semibold"
                style={{
                  background: "oklch(0.62 0.22 290 / 16%)",
                  border: "1px solid oklch(0.62 0.22 290 / 40%)",
                  color: "oklch(0.86 0.16 290)",
                }}
              >
                <Plus className="h-3.5 w-3.5" /> {t("첫 프로젝트 만들기")}
              </button>
              <p className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
                {t("제목만 정해 두면 나머지는 나중에 채워도 됩니다")}
              </p>

              {/*
                **처음 온 사람이 실제로 보는 자리.**

                빈 작품으로 시작하면 가위도 시트도 뽑은 그림도 없어 «이 앱이 무엇을 하는지» 를 볼 수가
                없습니다. 여기에 미리 채워 둔 작품을 함께 두어, 만들지 않고도 열어 볼 수 있게 합니다.
              */}
              <div className="mt-3 flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  disabled={makingSample}
                  onClick={() => {
                    setMakingSample(true);
                    void import("@/lib/tutorialSample")
                      .then((module) => module.ensureTutorialSample())
                      .then((id) => navigate(`/project/${id}`))
                      .catch(() =>
                        toast.error(t("예시 작품을 만들지 못했습니다. 설정에서 기본 저장 폴더를 먼저 정하세요.")),
                      )
                      .finally(() => setMakingSample(false));
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[11px] font-semibold disabled:opacity-50"
                  style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.74 0.12 200)" }}
                >
                  <Sparkles className="h-3 w-3" />
                  {makingSample ? t("만드는 중…") : t("연습용 예시 작품 열어 보기")}
                </button>
                <p className="text-[10px]" style={{ color: "oklch(0.40 0.01 265)" }}>
                  {t("인물 · 장소 · 장면과 뽑아 둔 그림이 미리 들어 있는 작품입니다. 튜토리얼도 여기서 돕니다.")}
                </p>
              </div>
            </div>
          ) : (
            <div data-tour="projects-grid" className={viewMode === "grid" ? BOARD_GRID : "flex flex-col gap-3"}>
              {/* 새 프로젝트 카드 */}
              <button
                onClick={() => navigate("/new-project")}
                className="group rounded-xl p-6 flex flex-col items-center justify-center gap-3 min-h-[200px] transition-all duration-200 hover:border-white/20"
                style={{ background: "oklch(0.16 0.01 265)", border: "2px dashed oklch(1 0 0 / 10%)" }}>
                <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity glow-sm">
                  <Plus className="w-6 h-6 text-white" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-white/60 group-hover:text-white/90 transition-colors">{t("새 프로젝트 만들기")}</p>
                  <p className="text-xs mt-1" style={{ color: "oklch(0.40 0.01 265)" }}>{t("빈 캔버스에서 시작")}</p>
                </div>
              </button>

              {filtered.map(project => (
                <div key={project.id}
                  onClick={() => navigate(`/project/${project.id}`)}
                  className="group rounded-xl overflow-hidden cursor-pointer transition-all duration-200 hover:border-white/15 hover:-translate-y-0.5"
                  style={{ background: "oklch(0.16 0.01 265)", border: "1px solid oklch(1 0 0 / 8%)" }}>
                  {/* 썸네일 자리 */}
                  {/*
                    높이를 못 박지 않고 **16:9 로 둡니다.** 창을 키우면 칸이 넓어지는데 높이가
                    144px 에 묶여 있어 `object-cover` 가 세로를 잘라 얼굴이 날아갔습니다
                    (「창을 줄이면 잘 붙네」).
                  */}
                  <div className="relative aspect-video overflow-hidden" style={{ background: "oklch(0.13 0.009 265)" }}>
                    {/*
                      **대표 그림.** 사람이 정한 것이 없으면 작품 안에서 찾은 한 장입니다
                      (`projectCover.coverOf`). 그것도 없을 때만 필름 아이콘이 남습니다.
                    */}
                    {assetSrc(project.coverPath) ? (
                      <img
                        src={assetSrc(project.coverPath)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        // 파일이 사라졌으면 아이콘으로 물러납니다 — 액박은 두지 않습니다.
                        onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Clapperboard className="w-10 h-10" style={{ color: "oklch(0.30 0.01 265)" }} />
                      </div>
                    )}
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, oklch(0.16 0.01 265) 0%, transparent 50%)" }} />
                    {/* 코너 프레임 — 이 앱의 표식입니다 */}
                    <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 opacity-40" style={{ borderColor: "oklch(0.62 0.22 290)" }} />
                    <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 opacity-40" style={{ borderColor: "oklch(0.62 0.22 290)" }} />
                    {/* 상태 뱃지 */}
                    <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ background: "oklch(0.12 0.008 265 / 80%)", color: STATUS_COLOR, border: `1px solid ${STATUS_COLOR}40` }}>
                      {project.sceneCount > 0 ? t("진행 중") : t("초안")}
                    </div>
                  </div>

                  {/* 정보 */}
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="font-display font-semibold text-sm text-white group-hover:text-gradient transition-all">{titleOf(project)}</h3>
                      {/* 카드마다 같은 앵커 — 튜토리얼은 첫 번째 것을 잡습니다(ANCHORS.md). */}
                      <button onClick={e => { e.stopPropagation(); void hide(project); }}
                        data-tour="projects-card-hide"
                        aria-label={t("{title} 숨기기", { title: titleOf(project) })}
                        title={t("목록에서만 감춥니다. 폴더와 그림은 그대로 남습니다")}
                        className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10"
                        style={{ color: "oklch(0.66 0.01 265)" }}>
                        <EyeOff className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs mb-3 line-clamp-1" style={{ color: "oklch(0.45 0.01 265)" }}>
                      {project.logline || project.genre || t("로컬 프로젝트")}
                    </p>
                    {/* 진행바 — 씬이 있으면 절반, 없으면 갓 만든 것 */}
                    <div className="h-0.5 rounded-full mb-3 overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${project.sceneCount > 0 ? 55 : 10}%`, background: STATUS_COLOR }} />
                    </div>
                    <div className="flex items-center gap-3 text-xs" style={{ color: "oklch(0.45 0.01 265)" }}>
                      <span className="flex items-center gap-1"><Film className="w-3 h-3" />{t("{count} 씬", { count: project.sceneCount })}</span>
                      <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{t("{count} 자산", { count: project.assetCount })}</span>
                      <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" />
                        {new Date(project.updatedAt).toLocaleDateString(localeTag(locale))}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {filtered.length === 0 && (
                <p className="col-span-full py-8 text-center text-xs" style={{ color: "oklch(0.45 0.01 265)" }}>
                  {t("«{search}» 과 맞는 프로젝트가 없습니다.", { search })}
                </p>
              )}
            </div>
          )}
        </div>
        {/* ── 숨긴 프로젝트 ─────────────────────────────────────────── */}
        {hidden.length > 0 && (
          <div className="px-6 pb-12">
            <button
              type="button"
              data-tour="projects-hidden"
              onClick={() => setShowHidden(!showHidden)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold"
              style={{ color: "oklch(0.58 0.01 265)" }}
            >
              <EyeOff className="h-3.5 w-3.5" />
              {t("숨긴 프로젝트 ({count})", { count: hidden.length })}
              <span style={{ color: "oklch(0.42 0.01 265)" }}>{showHidden ? t("접기") : t("펼치기")}</span>
            </button>

            {showHidden && (
              <>
                <p className="mb-2 mt-1 text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
                  {t(
                    "목록에서만 감춘 것입니다. 폴더와 그림은 그대로 있습니다 — 정말 지우려면 탐색기에서 프로젝트 폴더를 지우세요. 그러면 여기서도 사라집니다.",
                  )}
                </p>
                <div className="flex flex-col gap-1.5">
                  {hidden.map(project => (
                    <div
                      key={project.id}
                      className="flex items-center gap-2 rounded-lg px-3 py-2"
                      style={{ background: "oklch(0.14 0.009 265)", border: "1px solid oklch(1 0 0 / 7%)" }}
                    >
                      <Clapperboard className="h-3.5 w-3.5 shrink-0" style={{ color: "oklch(0.38 0.01 265)" }} />
                      <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "oklch(0.62 0.01 265)" }}>
                        {titleOf(project)}
                      </span>
                      <span className="shrink-0 font-mono text-[10px]" style={{ color: "oklch(0.40 0.01 265)" }}>
                        {project.folder || t("폴더 없음")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          unhideProject(project.id);
                          refresh();
                          toast.success(t("{title} 을 다시 꺼냈습니다.", { title: titleOf(project) }));
                        }}
                        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold"
                        style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.74 0.14 200)" }}
                      >
                        <Eye className="h-3 w-3" /> {t("다시 보이기")}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </main>
      {/* 확인 창을 띄울 자리. 없으면 브라우저 기본 confirm 으로 떨어집니다. */}
      <ConfirmDialogHost />
    </div>
  );
}

const STATUS_COLOR = "oklch(0.78 0.18 290)";
