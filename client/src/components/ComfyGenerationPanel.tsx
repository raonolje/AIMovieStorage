import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { checkComfy, chooseComfyWorkflowFile } from "@/lib/upscale";
import { getComfyGenerationSettings, inspectComfyGenerationWorkflow, saveComfyGenerationSettings, subscribeComfyGeneration,
  type ComfyInputMapping, type ComfyKind, type ComfyWorkflowInfo } from "@/lib/comfyGeneration";

const fieldClass = "rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs min-w-0";

/** 그림·영상의 워크플로가 달라서 입력 연결도 별도로 보관합니다. 노드 이름만 보고 역할을 추측하지 않습니다. */
export default function ComfyGenerationPanel() {
  const t = useT();
  const [draft, setDraft] = useState(getComfyGenerationSettings);
  const [kind, setKind] = useState<ComfyKind>("image");
  const [inspected, setInspected] = useState<{path: string; info: ComfyWorkflowInfo} | null>(null);
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState("");
  useEffect(() => subscribeComfyGeneration(() => setDraft(getComfyGenerationSettings())), []);
  const config = draft[kind];
  const info = inspected?.path === config.workflowPath ? inspected.info : null;
  const patchConfig = (change: Partial<typeof config>) => setDraft(current => ({...current, [kind]: {...current[kind], ...change}}));
  const inspect = async (path = config.workflowPath) => {
    setBusy(true);
    try { setInspected({path, info: await inspectComfyGenerationWorkflow(path)}); }
    catch (error) { setInspected(null); toast.error(String(error)); }
    finally { setBusy(false); }
  };
  const pick = async () => {
    const path = await chooseComfyWorkflowFile();
    if (!path) return;
    patchConfig({workflowPath:path, mappings:[], outputNodeIds:[]});
    await inspect(path);
  };
  const putMapping = (nodeId: string, input: string, update: Partial<ComfyInputMapping> | null) => {
    setDraft(current => {
      const config = current[kind];
      const existing = config.mappings.find(mapping => mapping.nodeId === nodeId && mapping.input === input);
      const others = config.mappings.filter(mapping => mapping.nodeId !== nodeId || mapping.input !== input);
      return {...current, [kind]: {...config, mappings:update ? [...others, {nodeId,input,source:"value" as const,...existing,...update}] : others}};
    });
  };
  const save = () => {
    if (!info) { toast.error(t("워크플로를 먼저 검사하세요.")); return; }
    if (!config.mappings.some(mapping => mapping.source === "prompt")) { toast.error(t("ComfyUI 워크플로에 프롬프트 입력을 연결하세요.")); return; }
    saveComfyGenerationSettings(current => ({...current, baseUrl:draft.baseUrl, [kind]:config}));
    toast.success(t("ComfyUI 생성 설정을 저장했습니다."));
  };
  return <div className="space-y-3 text-xs">
    <p className="leading-relaxed text-white/55">{t("켜져 있는 ComfyUI 에 API 형식 워크플로를 보내 그림·영상을 만들고, 결과를 프로젝트 폴더로 받습니다. 모델과 사용자 노드는 ComfyUI 쪽에 설치해야 합니다.")}</p>
    <div className="flex flex-wrap gap-2">
      <input aria-label={t("ComfyUI 생성 서버 주소")} className={`${fieldClass} grow`} value={draft.baseUrl} onChange={event => setDraft(current => ({...current,baseUrl:event.target.value}))} />
      <button className={fieldClass} disabled={busy} onClick={() => { setBusy(true); void checkComfy(draft.baseUrl).then(setConnection).catch(error => toast.error(String(error))).finally(() => setBusy(false)); }}>{t("연결 확인")}</button>
    </div>
    {connection && <p className="break-all text-emerald-300">{connection}</p>}
    <div className="flex gap-2" role="group" aria-label={t("ComfyUI 생성 갈래")}>
      {(["image","video"] as const).map(value => <button key={value} className={`${fieldClass} ${kind === value ? "text-violet-300 border-violet-400/50" : "text-white/50"}`} onClick={() => setKind(value)}>{t(value === "image" ? "그림 워크플로" : "영상 워크플로")}</button>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <input aria-label={t("ComfyUI API 워크플로 파일")} className={`${fieldClass} grow`} value={config.workflowPath} placeholder="workflow_api.json" onChange={event => patchConfig({workflowPath:event.target.value, mappings:[], outputNodeIds:[]})} />
      <button className={fieldClass} disabled={busy} onClick={() => void pick().catch(error => toast.error(String(error)))}>{t("파일 고르기")}</button>
      <button className={fieldClass} disabled={busy || !config.workflowPath.trim()} onClick={() => void inspect()}>{t("워크플로 검사")}</button>
    </div>
    <p className="text-[11px] text-white/50">{t("ComfyUI 의 Save (API Format) 로 저장하세요. 프롬프트·레퍼런스가 들어갈 노드를 직접 연결하며, 연결하지 않은 값은 원래 워크플로를 따릅니다.")}</p>
    {info && <>
      <div className="max-h-96 overflow-y-auto space-y-2 rounded-lg border border-white/10 p-2">
        {info.nodes.map(node => <details key={node.id} open={config.mappings.some(mapping => mapping.nodeId === node.id)} className="rounded-md bg-black/15 p-2">
          <summary className="cursor-pointer break-all">{node.id} · {node.title || node.classType} <span className="text-white/40">({node.classType})</span></summary>
          <div className="space-y-2 pt-2">{node.inputs.map(field => {
            const mapping = config.mappings.find(mapping => mapping.nodeId === node.id && mapping.input === field.name);
            return <div key={field.name} className="flex flex-wrap items-center gap-2">
              <label className="w-32 break-all text-white/70">{field.name}</label>
              <select aria-label={`${node.id}.${field.name}`} className={fieldClass} value={mapping?.source ?? ""} onChange={event => putMapping(node.id,field.name,event.target.value ? {source:event.target.value as ComfyInputMapping["source"],value:field.value} : null)}>
                <option value="">{t("워크플로 값 유지")}</option>
                {typeof field.value === "string" && <><option value="prompt">{t("카드 프롬프트")}</option><option value="negative">{t("부정 프롬프트")}</option><option value="reference">{t("레퍼런스 파일")}</option></>}
                <option value="value">{t("설정값 (조종기에서 변경 가능)")}</option>
              </select>
              {mapping?.source === "reference" && <>
                <select className={fieldClass} aria-label={t("레퍼런스 갈래")} value={mapping.referenceKind ?? "image"} onChange={event => putMapping(node.id,field.name,{referenceKind:event.target.value as "image"|"video"|"audio"})}>
                  <option value="image">{t("그림")}</option><option value="video">{t("영상")}</option><option value="audio">{t("음원")}</option>
                </select>
                <input type="number" min={1} max={64} aria-label={t("같은 갈래의 레퍼런스 순서")} className={`${fieldClass} w-16`} value={(mapping.referenceIndex ?? 0)+1} onChange={event => putMapping(node.id,field.name,{referenceIndex:Math.max(0,Number(event.target.value)-1)})} />
              </>}
              {mapping?.source === "value" && (typeof field.value === "boolean" ? <input type="checkbox" aria-label={`${node.id}.${field.name} ${t("값")}`} checked={Boolean(mapping.value ?? field.value)} onChange={event => putMapping(node.id,field.name,{value:event.target.checked})} /> :
                <input className={`${fieldClass} grow`} aria-label={`${node.id}.${field.name} ${t("값")}`} type={typeof field.value === "number" ? "number" : "text"} value={String(mapping.value ?? field.value)} onChange={event => putMapping(node.id,field.name,{value:typeof field.value === "number" ? Number(event.target.value) : event.target.value})} />)}
            </div>;
          })}</div>
          <label className="mt-2 flex gap-2 items-center text-white/60"><input type="checkbox" checked={config.outputNodeIds.includes(node.id)} onChange={event => patchConfig({outputNodeIds:event.target.checked ? [...config.outputNodeIds,node.id] : config.outputNodeIds.filter(id => id !== node.id)})} />{t("이 노드의 결과 받기")}</label>
        </details>)}
      </div>
      <p className="text-[11px] text-white/50">{t("결과 노드를 선택하지 않으면 해당 갈래의 모든 저장 결과를 받습니다. 레퍼런스 순서는 그림·영상·음원 각각 따로 셉니다. 지원하지 않는 입력은 자동 변환하지 않습니다.")}</p>
    </>}
    <button className={`${fieldClass} bg-violet-500/20 text-violet-200`} disabled={busy || !info} onClick={save}>{t("ComfyUI 생성 설정 저장")}</button>
  </div>;
}
