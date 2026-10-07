import { appPromptSelection } from "./appPromptRequest";
import { promptStaleMessage } from "./promptModelSelection";
import { z } from "zod";
import { appPromptTargetSchema, getProjectSnapshot, ProjectControlError } from "./projectControl";
import { readProject } from "./projectWrite";

export const promptStatusSchema = z.object({
  projectId: z.string().min(1).max(300),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(100),
  missingOnly: z.boolean().default(false),
}).strict();
export const promptHistoryReadSchema = z.object({
  projectId: z.string().min(1).max(300),
  target: appPromptTargetSchema,
  entryId: z.string().min(1).max(300).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();

/** 한 컷의 예전 프롬프트를 대화에서 다시 검토할 수 있게, 목록과 본문을 분리해 읽습니다. */
export async function getProjectPromptHistory(raw: unknown) {
  const request = promptHistoryReadSchema.parse(raw);
  const snapshot = await getProjectSnapshot(request.projectId, "summary");
  const draft = readProject(request.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const target = request.target;
  const owner = target.kind === "character" ? draft.characters.find((item) => item.id === target.id)
    : target.kind === "background" ? draft.backgrounds.find((item) => item.id === target.id)
      : target.kind === "sceneVideo" ? draft.scenes.find((item) => item.id === target.sceneId)
        : draft.scenes.find((item) => item.id === target.sceneId)?.cuts.find((item) => item.id === target.cutId);
  if (!owner) throw new ProjectControlError("target_not_found", "프롬프트 카드를 찾지 못했습니다.");
  const history = target.kind === "sceneVideo" ? draft.scenes.find((item) => item.id === target.sceneId)?.storyboardPromptHistory ?? []
    : target.kind === "cutVideo" ? draft.scenes.find((item) => item.id === target.sceneId)?.cuts.find((item) => item.id === target.cutId)?.videoPromptHistory ?? []
      : "promptHistory" in owner ? owner.promptHistory ?? [] : [];
  if (request.entryId) {
    const found = history.find((entry) => entry.id === request.entryId);
    if (!found) throw new ProjectControlError("target_not_found", "요청한 프롬프트 이력 판을 찾지 못했습니다.");
    return { projectId: request.projectId, revision: snapshot.revision, target, entry: found };
  }
  const entries = history.slice(request.offset, request.offset + request.limit).map((entry) => ({
    id: entry.id, createdAt: entry.createdAt, note: entry.note ?? "", label: entry.label ?? "",
    blueprint: entry.blueprint ?? [], koChars: entry.ko.length, enChars: entry.en.length,
    negativeKoChars: entry.negativeKo.length, negativeEnChars: entry.negativeEn.length,
  }));
  return { projectId: request.projectId, revision: snapshot.revision, target,
    total: history.length, offset: request.offset,
    nextOffset: request.offset + request.limit < history.length ? request.offset + request.limit : null,
    entries, nextAction: "본문은 entryId로 다시 읽으세요. 예전 문구를 다시 쓰려면 최신 revision으로 project_update prompt.apply에 한·영 본문과 네거티브를 적용하세요." };
}

/** 긴 원문을 전송하지 않고 작품의 모든 프롬프트 칸과 이력을 순서대로 조사합니다. */
export async function getProjectPromptStatus(raw: unknown) {
  const request = promptStatusSchema.parse(raw);
  const snapshot = await getProjectSnapshot(request.projectId, "summary");
  const draft = readProject(request.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const rows = [
    ...draft.characters.map((item) => ({
      target: { kind: "character" as const, id: item.id }, label: item.name,
      ready: true, ko: Boolean(item.promptKo?.trim()), en: Boolean(item.promptEn?.trim()),
      negativeKo: Boolean(item.negativeKo?.trim()), negativeEn: Boolean(item.negativeEn?.trim()),
      historyCount: item.promptHistory?.length ?? 0, lastNote: item.promptHistory?.[0]?.note ?? "",
    })),
    ...draft.backgrounds.map((item) => ({
      target: { kind: "background" as const, id: item.id }, label: item.name,
      ready: true, ko: Boolean(item.promptKo?.trim()), en: Boolean(item.promptEn?.trim()),
      negativeKo: Boolean(item.negativeKo?.trim()), negativeEn: Boolean(item.negativeEn?.trim()),
      historyCount: item.promptHistory?.length ?? 0, lastNote: item.promptHistory?.[0]?.note ?? "",
    })),
    ...draft.scenes.flatMap((scene) => [
      { target: { kind: "sceneVideo" as const, sceneId: scene.id }, label: `${scene.title || "장면"} · 스토리보드 영상`,
        ready: Boolean(scene.storyboardPath), ko: Boolean(scene.storyboardPromptKo?.trim()), en: Boolean(scene.storyboardPromptEn?.trim()),
        negativeKo: false, negativeEn: false, historyCount: scene.storyboardPromptHistory?.length ?? 0,
        lastNote: scene.storyboardPromptHistory?.[0]?.note ?? "" },
      ...scene.cuts.flatMap((cut) => [
        { target: { kind: "cutImage" as const, sceneId: scene.id, cutId: cut.id },
          label: `${scene.title || "장면"} · 컷 ${cut.order} 그림`, ready: true,
          ko: Boolean(cut.promptKo?.trim()), en: Boolean(cut.promptEn?.trim()),
          negativeKo: Boolean(cut.negativeKo?.trim()), negativeEn: Boolean(cut.negativeEn?.trim()),
          historyCount: cut.promptHistory?.length ?? 0, lastNote: cut.promptHistory?.[0]?.note ?? "" },
        { target: { kind: "cutVideo" as const, sceneId: scene.id, cutId: cut.id },
          label: `${scene.title || "장면"} · 컷 ${cut.order} 영상`, ready: true,
          ko: Boolean(cut.videoPromptKo?.trim()), en: Boolean(cut.videoPromptEn?.trim()),
          negativeKo: false, negativeEn: false,
          historyCount: cut.videoPromptHistory?.length ?? 0, lastNote: cut.videoPromptHistory?.[0]?.note ?? "" },
      ]),
    ]),
  ];
  const annotated = rows.map(row => {
    const target = row.target;
    const owner = target.kind === "character" ? draft.characters.find(x=>x.id===target.id) : target.kind === "background" ? draft.backgrounds.find(x=>x.id===target.id) : target.kind === "sceneVideo" ? draft.scenes.find(x=>x.id===target.sceneId) : draft.scenes.find(x=>x.id===target.sceneId)?.cuts.find(x=>x.id===target.cutId);
    const fields = owner as { promptModelStamp?: string; videoPromptModelStamp?: string; storyboardPromptModelStamp?: string };
    try { const selection = appPromptSelection(draft, target); return { ...row, selection, stale: promptStaleMessage(target.kind === "sceneVideo" ? fields.storyboardPromptModelStamp : target.kind === "cutVideo" ? fields.videoPromptModelStamp : fields.promptModelStamp, selection, row.ko || row.en) }; }
    catch(error) { return { ...row, stale: String(error) }; }
  });
  const selected = request.missingOnly ? annotated.filter((item) => item.ready && (!item.ko || !item.en)) : annotated;
  return { projectId: request.projectId, revision: snapshot.revision, total: selected.length,
    offset: request.offset, nextOffset: request.offset + request.limit < selected.length ? request.offset + request.limit : null,
    prompts: selected.slice(request.offset, request.offset + request.limit),
    nextAction: "빈 칸이나 규칙 초안이 남은 target은 prompt_prepare로 앱 API와 같은 요청문을 받은 뒤 project_update prompt.apply로 저장하세요. sceneVideo는 storyboard_bake가 먼저 필요합니다." };
}
