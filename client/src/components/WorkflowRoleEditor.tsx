import {useT} from "@/lib/i18n";
import {editableWorkflowFields,fixedWorkflowReferenceGroups,WORKFLOW_SEMANTICS,type WorkflowEditorDraft} from "@/lib/workflowEditor";
import {workflowSourceSchema,type WorkflowGraph,type WorkflowSlot,type WorkflowPromptRole} from "@/lib/comfyWorkflowContract";
import {VOICE_OPTION_LABELS,type VoiceOptionBindings} from "@/lib/workflowVoiceOptions";

export default function WorkflowRoleEditor({draft,graph,onChange}:{draft:WorkflowEditorDraft;graph:WorkflowGraph;onChange:(next:WorkflowEditorDraft)=>void}){
 const t=useT(),fields=editableWorkflowFields(graph),selection=draft.selection;
 const changeSelection=(patch:Partial<typeof selection>)=>onChange({...draft,selection:{...selection,...patch}});
 const patchSlot=(index:number,patch:Partial<WorkflowSlot>)=>changeSelection({slots:selection.slots.map((slot,i)=>i===index?{...slot,...patch}:slot)});
 const patchRole=(index:number,patch:Partial<WorkflowPromptRole>)=>changeSelection({promptRoles:selection.promptRoles.map((role,i)=>i===index?{...role,...patch}:role)});
 const toggle=(list:string[],id:string)=>list.includes(id)?list.filter(value=>value!==id):[...list,id];
 const text=(label:string,value:string,change:(value:string)=>void)=><label className="block">{t(label)}<input className="ml-2 rounded bg-black/20 p-1" value={value} onChange={event=>change(event.target.value)}/></label>;
 return <div className="space-y-3 rounded border border-emerald-400/20 p-3">
  <p>{t("파일은 그대로 보존합니다. 실제 모델 로더·본문 슬롯·출력 노드를 직접 선택하세요. 복수 모델을 임의로 하나로 고르지 않습니다.")}</p>
  {text("workflow ID",draft.source.workflowId,value=>onChange({...draft,source:{...draft.source,workflowId:value}}))}
  {text("표시 이름",draft.source.title,value=>onChange({...draft,source:{...draft.source,title:value}}))}
  <label>{t("출력 종류")} <select value={draft.source.outputKind} onChange={event=>onChange({...draft,source:{...draft.source,outputKind:event.target.value as typeof draft.source.outputKind}})}><option value="">{t("직접 선택")}</option>{["image","video","audio"].map(value=><option key={value}>{value}</option>)}</select></label>
  <label className="ml-2">{t("작업")} <select value={draft.source.operation} onChange={event=>onChange({...draft,source:{...draft.source,operation:event.target.value as typeof draft.source.operation}})}><option value="">{t("직접 선택")}</option>{workflowSourceSchema.shape.operation.options.map(value=><option key={value}>{value}</option>)}</select></label>
  {draft.source.operation==="tts"&&<p>{t("대사와 지시문이 나뉜 노드는 대사를 text 슬롯, 지시문을 필수 positive 역할에 연결하세요. 대사 입력 하나만 있는 노드는 그 입력을 필수 positive 역할로 연결합니다. 화자와 연기 프로필은 명시 바인딩으로 구별하세요.")}</p>}
  <p>{t("입력 슬롯")}</p>
  {selection.slots.map((slot,index)=><div key={index} className="space-y-1 rounded bg-black/10 p-2">
   {text("슬롯 ID",slot.id,id=>patchSlot(index,{id}))}
   <select aria-label={t("실제 노드 입력")} value={`${slot.nodeId}\n${slot.input}`} onChange={event=>{const [nodeId,input]=event.target.value.split("\n");patchSlot(index,{nodeId,input});}}><option value="">{t("노드 입력 선택")}</option>{fields.map(field=><option key={field.label} value={`${field.nodeId}\n${field.input}`}>{field.label}</option>)}</select>
   <select aria-label={t("입력 의미")} value={slot.semantic} onChange={event=>patchSlot(index,{semantic:event.target.value as WorkflowSlot["semantic"]})}>{WORKFLOW_SEMANTICS.map(value=><option key={value}>{value}</option>)}</select>
   <label><input type="checkbox" checked={slot.required} onChange={event=>patchSlot(index,{required:event.target.checked})}/>{t("필수")}</label>
   {text("기본 scalar 값",String(slot.defaultValue??""),value=>{if(!value){patchSlot(index,{defaultValue:undefined});return;}const original=graph[slot.nodeId]?.inputs[slot.input];patchSlot(index,{defaultValue:typeof original==="number"?Number(value):typeof original==="boolean"?value==="true":value});})}
   <button onClick={()=>{const value=graph[slot.nodeId]?.inputs[slot.input];if(["string","number","boolean"].includes(typeof value))patchSlot(index,{defaultValue:value as WorkflowSlot["defaultValue"]});}}>{t("선택한 원본 scalar 값 사용")}</button>
   {/^mask/.test(slot.semantic)&&<select value={slot.maskConvention??""} onChange={event=>patchSlot(index,{maskConvention:event.target.value as WorkflowSlot["maskConvention"]})}><option value="">{t("마스크 규약 선택")}</option><option>white-edit</option><option>alpha-inverted</option></select>}
   {["sourceVideo","maskVideo","poseVideo","depthVideo","cameraGuide","audio","voiceReference"].includes(slot.semantic)&&<select value={slot.alignment??""} onChange={event=>patchSlot(index,{alignment:event.target.value?event.target.value as WorkflowSlot["alignment"]:undefined})}><option value="">{t("시간축 정렬 규약 선택")}</option><option>exact</option><option>resample-in-workflow</option></select>}
   <button onClick={()=>changeSelection({slots:selection.slots.filter((_,i)=>i!==index)})}>{t("슬롯 연결 제거 (파일 보존)")}</button>
  </div>)}
  <button onClick={()=>changeSelection({slots:[...selection.slots,{id:`slot-${selection.slots.length+1}`,nodeId:"",input:"",semantic:"value",required:true}]})}>{t("입력 슬롯 추가")}</button>
  <p>{t("프롬프트 역할")}</p>
  {selection.promptRoles.map((role,index)=><div key={index} className="space-y-1 rounded bg-black/10 p-2">
   {text("역할 ID",role.id,id=>patchRole(index,{id}))}{text("모델 규칙 ID",role.modelRuleId,modelRuleId=>patchRole(index,{modelRuleId}))}
   <p>{t("실제 모델 로더 노드 (직접 지정)")}</p>{Object.entries(graph).map(([id,node])=><label key={id} className="mr-2 inline-block"><input type="checkbox" checked={role.loaderNodeIds.includes(id)} onChange={()=>patchRole(index,{loaderNodeIds:toggle(role.loaderNodeIds,id)})}/>{id} · {node.class_type}</label>)}
   <p>{t("본문 슬롯")}</p>{selection.slots.map(slot=><label key={slot.id} className="mr-2"><input type="checkbox" checked={role.positiveSlotIds.includes(slot.id)} onChange={()=>patchRole(index,{positiveSlotIds:toggle(role.positiveSlotIds,slot.id)})}/>{slot.id}</label>)}
   <p>{t("부정문 슬롯")}</p>{selection.slots.map(slot=><label key={slot.id} className="mr-2"><input type="checkbox" checked={role.negativeSlotIds.includes(slot.id)} onChange={()=>patchRole(index,{negativeSlotIds:toggle(role.negativeSlotIds,slot.id)})}/>{slot.id}</label>)}
   <select aria-label={t("부정문 지원")} value={role.negativeSupport} onChange={event=>patchRole(index,{negativeSupport:event.target.value as WorkflowPromptRole["negativeSupport"]})}>{["unsupported","supported","ignored"].map(value=><option key={value}>{value}</option>)}</select>
   <button onClick={()=>changeSelection({promptRoles:selection.promptRoles.filter((_,i)=>i!==index)})}>{t("역할 연결 제거 (문장 보존)")}</button>
  </div>)}
  <button onClick={()=>changeSelection({promptRoles:[...selection.promptRoles,{id:`role-${selection.promptRoles.length+1}`,modelRuleId:"",loaderNodeIds:[],positiveSlotIds:[],negativeSlotIds:[],negativeSupport:"unsupported"}]})}>{t("역할 추가")}</button>
  <label className="block">{t("선택할 프롬프트 역할")} <select value={selection.selectedPromptRoleId} onChange={event=>{const id=event.target.value;onChange({...draft,source:{...draft.source,modelIds:[...new Set(selection.promptRoles.map(role=>role.modelRuleId).filter(Boolean))],promptProfile:selection.promptRoles.find(role=>role.id===id)?.modelRuleId??""},selection:{...selection,selectedPromptRoleId:id}});}}><option value="">{t("직접 선택")}</option>{selection.promptRoles.map(role=><option key={role.id} value={role.id}>{role.id} / {role.modelRuleId}</option>)}</select></label>
  <p>{t("수집할 출력 노드")}</p>{Object.entries(graph).map(([id,node])=><label key={id} className="mr-2"><input type="checkbox" checked={selection.outputNodeIds.includes(id)} onChange={()=>changeSelection({outputNodeIds:toggle(selection.outputNodeIds,id)})}/>{id} · {node.class_type}</label>)}
  <p>{t("고정 참조 그룹: 등록된 그룹은 계약 JSON에서 편집합니다. 서로 다른 개수는 별도 graph 변형으로 등록하세요.")}</p>
  <button onClick={()=>changeSelection({referenceGroups:[...selection.referenceGroups,...fixedWorkflowReferenceGroups(selection)]})}>{t("미연결 참조 슬롯을 의미별 고정 그룹으로 추가")}</button>
  {draft.source.operation==="tts"&&<div><p>{t("TTS 추가 옵션의 명시 value 슬롯")}</p>{([...Object.keys(VOICE_OPTION_LABELS).filter(key=>key!=="language"),"actingProfile"] as (keyof VoiceOptionBindings)[]).map(key=><label key={key} className="mr-2 inline-block">{t(key==="actingProfile"?"연기 지시 프로필":VOICE_OPTION_LABELS[key])}<select value={draft.voiceOptionBindings?.[key]??""} onChange={event=>{const bindings={...draft.voiceOptionBindings};if(event.target.value)bindings[key]=event.target.value;else delete bindings[key];onChange({...draft,voiceOptionBindings:bindings});}}><option value="">{t("미지원")}</option>{selection.slots.filter(slot=>key==="actingProfile"?slot.semantic==="voiceProfile":key==="speaker"?["value","voiceProfile"].includes(slot.semantic):slot.semantic==="value").map(slot=><option key={slot.id}>{slot.id}</option>)}</select></label>)}</div>}
 </div>;
}
