import {useT} from "@/lib/i18n";
import {revealFile} from "@/lib/mediaLibrary";
import {workflowTaskReceipt} from "@/lib/workflowTaskReceipt";
import type {QueueTask} from "@/lib/taskQueue";

export default function ComfyTaskReceipt({task}:{task:QueueTask}){
 const t=useT(),receipt=workflowTaskReceipt(task);
 if(!receipt)return null;
 return <details className="break-all text-[10px] leading-relaxed text-muted-foreground"><summary className="cursor-pointer">{t("Comfy 접수·수집·등록 상세")}</summary>
  <p>promptId: {receipt.promptId??t("아직 확인되지 않음")}</p>
  <p>{t("연결 주소")}: {receipt.baseUrl??t("기록 없음")}</p>
  {Boolean(receipt.workflowTarget)&&<p>{t("선택 역할")}: {String((receipt.workflowTarget as {workflowId?:string}).workflowId??"")} / {String((receipt.workflowTarget as {roleId?:string}).roleId??"")} / {String((receipt.workflowTarget as {modelRuleId?:string}).modelRuleId??"")}</p>}
  <p>{t("등록 상태")}: {t(receipt.registration==="registered"?"원래 대상에 등록 확인":receipt.registration==="collected-unregistered"?"수집 파일 보존 · 등록 미확인":"수집·등록 미확인")}</p>
  <p>{t(receipt.resubmissionBlocked?"접수 응답을 잃었습니다. 중복 생성을 막기 위해 재제출하지 않습니다.":receipt.phase==="submitted"?"재시도는 기존 promptId로 조회·수집을 이어갑니다.":receipt.phase==="collected"?"재시도는 같은 결과 파일을 재검사하고 등록합니다.":"명시 workflow와 입력을 검사한 뒤 접수합니다.")}</p>
  {receipt.cancelled&&<p className="text-amber-200">{t("앱의 대기를 중지했습니다. 서버 작업 종료를 뜻하지 않습니다. 기존 작업 번호와 수집 파일을 보존합니다.")}</p>}
  {receipt.folder&&<p>{t("수집 폴더")}: {receipt.folder} <button className="underline" onClick={()=>void revealFile(receipt.paths[0])}>{t("수집 폴더 열기")}</button></p>}
  {receipt.paths.map(path=><p key={path}>{t("출력 파일")}: {path}</p>)}
  {receipt.error&&<p className="text-red-300">{t("실패 사유")}: {receipt.error}</p>}
 </details>;
}
