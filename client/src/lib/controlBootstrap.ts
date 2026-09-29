import { z } from "zod";
import { assetSrc, deleteProjectMediaFile, importProjectMediaAsset } from "./mediaLibrary";
import { toLlmImage } from "./llm";
import { videoClipLimitOf } from "./modelRules";
import { buildPromptRequestText } from "./promptRequest";
import { summarizeProjectContext } from "./projectContext";
import { applyBootstrapToDraft, hasBootstrapContent, parseBootstrapDetails, parseBootstrapOutline, parseBootstrapShots, summarizeBootstrap } from "./projectBootstrap";
import { getProjectSnapshot, ProjectControlError } from "./projectControl";
import { readProject, writeProjectAndConfirm } from "./projectWrite";
import { expectEmptyProjectSave } from "./localProjectStore";
import { projectFolderName } from "./localProjectStore";
import { sameImmutableJson } from "./immutableJson";
import { DOCUMENT_EXTENSIONS, readDocumentText } from "./documentText";
import type { ProjectDraft } from "./projectTypes";

const id = z.string().min(1).max(300);
const base = z.object({ projectId: id, expectedRevision: id });
export const bootstrapInputSchema = base.extend({ source: z.string().min(1).max(500_000), hint: z.string().max(50_000).default(""),
  counts: z.object({ characters: z.number().int().min(0).max(30), backgrounds: z.number().int().min(0).max(30), scenes: z.number().int().min(0).max(30) }).strict(),
  mode: z.enum(["append", "replace"]).default("append"), richPrompts: z.boolean().default(true) }).strict();
export const bootstrapReferenceRegisterSchema = base.extend({ operationId: id,
  sourcePath: z.string().min(1).max(4000), kind: z.enum(["image", "video"]), note: z.string().max(5000).default("") }).strict();
export const bootstrapReferenceUpdateSchema = base.extend({ referenceId: id,
  note: z.string().max(5000).optional(), remove: z.boolean().default(false) }).strict();
export const bootstrapDocumentImportSchema = base.extend({ operationId: id,
  sourcePath: z.string().min(1).max(4000) }).strict();
export const bootstrapInputReadSchema = z.object({ projectId: id, detail: z.enum(["summary", "full"]).default("summary") }).strict();
export const bootstrapPrepareSchema = base.extend({ phase: z.enum(["outline", "details", "shots"]),
  outline: z.unknown().optional(), details: z.unknown().optional() }).strict();
export const bootstrapApplySchema = base.extend({ operationId: id, inputFingerprint: id,
  outline: z.unknown(), details: z.unknown(), shots: z.unknown().optional(), confirmedReplace: z.boolean().default(false) }).strict();
export const bootstrapPromptTargetsSchema = z.object({ projectId: id, operationId: id.optional() }).strict();

type PromptTarget = NonNullable<ProjectDraft["controlBootstrapPlans"]>[number]["targets"][number];
function plannedTargets(before: ProjectDraft, after: ProjectDraft): PromptTarget[] {
  const previousCharacters = new Set(before.characters.map((item) => item.id));
  const previousBackgrounds = new Set(before.backgrounds.map((item) => item.id));
  const previousScenes = new Set(before.scenes.map((item) => item.id));
  return [
    ...after.characters.filter((item) => !previousCharacters.has(item.id))
      .map((item) => ({ kind: "character" as const, id: item.id })),
    ...after.backgrounds.filter((item) => !previousBackgrounds.has(item.id))
      .map((item) => ({ kind: "background" as const, id: item.id })),
    ...after.scenes.filter((scene) => !previousScenes.has(scene.id))
      .flatMap((scene) => scene.cuts.flatMap((cut) => [
        { kind: "cutImage" as const, sceneId: scene.id, cutId: cut.id },
        { kind: "cutVideo" as const, sceneId: scene.id, cutId: cut.id },
      ])),
  ];
}

