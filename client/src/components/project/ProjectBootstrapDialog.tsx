import { startProjectGeneration } from "@/lib/batchRun";
import { useRef } from "react";
import { useEscapeClose } from "@/components/useEscapeClose";
import { Clapperboard, Image, Square, Wand2, X } from "lucide-react";
import { confirmDialog } from "@/components/ConfirmDialog";
import { HOLDS_BOOTSTRAP, useTutorialPanel } from "@/lib/useTutorialPanel";
import { fieldStyle } from "@/components/project/fieldStyle";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import { summarizeProjectContext } from "@/lib/projectContext";
import PromptHistoryShelf from "@/components/PromptHistoryShelf";
import BootstrapRefsField from "@/components/project/BootstrapRefsField";
import BootstrapDocsField from "@/components/project/BootstrapDocsField";
import BatchToolsField from "@/components/project/BatchToolsField";
import {
  removeBootstrapPast,
  renameBootstrapPast,
  restoreBootstrap,
  setBootstrapInput,
  useBootstrapRun,
  brokenTags,
  linkedTags,
} from "@/lib/bootstrapStore";
// «만들기·중지» 만 돌리기에서 — 살림(`bootstrapStore`)과 돌리기(`bootstrapRun`)를 갈랐습니다.
import { startBootstrap, stopBootstrap } from "@/lib/bootstrapRun";
import { cardsWithImages, summarizeBootstrap } from "@/lib/projectBootstrap";
import type { ProjectDraft } from "@/lib/projectTypes";
import {
  MODAL_BACKDROP,
  MODAL_BACKDROP_STYLE,
  MODAL_CARD_STYLE,
  modalCard,
} from "@/components/modalShell";

/**
 * «AI 로 일괄 생성» 창.
 *
 * 시나리오·설정을 통째로 붙여넣으면 작품 정보·줄거리·캐릭터·배경·씬 초안이 한 번에
 * 들어갑니다.
 *
 * # 왜 두 번 부르는가
 *
 * 「작품 정보부터 씬까지 전부」 를 한 번에 시키면 뒤로 갈수록 문장이 짧아지고, 인물끼리
 * 설정이 어긋나고, 답이 길어 중간에 잘립니다. 먼저 **뼈대(작품 정보 + 인물·장소 목록)** 를
 * 받고, 그 목록을 다시 넣어 **상세와 씬·컷** 을 받습니다.
 *
 * # 받은 답은 **저절로 들어갑니다**
 *
 * 창이 닫혀 있어도,
 * 다른 프로젝트를 보고 있어도 들어가야 하므로 붓는 일은 살림이 합니다
 * (`lib/bootstrapStore.ts` 의 `deliver`). 이 창은 **무엇이 들어갔는지** 를 보여 줍니다.
 *
 * 하나만 예외입니다 — «비우고 새로» 는 카드와 장면이 목록에서 빠지는 일이라, 무엇이
 * 지워지는지 먼저 말하고 확인을 받습니다(CLAUDE.md). 그때만 «적용» 을 사람이 누릅니다.
 *
 * 넣는 일은 전부 `lib/projectBootstrap.ts` 의 순수 함수가 합니다 — 여기는 화면과
 * 요청만 맡습니다. 채워 넣기 규칙은 LLM 없이 시험할 수 있어야 합니다.
 */
