import { describe, expect, it } from "vitest";
import {
  enqueueTasks,
  llmResumeStepOf,
  pendingTasksOf,
  projectIdOfTask,
  retargetTasks,
  withResumableLlm,
  type NewTask,
  registerTaskRunner, enqueueTask, getTask,
} from "@/lib/taskQueue";

it("CPU 합성은 미디어 작업 중에도 독립적으로 하나씩 실행한다",async()=>{
  let finishMedia!:()=>void,finishCpu!:()=>void;const started:string[]=[];
  registerTaskRunner("qa-held-media",async()=>{started.push("media");await new Promise<void>(r=>{finishMedia=r;});});
  registerTaskRunner("qa-held-cpu",async()=>{started.push("cpu");await new Promise<void>(r=>{finishCpu=r;});});
  const media=enqueueTask({lane:"media",kind:"qa-held-media",projectId:"cpu-qa",projectTitle:"QA",label:"media",payload:{}})!;
  const cpu=enqueueTask({lane:"cpu",kind:"qa-held-cpu",projectId:"cpu-qa",projectTitle:"QA",label:"cpu",payload:{}})!;
  const next=enqueueTask({lane:"cpu",kind:"qa-held-cpu",projectId:"cpu-qa",projectTitle:"QA",label:"next",payload:{}})!;
  expect(started).toEqual(["media","cpu"]);expect(getTask(next)?.status).toBe("waiting");
  finishCpu();await new Promise(r=>setTimeout(r,0));expect(started).toEqual(["media","cpu","cpu"]);expect(getTask(media)?.status).toBe("running");
  finishCpu();finishMedia();await new Promise(r=>setTimeout(r,0));expect(getTask(cpu)?.status).toBe("done");expect(getTask(next)?.status).toBe("done");
});

/*
  저장 전 프로젝트(«새 프로젝트»)가 첫 자동 저장으로 열쇠를 얻으면 줄에 선 일도 따라가야 합니다 — 2026-09-22 검토에서
  일괄 생성 4단계의 남은 카드가 전부 옛 열쇠로 실패하고 4단계가 영영 안 닫힌 것. 러너가 등록되지 않은 시험이라 줄은
  움직이지 않고, 넣은 일은 그대로 «대기» 로 남습니다(localStorage 가 없는 node 에서도 줄은 메모리로 돕니다).
*/
const stand = (over: Partial<NewTask> & Pick<NewTask, "kind" | "projectId" | "label">): NewTask => ({
  lane: "llm",
  projectTitle: "시험 작품",
  payload: {},
  ...over,
});

describe("retargetTasks", () => {
  it("대기 중인 일의 열쇠·재료(project·projectId)·dedupe 를 새 열쇠로 고쳐 쓰고, 다른 프로젝트는 건드리지 않는다", () => {
    enqueueTasks([
      stand({
        kind: "bootstrapPrompt",
        projectId: "새 프로젝트",
        label: "서진우 · 시트",
        dedupe: "새 프로젝트:bootstrapPrompt:character:c1",
        payload: { project: "새 프로젝트", target: { kind: "character", id: "c1" } },
      }),
      stand({
        lane: "media",
        kind: "characterSheet",
        projectId: "새 프로젝트",
        label: "서진우 시트 뽑기",
        dedupe: "새 프로젝트:character:c1",
        payload: { projectId: "새 프로젝트", characterId: "c1" },
      }),
      stand({ kind: "bootstrapPrompt", projectId: "다른 작품", label: "그대로", payload: { project: "다른 작품" } }),
    ]);

    expect(retargetTasks("새 프로젝트", "p-1")).toBe(2);
    expect(pendingTasksOf("새 프로젝트", "bootstrapPrompt")).toHaveLength(0);
    expect(pendingTasksOf("새 프로젝트", "characterSheet")).toHaveLength(0);

    const prompt = pendingTasksOf("p-1", "bootstrapPrompt");
    expect(prompt).toHaveLength(1);
    expect(prompt[0].payload).toMatchObject({
      project: "p-1",
      dedupe: "p-1:bootstrapPrompt:character:c1",
      target: { kind: "character", id: "c1" },
    });
    // 러너가 손에 든 사본이 아니라 줄에서 다시 읽는 열쇠.
    expect(projectIdOfTask(prompt[0].id)).toBe("p-1");

    const sheet = pendingTasksOf("p-1", "characterSheet");
    expect(sheet[0].payload).toMatchObject({ projectId: "p-1", dedupe: "p-1:character:c1" });

    const other = pendingTasksOf("다른 작품", "bootstrapPrompt");
    expect(other).toHaveLength(1);
    expect(other[0].payload).toMatchObject({ project: "다른 작품" });
  });

  it("옮긴 뒤에는 같은 카드를 새 열쇠로 다시 세워도 dedupe 가 막는다", () => {
    expect(
      enqueueTasks([
        stand({
          kind: "bootstrapPrompt",
          projectId: "p-1",
          label: "서진우 · 시트",
          dedupe: "p-1:bootstrapPrompt:character:c1",
          payload: { project: "p-1" },
        }),
      ]),
    ).toBe(0);
  });

  it("같은 열쇠로는 아무것도 안 옮기고, 없는 일은 열쇠가 없다", () => {
    expect(retargetTasks("p-1", "p-1")).toBe(0);
    expect(projectIdOfTask("없는 일")).toBeUndefined();
  });
});