/** 3단계 적용 뒤 카드별 API와 동일한 4단계 요청을 어디까지 했는지 다시 읽습니다. */
export async function getBootstrapPromptTargets(raw: unknown) {
  const request = bootstrapPromptTargetsSchema.parse(raw);
  const snapshot = await getProjectSnapshot(request.projectId, "summary");
  const draft = draftAt(request.projectId);
  const plan = request.operationId
    ? draft.controlBootstrapPlans?.find((item) => item.operationId === request.operationId)
    : draft.controlBootstrapPlans?.at(-1);
  if (!plan) throw new ProjectControlError("target_not_found", "이 일괄 생성의 상세 프롬프트 작업표를 찾지 못했습니다.");
  const targets = plan.targets.map((target) => {
    const item = target.kind === "character" ? draft.characters.find((entry) => entry.id === target.id)
      : target.kind === "background" ? draft.backgrounds.find((entry) => entry.id === target.id)
      : draft.scenes.find((entry) => entry.id === target.sceneId)?.cuts.find((entry) => entry.id === target.cutId);
    const history = target.kind === "cutVideo" && item && "videoPromptHistory" in item
      ? item.videoPromptHistory : item?.promptHistory;
    const completed = Boolean(history?.some((entry) =>
      (entry.note || "").includes("프롬프트 작성") && !(entry.note || "").includes("규칙 조립")));
    return { target, exists: Boolean(item), completed };
  });
  return { projectId: request.projectId, revision: snapshot.revision, operationId: plan.operationId,
    total: targets.length, remaining: targets.filter((item) => item.exists && !item.completed).length,
    targets, nextAction: "미완료 target마다 prompt_prepare를 호출하고 같은 revision으로 project_update의 prompt.apply에 한·영 본문과 네거티브를 저장하세요. 각 저장 뒤 최신 revision을 다시 읽으세요." };
}

