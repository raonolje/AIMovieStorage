import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ComfyWorkflowManifest, WorkflowAssetFact, WorkflowEnvironment, WorkflowGraph, WorkflowSelection, WorkflowSource } from "./comfyWorkflowContract";
import { buildComfyWorkflowManifest, inspectComfyWorkflow, STANDARD_WORKFLOW_NODE_REVIEWS, STANDARD_WORKFLOW_SOURCE_PINS, WORKFLOW_POLICY_VERSION } from "./comfyWorkflowInspection";
import { identifyWorkflowOutputs, prepareWorkflowAdapterPlan, validateWorkflowCollectedOutputs } from "./comfyWorkflowBinding";
import { workflowSlotSchema, workflowSourceSchema } from "./comfyWorkflowContract";

const schemas = JSON.parse(readFileSync(resolve("scratch/workflow-node-schemas.json"), "utf8"));
function fixture(count = 0) {
  const catalog = structuredClone(schemas);
  catalog.UNETLoader.input.required.unet_name = [["wan-high.safetensors", "wan-low.safetensors", "MiniMax-H3.safetensors"]];
  catalog.CLIPLoader.input.required.clip_name = [["umt5.safetensors"]];
  catalog.VAELoader.input.required.vae_name = [["wan-vae.safetensors"]];
  catalog.LoraLoader.input.required.lora_name = [["motion.safetensors", "style.safetensors", "MiniMax-H3.safetensors"]];
  const environment: WorkflowEnvironment = { comfyVersion: "0.36.0", coreCommit: "ee71d5c4993f29086b27fde1629a945ae48425bf", pythonVersion: "3.13.12", torchVersion: "2.12.1+cu130", customNodeVersions: {}, nodeSourceHashes: { ...STANDARD_WORKFLOW_SOURCE_PINS }, reviewVersion: WORKFLOW_POLICY_VERSION,
    catalog, reviewedNodes: structuredClone(STANDARD_WORKFLOW_NODE_REVIEWS), weights: [
      { category: "diffusion_models", name: "wan-high.safetensors", license: "allowed" },
      { category: "diffusion_models", name: "wan-low.safetensors", license: "allowed" },
      { category: "diffusion_models", name: "MiniMax-H3.safetensors", license: "allowed" },
      { category: "text_encoders", name: "umt5.safetensors", license: "allowed" }, { category: "vae", name: "wan-vae.safetensors", license: "allowed" },
      { category: "loras", name: "motion.safetensors", license: "allowed" }, { category: "loras", name: "style.safetensors", license: "allowed" }, { category: "loras", name: "MiniMax-H3.safetensors", license: "allowed" },
    ] };
  const graph: WorkflowGraph = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "wan-high.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "umt5.safetensors", type: "wan" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "wan-vae.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: "sample" } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: "blurry" } },
    "6": { class_type: "EmptyHunyuanLatentVideo", inputs: { width: 384, height: 256, length: 9, batch_size: 1 } },
    "7": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], seed: 1, steps: 2, cfg: 4, sampler_name: "euler", scheduler: "normal", denoise: 1 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: 8 } },
    "10": { class_type: "SaveVideo", inputs: { video: ["9", 0], filename_prefix: "video/test", format: "mp4", "format.codec": "h264" } },
  };
  const selection: WorkflowSelection = { slots: [{ id: "positive", semantic: "positive", nodeId: "4", input: "text", required: true }, { id: "negative", semantic: "negative", nodeId: "5", input: "text", required: true }, { id: "seed", semantic: "seed", nodeId: "7", input: "seed", required: false }],
    promptRoles: [{ id: "video", modelRuleId: "wan2.2", loaderNodeIds: ["1"], positiveSlotIds: ["positive"], negativeSlotIds: ["negative"], negativeSupport: "supported" }], selectedPromptRoleId: "video", outputNodeIds: ["10"], referenceGroups: [] };
  for (let i = 0; i < count; i++) {
    const id = String(11 + i * 2), video = String(12 + i * 2), save = String(40 + i);
    graph[id] = { class_type: "LoadImage", inputs: { image: "placeholder.png" } };
    graph[video] = { class_type: "CreateVideo", inputs: { images: [id, 0], fps: 8 } };
    graph[save] = { class_type: "SaveVideo", inputs: { video: [video, 0], filename_prefix: "video/ref", format: "mp4", "format.codec": "h264" } };
    selection.slots.push({ id: `identity-${i}`, semantic: "identityImage", nodeId: id, input: "image", required: true }); selection.outputNodeIds.push(save);
  }
  if (count) selection.referenceGroups.push({ id: "cast", role: "identityImage", mediaKind: "image", minItems: count, maxItems: count, slotIds: Array.from({ length: count }, (_, i) => `identity-${i}`), strategy: "fixed-slots", order: "explicit", identity: "multiple" });
  const source: WorkflowSource = { workflowId: "test-workflow", workflowPath: "C:/selected/workflow.json", title: "CPU 계약용 그래프", sourceVersion: "fixture-1", modelIds: ["wan2.2"], outputKind: "video", operation: "text-to-video", promptProfile: "explicit-roles", limitations: ["실제 생성 미실행", "참조 출력 분기는 ID 조건 모델이 아닙니다."], evidence: [] };
  return { graph, environment, selection, source, checkedAtUtc: "2026-10-06T16:00:00.000Z" };
}
const text = (f: ReturnType<typeof fixture>) => JSON.stringify(f.graph);
const inspect = (f: ReturnType<typeof fixture>) => inspectComfyWorkflow(text(f), f.environment, f.selection, f.source.outputKind);
const codes = (f: ReturnType<typeof fixture>) => inspect(f).issues.map(i => i.code);
async function manifest(f: ReturnType<typeof fixture>): Promise<ComfyWorkflowManifest> { const made = await buildComfyWorkflowManifest({ ...f, text: text(f) }); expect(made.inspection.issues).toEqual([]); expect(made.manifest).toBeDefined(); return made.manifest!; }
function asset(index = 0, kind: "image" | "video" | "audio" = "image"): WorkflowAssetFact { return { assetId: `a${index}`, projectId: "p", identityId: `actor${index}`, path: `C:/project/a${index}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`, kind, sha256: String(index % 10).repeat(64), bytes: 100, decodable: true, width: 384, height: 256, fps: 8, durationSeconds: 9 / 8 }; }
const request = () => ({ projectId: "p", prompt: "한국어 본문", negative: "흐림", values: { seed: 20 } });
async function plan(f: ReturnType<typeof fixture>, input = request()) { return prepareWorkflowAdapterPlan({ text: text(f), manifest: await manifest(f), environment: f.environment, request: input }); }

