import { z } from "zod";
import { buildCutPrompt } from "@/lib/cutPrompt";
import { cutVideoSecondsOf } from "@/lib/cutVideoPrompt";
import { naturalPromptRequestData } from "@/lib/naturalPromptRequest";
import { projectContextOf } from "@/lib/projectContext";
import { buildPromptRequestText } from "@/lib/promptRequest";
import { readProject } from "@/lib/projectWrite";
import { getProjectSnapshot, ProjectControlError } from "@/lib/projectControl";

const id = z.string().min(1).max(200);
export const naturalPromptPrepareSchema = z.object({
  projectId: id, expectedRevision: id,
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("characterDescription"), id }).strict(),
    z.object({ kind: z.literal("backgroundDescription"), id }).strict(),
    z.object({ kind: z.literal("sceneSummary"), sceneId: id }).strict(),
    z.object({ kind: z.literal("cutDescription"), sceneId: id, cutId: id }).strict(),
    z.object({ kind: z.literal("cutActing"), sceneId: id, cutId: id }).strict(),
    z.object({ kind: z.literal("cutBackgroundMotion"), sceneId: id, cutId: id }).strict(),
    z.object({ kind: z.literal("cutVfx"), sceneId: id, cutId: id }).strict(),
  ]),
}).strict();

/** 화면의 공통 «프롬프트 말로» 단추와 같은 요청 재료를 만듭니다. */
export async function prepareNaturalPrompt(raw: unknown) {
  const request = naturalPromptPrepareSchema.parse(raw);
  const before = await getProjectSnapshot(request.projectId, "summary");
  if (before.revision !== request.expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트가 바뀌었습니다. 다시 읽어 주세요.", { actualRevision: before.revision });
  const draft = readProject(request.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const target = request.target;
  const context = projectContextOf(draft);
  let text = "";
  let kind: "acting" | "vfx" | "background" | "scene" = "scene";
  let isVideo = false;
  let seconds: number | undefined;
  let shot: string | undefined;
  let people: string[] = [];
  let apply = "";
  if (target.kind === "characterDescription" || target.kind === "backgroundDescription") {
    const entity = target.kind === "characterDescription" ? draft.characters.find((item) => item.id === target.id)
      : draft.backgrounds.find((item) => item.id === target.id);
    if (!entity) throw new ProjectControlError("target_not_found", "카드를 찾지 못했습니다.");
    text = entity.description;
    apply = `project_update의 ${target.kind === "characterDescription" ? "character" : "background"}.update fields.description에 ko를 넣으세요.`;
  } else {
    const scene = draft.scenes.find((item) => item.id === target.sceneId);
    if (!scene) throw new ProjectControlError("target_not_found", "장면을 찾지 못했습니다.");
    if (target.kind === "sceneSummary") {
      text = scene.summary;
      isVideo = true;
      people = [...new Set(scene.cuts.flatMap((cut) => cut.characterIds))]
        .map((id) => draft.characters.find((person) => person.id === id)?.name)
        .filter((name): name is string => Boolean(name));
      apply = "project_update scene.update fields.summary에 ko를 넣으세요.";
    } else {
      const cut = scene.cuts.find((item) => item.id === target.cutId);
      if (!cut) throw new ProjectControlError("target_not_found", "컷을 찾지 못했습니다.");
      const cast = draft.characters.filter((person) => cut.characterIds.includes(person.id));
      people = cast.map((person) => person.name);
      seconds = cutVideoSecondsOf(cut);
      isVideo = target.kind !== "cutDescription";
      const field = ({
        cutDescription: "description", cutActing: "acting",
        cutBackgroundMotion: "backgroundMotion", cutVfx: "vfx",
      } as const)[target.kind];
      text = cut[field] || "";
      kind = target.kind === "cutActing" ? "acting" : target.kind === "cutBackgroundMotion" ? "background" : target.kind === "cutVfx" ? "vfx" : "scene";
      if (target.kind === "cutActing") {
        const facts = buildCutPrompt({ cut, characters: cast, background: draft.backgrounds.find((item) => item.id === cut.backgroundId), context }).facts;
        shot = (facts.subjects as { shot?: string }[] | undefined)?.[0]?.shot;
      }
      apply = `project_update cut.update fields.${field}에 ko를${field === "description" ? "" : `, fields.${field}En에 en을`} 넣으세요.`;
    }
  }
  if (!text.trim()) throw new ProjectControlError("empty_source", "원본 문장이 없습니다. 먼저 카드에 문장을 적어 주세요.");
  const data = naturalPromptRequestData({ text, kind, isVideo, seconds, shot, people, context });
  const parts = await buildPromptRequestText({ template: "natural-to-prompt", data }, 0);
  const prompt = [parts.fixed, parts.fresh].filter(Boolean).join("\n\n---\n\n");
  const latest = await getProjectSnapshot(request.projectId, "summary");
  if (latest.revision !== before.revision)
    throw new ProjectControlError("revision_conflict", "요청문을 준비하는 동안 프로젝트가 바뀌었습니다.", { actualRevision: latest.revision });
  return { projectId: request.projectId, revision: before.revision, target, request: prompt, apply };
}
