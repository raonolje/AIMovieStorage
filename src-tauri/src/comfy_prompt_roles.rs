use serde_json::Value;
use crate::Res;

/// Exact reviewed topology determines which body belongs to each slot. It never chooses a model or role.
pub(crate) fn slot_body(selection:&Value,target:&Value,provenance:&Value,slot_id:&str,semantic:&str)->Res<String>{
 let field=match semantic{"positive"=>"positiveSlotIds","negative"=>"negativeSlotIds",_=>return Err("workflow_native_prompt_semantic_invalid".into())};
 let roles=selection["promptRoles"].as_array().ok_or("workflow_native_prompt_roles_missing")?;
 let owners=roles.iter().filter(|role|role[field].as_array().is_some_and(|ids|ids.iter().any(|id|id==slot_id))).collect::<Vec<_>>();
 if owners.len()!=1{return Err("workflow_native_prompt_slot_role_ambiguous".into());}
 let role=owners[0];let primary=role["id"]==target["roleId"];
 let value=if primary{&provenance[if semantic=="positive"{"prompt"}else{"negative"}]}else{&provenance["rolePrompts"][role["id"].as_str().ok_or("workflow_native_prompt_role_invalid")?][semantic]};
 let text=if semantic=="negative"&&value.is_null(){""}else{value.as_str().ok_or("workflow_native_role_prompt_missing")?};
 if text.len()>32000||(semantic=="positive"&&text.trim().is_empty())||(semantic=="negative"&&!text.is_empty()&&role["negativeSupport"]!="supported"){return Err("workflow_native_role_prompt_invalid".into());}Ok(text.into())
}
pub(crate) fn validate_bodies(selection:&Value,target:&Value,provenance:&Value)->Res<()> {
 let roles=selection["promptRoles"].as_array().ok_or("workflow_native_prompt_roles_missing")?;
 let selected=roles.iter().find(|role|role["id"]==target["roleId"]).ok_or("workflow_native_prompt_role_invalid")?;
 if selection["selectedPromptRoleId"]!=target["roleId"]||selected["modelRuleId"]!=target["modelRuleId"]{return Err("workflow_native_prompt_target_changed".into());}
 if let Some(provided)=provenance["rolePrompts"].as_object(){for(id,body)in provided{if target["roleId"]==id.as_str()||!roles.iter().any(|role|role["id"]==*id)||!body.as_object().is_some_and(|fields|fields.keys().all(|key|["positive","negative"].contains(&key.as_str()))){return Err("workflow_native_unknown_role_prompt".into());}}}else if !provenance["rolePrompts"].is_null(){return Err("workflow_native_role_prompt_invalid".into());}
 for role in roles {for semantic in ["positive","negative"]{let field=if semantic=="positive"{"positiveSlotIds"}else{"negativeSlotIds"};let ids=role[field].as_array().ok_or("workflow_native_prompt_role_invalid")?;if semantic=="positive"&&ids.is_empty(){return Err("workflow_native_prompt_role_invalid".into());}for id in ids{slot_body(selection,target,provenance,id.as_str().ok_or("workflow_native_prompt_slot_invalid")?,semantic)?;}
  if semantic=="negative"&&ids.is_empty(){let text=if role["id"]==target["roleId"]{&provenance["negative"]}else{&provenance["rolePrompts"][role["id"].as_str().unwrap_or("")]["negative"]};if text.as_str().is_some_and(|text|!text.is_empty()){return Err("workflow_native_negative_unsupported".into());}}
 }}Ok(())
}
