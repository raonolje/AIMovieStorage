import { invoke } from "@tauri-apps/api/core";
import { getTask } from "./taskQueue";
import { z } from "zod";
import { assetSrc, importProjectMediaAsset, isVideoFile } from "./mediaLibrary";
import { controlMediaTarget, mediaTargetSchema } from "./controlMedia";
import { checkKoreanPrompt, getProjectSnapshot, ProjectControlError } from "./projectControl";
import { projectFolderName } from "./localProjectStore";
import { readProject, writeProjectAndConfirm } from "./projectWrite";
import { uid, type GeneratedImageAsset, type SceneVideoAsset } from "./projectTypes";
import { saveVideoEndFrame } from "./videoEndFrame";
import { appendPromptHistory } from "./promptHistory";
import { withCutVideoPrompt } from "./cutVideoPromptHistory";

const id = z.string().min(1).max(300);
export const mediaRegisterSchema = z.object({
  projectId: id, expectedRevision: id, operationId: id, target: mediaTargetSchema,
  sourcePath: z.string().min(1).max(4000),
  promptKo: z.string().max(32_000).optional(), promptEn: z.string().max(32_000).optional(),
  makePrimary: z.boolean().optional(),
  previewJobId: id.optional(),
}).strict();
export const assetSetPrimarySchema = z.object({
  projectId: id, expectedRevision: id, target: mediaTargetSchema, assetId: id,
}).strict();

type Target = z.infer<typeof mediaTargetSchema>;
function recordImportedImagePrompt<T extends {
  promptKo?: string; promptEn?: string; negativeKo?: string; negativeEn?: string;
  promptHistory?: ReturnType<typeof appendPromptHistory>;
}>(current: T, promptKo?: string, promptEn?: string): Partial<T> {
  if (promptKo === undefined && promptEn === undefined) return {};
  const next = { ...current,
    ...(promptKo === undefined ? {} : { promptKo }),
    ...(promptEn === undefined ? {} : { promptEn }),
  };
  let history = current.promptHistory;
  if (current.promptKo?.trim() || current.promptEn?.trim())
    history = appendPromptHistory(history, {
      ko: current.promptKo || "", en: current.promptEn || "",
      negativeKo: current.negativeKo || "", negativeEn: current.negativeEn || "", note: "덮어쓰기 전",
    });
  return { ...(promptKo === undefined ? {} : { promptKo }),
    ...(promptEn === undefined ? {} : { promptEn }),
    promptHistory: appendPromptHistory(history, {
    ko: next.promptKo || "", en: next.promptEn || "",
    negativeKo: next.negativeKo || "", negativeEn: next.negativeEn || "", note: "대화 조종기 결과 등록",
  }) } as Partial<T>;
}
function shelf(draft: NonNullable<ReturnType<typeof readProject>>, target: Target, video: boolean) {
  if (target.kind === "character") return draft.characters.find(item => item.id === target.id)?.generatedImages ?? [];
  if (target.kind === "background") return draft.backgrounds.find(item => item.id === target.id)?.generatedImages ?? [];
  const cut = draft.scenes.flatMap(scene => scene.cuts).find(item => item.id === target.id);
  return video ? cut?.videos ?? [] : cut?.images ?? [];
}

