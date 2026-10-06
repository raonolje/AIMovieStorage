import { z } from "zod";
import { assetSrc, whenAppSettingsReady } from "./mediaLibrary";
import { importKimodoMotion } from "./mocapStore";
import { projectFolderName } from "./localProjectStore";
import { readProject } from "./projectWrite";
import { KIMODO_MODELS, generateKimodoMotion } from "./kimodoGeneration";
import { installLocalEngine, cancelLocalInstall } from "./localEngines";
import { enqueueTaskOperation, isStopping, registerTaskRunner, setTaskResult } from "./taskQueue";

export const kimodoInstallSchema = z.object({ operationId: z.string().min(1).max(300) }).strict();
export const kimodoGenerateSchema = z.object({
  projectId: z.string().min(1).max(200), operationId: z.string().min(1).max(300),
  prompt: z.string().trim().min(1).max(4000), model: z.enum(KIMODO_MODELS),
  seconds: z.number().finite().min(0.5).max(30),
  steps: z.number().int().min(1).max(200).default(100),
  seed: z.number().int().min(0).max(2147483647).default(0),
  textEncoderDevice: z.enum(["cpu", "cuda"]).default("cuda"),
}).strict();

export async function installControlKimodo(raw: unknown) {
  const input = kimodoInstallSchema.parse(raw);
  return enqueueTaskOperation({ lane: "media", kind: "control.kimodo.install", projectId: "settings",
    projectTitle: "로컬 모델", label: "KIMODO 설치", operationId: input.operationId, payload: input });
}
registerTaskRunner("control.kimodo.install", async (_raw, report, task) => {
  if (isStopping(task.id)) return;
  await installLocalEngine("kimodo", event => {
    if (isStopping(task.id)) void cancelLocalInstall("kimodo");
    report({ step: event.message || event.stage });
  });
  return { data: { engine: "kimodo", installed: true, weights: "download on first generation" } };
});
export async function generateControlKimodo(raw: unknown) {
  const input = kimodoGenerateSchema.parse(raw);
  const project = readProject(input.projectId);
  if (!project) throw new Error("프로젝트를 찾지 못했습니다.");
  return enqueueTaskOperation({ lane: "media", kind: "control.kimodo.generate", projectId: input.projectId,
    projectTitle: project.title, label: "KIMODO 동작 생성", operationId: input.operationId, payload: input });
}
registerTaskRunner("control.kimodo.generate", async (raw, report, task) => {
  if (isStopping(task.id)) return;
  const input = kimodoGenerateSchema.parse(raw);
  const project = readProject(input.projectId);
  if (!project) throw new Error("프로젝트를 찾지 못했습니다.");
  const source = await generateKimodoMotion({ ...input, projectName: projectFolderName(input.projectId, project.title) },
    message => report({ step: message }));
  const result = { paths: [source.path, source.resultPath].filter((path): path is string => Boolean(path)), data: { sourceId: source.id, duration: source.duration, fps: source.fps } };
  setTaskResult(task.id, result);
  return result;
});

export const kimodoImportSchema = z.object({
  projectId: z.string().min(1).max(200),
  sourcePath: z.string().min(1).max(4000),
}).strict();

/** Controller and editor both use the same SOMA BVH parser and project-local registration. */
export async function importControlKimodo(raw: unknown) {
  const input = kimodoImportSchema.parse(raw);
  if (!/^(?:[a-z]:[\\/]|\/(?!\/))/i.test(input.sourcePath) || !/\.bvh$/i.test(input.sourcePath))
    throw new Error("로컬 KIMODO SOMA BVH 경로를 지정하세요.");
  await whenAppSettingsReady();
  const project = readProject(input.projectId);
  if (!project) throw new Error("프로젝트를 찾지 못했습니다.");
  const response = await fetch(assetSrc(input.sourcePath));
  if (!response.ok) throw new Error("BVH 원본 파일을 열지 못했습니다.");
  const name = input.sourcePath.split(/[\\/]/).pop() || "kimodo.bvh";
  const file = new File([await response.blob()], name, { type: "text/plain" });
  const folder = projectFolderName(input.projectId, project.title);
  const source = await importKimodoMotion(folder, file);
  return { projectId: input.projectId, sourceId: source.id, name: source.name,
    sourcePath: source.path, resultPath: source.resultPath,
    durationSeconds: source.duration, fps: source.fps, personNumbers: [1] };
}