describe("업로드 그래프 검사", () => {
  it("UI JSON을 API로 자동 변환하지 않습니다", () => { const f = fixture(); const result = inspectComfyWorkflow('{"nodes":[],"links":[]}', f.environment); expect(result.format).toBe("ui"); expect(result.issues[0].code).toBe("api_export_required"); });
  it.each(["not json", "[]", "{}", '{"x":{"class_type":"SaveVideo"}}'])("잘못된 그래프를 차단합니다: %s", raw => { expect(inspectComfyWorkflow(raw, fixture().environment).issues.length).toBeGreaterThan(0); });
  it("검토된 실제 서버 스키마로 manifest를 만들지만 생성 검증을 주장하지 않습니다", async () => { const f = fixture(), m = await manifest(f); expect(m.verification.actualGenerationRegistration).toBe("not-run"); expect(m.verification.executionAdmission).toBe("required"); expect(m.promptTarget.modelRuleId).toBe("wan2.2"); expect(m.nodeRequirements.every(n => n.schemaSha256.length === 64 && n.sourceSha256.length === 64)).toBe(true); });
  it.each(["PythonExec", "DownloadModel", "Shell", "HTTPRequest", "SDNQSampler"])("설치되었어도 미검토 %s는 실행할 수 없습니다", type => { const f = fixture(); f.graph.evil = { class_type: type, inputs: {} }; f.environment.catalog[type] = { input: {}, output: [], python_module: "custom_nodes.test" }; expect(codes(f)).toContain("unreviewed_node"); });
  it("외부 API 노드와 같은 이름의 다른 모듈을 차단합니다", () => { const f = fixture(); f.environment.catalog.KSampler.api_node = true; expect(codes(f)).toContain("external_api_node"); f.environment.catalog.KSampler.python_module = "custom_nodes.replacement"; expect(codes(f)).toContain("unreviewed_node"); });
  it("소스 hash가 달라지면 같은 노드 이름도 미검토입니다", () => { const f = fixture(); f.environment.nodeSourceHashes.nodes = "0".repeat(64); expect(codes(f)).toContain("unreviewed_node"); });
  it.each(["missing_node", "dangling_link", "link_type_mismatch", "missing_required_input", "graph_cycle"])("연결·필수 입력 오류를 발견합니다: %s", code => { const f = fixture(); if (code === "missing_node") delete f.environment.catalog.KSampler; if (code === "dangling_link") f.graph["8"].inputs.samples = ["absent", 0]; if (code === "link_type_mismatch") f.graph["8"].inputs.samples = ["2", 0]; if (code === "missing_required_input") delete f.graph["7"].inputs.steps; if (code === "graph_cycle") f.graph["7"].inputs.latent_image = ["7", 0]; expect(codes(f)).toContain(code); });
  it("알 수 없는 입력·범위초과·잘못된 sampler enum을 차단합니다", () => { const f = fixture(); f.graph["7"].inputs.download_url = "https://example.com/a"; f.graph["7"].inputs.steps = -1; f.graph["7"].inputs.sampler_name = "invented"; expect(codes(f)).toContain("unknown_input"); expect(codes(f).filter(c => c === "invalid_input_value").length).toBe(2); });
  it.each(["C:/models/wan.safetensors", "https://example.com/a", "../a.safetensors"])("임의 모델 경로와 URL을 차단합니다: %s", name => { const f = fixture(); f.graph["1"].inputs.unet_name = name; expect(codes(f)).toContain("missing_weight"); });
  it("설치 enum과 파일 허가의 intersection만 인정합니다", () => { const f = fixture(); f.environment.weights[0].license = "unknown"; expect(codes(f)).toContain("weight_license_unverified"); f.environment.weights[0].license = "allowed"; f.environment.catalog.UNETLoader.input.required!.unet_name = [[]]; expect(codes(f)).toContain("missing_weight"); });
  it("라이선스 기록이 허용이어도 H3는 차단합니다", () => { const f = fixture(); f.graph["1"].inputs.unet_name = "MiniMax-H3.safetensors"; expect(codes(f)).toContain("license_blocked_h3"); });
  it("모델 loader가 여러 개면 모든 역할을 명시해야 합니다", () => { const f = fixture(); f.graph["30"] = { class_type: "UNETLoader", inputs: { unet_name: "wan-low.safetensors", weight_dtype: "default" } }; expect(codes(f)).toContain("prompt_model_ambiguous"); });
  it("매핑 중복·link 덮어쓰기·잘못된 영상 출력은 차단합니다", () => { const f = fixture(); f.selection.slots.push({ ...f.selection.slots[0], id: "duplicate" }); f.selection.slots[1].input = "clip"; f.selection.outputNodeIds = ["9"]; expect(codes(f)).toContain("duplicate_mapping"); expect(codes(f)).toContain("binding_target_not_scalar"); expect(codes(f)).toContain("media_output_required"); });
  it("동적 SaveVideo의 선택 갈래에서 누락된 필수 값을 검사합니다", () => { const f = fixture(); delete f.graph["10"].inputs["format.codec"]; expect(codes(f)).toContain("missing_required_input"); f.graph["10"].inputs["format.codec"] = "made-up"; expect(codes(f)).toContain("invalid_input_value"); });
  it("직접 list/batch 입력은 scalar adapter 지원으로 착각하지 않습니다", () => { const f = fixture(1); f.selection.referenceGroups[0].strategy = "list-input"; expect(codes(f)).toContain("list_input_unsupported"); });
  it("optional 참조는 고정 그래프에서 자동 생략하지 않습니다", () => { const f = fixture(1); f.selection.referenceGroups[0].minItems = 0; expect(codes(f)).toContain("reference_variant_required"); });
});

