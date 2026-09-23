import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "wouter";
import GlobalNav from "@/components/GlobalNav";
import { createProjectEditorBootstrap } from "@/lib/projectEditorBootstrap";
import type { LocalProject } from "@/lib/localProjectStore";
import { useT } from "@/lib/i18n";
import { WORK_WIDTH } from "@/lib/layout";

/** 편집기 자체를 늦게 열어 자동 저장·MCP 편집 대상·구도 열기가 같은 경계를 지킵니다. */
export default function ProjectEditorLoadGate({ projectId, children }: {
  projectId: string;
  children: (project: LocalProject) => ReactNode;
}) {
  const t = useT();
  // 부모가 projectId를 key로 씁니다. 언어 전환이나 부모 재렌더는 파일을 다시 읽지 않습니다.
  const [bootstrap] = useState(() => createProjectEditorBootstrap(projectId));
  const state = useSyncExternalStore(bootstrap.subscribe, bootstrap.getSnapshot, bootstrap.getSnapshot);
  useEffect(() => {
    void bootstrap.start();
    return () => bootstrap.cancel();
  }, [bootstrap]);

  if (state.status === "ready") return children(state.project);
  return (
    <div className="min-h-screen" style={{ background: "oklch(0.12 0.008 265)" }}>
      <GlobalNav />
      <main className={`${WORK_WIDTH} space-y-4 py-8`}>
        {state.status === "error" ? <>
          <p role="alert">{t("프로젝트를 불러오지 못했습니다. 저장 폴더 연결과 프로젝트 파일을 확인한 뒤 다시 시도해 주세요.")}</p>
          <button type="button" className="rounded-lg border px-4 py-2" onClick={() => { void bootstrap.start(); }}>
            {t("다시 불러오기")}
          </button>
        </> : <p role="status">{t("저장된 프로젝트를 불러오는 중입니다…")}</p>}
        <div><Link href="/" className="text-sm underline">{t("프로젝트 목록으로")}</Link></div>
      </main>
    </div>
  );
}