async function fingerprint(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}
function draftAt(projectId: string) {
  const draft = readProject(projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  return draft;
}
async function checkRevision(projectId: string, expectedRevision: string) {
  const current = await getProjectSnapshot(projectId, "summary");
  if (current.revision !== expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트가 바뀌었습니다. 최신 판을 읽어 주세요.", { actualRevision: current.revision });
}

/** 다른 대화에서 이어갈 때 기존 원문·참고 파일·문서와 이름표를 다시 읽습니다. */
export async function getBootstrapInput(raw: unknown) {
  const { runOf, refTag } = await import("./bootstrapStore");
  const request = bootstrapInputReadSchema.parse(raw);
  const revision = (await getProjectSnapshot(request.projectId, "summary")).revision;
  const input = runOf(request.projectId).input;
  return { projectId: request.projectId, revision, inputFingerprint: await fingerprint(input),
    source: request.detail === "full" ? input.source : input.source.slice(0, 20_000),
    sourceTruncated: request.detail !== "full" && input.source.length > 20_000,
    hint: input.hint, counts: input.counts, mode: input.mode, richPrompts: input.richPrompts,
    refs: (input.refs ?? []).map((item) => ({ ...item, tag: refTag(input.refs ?? [], item.id) })),
    docs: input.docs ?? [] };
}

/** 앱의 일괄 생성 입력칸을 Codex/Claude에서 채웁니다. 업로드 레퍼런스는 앱 칸의 기존 파일을 보존합니다. */
export async function updateBootstrapInput(raw: unknown) {
  const { runOf, setBootstrapInput } = await import("./bootstrapStore");
  const request = bootstrapInputSchema.parse(raw);
  await checkRevision(request.projectId, request.expectedRevision);
  draftAt(request.projectId);
  setBootstrapInput(request.projectId, { source: request.source, hint: request.hint,
    counts: Object.fromEntries(Object.entries(request.counts).map(([key, value]) => [key, String(value)])) as { characters: string; backgrounds: string; scenes: string },
    mode: request.mode, richPrompts: request.richPrompts });
  const input = runOf(request.projectId).input;
  return { projectId: request.projectId, revision: request.expectedRevision, inputFingerprint: await fingerprint(input),
    referenceCount: input.refs?.length ?? 0 };
}

/** 일괄 생성 UI와 같은 @ref_img/@ref_mov 이름으로 로컬 참고 파일을 프로젝트에 둡니다. */
export async function registerBootstrapReference(raw: unknown) {
  const { runOf, setBootstrapInput, refTag } = await import("./bootstrapStore");
  const request = bootstrapReferenceRegisterSchema.parse(raw);
  await checkRevision(request.projectId, request.expectedRevision);
  const draft = draftAt(request.projectId);
  const referenceId = `control-ref-${await fingerprint(request.operationId)}`;
  const before = runOf(request.projectId).input;
  const existing = (before.refs ?? []).find((item) => item.id === referenceId);
  if (existing) {
    if (existing.importSourcePath !== request.sourcePath || existing.kind !== request.kind)
      throw new ProjectControlError("operation_conflict", "같은 작업 ID에 다른 참고 파일이 지정됐습니다.");
    return { referenceId, path: existing.path, tag: refTag(before.refs ?? [], referenceId), reused: true,
      inputFingerprint: await fingerprint(before) };
  }
  const matches = request.kind === "image" ? /\.(png|jpe?g|webp|bmp|gif)$/i : /\.(mp4|mov|webm|m4v|mkv|avi)$/i;
  if (!matches.test(request.sourcePath)) throw new ProjectControlError("unsupported_media", "참고 파일 종류와 확장자가 맞지 않습니다.");
  const refs = before.refs ?? [];
  const number = refs.filter((item) => item.kind === request.kind).length + 1;
  const stem = `ref_${request.kind === "image" ? "img" : "mov"}_${number}`;
  const projectName = projectFolderName(request.projectId, draft.title);
  const saved = await importProjectMediaAsset(request.sourcePath, { projectName,
    assetType: request.kind === "image" ? "scene-cut" : "scene-video", ownerName: "일괄 생성 참고", stem });
  if (!saved) throw new ProjectControlError("import_unavailable", "앱 프로젝트 저장 폴더를 확인하세요.");
  let retained = false;
  try {
    await checkRevision(request.projectId, request.expectedRevision);
    if (await fingerprint(runOf(request.projectId).input) !== await fingerprint(before))
      throw new ProjectControlError("revision_conflict", "참고 파일을 복사하는 동안 일괄 생성 입력이 바뀌었습니다.");
    const next = [...refs, { id: referenceId, path: saved.path, name: saved.name || stem,
      kind: request.kind, note: request.note, importSourcePath: request.sourcePath }];
    setBootstrapInput(request.projectId, { refs: next });
    retained = true;
    return { referenceId, path: saved.path, tag: refTag(next, referenceId), reused: false,
      inputFingerprint: await fingerprint(runOf(request.projectId).input) };
  } finally {
    if (!retained) await deleteProjectMediaFile(projectName, saved.path).catch(() => undefined);
  }
}

/** 레퍼런스를 요청에서 빼도 원본은 다른 컷·모캡에서 다시 쓸 수 있게 폴더에 남깁니다. */
export async function updateBootstrapReference(raw: unknown) {
  const { runOf, setBootstrapInput, refTag } = await import("./bootstrapStore");
  const request = bootstrapReferenceUpdateSchema.parse(raw);
  await checkRevision(request.projectId, request.expectedRevision);
  draftAt(request.projectId);
  if (!request.remove && request.note === undefined)
    throw new ProjectControlError("invalid_request", "참고 파일의 note를 고치거나 remove를 지정하세요.");
  const input = runOf(request.projectId).input;
  if (!(input.refs ?? []).some((item) => item.id === request.referenceId))
    throw new ProjectControlError("target_not_found", "일괄 생성 참고 파일을 찾지 못했습니다.");
  const refs = request.remove ? (input.refs ?? []).filter((item) => item.id !== request.referenceId)
    : (input.refs ?? []).map((item) => item.id === request.referenceId ? { ...item, note: request.note! } : item);
  setBootstrapInput(request.projectId, { refs });
  return { referenceId: request.referenceId, removed: request.remove,
    ...(request.remove ? {} : { tag: refTag(refs, request.referenceId) }), inputFingerprint: await fingerprint(runOf(request.projectId).input) };
}

/** PDF·워드·텍스트를 UI와 같은 추출기로 읽고 원본을 DOCU에 둔 뒤 시나리오에 덧붙입니다. */
export async function importBootstrapDocument(raw: unknown) {
  const { runOf, setBootstrapInput } = await import("./bootstrapStore");
  const request = bootstrapDocumentImportSchema.parse(raw);
  await checkRevision(request.projectId, request.expectedRevision);
  const draft = draftAt(request.projectId);
  const documentId = `control-doc-${await fingerprint(request.operationId)}`;
  const before = runOf(request.projectId).input;
  const existing = (before.docs ?? []).find((item) => item.id === documentId);
  if (existing) {
    if (existing.importSourcePath !== request.sourcePath)
      throw new ProjectControlError("operation_conflict", "같은 작업 ID에 다른 문서가 지정됐습니다.");
    return { documentId, path: existing.path, chars: existing.chars, pages: existing.pages,
      reused: true, inputFingerprint: await fingerprint(before) };
  }
  const fileName = request.sourcePath.split(/[\\/]/).pop() || "";
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (!DOCUMENT_EXTENSIONS.some((item) => item === extension))
    throw new ProjectControlError("unsupported_document", "PDF·DOCX·텍스트 문서를 지정하세요.");
  const projectName = projectFolderName(request.projectId, draft.title);
  const saved = await importProjectMediaAsset(request.sourcePath, { projectName, assetType: "document", ownerName: "",
    stem: fileName.replace(/\.[^.]+$/, "") });
  if (!saved) throw new ProjectControlError("import_unavailable", "앱 프로젝트 저장 폴더를 확인하세요.");
  let retained = false;
  try {
    const response = await fetch(assetSrc(saved.path));
    if (!response.ok) throw new ProjectControlError("document_unreadable", "저장한 문서를 읽지 못했습니다.");
    const file = new File([await response.blob()], fileName);
    const parsed = await readDocumentText(file);
    if (!parsed.text.trim()) throw new ProjectControlError("empty_document", "문서에서 읽을 글을 찾지 못했습니다.");
    await checkRevision(request.projectId, request.expectedRevision);
    if (await fingerprint(runOf(request.projectId).input) !== await fingerprint(before))
      throw new ProjectControlError("revision_conflict", "문서를 읽는 동안 일괄 생성 입력이 바뀌었습니다.");
    const chunk = `### ${fileName}\n\n${parsed.text}`;
    const source = [before.source.trim(), chunk].filter(Boolean).join("\n\n");
    if (source.length > 500_000) throw new ProjectControlError("source_too_long", "시나리오 입력 상한 50만 자를 넘습니다.");
    const docs = [...(before.docs ?? []), { id: documentId, path: saved.path, name: fileName, importSourcePath: request.sourcePath,
      chars: parsed.text.length, pages: parsed.pages }];
    setBootstrapInput(request.projectId, { source, docs });
    retained = true;
    return { documentId, path: saved.path, chars: parsed.text.length, pages: parsed.pages,
      sourceLength: source.length, reused: false, inputFingerprint: await fingerprint(runOf(request.projectId).input) };
  } finally {
    if (!retained) await deleteProjectMediaFile(projectName, saved.path).catch(() => undefined);
  }
}

/** 앱의 1/3·2/3·3/3 API 요청과 같은 템플릿·자료로 대화용 요청문을 준비합니다. */
export async function prepareBootstrapPrompt(raw: unknown) {
  const { runOf, refTag } = await import("./bootstrapStore");
  const request = bootstrapPrepareSchema.parse(raw);
  await checkRevision(request.projectId, request.expectedRevision);
  const draft = draftAt(request.projectId);
  const input = runOf(request.projectId).input;
  if (!input.source.trim()) throw new ProjectControlError("empty_source", "먼저 bootstrap_input_update로 시나리오를 등록하세요.");
  if (request.phase !== "outline" && request.outline === undefined)
    throw new ProjectControlError("missing_previous_result", "2·3단계에는 앞서 받은 작품 목록 답을 넣으세요.");
  if (request.phase === "shots" && request.details === undefined)
    throw new ProjectControlError("missing_previous_result", "3단계에는 앞서 받은 상세·장면 답을 넣으세요.");
  const usable = (input.refs ?? []).filter((item) => item.kind !== "image" || Boolean(assetSrc(item.path)));
  const refImages = usable.filter((item) => item.kind === "image").map((item) => assetSrc(item.path)).slice(0, 4);
  const refs = usable.map((item) => ({ 이름표: refTag(usable, item.id), 이름: item.name,
    종류: item.kind === "video" ? "영상" : "그림", "이렇게 쓰세요": item.note || "참고 자료" }));
  const outline = request.phase === "outline" ? undefined : parseBootstrapOutline(request.outline);
  const details = request.phase === "shots" ? parseBootstrapDetails(request.details) : undefined;
  const counts = Object.fromEntries(Object.entries(input.counts).map(([key, value]) => [key, Math.min(30, Math.max(0, Number(value) || 0))]));
  const project = summarizeProjectContext(draft).facts;
  const options = request.phase === "outline" ? {
    task: "projectBootstrap" as const, template: "project-bootstrap" as const,
    data: { source: input.source.trim(), hint: input.hint.trim(), counts,
      existing: input.mode === "append" ? { characters: draft.characters.map((item) => item.name).filter(Boolean), backgrounds: draft.backgrounds.map((item) => item.name).filter(Boolean) } : { characters: [], backgrounds: [] },
      project, refs },
  } : request.phase === "details" ? {
    task: "projectDetails" as const, template: "project-details" as const,
    data: { outline, source: input.source.trim(), counts, project, refs,
      videoModel: videoClipLimitOf(draft.magnific?.videoModel) },
  } : {
    task: "projectDetails" as const, template: "project-shots" as const,
    data: { outline, scenes: details!.scenes, project, refs, richPrompts: input.richPrompts !== false ? "yes" : "no" },
  };
  const parts = await buildPromptRequestText(options, refImages.length);
  const images = await Promise.all(refImages.map((source) => toLlmImage(source)));
  await checkRevision(request.projectId, request.expectedRevision);
  if (await fingerprint(runOf(request.projectId).input) !== await fingerprint(input))
    throw new ProjectControlError("revision_conflict", "일괄 생성 입력이 바뀌었습니다. 요청문을 다시 준비하세요.");
  const result = { projectId: request.projectId, revision: request.expectedRevision, inputFingerprint: await fingerprint(input),
    phase: request.phase, request: [parts.fixed, parts.fresh].filter(Boolean).join("\n\n---\n\n"), imageCount: images.length };
  return { content: [{ type: "text" as const, text: JSON.stringify(result) },
    ...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mediaType }))], structuredContent: result };
}