describe("의미별 입력 바인딩과 가변 참조", () => {
  it.each([0, 1, 3])("검토된 %i개 고정 변형의 명시 순서를 보존합니다", async count => { const f = fixture(count), m = await manifest(f); const items = Array.from({ length: count }, (_, i) => asset(i)); const result = await prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), referenceGroups: count ? { cast: items } : {} } }); expect(result.references.map(a => a.path)).toEqual(items.map(a => a.path)); expect(result.provenance.assets.map(a => a.assetId)).toEqual(items.map(a => a.assetId)); expect(result.config.mappings.filter(m => m.source === "reference").map(m => m.referenceIndex)).toEqual(items.map((_, i) => i)); });
  it("max+1·0/누락은 자동 합성·생략하지 않습니다", async () => { const f = fixture(2), m = await manifest(f); for (const items of [[], [asset(0)], [asset(0), asset(1), asset(2)]]) await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), referenceGroups: { cast: items } } })).rejects.toThrow("reference_count_mismatch"); await expect(plan(f)).rejects.toThrow("required_reference_missing"); });
  it("복수 캐릭터 ID를 유지하고 단일 정체성 그룹의 혼합은 차단합니다", async () => { const f = fixture(2); f.selection.referenceGroups[0].identity = "single"; await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: await manifest(f), environment: f.environment, request: { ...request(), referenceGroups: { cast: [asset(0), asset(1)] } } })).rejects.toThrow("reference_identity_mismatch"); });
  it("같은 슬롯의 그룹·개별 중복과 미연결 참조를 차단합니다", async () => { const f = fixture(1), m = await manifest(f); await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), assets: { "identity-0": asset(0) }, referenceGroups: { cast: [asset(1)] } } })).rejects.toThrow("duplicate_reference"); await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), assets: { unused: asset(0) } } })).rejects.toThrow("unused_reference"); });
  it("참조 metadata·같은 프로젝트·마스크 규약을 검사합니다", async () => { const f = fixture(1), m = await manifest(f); for (const bad of [{ ...asset(), projectId: "other" }, { ...asset(), bytes: 0 }, { ...asset(), decodable: false }, { ...asset(), width: undefined }]) await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), assets: { "identity-0": bad } } })).rejects.toThrow(); });
  it("image/video/audio를 각 갈래의 순서로 기존 adapter에 전달합니다", async () => { const f = fixture(1); f.graph["20"] = { class_type: "LoadVideo", inputs: { file: "clip.mp4" } }; f.graph["21"] = { class_type: "SaveVideo", inputs: { video: ["20", 0], filename_prefix: "video/source", format: "mp4", "format.codec": "h264" } }; f.graph["22"] = { class_type: "LoadAudio", inputs: { audio: "clip.wav" } }; f.graph["9"].inputs.audio = ["22", 0]; f.selection.outputNodeIds.push("21"); f.selection.slots.push({ id: "motion", semantic: "poseVideo", nodeId: "20", input: "file", required: true, alignment: "exact" }, { id: "sound", semantic: "audio", nodeId: "22", input: "audio", required: true, alignment: "exact" }); const m = await manifest(f); const result = await prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), assets: { "identity-0": asset(0), motion: asset(1, "video"), sound: asset(2, "audio") } } }); expect(result.references.map(r => r.kind)).toEqual(["image", "video", "audio"]); expect(result.config.mappings.filter(m => m.source === "reference").map(m => m.referenceIndex)).toEqual([0, 0, 0]); await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), assets: { "identity-0": asset(0), motion: { ...asset(1, "video"), fps: 24 }, sound: asset(2, "audio") } } })).rejects.toThrow("reference_timebase_mismatch"); });
  it("부정 프롬프트가 무시되는 모델에는 nonempty negative를 묵시 전달하지 않습니다", async () => { const f = fixture(); f.selection.promptRoles[0].negativeSupport = "ignored"; f.selection.promptRoles[0].negativeSlotIds = []; f.selection.slots = f.selection.slots.filter(s => s.semantic !== "negative"); await expect(plan(f)).rejects.toThrow("negative_not_consumed"); });
  it("LoRA는 Comfy 파일명과 강도만 바꾸며 모델·파일은 복사하지 않습니다", async () => { const f = fixture(); f.graph["30"] = { class_type: "LoraLoader", inputs: { model: ["1", 0], clip: ["2", 0], lora_name: "motion.safetensors", strength_model: 1, strength_clip: 1 } }; f.graph["7"].inputs.model = ["30", 0]; f.selection.slots.push({ id: "lora", semantic: "loraName", nodeId: "30", input: "lora_name", required: false }, { id: "strength", semantic: "loraModelStrength", nodeId: "30", input: "strength_model", required: false }); const m = await manifest(f); const result = await prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), values: { seed: 20, lora: "style.safetensors", strength: 0.8 } } }); expect(result.bindings).toContainEqual({ nodeId: "30", input: "lora_name", value: "style.safetensors" }); expect(result.references).toEqual([]); for (const lora of ["C:/app/loras/a.safetensors", "https://example.com/a", "MiniMax-H3.safetensors"]) await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), values: { seed: 20, lora } } })).rejects.toThrow(); });
  it("workflow hash·schema·commit·Torch 변경은 실행 직전 재검사를 요구합니다", async () => { const f = fixture(), m = await manifest(f); await expect(prepareWorkflowAdapterPlan({ text: text(f) + " ", manifest: m, environment: f.environment, request: request() })).rejects.toThrow("workflow_changed"); for (const change of ["schema", "commit", "torch"]) { const env = structuredClone(f.environment); if (change === "schema") env.catalog.KSampler.output = ["LATENT", "IMAGE"]; if (change === "commit") env.coreCommit = "0".repeat(40); if (change === "torch") env.torchVersion = "updated"; await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: env, request: request() })).rejects.toThrow("manifest_changed"); } });
  it("동적 파일 목록만 변한 경우 입력 schema의 호환성은 유지됩니다", async () => { const f = fixture(1), m = await manifest(f); const env = structuredClone(f.environment); env.catalog.LoadImage.input.required!.image = [["new-upload.png"], { image_upload: true }]; await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: env, request: { ...request(), assets: { "identity-0": asset() } } })).resolves.toBeDefined(); });
});