export default function ProjectBootstrapDialog({
  open,
  draft,
  projectKey,
  onChange,
  onClose,
}: {
  open: boolean;
  draft: ProjectDraft;
  /** 일괄 생성 살림의 열쇠(프로젝트 id). 진행도 답도 여기 창이 아니라 살림에 있습니다. */
  projectKey: string;
  /**
   * 초안을 고칩니다. **지금 값을 받아 다음 값을 만드는 함수** 여야 합니다.
   *
   * 받은 답을 붓는 데는 안 씁니다(그건 `bootstrapStore` 가 합니다). 여기서는 **무엇으로
   * 뽑을지** — 생성기·모델·해상도 — 를 이 작품에 적어 두는 데만 씁니다.
   */
  onChange: (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => void;
  onClose: () => void;
}) {
  /*
    걸음이 이 창 밖(«장르» · «비주얼 스타일» 같은 아래 페이지의 자리)을 가리키면 스스로 물러납니다.
     규칙은 `useTutorialPanel` 한 곳에 있습니다.
  */
  useTutorialPanel({ open, holds: HOLDS_BOOTSTRAP, onClose });

  /**
   * 입력도 진행도 결과도 **창 밖 살림**에 있습니다(`lib/bootstrapStore.ts`).
   *
   * 이 창은 «주제 설정» 단계 안에
   * 살아서, 캐릭터 단계로 한 발만 옮겨도 통째로 사라집니다 — 여기 상태를 두면 그때
   * TOP 모델로 받아 둔 답까지 같이 사라졌습니다.
   */
  const { projectName } = useProjectMedia();
  const key = projectKey;
  const run = useBootstrapRun(key);
  const { input, stage, outline, result } = run;
  const { source, hint, counts, mode } = input;
  /*
    시나리오에 적은 이름표가 **실제 파일을 가리키는가.** 걸린 것과 못 건 것을 갈라
    칸 아래에 보여 줍니다 — 잘못 적은 이름표는 조용히 무시되면 안 됩니다.
  */
  const linked = linkedTags(source, input.refs ?? []);
  const broken = brokenTags(source, input.refs ?? []);
  /** 넣고 **이미지·영상까지 바로 뽑을까.** 프로젝트마다 기억합니다(살림에 있습니다). */
  const thenGenerate = Boolean(input.thenGenerate);
  /**
   * **이 창을 언제 열었는가.** 답이 그보다 먼저 왔으면 「앞서 만들어 둔 것」 입니다.
   *
   * 창을 닫아도 요청은 돌고 결과는 살림에 남습니다. 그걸 열 때마다 지우면 TOP 모델 세 번의
   * 값이 그냥 버려지므로, 지우지 않고 **글로** 구분합니다.
   */
  const openedAt = useRef(0);
  if (open && !openedAt.current) openedAt.current = Date.now();
  if (!open && openedAt.current) openedAt.current = 0;

  const running = stage !== 0 || Boolean(run.queued);
  const fresh = !result || (run.doneAt ?? 0) >= openedAt.current;

  // Esc 로도 닫습니다 — 창마다 따로 적으면 새 창에서 또 빠집니다(규칙 1).
  useEscapeClose(open, onClose);

  if (!open) return null;

  const setInput = (patch: Parameters<typeof setBootstrapInput>[1]) => setBootstrapInput(key, patch);

  /**
   * `detailsOnly` — 1단계를 건너뛰고 **받아 둔 작품 정보로 2단계만** 다시 부릅니다.
   * 2단계만 실패했을 때 처음부터 두 번 결제하지 않게 하는 길입니다.
   */
  const start = async (detailsOnly = false) => {
    /*
      ── 지우는 일은 **여기서** 확인받습니다 ────────────────────────────
      

      받은 뒤에 «적용» 을 기다리면, 답이 다 나왔는데 사람이 그 자리에 없어서 아무 일도
      안 일어납니다 — 실제로 「영상이랑 이미지 안 뽑는데?」 가 이것이었습니다(«비우고 새로»
      라 답을 들고 기다리고 있었습니다). 그래서 확인은 **앞으로 당기고**, 받은 답은 늘
      저절로 들어갑니다.
    */
    if (mode === "replace" && (draft.characters.length || draft.backgrounds.length || draft.scenes.length)) {
      const leaving =
        draft.characters.length -
        keptOnReplace.characters.length +
        (draft.backgrounds.length - keptOnReplace.backgrounds.length);
      const ok = await confirmDialog({
        title: "받으면 지금 있는 캐릭터·배경·장면을 비우고 새로 넣습니다.",
        description:
          `카드 ${leaving} 장과 장면 ${draft.scenes.length} 이 목록에서 빠집니다. ` +
          (keptCount
            ? `그림이 붙은 카드 ${keptCount} 장(${[...keptOnReplace.characters, ...keptOnReplace.backgrounds]
                .map((item) => item.name || "이름 없음")
                .join(", ")})은 남깁니다 — 카드를 없애면 저장 폴더의 그 인물 폴더를 앱에서 지울 길이 사라집니다. ` +
              "정말 지울 것은 캐릭터·배경 단계에서 카드를 지워 주세요(원본 파일도 함께 지워집니다)."
            : "저장 폴더의 그림 파일은 건드리지 않습니다."),
        confirmLabel: "비우고 만들기",
        tone: "danger",
      });
      if (!ok) return;
    }
    /*
      ── «덧붙이기» 로 다시 받을 때 ────────────────────────────────────
      인물·장소는 **이름으로 걸러집니다**(`pickNew`) — 같은 사람을 두 번 만들지 않습니다.
      그런데 **장면은 안 걸러집니다.** 제목이 같아도 뒤에 그대로 붙습니다.

      2026-09-18 에 이 단추(«상세만 다시 만들기»)를 늘 보이게 바꾸면서 드러났습니다 —
      씬 24개가 든 작품에서 한 번 더 누르면 48개가 됩니다. 걸러 버리면 «다시 받는» 뜻이
      없어지고(고친 규칙이 안 먹습니다), 그냥 붙이면 목록이 두 배가 됩니다. 그래서
      **무엇이 일어나는지 말하고 고르게** 합니다.
    */
    if (mode === "append" && draft.scenes.length) {
      const ok = await confirmDialog({
        title: `장면 ${draft.scenes.length}개가 이미 있습니다 — 받은 장면은 그 뒤에 붙습니다.`,
        description:
          "인물·장소는 이름이 같으면 새로 안 만들지만, 장면은 제목이 같아도 새로 붙습니다. " +
          "이미 있는 장면을 새로 받은 것으로 바꾸려면 «비우고 새로» 를 고른 뒤 누르세요 — " +
          "그림이 붙은 카드는 그때도 남습니다.",
        confirmLabel: "그래도 뒤에 붙이기",
      });
      if (!ok) return;
    }
    // 확인을 받았다고 적어 둡니다 — 답이 도착할 때 붓는 쪽이 이걸 봅니다.
    setInput({ replaceOk: mode === "replace" });
    startBootstrap(key, {
      detailsOnly,
      /*
        «덧붙이기» 면 이미 있는 이름을 알려 줍니다. 안 알려 주면 같은 인물을 한 번 더
        만들어 카드가 둘이 되고, 씬은 그중 어느 쪽을 가리키는지 알 수 없어집니다.
      */
      existing: {
        characters: draft.characters.map((item) => item.name).filter(Boolean),
        backgrounds: draft.backgrounds.map((item) => item.name).filter(Boolean),
      },
      project: summarizeProjectContext(draft).facts,
      label: draft.title.trim() || projectName,
      // 4단계(카드마다 프롬프트 쓰기) — 아래 체크가 기본 켜짐. 까닭은 `BootstrapInput.richPrompts`.
      richPrompts: input.richPrompts !== false,
      // 컷 길이의 상한은 고른 영상 모델이 정합니다(씨댄쓰 2.5 = 30초).
      videoModel: draft.magnific?.videoModel,
    });
  };

  /*
    «비우고 새로» 라도 **그림이 붙은 카드는 남습니다**(applyBootstrapToDraft).
    카드를 없애면 그 인물 폴더를 지울 길이 앱에서 사라지기 때문입니다 — 폴더 삭제는
    카드 삭제 하나뿐이고, 카드가 없어진 뒤에는 탐색기로 가야 합니다. 미리보기도 이
    카드들을 «이미 있는 것» 으로 세어야 화면과 실제가 맞습니다.
  */
  const keptOnReplace = {
    characters: cardsWithImages(draft.characters),
    backgrounds: cardsWithImages(draft.backgrounds),
  };
  const keptCount = keptOnReplace.characters.length + keptOnReplace.backgrounds.length;
  const staying = mode === "append" ? { characters: draft.characters, backgrounds: draft.backgrounds } : keptOnReplace;

  /** 덧붙이기면 이미 있는 이름은 새로 만들지 않습니다. 미리보기도 같은 셈을 보여 줘야 합니다. */
  const summary = result
    ? summarizeBootstrap(result, {
        characters: staying.characters.map((item) => item.name),
        backgrounds: staying.backgrounds.map((item) => item.name),
      })
    : null;

  /** 상세가 통째로 비었는가 — 2단계만 실패했을 때입니다. */
  const detailsEmpty =
    !result || (!result.details.characters.length && !result.details.backgrounds.length && !result.details.scenes.length);

  return (
    <div className={`${MODAL_BACKDROP} z-50`} style={MODAL_BACKDROP_STYLE}>
      <div className={modalCard("medium")} style={MODAL_CARD_STYLE}>
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid oklch(1 0 0 / 8%)" }}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" style={{ color: "oklch(0.88 0.01 265)" }}>
              AI 로 일괄 생성
            </p>
            <p className="truncate text-[10px]" style={{ color: "oklch(0.50 0.01 265)" }}>
              시나리오를 넣으면 작품 정보 · 캐릭터 · 배경 · 장면 · 컷 구도 · 키컷 프롬프트까지 한 번에 만듭니다
            </p>
          </div>
          {/*
            **도는 중에도 닫을 수 있습니다.**

            예전에는 막아 두었습니다 — 닫고 다시 열면 «만들기» 를 한 번 더 누를 수 있었고,
            job id 가 덮여 먼저 건 요청을 영영 못 끊었기 때문입니다. 지금은 진행도 job id 도
            프로젝트마다 살림에 있어(`bootstrapStore`), 다시 열면 그 프로젝트의 진행이 그대로
            보이고 «중지» 도 제 요청을 끊습니다. 그래서 막을 이유가 없어졌습니다.
          */}
          <button
            type="button"
            onClick={onClose}
            title={
              running
                ? "닫아도 계속 돕니다 — 다른 프로젝트를 만지다 돌아오면 결과가 기다립니다"
                : "닫기"
            }
            className="shrink-0 rounded-md p-1.5 hover:bg-white/10"
            style={{ color: "oklch(0.62 0.01 265)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="composition-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold" style={{ color: "oklch(0.72 0.01 265)" }}>
              시나리오 · 설정 · 기획안
            </span>
            <textarea
              data-tour="bootstrap-scenario"
              value={source}
              onChange={(event) => setInput({ source: event.target.value })}
              disabled={running}
              rows={12}
              placeholder={
                "쓰던 글을 그대로 붙여넣으세요. 길어도 됩니다.\n" +
                "트리트먼트, 인물 메모, 설정집, 대본 어느 것이든 좋습니다."
              }
              className="composition-scroll w-full resize-none rounded-md px-3 py-2 text-[12px] leading-relaxed outline-none"
              style={fieldStyle}
            />
            {/*
              **이름표가 제대로 걸렸는지 보여 줍니다.**

               글 안에서 색을
              바꾸려면 textarea 를 겹친 div 로 갈아야 하는데, 그러면 한글 입력기 조합과
              커서 자리가 어긋납니다(구도잡기에서 겪었습니다). 그래서 **칸 아래에 칩으로**
              보여 줍니다 — 걸린 것은 파랗게, 못 건 것은 빨갛게.
            */}
            {(linked.length > 0 || broken.length > 0) && (
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                {linked.map((tag) => (
                  <span
                    key={tag}
                    title="이 파일을 가리킵니다"
                    className="rounded px-1 py-0.5 text-[9px] font-bold"
                    style={{ background: "oklch(0.55 0.15 200 / 22%)", color: "oklch(0.82 0.12 200)" }}
                  >
                    {tag}
                  </span>
                ))}
                {broken.map((tag) => (
                  <span
                    key={tag}
                    title="그런 파일이 없습니다. 올린 파일의 이름표를 확인하세요"
                    className="rounded px-1 py-0.5 text-[9px] font-bold"
                    style={{ background: "oklch(0.60 0.15 25 / 22%)", color: "oklch(0.80 0.14 25)" }}
                  >
                    {tag} ?
                  </span>
                ))}
              </div>
            )}
          </label>

          {/*
            올린 그림·영상. 글만으로는 「이 춤」 을 말할 수 없습니다 — 사용자 2026-09-17
            의 댄스 커버 예가 그것입니다.
          */}
          {/*
            시나리오·기획안 **파일**. 글을 뽑아 위 칸에 덧붙이고, 원본은 DOCU 폴더에 둡니다.
            그림·영상 칸과 따로인 까닭은 `BootstrapDocsField` 머리말에 — 저쪽은 «보여 줄 것»,
            이쪽은 «읽을 것» 이라 올린 뒤에 하는 일이 정반대입니다.
          */}
          <BootstrapDocsField
            projectName={projectName}
            docs={input.docs ?? []}
            onChange={(docs) => setInput({ docs })}
            onText={(text) =>
              /*
                **덧붙입니다.** 이미 적어 둔 글을 지우면, 손으로 쓴 메모를 파일 하나로
                날리는 사고가 납니다(되돌리기가 없는 칸입니다).
              */
              setInput({ source: source.trim() ? `${source.trim()}

${text}` : text })
            }
            disabled={running}
          />

          <BootstrapRefsField
            projectName={projectName}
            refs={input.refs ?? []}
            onChange={(refs) => setInput({ refs })}
            disabled={running}
          />

          <label className="block space-y-1">
            <span className="text-[11px] font-semibold" style={{ color: "oklch(0.72 0.01 265)" }}>
              장르 · 분위기 (선택)
            </span>
            <input
              value={hint}
              onChange={(event) => setInput({ hint: event.target.value })}
              disabled={running}
              placeholder="차분한 판타지 단편, 흐린 날의 색감"
              className="w-full rounded-md px-3 py-2 text-sm outline-none"
              style={fieldStyle}
            />
            <span className="block text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
              위 글과 어긋나면 위 글이 이깁니다
            </span>
          </label>

          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { key: "characters", label: "캐릭터 수" },
                { key: "backgrounds", label: "배경 수" },
                { key: "scenes", label: "장면 수" },
              ] as const
            ).map((field) => (
              <label key={field.key} className="block space-y-1">
                <span className="text-[11px] font-semibold" style={{ color: "oklch(0.72 0.01 265)" }}>
                  {field.label}
                </span>
                <input
                  value={counts[field.key]}
                  onChange={(event) => setInput({ counts: { ...counts, [field.key]: event.target.value } })}
                  disabled={running}
                  inputMode="numeric"
                  placeholder="자동"
                  className="w-full rounded-md px-3 py-2 text-sm outline-none"
                  style={fieldStyle}
                />
              </label>
            ))}
          </div>

          <div className="space-y-1" data-tour="bootstrap-mode">
            <p className="text-[11px] font-semibold" style={{ color: "oklch(0.72 0.01 265)" }}>
              어떻게 넣을까요
            </p>
            <div className="flex gap-1.5">
              {(
                [
                  { id: "append", label: "이미 있는 것에 덧붙이기" },
                  { id: "replace", label: "비우고 새로" },
                ] as const
              ).map((option) => {
                const on = mode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setInput({ mode: option.id })}
                    disabled={running}
                    className="rounded-md px-2.5 py-1.5 text-[11px] font-medium"
                    style={{
                      background: on ? "oklch(0.62 0.22 290 / 20%)" : "oklch(1 0 0 / 5%)",
                      border: `1px solid ${on ? "oklch(0.62 0.22 290 / 45%)" : "oklch(1 0 0 / 8%)"}`,
                      color: on ? "oklch(0.86 0.16 290)" : "oklch(0.60 0.01 265)",
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
              {mode === "append"
                ? "이미 적어 둔 제목·줄거리는 건드리지 않고, 카드만 뒤에 붙입니다."
                : `캐릭터·배경·장면 목록을 비우고 넣습니다. 저장 폴더의 그림 파일은 지우지 않습니다 — ` +
                  (keptCount
                    ? `그래서 그림이 붙은 카드 ${keptCount} 장은 남깁니다(카드를 없애면 그 폴더를 앱에서 지울 수 없습니다).`
                    : "그림이 붙은 카드가 있으면 그 카드는 남깁니다.")}
            </p>
          </div>

          {/*
            ── 무엇으로 뽑을까 ──────────────────────────────────────────
            

            켜는 자리와 고르는 자리가 같아야 합니다 — 켜 놓고 확인 탭까지 갔다 올 일이
            없어야 「한 번에」 입니다.
          */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold" style={{ color: "oklch(0.72 0.01 265)" }}>
              무엇으로 뽑을까 <span style={{ color: "oklch(0.42 0.01 265)" }}>· 아래 «바로 뽑기» 를 켰을 때</span>
            </p>
            <BatchToolsField draft={draft} onChange={onChange} disabled={running} />
          </div>

          {/* 미리보기 — 무엇이 몇 개 들어갔는지 보여 줍니다. */}
          {summary && (
            <div
              className="space-y-2 rounded-lg px-3 py-2.5"
              style={{ background: "oklch(0.11 0.008 265)", border: "1px solid oklch(0.62 0.22 290 / 30%)" }}
            >
              <p className="text-[11px] font-semibold" style={{ color: "oklch(0.86 0.16 290)" }}>
                이렇게 들어갑니다
              </p>
              {/*
                받은 답은 대개 **이미 들어가 있습니다** — 살림이 부었습니다(`bootstrapStore.deliver`).
                그러니 여기 미리보기는 「무엇이 들어갔는지」 를 보여 주는 자리입니다.
                「비우고 새로」 만 확인을 받으려고 기다립니다.
              */}
              {run.appliedAt ? (
                <p className="text-[10px]" style={{ color: "oklch(0.74 0.14 160)" }}>
                  이 답은 이미 초안에 들어갔습니다
                  {fresh ? "" : " — 창을 닫아 둔 사이에 자동으로 들어갔습니다"}. 목록에서 확인하고,
                  마음에 안 들면 카드를 지우거나 «다시 만들기» 를 누르세요.
                </p>
              ) : run.held ? (
                <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.72 0.13 60)" }}>
                  {run.held}
                </p>
              ) : !fresh ? (
                <p className="text-[10px]" style={{ color: "oklch(0.72 0.13 60)" }}>
                  앞서 만들어 둔 미리보기입니다. 새로 받으려면 «다시 만들기» 를 누르세요.
                </p>
              ) : null}
              {detailsEmpty && (
                <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.72 0.13 60)" }}>
                  상세와 장면을 받지 못했습니다. 작품 정보만 들어갑니다 — 아래 «상세만 다시 만들기» 로 2단계만 다시
                  부를 수 있습니다.
                </p>
              )}
              {summary.title && (
                <PreviewRow label="제목" values={[summary.title]} />
              )}
              <PreviewRow label={`캐릭터 ${summary.characterNames.length}`} values={summary.characterNames} />
              <PreviewRow label={`배경 ${summary.backgroundNames.length}`} values={summary.backgroundNames} />
              <PreviewRow
                label={`장면 ${summary.sceneTitles.length} · 컷 ${summary.cutCount}${
                  summary.shotCount ? ` · 구도 ${summary.shotCount}` : ""
                }`}
                values={summary.sceneTitles}
              />
              {/*
                컷 길이의 합을 보여 줍니다. 컷 길이가 그대로 영상 생성기의 러닝타임이
                되므로(), 적용하기
                전에 «3분 단편» 을 시켰는데 합이 40초인 답을 알아채야 합니다.
              */}
              {summary.timedCuts > 0 && (
                <p className="text-[10px]" style={{ color: "oklch(0.62 0.01 265)" }}>
                  컷 길이 합 {Math.floor(summary.totalSeconds / 60)}분{" "}
                  {Math.round(summary.totalSeconds % 60)}초
                  {summary.timedCuts < summary.cutCount &&
                    ` — 길이가 적힌 컷 ${summary.timedCuts}/${summary.cutCount}, 나머지는 구도잡기에서 정합니다`}
                </p>
              )}
              {summary.skippedNames.length > 0 && (
                <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.62 0.01 265)" }}>
                  이미 있거나 이름이 겹쳐서 새로 만들지 않는 것: {summary.skippedNames.join(", ")} — 장면·컷은 원래
                  카드를 가리킵니다. (같은 이름의 카드가 둘이면 한 폴더를 나눠 써서, 한 장을 지울 때 다른 쪽 그림까지
                  지워집니다)
                </p>
              )}
              {summary.unmatchedNames.length > 0 && (
                <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.72 0.13 60)" }}>
                  컷이 가리키는데 목록에 없는 이름: {summary.unmatchedNames.join(", ")} — 그 자리는 비워 둡니다.
                  적용한 뒤 장면 단계에서 골라 주세요.
                </p>
              )}
            </div>
          )}

          {/*
            ── 지난 답 ──────────────────────────────────────────────────
            

            프롬프트 카드가 오래전부터 하던 일과 같아서 **선반도 같은 것**을 씁니다
            (공통 규칙 1). 되돌리기는 늘 «덧붙이기» 입니다 — 되돌리는 일이 카드를
            지우는 일이 되면 안 됩니다.
          */}
          <PromptHistoryShelf
            history={run.history ?? []}
            title="지난 일괄 생성"
            emptyText="받아 둔 답이 아직 없습니다. 만들 때마다 여기 쌓이고, 언제든 다시 넣을 수 있습니다."
            preview={(entry) => entry.source}
            onRestore={(entry) => restoreBootstrap(key, entry.id)}
            onRename={(id, label) => renameBootstrapPast(key, id, label)}
            onRemove={(id) => removeBootstrapPast(key, id)}
          />
        </div>

        <div
          className="flex shrink-0 items-center justify-between gap-2 px-4 py-3"
          style={{ borderTop: "1px solid oklch(1 0 0 / 8%)" }}
        >
          <p className="min-w-0 truncate text-[11px]" style={{ color: "oklch(0.62 0.01 265)" }}>
            {/* 닫아도 도는 일이라, 진행 문구에 그 말을 붙여 둡니다. */}
            {stage === 1 && "1/3 인물과 장소를 뽑는 중… 닫고 다른 일을 해도 됩니다"}
            {stage === 2 && "2/3 상세와 장면을 쓰는 중… 닫고 다른 일을 해도 됩니다"}
            {stage === 3 && "3/3 컷마다 구도와 프롬프트를 쓰는 중… 닫고 다른 일을 해도 됩니다"}
            {/*
              4단계는 카드 수만큼의 일이라 몇 번째인지를 같이 적습니다 — 「돌고 있나 멈췄나」 를 여기서 가릅니다.
              `done` 은 앞에 선 카드 수(0부터)라 +1 해서 «n번째» 로 — 첫 카드가 도는 동안 「0/12」 로 보이면 멈춘 줄 압니다.
            */}
            {stage === 4 &&
              `4/4 카드마다 프롬프트를 자세히 쓰는 중 — ${Math.min((run.prompts?.done ?? 0) + 1, run.prompts?.total ?? 1)}/${run.prompts?.total ?? 0}번째… 닫고 다른 일을 해도 됩니다`}
            {stage === 0 &&
              (run.queued
                ? "차례를 기다리는 중… 닫고 다른 일을 해도 됩니다"
                : run.held
                  ? "받아 두었습니다 — 넣으려면 확인이 필요합니다"
                  : run.appliedAt
                    ? "초안에 들어갔습니다 — 캐릭터·씬 단계에서 확인하세요"
                    : // 4단계를 껐으면 그 약속은 하지 않습니다 — 아래 체크와 같은 판정(`richPrompts !== false`).
                      input.richPrompts !== false
                      ? "받으면 저절로 들어갑니다 — 세 번에 나눠 물어보고, 그다음 카드마다 프롬프트를 따로 씁니다"
                      : "받으면 저절로 들어갑니다 — 세 번에 나눠 물어보고 몇 분 걸립니다")}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {/*
              **1단계를 건너뛰고 2·3단계만** 다시 부릅니다.

              예전에는 «2단계가 죽었을 때»(`detailsEmpty`)만 이 단추를 보여 주었습니다.
              앞 판이 **성공했으면
              단추가 사라져서**, 씬·컷만 다시 받고 싶어도 1단계(가장 비싼 단)부터 통째로
              다시 도는 수밖에 없었습니다.

              성공한 뒤에도 다시 부를 까닭은 많습니다 — 프롬프트 규칙이 바뀌었을 때,
              씬을 다르게 끊고 싶을 때. 제목·줄거리·인물 목록은 그대로 두고 그 아래만
              다시 만드는 것이 이 단추입니다. 받아 둔 작품 정보가 있으면 늘 보입니다.
            */}
            {/*
              ── 그림·영상만 다시 ────────────────────────────────────────
              

              글은 이미 다 받아 두었습니다. 모델만 바꿔 다시 뽑고 싶을 때 LLM 을 한 번도 부르지 않고
              **줄에 그림·영상만** 세웁니다. 확인 탭의 «지금 뽑기» 는 «아직 없는 것을 채우는» 자리라
              이미 뽑은 것을 건너뛰는데, 이쪽은 **이미 뽑은 것도 다시** 뽑습니다(옛 그림은 지우지 않고
              번호를 올려 나란히 쌓습니다).
            */}
            {!running && (
              <button
                type="button"
                onClick={() => startProjectGeneration(key, draft, { images: true, redo: true })}
                title="글은 그대로 두고 인물 시트와 컷 그림만 지금 고른 모델로 다시 뽑습니다. API 를 쓰지 않습니다"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
                style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.80 0.16 290)" }}
              >
                <Image className="h-3.5 w-3.5" /> 그림만 다시 뽑기
              </button>
            )}
            {!running && (
              <button
                type="button"
                onClick={() => startProjectGeneration(key, draft, { videos: true, redo: true })}
                title="글은 그대로 두고 씬 영상만 지금 고른 모델로 다시 뽑습니다. API 를 쓰지 않습니다"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
                style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.80 0.14 60)" }}
              >
                <Clapperboard className="h-3.5 w-3.5" /> 영상만 다시 뽑기
              </button>
            )}
            {!running && outline && (
              <button
                type="button"
                onClick={() => start(true)}
                title="받아 둔 작품 정보로 2·3단계(상세·장면·구도)만 다시 부릅니다. 1단계는 다시 결제하지 않습니다."
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
                style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.78 0.14 200)" }}
              >
                <Wand2 className="h-3.5 w-3.5" /> 상세만 다시 만들기
              </button>
            )}
            {running ? (
              <button
                type="button"
                onClick={() => void stopBootstrap(key)}
                data-tour="bootstrap-run"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
                style={{ background: "oklch(0.55 0.20 25 / 18%)", color: "oklch(0.80 0.16 25)" }}
              >
                <Square className="h-3 w-3" /> 중지
              </button>
            ) : (
              <button
                type="button"
                onClick={() => start()}
                data-tour="bootstrap-run"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
                style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.78 0.01 265)" }}
              >
                <Wand2 className="h-3.5 w-3.5" /> {summary ? "다시 만들기" : "만들기"}
              </button>
            )}
            {/*
              **적용하고 바로 뽑으러 갑니다.**
              생성기를 고르는 자리는 «한 번에 뽑기» 판 하나뿐입니다 — 여기서 또 고르게 하면
              두 곳이 어긋납니다. 여기서는 그리로 데려다만 줍니다.
            */}
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[10px]"
              style={{ color: "oklch(0.60 0.01 265)" }}
              title="켜 두면 답이 들어간 뒤 인물 시트 → 컷 그림 → 스토리보드 → 씬 영상까지 줄에 세웁니다. 무엇으로 뽑을지는 위 «무엇으로 뽑을까» 에서 고릅니다. 끄면 글·프롬프트·구도까지만 세팅합니다."
            >
              <input
                type="checkbox"
                checked={thenGenerate}
                onChange={(event) => setInput({ thenGenerate: event.target.checked })}
                className="h-3 w-3"
              />
              넣고 이미지·영상까지 바로 뽑기
            </label>
            {/*
              ── 4단계 — 카드마다 프롬프트를 자세히 쓰기 ──────────────────────
               3단계 한 답으로는 컷마다 한 문단이 고작이라, 넣은 뒤
              카드마다 「프롬프트 작성」 과 같은 요청을 따로 보냅니다. 요금이 카드 수만큼 드니 끌 수 있게.
            */}
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[10px]"
              style={{ color: "oklch(0.60 0.01 265)" }}
              title="켜 두면 넣은 뒤 인물·장소 시트와 컷의 그림·영상 프롬프트를 카드마다 LLM 으로 따로 받습니다 — 한 답에 몰아 받는 3단계로는 상황·환경·동작·표정 묘사가 얇게 나옵니다. 요금과 시간이 카드 수만큼 듭니다. 끄면 3단계의 짧은 프롬프트와 규칙 조립만 남습니다."
            >
              <input
                type="checkbox"
                checked={input.richPrompts !== false}
                onChange={(event) => setInput({ richPrompts: event.target.checked })}
                className="h-3 w-3"
              />
              카드마다 프롬프트 자세히 쓰기 (4/4)
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-24 shrink-0" style={{ color: "oklch(0.55 0.01 265)" }}>
        {label}
      </span>
      <span className="min-w-0 flex-1" style={{ color: "oklch(0.80 0.01 265)" }}>
        {values.filter(Boolean).join(", ") || "—"}
      </span>
    </div>
  );
}
