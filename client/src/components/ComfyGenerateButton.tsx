import { useEffect, useRef, useState } from "react";
import { Loader2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { isDesktopApp } from "@/lib/llm";
import { getComfyGenerationSettings, inspectComfyGenerationWorkflow, prepareComfyBindings, subscribeComfyGeneration, type ComfyKind, type ComfyOutput, type ComfyReference } from "@/lib/comfyGeneration";
import { COMFY_UI_TASK } from "@/lib/comfyUiTasks";
import { enqueueTaskOperation, stopTask, useTaskQueue } from "@/lib/taskQueue";
import { listLocalProjects } from "@/lib/localProjectStore";
import { getMediaLibrarySettings, type ProjectAssetType } from "@/lib/mediaLibrary";
import type { LocalPromptInput } from "@/lib/localPrompt";

export default function ComfyGenerateButton(props: {
  kind: ComfyKind; prompt: LocalPromptInput; references?: ComfyReference[]; firstFrame?: string;
  projectName: string; assetType: ProjectAssetType; ownerName: string; stem: string;
  onDone: (path: string, name: string) => void;
}) {
  const t = useT();
  const [settings, setSettings] = useState(getComfyGenerationSettings);
  const [jobId, setJobId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const candidates = [...(props.references ?? [])];
  if (props.firstFrame && !candidates.some(ref => ref.path === props.firstFrame)) candidates.unshift({kind:"image", path:props.firstFrame});
  const uniqueReferences = candidates.filter((reference, index) => candidates.findIndex(item => item.path === reference.path && item.kind === reference.kind) === index);
  const referenceKey = JSON.stringify(uniqueReferences);
  const [selection, setSelection] = useState<{key: string; paths: string[]} | null>(null);
  const selectedPaths = selection?.key === referenceKey ? selection.paths : uniqueReferences.map(reference => reference.path);
  const references = uniqueReferences.filter(reference => selectedPaths.includes(reference.path));
  const notified = useRef(new Set<string>());
  const tasks = useTaskQueue();
  const task = tasks.find(task => task.id === jobId);
  const sameTarget = !!task && ["projectName", "assetType", "ownerName", "stem", "kind"].every(key =>
    (task.payload as Record<string, unknown>)?.[key] === props[key as "projectName" | "assetType" | "ownerName" | "stem" | "kind"]);
  const busy = accepting || (sameTarget && (task?.status === "waiting" || task?.status === "running"));
  useEffect(() => subscribeComfyGeneration(() => setSettings(getComfyGenerationSettings())), []);
  useEffect(() => {
    if (!task || notified.current.has(task.id) || !["done", "failed", "stopped"].includes(task.status)) return;
    notified.current.add(task.id);
    if (task.status === "done") {
      const files = task.result?.data?.files as ComfyOutput[] | undefined;
      // 생성 도중 다른 카드로 바뀐 컴포넌트에 옛 결과를 붙이지 않습니다. 원래 폴더·작업 기록은 그대로 남습니다.
      if (sameTarget) files?.forEach(file => props.onDone(file.path, file.name));
      toast.success(t("ComfyUI 결과를 프로젝트에 저장했습니다."));
    } else if (task.status === "failed") toast.error(task.error || t("ComfyUI 생성이 실패했습니다."));
  }, [task, sameTarget, props.onDone, t]);
  if (!isDesktopApp()) return null;
  const run = async () => {
    if (busy) return;
    setAccepting(true);
    try {
      const projects = listLocalProjects().filter(project => project.folder === props.projectName);
      if (projects.length !== 1) throw new Error(t("ComfyUI 생성 전에 프로젝트를 저장하세요."));
      const prompt = props.prompt.en?.trim() || props.prompt.ko?.trim() || "";
      if (!prompt) throw new Error(t("보낼 프롬프트가 없습니다."));
      const info = await inspectComfyGenerationWorkflow(settings[props.kind].workflowPath);
      const payload = {kind:props.kind, prompt, negative:props.prompt.negativeEn || props.prompt.negativeKo || "", references,
        projectName:props.projectName, assetType:props.assetType, ownerName:props.ownerName, stem:props.stem,
        settings, workflowSha256:info.sha256, baseDirectory:getMediaLibrarySettings().baseDirectory};
      prepareComfyBindings(settings[props.kind], info, payload);
      const {jobId} = await enqueueTaskOperation({operationId:`comfy-ui-${crypto.randomUUID()}`, lane:"media", projectId:projects[0].id,
        projectTitle:projects[0].title, label:`ComfyUI · ${props.ownerName || props.stem}`, kind:COMFY_UI_TASK, payload});
      setJobId(jobId);
      toast.success(t("ComfyUI 생성을 작업 줄에 넣었습니다."));
    } catch (error) { toast.error(String(error)); }
    finally { setAccepting(false); }
  };
  return <div className="inline-flex flex-wrap items-center gap-1.5" data-tour="card-comfy-generate">
    {uniqueReferences.length > 0 && <details className="relative text-[10px]">
      <summary className="cursor-pointer rounded-md border border-white/10 px-2 py-1.5 text-white/60">{t("컴피 레퍼런스 {selected}/{total}", {selected:String(references.length), total:String(uniqueReferences.length)})}</summary>
      <div className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded-lg border border-white/15 bg-zinc-950 p-3 shadow-xl">
        <p className="mb-2 text-white/60">{t("선택한 파일만 보냅니다. 설정의 레퍼런스 순서와 맞추세요.")}</p>
        <div className="mb-2 flex gap-3"><button type="button" disabled={busy} onClick={() => setSelection({key:referenceKey, paths:uniqueReferences.map(reference => reference.path)})}>{t("모두 선택")}</button>
          <button type="button" disabled={busy} onClick={() => setSelection({key:referenceKey, paths:[]})}>{t("모두 해제")}</button></div>
        <div className="max-h-48 overflow-y-auto space-y-2">{uniqueReferences.map((reference,index) => <label className="flex gap-2 items-center" key={`${reference.kind}:${reference.path}`}>
          <input type="checkbox" disabled={busy} checked={selectedPaths.includes(reference.path)} onChange={event => setSelection({key:referenceKey,paths:event.target.checked ? [...selectedPaths,reference.path] : selectedPaths.filter(path => path !== reference.path)})} />
          <span className="shrink-0 text-white/40">{t(reference.kind === "image" ? "그림" : reference.kind === "video" ? "영상" : "음원")} {uniqueReferences.slice(0,index+1).filter(ref => ref.kind === reference.kind).length}</span>
          <span className="truncate" title={reference.path}>{reference.path.split(/[\\/]/).pop()}</span>
        </label>)}</div>
      </div>
    </details>}
    <button type="button" disabled={busy || !settings[props.kind].workflowPath}
      title={settings[props.kind].workflowPath ? t("설정한 ComfyUI 워크플로로 생성하고 결과를 이 카드의 폴더에 저장합니다.") : t("설정 → ComfyUI 에서 생성 워크플로를 연결하세요.")}
      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-300 disabled:opacity-40" onClick={() => void run()}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Workflow className="h-3 w-3" />}{t(busy ? "ComfyUI 생성 중" : "컴피로 뽑기")}
    </button>
    {busy && task && <button type="button" className="text-[10px] text-white/50" title={t("기다리기만 중지합니다. ComfyUI 서버 작업은 계속될 수 있습니다.")} onClick={() => stopTask(task.id)}>{t("대기 중지")}</button>}
  </div>;
}