describe("job 출력 식별·수집 후 검증", () => {
  const history = (files: unknown[]) => ({ job: { status: { completed: true, status_str: "success" }, outputs: { "10": { videos: files }, "999": { videos: [{ filename: "foreign.mp4" }] } } } });
  it("선택 job/node의 여러 출력만 식별하고 중복 callback 목록은 하나로 셉니다", async () => { const m = await manifest(fixture()), file = { filename: "a.mp4", subfolder: "video", type: "output" }; expect(identifyWorkflowOutputs(m, history([file, file, { ...file, filename: "b.mp4" }]), "job").map(o => o.filename)).toEqual(["a.mp4", "b.mp4"]); });
  it.each(["../a.mp4", "C:/a.mp4", "https://example.com/a.mp4", "sub/a.mp4"])("서버 filename traversal을 차단합니다: %s", async filename => { const m = await manifest(fixture()); expect(() => identifyWorkflowOutputs(m, history([{ filename }]), "job")).toThrow("unsafe_output_path"); });
  it("partial·다른 job·실패/취소는 완료가 아닙니다", async () => { const m = await manifest(fixture()); expect(() => identifyWorkflowOutputs(m, history([{ filename: "a.mp4.partial" }]), "job")).toThrow("output_missing"); expect(() => identifyWorkflowOutputs(m, history([]), "other")).toThrow("job_not_successful"); const h = history([{ filename: "a.mp4" }]); h.job.status.status_str = "error"; expect(() => identifyWorkflowOutputs(m, h, "job")).toThrow("job_not_successful"); });
  it("수집 파일의 metadata·프로젝트·audio track 검증도 완료 조건입니다", async () => { const m = await manifest(fixture()), fact = { ...asset(1, "video"), nodeId: "10", audioTracks: 1 }; expect(() => validateWorkflowCollectedOutputs(m, [fact], { projectId: "p", requireAudioTrack: true })).not.toThrow(); for (const bad of [{ ...fact, decodable: false }, { ...fact, bytes: 0 }, { ...fact, projectId: "wrong" }, { ...fact, audioTracks: 0 }]) expect(() => validateWorkflowCollectedOutputs(m, [bad], { projectId: "p", requireAudioTrack: true })).toThrow(); });
  it("audio 출력과 TTS 상태도 구조적으로 구분합니다", async () => { const f = fixture(); f.source.outputKind = "audio"; f.source.operation = "tts"; f.graph["20"] = { class_type: "LoadAudio", inputs: { audio: "reference.wav" } }; f.graph["21"] = { class_type: "SaveAudioAdvanced", inputs: { audio: ["20", 0], filename_prefix: "audio/test", format: "flac" } }; f.graph["22"] = { class_type: "GetVideoComponents", inputs: { video: ["9", 0] } }; f.graph["23"] = { class_type: "SaveAudio", inputs: { audio: ["22", 1], filename_prefix: "audio/generated" } }; f.selection.outputNodeIds = ["21", "23"]; f.selection.slots.push({ id: "voice", semantic: "voiceReference", nodeId: "20", input: "audio", required: true }); const m = await manifest(f); const h = { job: { status: { status_str: "success" }, outputs: { "21": { audio: [{ filename: "voice.flac", subfolder: "audio", type: "output" }] } } } }; expect(identifyWorkflowOutputs(m, h, "job")[0].kind).toBe("audio"); expect(m.verification.actualGenerationRegistration).toBe("not-run"); });
});


