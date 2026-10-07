use serde_json::Value;
use crate::Res;
use crate::comfy_generation::InputBinding;
pub(crate) fn media_kind(semantic:&str)->Option<&'static str>{match semantic{"firstFrame"|"endFrame"|"identityImage"|"sourceImage"|"maskImage"|"poseImage"|"depthImage"=>Some("image"),"sourceVideo"|"maskVideo"|"poseVideo"|"depthVideo"|"cameraGuide"=>Some("video"),"audio"|"voiceReference"=>Some("audio"),_=>None}}
pub(crate) struct Timebase {pub fps:Option<f64>,pub frame_count:Option<f64>,pub duration_seconds:Option<f64>}
/// Callers supply the exact reviewed graph after SHA/policy checks and the actual validated bindings.
/// No caller-provided expected FPS/duration or inferred node execution is authoritative.
pub(crate) fn resolve_timebase(selection:&Value,provenance:&Value,graph:&Value,bindings:&[InputBinding])->Res<Timebase> {
 let slots=selection["slots"].as_array().ok_or("workflow_native_reference_slots_missing")?;
 let fail=|reason:&str,semantic:&str|format!("workflow_native_reference_timebase_{reason}:{semantic}");
 let mut effective=graph.clone();let mut fields=std::collections::HashSet::new();
 for binding in bindings {
  let slot=slots.iter().find(|slot|slot["nodeId"]==binding.node_id&&slot["input"]==binding.input).ok_or_else(||fail("binding_invalid","bindings"))?;
  if !fields.insert((&binding.node_id,&binding.input)){return Err(fail("binding_invalid","bindings"));}
  let inputs=effective.get_mut(&binding.node_id).and_then(|node|node.get_mut("inputs")).and_then(Value::as_object_mut).filter(|inputs|inputs.contains_key(&binding.input)).ok_or_else(||fail("binding_invalid","bindings"))?;
  if binding.file_path.is_some(){continue;}
  let value=binding.value.as_ref().ok_or_else(||fail("binding_invalid","bindings"))?;
  let id=slot["id"].as_str().ok_or_else(||fail("binding_invalid","bindings"))?;
  if provenance["values"].get(id)!=Some(value){return Err(fail("binding_invalid",id));}
  inputs.insert(binding.input.clone(),value.clone());
 }
 let number=|semantic:&str|->Res<Option<f64>>{
  let semantic_slots=slots.iter().filter(|slot|slot["semantic"]==semantic).collect::<Vec<_>>();
  let mut candidates=vec![];
  if !semantic_slots.is_empty() {
   for slot in semantic_slots {let found=bindings.iter().filter(|b|slot["nodeId"]==b.node_id&&slot["input"]==b.input).collect::<Vec<_>>();
    if found.len()!=1||found[0].file_path.is_some(){return Err(fail("binding_invalid",semantic));}
    candidates.push(found[0].value.as_ref().ok_or_else(||fail("binding_invalid",semantic))?);
   }
  } else {
   let names:Vec<&str>=if semantic=="frameCount"{vec!["length","num_frames"]}else{vec![semantic]};
   for node in effective.as_object().ok_or_else(||fail("invalid","graph"))?.values(){for name in &names{if let Some(value)=node["inputs"].get(*name){candidates.push(value);}}}
  }
  if candidates.is_empty(){return Ok(None);}
  let mut values=vec![];for value in candidates {let n=value.as_f64().filter(|n|n.is_finite()&&*n>0.0&&(semantic!="frameCount"||(n.fract()==0.0&&*n<=9007199254740991.0))).ok_or_else(||fail("invalid",semantic))?;values.push(n);}
  if values.iter().any(|n|*n!=values[0]){return Err(fail("ambiguous",semantic));}Ok(Some(values[0]))
 };
 let fps=number("fps")?;let frame_count=number("frameCount")?;let direct=number("durationSeconds")?;
 let derived=fps.zip(frame_count).map(|(fps,frames)|frames/fps);
 if derived.is_some_and(|n|!n.is_finite()||n<=0.0){return Err(fail("invalid","durationSeconds"));}
 if direct.zip(derived).is_some_and(|(direct,derived)|(direct-derived).abs()>1e-9*1.0_f64.max(direct.abs()).max(derived.abs())){return Err(fail("conflict","durationSeconds"));}
 Ok(Timebase{fps,frame_count,duration_seconds:direct.or(derived)})
}
pub(crate) fn validate_constraints(selection:&Value,provenance:&Value,facts:&[Value],graph:&Value,bindings:&[InputBinding])->Res<()> {
 let slots=selection["slots"].as_array().ok_or("workflow_native_reference_slots_missing")?;
 let time=if slots.iter().any(|slot|slot["alignment"]=="exact"&&media_kind(slot["semantic"].as_str().unwrap_or("")).is_some_and(|kind|kind!="image")){Some(resolve_timebase(selection,provenance,graph,bindings)?)}else{None};
 let base=slots.iter().find(|s|s["semantic"]=="sourceImage").or_else(||slots.iter().find(|s|s["semantic"]=="firstFrame")).and_then(|s|facts.iter().find(|f|f["slotId"]==s["id"]));
 for slot in slots {let semantic=slot["semantic"].as_str().unwrap_or("");let Some(kind)=media_kind(semantic)else{continue};if semantic=="maskVideo"{return Err("workflow_native_mask_video_unsupported".into());}let fact=facts.iter().find(|fact|fact["slotId"]==slot["id"]).ok_or("workflow_native_reference_fact_missing")?;
  if fact["kind"]!=kind{return Err("workflow_native_reference_semantic_kind_mismatch".into());}
  if semantic=="maskImage" {let base=base.ok_or("workflow_native_mask_source_required")?;if !["white-edit","alpha-inverted"].contains(&slot["maskConvention"].as_str().unwrap_or(""))||fact["maskConvention"]!=slot["maskConvention"]{return Err("workflow_native_mask_convention_mismatch".into());}if fact["width"].as_u64().is_none_or(|n|n==0)||fact["height"].as_u64().is_none_or(|n|n==0)||fact["width"]!=base["width"]||fact["height"]!=base["height"]{return Err("workflow_native_mask_shape_mismatch".into());}}
  if slot["alignment"]=="exact"&&kind!="image" {let time=time.as_ref().ok_or("workflow_native_reference_duration_mismatch")?;if kind=="video"&&fact["fps"].as_f64().zip(time.fps).is_none_or(|(actual,expected)|!actual.is_finite()||actual<=0.0||(actual-expected).abs()>0.001){return Err("workflow_native_reference_timebase_mismatch".into());}if fact["durationSeconds"].as_f64().zip(time.duration_seconds).is_none_or(|(actual,expected)|!actual.is_finite()||actual<=0.0||(actual-expected).abs()>time.fps.map(|n|1.0/n).unwrap_or(0.02)){return Err("workflow_native_reference_duration_mismatch".into());}}
 }Ok(())
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test]fn v5_f1_ts_native_shared_timebase_priority_and_fail_closed_cases(){
  let data:Value=serde_json::from_str(include_str!("../../client/src/lib/__fixtures__/workflow-timebase-cases.json")).unwrap();
  for case in data["cases"].as_array().unwrap(){let bindings=serde_json::from_value::<Vec<InputBinding>>(case["bindings"].clone()).unwrap();let provenance=serde_json::json!({"values":case["values"]});let result=resolve_timebase(&case["selection"],&provenance,&case["graph"],&bindings);
   if let Some(reason)=case["error"].as_str(){assert!(result.err().is_some_and(|err|err.contains(reason)),"{} should reject {reason}",case["id"]);}else{let time=result.unwrap_or_else(|err|panic!("{}: {err}",case["id"]));for (field,actual) in [("fps",time.fps),("frameCount",time.frame_count),("durationSeconds",time.duration_seconds)]{assert_eq!(actual,case["expected"][field].as_f64(),"{} {field}",case["id"]);}}
  }
 }
}