/*
  이어 받을 열쇠 — 
  응답 id 는 그 일의 **어느 왕복** 것인지와 함께 줄에 남아야 하고(재료처럼 파일에 남는 값), 같은 왕복이 다시 돌 때만
  건네져야 하며, 왕복이 어떻게 끝나든 지워져야 합니다 — 남으면 사람이 누른 «다시» 가 옛 답을 또 받습니다.
*/
describe("withResumableLlm", () => {
  it("응답 id 를 왕복 이름과 함께 적고, 같은 왕복에만 건네며, 끝나면 지운다", async () => {
    enqueueTasks([stand({ kind: "bootstrap", projectId: "p-resume", label: "세 왕복", payload: {} })]);
    const [task] = pendingTasksOf("p-resume", "bootstrap");
    const now = () => pendingTasksOf("p-resume", "bootstrap")[0];

    await withResumableLlm(task.id, "details", async ({ resumeId, onResponseId }) => {
      // 처음 보내는 길 — 이어 받을 것이 없습니다.
      expect(resumeId).toBeUndefined();
      onResponseId("resp_1");
      expect(now()).toMatchObject({ llmResponseId: "resp_1", llmResumeStep: "details" });
      expect(llmResumeStepOf(task.id)).toBe("details");

      // 앱이 닫혔다 켜져 **같은 왕복**이 다시 도는 모양 — 그 id 를 건넵니다.
      await withResumableLlm(task.id, "details", async (again) => {
        expect(again.resumeId).toBe("resp_1");
      });
      // 그 왕복이 끝나면 열쇠는 지워집니다.
      expect(now().llmResponseId).toBeUndefined();
      expect(llmResumeStepOf(task.id)).toBeUndefined();

      // **다른 왕복**은 남의 답을 받지 않습니다 — 새로 보내고, 그 순간 옛 열쇠도 지워집니다.
      onResponseId("resp_2");
      await withResumableLlm(task.id, "outline", async (other) => {
        expect(other.resumeId).toBeUndefined();
      });
      expect(now().llmResponseId).toBeUndefined();
    });
    expect(now().llmResponseId).toBeUndefined();
    expect(now().llmResumeStep).toBeUndefined();
  });

  it("왕복이 실패해도 열쇠를 지우고 오류는 그대로 올린다", async () => {
    const [task] = pendingTasksOf("p-resume", "bootstrap");
    await expect(
      withResumableLlm(task.id, "shots", async ({ onResponseId }) => {
        onResponseId("resp_3");
        throw new Error("서버 오류");
      }),
    ).rejects.toThrow("서버 오류");
    expect(pendingTasksOf("p-resume", "bootstrap")[0].llmResponseId).toBeUndefined();
  });
});