describe("추가 환경 호환성과 입력 안전 계약", () => {
  it.each(["input_order", "input_is_list", "output_is_list", "hidden", "upload_type"])("같은 버전의 %s 변경은 manifest를 무효화합니다", async change => {
    const f = fixture(1), m = await manifest(f), env = structuredClone(f.environment);
    if (change === "input_order") env.catalog.KSampler.input_order = { required: ["seed", "model"] };
    if (change === "input_is_list") env.catalog.KSampler.is_input_list = true;
    if (change === "output_is_list") env.catalog.KSampler.output_is_list = [true];
    if (change === "hidden") env.catalog.KSampler.input.hidden = { prompt: "PROMPT" };
    if (change === "upload_type") env.catalog.LoadImage.input.required!.image = ["STRING", { image_upload: true }];
    await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: env, request: { ...request(), assets: { "identity-0": asset() } } })).rejects.toThrow("manifest_changed");
  });
  it.each(["__proto__", "constructor", "prototype"])("JSON 원본의 예약 키 %s를 파싱 전에 거부합니다", key => {
    const f = fixture(); const raw = text(f).replace('"inputs":{', '"inputs":{"' + key + '":"x",');
    expect(inspectComfyWorkflow(raw, f.environment, f.selection).issues.map(i => i.code)).toContain("unsafe_key");
  });
  it.each(["video/%date%", "video/../a", "video/.. /a", "video/a./b", "video/NUL.mp4"])("위험한 출력 prefix %s를 거부합니다", prefix => {
    const f = fixture(); f.graph["10"].inputs.filename_prefix = prefix; expect(codes(f)).toContain("unsafe_output_prefix");
  });
  it("마스크 극성과 원본 해상도를 별도로 검사합니다", async () => {
    const f = fixture(1); f.selection.referenceGroups = []; f.selection.slots[3].semantic = "firstFrame";
    f.graph["20"] = { class_type: "LoadImage", inputs: { image: "mask.png" } };
    f.graph["21"] = { class_type: "ImageToMask", inputs: { image: ["20", 0], channel: "alpha" } };
    f.graph["22"] = { class_type: "ImageCompositeMasked", inputs: { destination: ["11", 0], source: ["8", 0], x: 0, y: 0, resize_source: false, mask: ["21", 0] } };
    f.graph["12"].inputs.images = ["22", 0];
    f.selection.slots.push({ id: "mask", semantic: "maskImage", nodeId: "20", input: "image", required: true, maskConvention: "alpha-inverted" });
    const m = await manifest(f);
    const run = (mask: WorkflowAssetFact) => prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), assets: { "identity-0": asset(), mask } } });
    await expect(run({ ...asset(2), maskConvention: "alpha-inverted" })).resolves.toBeDefined();
    await expect(run({ ...asset(2), maskConvention: "white-edit" })).rejects.toThrow("mask_convention_mismatch");
    await expect(run({ ...asset(2), maskConvention: "alpha-inverted", height: 128 })).rejects.toThrow("mask_shape_mismatch");
  });
  it("TTS 본문·언어·프로필·음성참조는 명시적인 계약 필드입니다", () => {
    const f = fixture(); expect(workflowSourceSchema.parse({ ...f.source, operation: "tts", outputKind: "audio" }).operation).toBe("tts");
    for (const semantic of ["text", "language", "voiceProfile", "voiceReference"] as const) expect(workflowSlotSchema.parse({ id: semantic, semantic, nodeId: "1", input: "value", required: true }).semantic).toBe(semantic);
  });
  it("취소 이벤트와 subfolder traversal은 완료로 등록하지 않습니다", async () => {
    const m = await manifest(fixture());
    const interrupted = { job: { status: { completed: true, status_str: "success", messages: [["execution_interrupted", {}]] }, outputs: { "10": { videos: [{ filename: "a.mp4" }] } } } };
    expect(() => identifyWorkflowOutputs(m, interrupted, "job")).toThrow("job_not_successful");
    const unsafe = { job: { status: { completed: true }, outputs: { "10": { videos: [{ filename: "a.mp4", subfolder: "../foreign" }] } } } };
    expect(() => identifyWorkflowOutputs(m, unsafe, "job")).toThrow("unsafe_output_path");
  });
});


