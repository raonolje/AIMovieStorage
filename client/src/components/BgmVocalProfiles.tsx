import type { BgmTrack } from "@/lib/bgmProjects";
import { uid } from "@/lib/projectTypes";
import { useT } from "@/lib/i18n";

export default function BgmVocalProfiles({track,onChange}:{track:BgmTrack;onChange:(fields:Partial<BgmTrack>)=>void}) {
 const t=useT(),singers=track.singers??[];
 return <details className="rounded border border-white/10 p-2 text-xs"><summary>{t("보컬 일관성·멤버 음색·파트")} ({singers.length})</summary>
  <p className="my-2 text-white/60">{t("6명 이상도 같은 ID·음색·음역·발음·창법 프로필을 재사용하고 구간별 리드를 지정하세요. 프로필은 모델의 공식 화자 ID나 보컬 고정 보장이 아닙니다. 단일 리드는 드라이한 한 트랙으로 요청하고, 후렴 구간과 코러스 효과를 구별합니다.")}</p>
  <label>{t("리드 배치")} <select value={track.leadMode??"single"} onChange={event=>onChange({leadMode:event.target.value as "single"|"group"})} className="rounded bg-black/30 p-1"><option value="single">{t("한 구간 한 리드")}</option><option value="group">{t("명시 그룹 파트")}</option></select></label>
  {singers.map((singer,index)=><div key={singer.id} className="my-2 grid gap-1 sm:grid-cols-2">
   <p className="col-span-full text-white/50">{singer.id}</p>
   {([['name','멤버 이름'],['timbre','음색'],['range','음역'],['diction','발음'],['vibrato','비브라토'],['delivery','창법'],['parts','파트·구간']] as const).map(([key,label])=><label key={key}>{t(label)}<input value={singer[key]} onChange={event=>onChange({singers:singers.map((item,i)=>i===index?{...item,[key]:event.target.value}:item)})} className="ml-2 rounded bg-black/30 p-1"/></label>)}
   <button onClick={()=>onChange({singers:singers.filter(item=>item.id!==singer.id)})}>{t("프로필 목록에서 빼기")}</button>
  </div>)}
  <button onClick={()=>onChange({singers:[...singers,{id:uid(),name:"",timbre:"",range:"",diction:"",vibrato:"",delivery:"",parts:""}]})}>{t("멤버 프로필 추가")}</button>
 </details>;
}