/** 세 답을 화면의 applyBootstrapToDraft로 한 번만 저장하고 같은 일괄 생성 이력에 남깁니다. */
export async function applyBootstrapResult(raw: unknown) {
  const { runOf, keepPast } = await import("./bootstrapStore");
  const request = bootstrapApplySchema.parse(raw);
  const draft = draftAt(request.projectId);
  if (draft.controlBootstrapOperations?.includes(request.operationId)) {
    if (draft.controlBootstrapPlans?.some((item) => item.operationId === request.operationId))
      return { ...(await getBootstrapPromptTargets({ projectId: request.projectId, operationId: request.operationId })), alreadyApplied: true };
    return { ...(await getProjectSnapshot(request.projectId, "summary")), alreadyApplied: true,
      promptTargetsUnavailable: true };
  }
  await checkRevision(request.projectId, request.expectedRevision);
  const input = runOf(request.projectId).input;
  if (await fingerprint(input) !== request.inputFingerprint)
    throw new ProjectControlError("revision_conflict", "일괄 생성 입력이 바뀌었습니다. 새 요청문으로 다시 진행하세요.");
  if (input.mode === "replace" && !request.confirmedReplace)
    throw new ProjectControlError("replace_confirmation_required", "기존 장면과 그림 없는 카드를 목록에서 비웁니다. confirmedReplace를 명시해야 합니다.");
  const result = { outline: parseBootstrapOutline(request.outline), details: parseBootstrapDetails(request.details),
    ...(request.shots === undefined ? {} : { shots: parseBootstrapShots(request.shots) }) };
  if (!hasBootstrapContent(result)) throw new ProjectControlError("empty_result", "답에 만들 카드와 장면이 없습니다.");
  const summary = summarizeBootstrap(result, { characters: draft.characters.map((item) => item.name), backgrounds: draft.backgrounds.map((item) => item.name) });
  if (input.mode === "replace" && !summary.characterNames.length && !summary.backgroundNames.length && !summary.sceneTitles.length)
    throw new ProjectControlError("empty_result", "빈 답으로 프로젝트를 비울 수 없습니다.");
  let conflicted = false;
  let targets: PromptTarget[] = [];
  const outcome = await writeProjectAndConfirm(request.projectId, (current) => {
    if (!sameImmutableJson(current, draft)) { conflicted = true; return {}; }
    if (input.mode === "replace") expectEmptyProjectSave();
    const applied = applyBootstrapToDraft(current, result, { mode: input.mode });
    targets = plannedTargets(current, { ...current, ...applied });
    return { ...applied,
      controlBootstrapOperations: [...(current.controlBootstrapOperations ?? []), request.operationId].slice(-64),
      controlBootstrapPlans: [...(current.controlBootstrapPlans ?? []), { operationId: request.operationId, targets }].slice(-8) };
  });
  if (conflicted) throw new ProjectControlError("revision_conflict", "적용 직전 프로젝트가 바뀌었습니다. 다시 읽어 주세요.");
  if (!outcome.persisted) throw new ProjectControlError("save_failed", outcome.why || "일괄 생성 저장에 실패했습니다.");
  keepPast(request.projectId, result, input);
  const latest = await getProjectSnapshot(request.projectId, "summary");
  return { projectId: request.projectId, revision: latest.revision, persisted: true, summary,
    richPrompts: input.richPrompts !== false, promptTargets: targets,
    nextAction: input.richPrompts === false ? "상세 프롬프트 단계를 건너뛰었습니다."
      : "promptTargets의 각 카드에 prompt_prepare → project_update prompt.apply를 순서대로 실행하세요. 이 목록은 bootstrap_prompt_targets에서 다시 읽을 수 있습니다." };
}
