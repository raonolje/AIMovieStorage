import { catalogRecord, catalogStrings, type MagnificModel } from "./magnificCatalog";
import { targetModelOf } from "./modelRules";
import { t } from "./i18n";

const record = catalogRecord, strings = catalogStrings;
const refsOf = (model: MagnificModel) => Array.isArray(model.details?.references)
  ? model.details.references.map(record) : [];

/** 화면용 구형 별칭은 조회할 때만 풉니다. 실제 요청에는 카탈로그의 slug를 씁니다. */
export function findMagnificVideoModel(models: MagnificModel[], id?: string): MagnificModel | undefined {
  if (!id) return undefined;
  const exact = models.find(item => item.slug === id);
  if (exact) return exact;
  const label = targetModelOf(id)?.label ?? (id === "seedance-2-5-pro" ? "Seedance 2.5" : id);
  const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matches = models.filter(item => normalized(item.name) === normalized(label));
  return matches.length === 1 ? matches[0] : undefined;
}

export function supportsVideoReference(model?: MagnificModel): boolean | undefined {
  if (!model?.details) return undefined;
  const detail = refsOf(model).find(item => item.type === "video");
  if (typeof detail?.allowed === "boolean") return detail.allowed;
  if (model.details.supportsReferences === false) return false;
  if (Array.isArray(model.details.referenceTypes)) return strings(model.details.referenceTypes).includes("video");
  return undefined;
}

export function videoInputKind(model?: MagnificModel): "unknown" | "motion" | "video" | "image" | "text" {
  if (!model?.details) return "unknown";
  if (supportsVideoReference(model)) return /motion[-_ ]control/i.test(String(model.details.mode ?? "")) ? "motion" : "video";
  if (supportsVideoReference(model) === undefined) return "unknown";
  return model.details.supportsStartFrame === true || strings(model.details.referenceTypes).includes("image") ? "image" : "text";
}

export function videoCapabilityLabel(model?: MagnificModel): string {
  switch (videoInputKind(model)) {
    case "video": return t("영상 레퍼런스 지원 · 카메라 재현 정도는 모델과 입력에 따라 다릅니다");
    case "motion": return t("동작 전용 · 카메라 이동과 공간 일치를 보장하지 않습니다");
    case "image": return t("그림 입력 지원 · 레퍼런스 영상의 움직임은 전달할 수 없습니다");
    case "text": return t("영상·그림 레퍼런스 미지원");
    default: return t("지원 범위를 확인하려면 Magnific에 연결하고 모델 목록을 불러오세요");
  }
}

/**
 * 실제로 접수·출력 완료를 확인한 한 규약만 보정합니다. 카탈로그 원문과 전송 인자는 바꾸지 않습니다.
 * 이 모델의 start=video 표시는 공통 video_generate의 start=image와 충돌하지만,
 * 시작 그림 + references.video 조합은 확인됐습니다. 다른 모델/달라진 규약으로 확대하지 않습니다.
 */
export function normalizeMagnificVideoInputContract(model: MagnificModel): MagnificModel {
  const details = model.details;
  if (!details || model.slug !== "kling-motion-control-30" || details.api !== "kling"
    || details.mode !== "motion-control-30" || details.tool !== "video-generator"
    || details.supportsReferences !== true || details.supportsStartFrame !== true || details.supportsEndFrame !== false) return model;
  const frames = record(details.keyframes), start = record(frames.start), refs = refsOf(model);
  const keys = (value: Record<string, unknown>) => Object.keys(value).sort().join(",");
  if (keys(frames) !== "start" || keys(start) !== "assetType,required" || start.assetType !== "video" || start.required !== true
    || strings(details.referenceTypes).join(",") !== "video" || refs.length !== 1
    || keys(refs[0]) !== "allowed,limit,type" || refs[0].type !== "video" || refs[0].allowed !== true || refs[0].limit !== 1) return model;
  return { ...model, details: { ...details, keyframes: { start: { ...start, assetType: "image" } },
    references: [{ ...refs[0], required: true }] } };
}