/** Codex/Claude가 만든 로컬 결과를 앱 프로젝트에 복사하고 출처·프롬프트·대표 선택을 함께 저장합니다. */
export async function registerControlMedia(raw: unknown) {
  const input = mediaRegisterSchema.parse(raw);
  let previewMetadata: import("./projectTypes").SceneVideoAsset["previewMetadata"];
  let verifyPreview: ((previewPath:string)=>Promise<unknown>) | undefined;
  if(input.previewJobId){
    const job=getTask(input.previewJobId),data=job?.result?.data;
    if(!job||job.kind!=="control.aac-preview"||job.status!=="done"||job.projectId!==input.projectId||data?.cancelled||input.target.kind!=="cut"||data?.sourceCutId!==input.target.id||job.result?.paths?.[0]!==input.sourcePath||input.makePrimary===true||input.promptKo!==undefined||input.promptEn!==undefined)throw new ProjectControlError("invalid_preview_registration","Completed same-project preview job and nonprimary registration required.");
    const master=readProject(input.projectId)?.scenes.flatMap(s=>s.cuts).find(c=>c.id===input.target.id)?.videos.find(v=>v.id===data.masterAssetId);
    if(!master)throw new ProjectControlError("invalid_preview_master","Original master association missing.");
    const verification=(data.meta as {aacPreview?:Record<string,unknown>}|undefined)?.aacPreview;
    if(verification?.allVideoPacketsExact!==true||verification?.allDecodedFramesExact!==true||verification?.originalUnchanged!==true||verification?.lossyAudio!==true||verification?.masterSha256!==data.masterSha256||typeof verification?.outputSha256!=="string")throw new ProjectControlError("invalid_preview_verification","Verified preview provenance required.");
    verifyPreview=(previewPath:string)=>invoke("aac_preview_verify",{sourceVideo:master.filePath,sourceSha256:data.masterSha256,previewVideo:previewPath,previewSha256:verification.outputSha256});
    await verifyPreview(input.sourcePath);
    previewMetadata={masterAssetId:String(data.masterAssetId),masterSha256:String(data.masterSha256),previewJobId:input.previewJobId,lossyAudio:true,verification:(data.meta??{}) as Record<string,unknown>};
  }
  if (/\.wav$/i.test(input.sourcePath)) return registerControlAudio(input);
  const video = isVideoFile(input.sourcePath);
  if (!video && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(input.sourcePath))
    throw new ProjectControlError("unsupported_media", "이미지 또는 영상 파일만 등록할 수 있습니다.");
  if (video && input.target.kind !== "cut")
    throw new ProjectControlError("invalid_target", "영상은 컷에 등록해야 합니다.");
  // 한 언어만 받은 생성 결과의 원문은 에셋 출처에 보관하되 카드의 쌍은 건드리지 않습니다.
  const updateCardPrompt = input.promptKo !== undefined && input.promptEn !== undefined;
  if (updateCardPrompt) checkKoreanPrompt(input.promptKo!, "결과 등록 한글 프롬프트");
  const draft = readProject(input.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const previous = shelf(draft, input.target, video).find(item => item.importOperationId === input.operationId);
  if (previous) {
    if (previous.importSourcePath !== input.sourcePath || (video && (previous as SceneVideoAsset).previewMetadata?.previewJobId !== input.previewJobId))
      throw new ProjectControlError("operation_conflict", "같은 작업 ID에 다른 원본 파일을 지정했습니다.");
    return { assetId: previous.id, path: previous.filePath, reused: true, persisted: true };
  }
  const snapshot = await getProjectSnapshot(input.projectId, "summary");
  if (snapshot.revision !== input.expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트가 바뀌었습니다. 최신 상태를 읽고 다시 요청하세요.", { actualRevision: snapshot.revision });
  const destination = controlMediaTarget(draft, input.target);
  const projectName = projectFolderName(input.projectId, draft.title);
  const imported = await importProjectMediaAsset(input.sourcePath, { projectName,
    assetType: video ? "scene-video" : destination.assetType,
    ownerName: destination.ownerName, stem: destination.stem });
  if (!imported) throw new ProjectControlError("import_unavailable", "데스크톱 앱의 프로젝트 저장 폴더가 필요합니다.");
  if(verifyPreview)await verifyPreview(imported.path);
  const latest = await getProjectSnapshot(input.projectId, "summary");
  if (latest.revision !== input.expectedRevision)
    throw new ProjectControlError("revision_conflict", "파일 복사 중 프로젝트가 바뀌었습니다. 복사된 파일을 확인하고 최신 상태에서 다시 요청하세요.", { actualRevision: latest.revision, copiedPath: imported.path });
  const assetId = uid();
  const registeredEndFrame = video && input.makePrimary
    ? await saveVideoEndFrame({ videoPath: imported.path, projectName,
        ownerName: destination.ownerName, stem: imported.name }) : undefined;
  const provenance = { importOperationId: input.operationId, importSourcePath: input.sourcePath,
    promptKo: input.promptKo, promptEn: input.promptEn };
  const outcome = await writeProjectAndConfirm(input.projectId, current => {
    controlMediaTarget(current, input.target);
    const assets = shelf(current, input.target, video);
    const primary = input.makePrimary ?? (video ? false : !assets.length);
    const image: GeneratedImageAsset = { id: assetId, name: imported.name, filePath: imported.path,
      thumb: assetSrc(imported.path), file: null, isPrimary: primary, ...provenance };
    const movie: SceneVideoAsset = { id: assetId, name: imported.name, filePath: imported.path,
      isPrimary: primary, endFramePath: registeredEndFrame, ...provenance, ...(previewMetadata ? {previewMetadata} : {}) };
    if (input.target.kind === "cut") return { ...current, scenes: current.scenes.map(scene => ({ ...scene,
      cuts: scene.cuts.map(cut => cut.id !== input.target.id ? cut : video
        ? { ...cut, videos: [...cut.videos.map(item => primary ? { ...item, isPrimary: false } : item), movie],
          ...(!updateCardPrompt ? {} : withCutVideoPrompt(cut, {
            ko: input.promptKo ?? cut.videoPromptKo ?? "", en: input.promptEn ?? cut.videoPromptEn ?? "",
          }, "대화 조종기 결과 등록")) }
        : { ...cut, images: [...cut.images.map(item => primary ? { ...item, isPrimary: false } : item), image],
          ...(!updateCardPrompt ? {} : recordImportedImagePrompt(cut, input.promptKo, input.promptEn)) }) })) };
    if (input.target.kind === "character") return { ...current, characters: current.characters.map(item => item.id !== input.target.id ? item : {
      ...item, generatedImages: [...item.generatedImages.map(asset => primary ? { ...asset, isPrimary: false } : asset), image],
      ...(!updateCardPrompt ? {} : recordImportedImagePrompt(item, input.promptKo, input.promptEn)),
    }) };
    return { ...current, backgrounds: current.backgrounds.map(item => item.id !== input.target.id ? item : {
      ...item, generatedImages: [...item.generatedImages.map(asset => primary ? { ...asset, isPrimary: false } : asset), image],
      ...(!updateCardPrompt ? {} : recordImportedImagePrompt(item, input.promptKo, input.promptEn)),
    }) };
  });
  if (!outcome.persisted) throw new ProjectControlError("save_failed", "파일은 복사했지만 프로젝트 등록을 확인하지 못했습니다.", { copiedPath: imported.path });
  return { assetId, path: imported.path, reused: false, persisted: true,
    cardPromptUpdated: updateCardPrompt, primary: input.makePrimary ?? (video ? false : !shelf(draft, input.target, video).length) };
}

/** 선반마다 대표 한 장만 남깁니다. */
async function registerControlAudio(input: z.infer<typeof mediaRegisterSchema>) {
  if (input.target.kind !== "character")
    throw new ProjectControlError("invalid_target", "WAV는 인물의 음성 자료로 등록해야 합니다.");
  const draft = readProject(input.projectId);
  const owner = draft?.characters.find(item => item.id === input.target.id);
  if (!draft || !owner) throw new ProjectControlError("character_not_found", "인물을 찾지 못했습니다.");
  const previous = owner.voiceReferences?.find(item => item.operationId === input.operationId);
  if (previous) {
    if (previous.importSourcePath !== input.sourcePath)
      throw new ProjectControlError("operation_conflict", "같은 작업 ID의 원음 경로가 다릅니다.");
    return {assetId:previous.id,path:previous.filePath,reused:true,persisted:true};
  }
  const snapshot = await getProjectSnapshot(input.projectId,"summary");
  if (snapshot.revision !== input.expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트의 최신 상태를 읽어 주세요.");
  const imported = await importProjectMediaAsset(input.sourcePath, {
    projectName:projectFolderName(input.projectId,draft.title),assetType:"character-voice",
    ownerName:owner.name,stem:`${owner.name}_입력음성`,
  });
  if (!imported) throw new ProjectControlError("import_unavailable", "로컬 음원 복사가 필요합니다.");
  const latest = await getProjectSnapshot(input.projectId,"summary");
  if (latest.revision !== input.expectedRevision)
    throw new ProjectControlError("revision_conflict", "복사 중 프로젝트가 바뀌었습니다.", {copiedPath:imported.path});
  const assetId=uid(),primary=input.makePrimary ?? false;
  const outcome=await writeProjectAndConfirm(input.projectId,current=>{
    const character=current.characters.find(item=>item.id===input.target.id);
    if (!character || JSON.stringify(character.voiceReferences || [])!==JSON.stringify(owner.voiceReferences || []))
      throw new ProjectControlError("revision_conflict", "인물 음성 자료가 바뀌었습니다.");
    return {...current,characters:current.characters.map(item=>item.id!==input.target.id ? item : {
      ...item,voiceReferences:[...(item.voiceReferences || []).map(reference=>primary ? {...reference,isPrimary:false} : reference),
        {id:assetId,operationId:input.operationId,filePath:imported.path,source:"imported" as const,
          importSourcePath:input.sourcePath,dialogue:input.promptKo,isPrimary:primary}],
    })};
  });
  if (!outcome.persisted) throw new ProjectControlError("save_failed", "음원 등록 저장을 확인하지 못했습니다.",{copiedPath:imported.path});
  return {assetId,path:imported.path,reused:false,persisted:true,primary,cardPromptUpdated:false,
    source:"imported",audioValidation:"native_a2v_validates_stereo_pcm16_before_inference",lipSyncVerified:false};
}

export async function setControlAssetPrimary(raw: unknown) {
  const input = assetSetPrimarySchema.parse(raw);
  const snapshot = await getProjectSnapshot(input.projectId, "summary");
  if (snapshot.revision !== input.expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트가 바뀌었습니다. 최신 상태를 읽고 다시 요청하세요.", { actualRevision: snapshot.revision });
  const draft = readProject(input.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const video = input.target.kind === "cut" && draft.scenes.flatMap(scene => scene.cuts)
    .find(cut => cut.id === input.target.id)?.videos.some(item => item.id === input.assetId) === true;
  if (!shelf(draft, input.target, video).some(item => item.id === input.assetId))
    throw new ProjectControlError("asset_not_found", "해당 대상의 이미지 또는 영상을 찾지 못했습니다.");
  const selected = video && input.target.kind === "cut"
    ? draft.scenes.flatMap(scene => scene.cuts).find(cut => cut.id === input.target.id)?.videos.find(item => item.id === input.assetId)
    : undefined;
  const target = controlMediaTarget(draft, input.target);
  const endFramePath = selected?.filePath && !selected.endFramePath
    ? await saveVideoEndFrame({ videoPath: selected.filePath, projectName: projectFolderName(input.projectId, draft.title),
        ownerName: target.ownerName, stem: selected.name }) : selected?.endFramePath;
  const outcome = await writeProjectAndConfirm(input.projectId, current => {
    const select = <T extends { id: string; isPrimary?: boolean; endFramePath?: string }>(items: T[]) => items.map(item => ({ ...item,
      isPrimary: item.id === input.assetId, ...(item.id === input.assetId && endFramePath ? { endFramePath } : {}) }));
    if (input.target.kind === "cut") return { ...current, scenes: current.scenes.map(scene => ({ ...scene,
      cuts: scene.cuts.map(cut => cut.id !== input.target.id ? cut : video
        ? { ...cut, videos: select(cut.videos) } : { ...cut, images: select(cut.images) }) })) };
    if (input.target.kind === "character") return { ...current, characters: current.characters.map(item => item.id !== input.target.id ? item : { ...item, generatedImages: select(item.generatedImages) }) };
    return { ...current, backgrounds: current.backgrounds.map(item => item.id !== input.target.id ? item : { ...item, generatedImages: select(item.generatedImages) }) };
  });
  if (!outcome.persisted) throw new ProjectControlError("save_failed", "대표 이미지 선택을 저장하지 못했습니다.");
  return { assetId: input.assetId, primary: true, persisted: true };
}
