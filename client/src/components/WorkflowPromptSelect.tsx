import { useEffect, useState } from "react";
import { listWorkflowLibrary, subscribeWorkflowLibrary } from "@/lib/comfyWorkflowLibrary";
import type { WorkflowPromptTarget } from "@/lib/promptModelSelection";
import { useT } from "@/lib/i18n";
import { listLocalProjects } from "@/lib/localProjectStore";

export default function WorkflowPromptSelect({kind,value,onChange,disabled,projectId,projectName}:{kind:"image"|"video"|"music"|"voice";value?:WorkflowPromptTarget;onChange:(target:WorkflowPromptTarget|undefined)=>void;disabled?:boolean;projectId?:string;projectName?:string}) {
  const t=useT(),[entries,setEntries]=useState(listWorkflowLibrary);
  useEffect(()=>subscribeWorkflowLibrary(()=>setEntries(listWorkflowLibrary())),[]);
  const saved=projectName?listLocalProjects().filter(project=>project.folder===projectName):[],scope=projectId??(saved.length===1?saved[0].id:undefined);
  const options=entries.filter(entry=>!(entry.projectScope??entry.manifest?.projectId)||(entry.projectScope??entry.manifest?.projectId)===scope).filter(entry=>kind==="music"?entry.source.operation==="music-generation":kind==="voice"?entry.source.operation==="tts":entry.source.outputKind===kind)
    .flatMap(entry=>entry.selection.promptRoles.filter(role=>role.id===(entry.manifest?.promptTarget.roleId??entry.selection.selectedPromptRoleId)).map(role=>({entry,role,target:{kind:"workflow" as const,workflowId:entry.source.workflowId,workflowSha256:entry.workflowSha256??entry.manifest?.workflowSha256??"",roleId:role.id,modelRuleId:role.modelRuleId}}))).filter(option=>option.target.workflowSha256);
  const key=(target:WorkflowPromptTarget)=>JSON.stringify(target);
  return <label className="inline-flex items-center gap-2 text-[11px] text-emerald-200">{t("Comfy 모델·작업·역할")}
    <select aria-label={t("Comfy 모델·작업·역할")} value={value?key(value):""} disabled={disabled} onChange={event=>onChange(options.find(option=>key(option.target)===event.target.value)?.target)} className="max-w-[360px] rounded bg-black/30 p-2">
      <option value="">{t("workflow 역할 선택")}</option>
      {value&&!options.some(option=>key(option.target)===key(value))&&<option value={key(value)}>{t("이전 선택 · 재검사 필요")} {value.workflowId}/{value.roleId}</option>}
      {options.map(option=><option key={key(option.target)} value={key(option.target)}>{option.entry.source.title} · {option.entry.source.operation} · {option.role.modelRuleId}/{option.role.id} · {option.entry.selectionEnvelope?"V2":"V1"} · {option.target.workflowSha256.slice(0,8)} · {option.entry.revisionId?.slice(0,8)??option.entry.checkedAtUtc} · {t(option.entry.manifest?"정적 검사만 통과":"초안·실행 차단")}</option>)}
    </select>
  </label>;
}