describe("프로젝트별 사용자 진술 사용 허가", () => {
  function authorized() {
    const f = fixture(); f.graph["1"].inputs.unet_name = "MiniMax-H3.safetensors";
    f.selection.promptRoles[0].modelRuleId = "minimaxh3"; f.source.modelIds = ["minimaxh3"];
    const weight = f.environment.weights.find(w => w.name === "MiniMax-H3.safetensors")!;
    weight.license = "blocked"; weight.sha256 = "b".repeat(64); f.environment.projectId = "p";
    f.environment.weightAuthorizations = [{ kind: "user-reported", projectId: "p", modelRuleId: "minimaxh3", category: weight.category, name: weight.name, sha256: weight.sha256,
      evidence: "사용자: 미니맥스 사용 허가 받았다니까", sourceThreadId: "parent-user-statement", reportedAtUtc: "2026-10-06T16:55:00.000Z" }];
    return f;
  }
  it("정확한 프로젝트·분류·이름·해시에만 허가를 적용하고 공개 제한은 보존합니다", async () => {
    const f = authorized(), m = await manifest(f);
    expect(m.projectId).toBe("p"); expect(m.weightAuthorizations).toHaveLength(1);
    expect(m.weightRequirements[0].publicLicense).toBe("blocked"); expect(m.weightRequirements[0].license).toBe("allowed");
    const run = await prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: request() });
    expect(run.provenance.weightAuthorizations[0].kind).toBe("user-reported");
    expect(f.environment.weights.find(w => w.name === "MiniMax-H3.safetensors")!.license).toBe("blocked");
  });
  it.each(["projectId", "category", "name", "sha256", "modelRuleId"] as const)("허가의 %s가 다르면 H3 제한을 해제하지 않습니다", field => {
    const f = authorized(); f.environment.weightAuthorizations![0][field] = field === "sha256" ? "a".repeat(64) : "other";
    expect(codes(f)).toContain("license_blocked_h3");
  });
  it("환경의 실제 파일 해시가 없으면 사용자 진술만으로 실행하지 않습니다", () => {
    const f = authorized(); delete f.environment.weights.find(w => w.name === "MiniMax-H3.safetensors")!.sha256;
    expect(codes(f)).toContain("license_blocked_h3");
  });
  it("다른 프로젝트와 허가 폐기는 실행 직전 차단합니다", async () => {
    const f = authorized(), m = await manifest(f);
    await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: f.environment, request: { ...request(), projectId: "other" } })).rejects.toThrow("authorization_project_mismatch");
    const env = structuredClone(f.environment); env.weightAuthorizations = [];
    await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: env, request: request() })).rejects.toThrow("license_blocked_h3");
  });
  it("공개 allowed 기록도 프로젝트 허가 없는 H3를 전세계 허용으로 바꾸지 않습니다", () => {
    const f = authorized(); f.environment.weights.find(w => w.name === "MiniMax-H3.safetensors")!.license = "allowed";
    f.environment.weightAuthorizations = []; expect(codes(f)).toContain("license_blocked_h3");
  });
  it("허가 provenance가 바뀌면 저장한 manifest를 재검사해야 합니다", async () => {
    const f = authorized(), m = await manifest(f), env = structuredClone(f.environment);
    env.weightAuthorizations![0].evidence = "새 사용자 진술";
    await expect(prepareWorkflowAdapterPlan({ text: text(f), manifest: m, environment: env, request: request() })).rejects.toThrow("manifest_changed");
  });
});