/** 카탈로그가 허용하지 않는 입력을 버리거나 첫 프레임으로 바꾸지 않고 전송 전에 거절합니다. */
export function assertMagnificVideoInputs(model: MagnificModel | undefined, args: Record<string, unknown>) {
  if (model) model = normalizeMagnificVideoInputContract(model);
  const references = Array.isArray(args.references) ? args.references.map(record) : [];
  const frames = record(args.keyframes);
  const hasInputs = references.length > 0 || Object.keys(frames).length > 0;
  if (!model?.details) {
    if (hasInputs) throw new Error(t("레퍼런스를 보내려면 현재 목록에서 Magnific 영상 모델을 먼저 고르세요."));
    return;
  }
  const fail = (key: string, values: Record<string, string | number> = {}) => { throw new Error(t(key, { model: model.name, ...values })); };
  const types = references.map(ref => String(ref.type ?? ""));
  const present = new Set([...types, ...Object.keys(frames).map(key => `keyframes.${key}`), ...Object.keys(frames).map(key => `${key}Frame`), ...types.map(type => `upload:${type}`)]);
  const required = (value: unknown) => strings(value).every(key => present.has(key));
  const prohibited = (value: unknown) => strings(value).some(key => present.has(key));
  const conditionMatches = (value: unknown) => Object.entries(record(value)).some(([key, expected]) => Array.isArray(expected) && expected.includes(args[key]));
  const constraints = (entry: Record<string, unknown>) => {
    const nested = record(entry.constraints);
    for (const rule of [entry, nested]) {
      if (prohibited(rule.prohibitedWith)) fail("{model}: 함께 사용할 수 없는 입력 조합입니다. 시작·끝 프레임과 레퍼런스 제약을 확인하세요.");
      if (rule.requiredWith && !required(rule.requiredWith)) fail("{model}: 함께 필요한 입력이 빠졌습니다 ({inputs}).", { inputs: strings(rule.requiredWith).join(", ") });
      if (strings(rule.requiredWithAny).length && !prohibited(rule.requiredWithAny)) fail("{model}: 그림이나 인물 등 시각 레퍼런스를 함께 넣어야 합니다.");
      if (conditionMatches(rule.prohibitedIf)) fail("{model}: 선택한 해상도 또는 설정에서는 이 레퍼런스를 사용할 수 없습니다.");
    }
  };
  for (const type of new Set(types)) {
    const entry = refsOf(model).find(ref => ref.type === type);
    const allowed = entry?.allowed ?? (model.details.supportsReferences === false ? false : Array.isArray(model.details.referenceTypes) ? strings(model.details.referenceTypes).includes(type) : undefined);
    if (allowed !== true) fail("{model}: {type} 레퍼런스를 지원하지 않거나 지원을 확인하지 못했습니다. 입력을 빼거나 지원 모델을 고르세요.", { type });
    const limit = entry?.limit ?? record(record(entry?.constraints).count).max;
    if (typeof limit === "number" && types.filter(value => value === type).length > limit) fail("{model}: {type} 레퍼런스는 최대 {limit}개입니다.", { type, limit });
    if (entry) constraints(entry);
  }
  for (const [key, frame] of Object.entries(frames)) {
    const entry = record(record(model.details.keyframes)[key]);
    const supported = key === "start" ? model.details.supportsStartFrame : key === "end" ? model.details.supportsEndFrame : undefined;
    if (!Object.keys(entry).length || supported === false) fail("{model}: {type} 입력을 지원하지 않거나 지원을 확인하지 못했습니다.", { type: `keyframes.${key}` });
    const suppliedType = typeof frame === "string" ? "image" : record(frame).type;
    if (entry.assetType && suppliedType !== entry.assetType) fail("{model}: {type} 입력 종류가 카탈로그와 다릅니다.", { type: `keyframes.${key}` });
    constraints(entry);
  }
  for (const entry of refsOf(model)) if (entry.required === true && !types.includes(String(entry.type))) fail("{model}: 필수 {type} 레퍼런스가 없습니다.", { type: String(entry.type) });
  for (const [key, value] of Object.entries(record(model.details.keyframes))) {
    const entry = record(value);
    if ((entry.required === true || conditionMatches(entry.requiredIf)) && !frames[key]) fail("{model}: 필수 {type} 입력이 없습니다.", { type: `keyframes.${key}` });
  }
  // 도구에는 start(image) 외에 video 슬롯도 있지만 카탈로그는 start=video라고 적습니다.
  // 위의 검증된 모델·규약 외에는 대응을 추측하거나 레퍼런스를 버리지 않습니다.
  if (videoInputKind(model) === "motion" && record(record(model.details.keyframes).start).assetType === "video") {
    fail("{model}: 동작 전용 모델의 시작 입력 규약이 서로 달라 자동 전송을 멈췄습니다. Magnific에서 입력을 직접 확인하세요.");
  }
}

export function mediaTypeOfPath(path: string): "image" | "video" | "audio" {
  if (/\.(mp4|mov|webm|mkv)(?:[?#]|$)/i.test(path)) return "video";
  if (/\.(mp3|wav|ogg|flac|m4a)(?:[?#]|$)/i.test(path)) return "audio";
  return "image";
}
