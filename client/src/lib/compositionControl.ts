import { z } from "zod";
import type { CompositionState } from "@/lib/composition";
import type { CompositionVideoOptions, CompositionVideoControls, SavedReferenceVideo } from "./referenceVideoExport";
import { SHOT_PRESETS } from "@/lib/cameraMoves";
import { EDITABLE_BONES } from "@/lib/rig";
import { controlDetailSchema, projectControlValue, type ControlDetail } from "./controlProjection";
import { copyJsonWithinLimit } from "./immutableJson";
import {
  CompositionControlError,
  compositionCommandsSchema,
  reduceCompositionCommands,
  type CompositionCommandContext,
} from "@/lib/compositionControlCommands";
export {
  CompositionControlError,
  COMPOSITION_COMMANDS,
  compositionCommandSchema,
  compositionCommandsSchema,
  compositionCommandsJsonSchema,
} from "@/lib/compositionControlCommands";

export interface CompositionIdentity {
  projectName: string;
  cutId: string;
  sceneTitle?: string;
  cutOrder?: number;
}
export interface CompositionCapture {
  guide: string;
  plate: string;
}
export interface CompositionSessionPort {
  /** history와 같은 불변 판입니다. 편집은 apply의 함수형 갱신으로 새 참조를 만듭니다. */
  read: () => {
    state: CompositionState;
    canUndo: boolean;
    canRedo: boolean;
    context: CompositionCommandContext;
  };
  apply: (updater: (current: CompositionState) => CompositionState) => void;
  undo: () => void;
  redo: () => void;
  settle?: () => Promise<void>;
  capture: () => Promise<CompositionCapture>;
  exportVideo?: (options: CompositionVideoOptions, controls: CompositionVideoControls) => Promise<SavedReferenceVideo>;
  commit: (
    /** 저장 포트도 이 판을 읽기만 합니다. 저장 중 새 편집은 새 객체로 남습니다. */
    state: CompositionState,
    captures: CompositionCapture,
  ) => Promise<unknown>;
}
interface Session {
  sessionId: string;
  identity: CompositionIdentity;
  port: CompositionSessionPort;
  revision: number;
  busy: boolean;
  previous: CompositionState;
  changes: CompositionChange[];
  source?: CompositionChange["source"];
}
export interface CompositionChange {
  revision: number;
  source: "editor" | "controller" | "undo" | "redo";
  changedPaths: string[];
  changes: { path: string; before?: unknown; after?: unknown }[];
  truncated: boolean;
}
const sessions = new Map<string, Session>();
const openers = new Map<
  string,
  { identity: CompositionIdentity; open: () => void }
>();
const projectPages = new Map<
  string,
  { targets: () => CompositionIdentity[]; prepare: (cutId: string) => void }
>();
let serial = 0;
const keyOf = (target: CompositionIdentity) =>
  JSON.stringify([target.projectName, target.cutId]);
const sessionIdSchema = z.string().min(1).max(300);
export const compositionSessionRequestSchema = z
  .object({
    sessionId: sessionIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    detail: controlDetailSchema,
  })
  .strict();
export const compositionApplyRequestSchema =
  compositionSessionRequestSchema.extend({
    commands: compositionCommandsSchema,
  });
export const compositionOpenRequestSchema = z
  .object({
    projectName: z.string().min(1).max(500),
    cutId: z.string().min(1).max(200),
    detail: controlDetailSchema,
  })
  .strict();
export const compositionChangesRequestSchema = z
  .object({
    sessionId: sessionIdSchema,
    sinceRevision: z.number().int().nonnegative(),
    detail: controlDetailSchema,
  })
  .strict();
export const compositionChangesJsonSchema = z.toJSONSchema(
  compositionChangesRequestSchema,
);
export const compositionApplyJsonSchema = z.toJSONSchema(
  compositionApplyRequestSchema,
);
export const compositionSessionJsonSchema = z.toJSONSchema(
  compositionSessionRequestSchema,
);
export const compositionOpenJsonSchema = z.toJSONSchema(
  compositionOpenRequestSchema,
);

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new CompositionControlError(
      "invalid_request",
      "구도 요청의 형식이 맞지 않습니다.",
      result.error.issues,
    );
  return result.data;
}

function difference(
  before: unknown,
  after: unknown,
  path = "",
  result: CompositionChange["changes"] = [],
): CompositionChange["changes"] {
  if (before === after) return result;
  if (result.length >= 100) return result;
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    Array.isArray(before) === Array.isArray(after)
  ) {
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      if (result.length >= 100) break;
      difference(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
        result,
      );
    }
  } else result.push({ path: path || "/", before, after });
  return result;
}
function reconcile(session: Session) {
  const value = session.port.read();
  if (value.state !== session.previous) {
    const changes = difference(session.previous, value.state);
    // 입력은 history의 불변 판입니다. 구도 전체 사본을 하나 더 보관하지 않습니다.
    session.previous = value.state;
    if (!changes.length) return value;
    const copied = copyJsonWithinLimit(changes, 200_000);
    session.revision += 1;
    session.changes.push({
      revision: session.revision,
      source: session.source ?? "editor",
      changedPaths: changes.map((item) => item.path),
      changes: copied.value ?? [],
      truncated: copied.exceeded || changes.length >= 100,
    });
    if (session.changes.length > 200) session.changes.shift();
  }
  return value;
}
function requireSession(sessionId: string): Session {
  const session = sessions.get(sessionId);
  if (!session)
    throw new CompositionControlError(
      "session_closed",
      "구도 편집창이 닫혔거나 다시 열렸습니다. 열린 구도 목록을 다시 읽어 주세요.",
    );
  return session;
}
function guard(session: Session, revision: number) {
  if (sessions.get(session.sessionId) !== session)
    throw new CompositionControlError(
      "session_closed",
      "작업 중 구도 편집창이 닫혔습니다.",
    );
  reconcile(session);
  if (session.revision !== revision)
    throw new CompositionControlError(
      "revision_conflict",
      "그 사이 구도가 바뀌었습니다. 최신 구도를 읽은 뒤 다시 적용해 주세요.",
      { expectedRevision: revision, actualRevision: session.revision },
    );
}
function snapshot(session: Session, detail: ControlDetail = "full") {
  const value = reconcile(session);
  // 모캡 키 전체를 먼저 복제하면 요약 응답이어도 수십 MB를 왕복 준비하며 멈춥니다.
  const projected = projectControlValue(value.state, detail);
  return {
    ...session.identity,
    sessionId: session.sessionId,
    revision: session.revision,
    busy: session.busy,
    canUndo: value.canUndo,
    canRedo: value.canRedo,
    state: projected.value,
    projection: projected.projection,
    availableCharacterIds: [...value.context.characterIds],
    availableImageIds: [...(value.context.imageIds ?? [])],
  };
}

/** 등록은 열린 창에만 합니다. 같은 컷을 다시 열면 옛 revision을 새 창에 적용할 수 없습니다. */
export function registerCompositionSession(
  identity: CompositionIdentity,
  port: CompositionSessionPort,
) {
  const sessionId = `composition-${Date.now()}-${++serial}`;
  const initial = port.read().state;
  const session: Session = {
    identity,
    port,
    sessionId,
    revision: 0,
    previous: initial,
    changes: [],
    busy: false,
  };
  sessions.set(sessionId, session);
  return () => {
    sessions.delete(sessionId);
  };
}
/** 매 화면 커밋에서도 관찰해야 대화가 쉬는 동안 사람이 편집한 내역을 놓치지 않습니다. */
export function observeCompositionSession(identity: CompositionIdentity) {
  for (const session of sessions.values())
    if (keyOf(session.identity) === keyOf(identity)) reconcile(session);
}
/** 버튼·단축키의 되돌리기도 같은 로그에 적습니다. action은 화면 반영까지 동기로 끝냅니다. */
export function withCompositionChangeSource(
  identity: CompositionIdentity | null,
  source: CompositionChange["source"],
  action: () => void,
) {
  const selected = identity
    ? [...sessions.values()].filter(
        (session) => keyOf(session.identity) === keyOf(identity),
      )
    : [];
  const previous = selected.map((session) => {
    reconcile(session);
    const before = session.source;
    session.source = source;
    return before;
  });
  try {
    action();
    selected.forEach(reconcile);
  } finally {
    selected.forEach((session, index) => {
      session.source = previous[index];
    });
  }
}
/** 단계가 달라도 컷을 찾습니다. 이동은 진행 도장을 찍거나 프로젝트를 쓰지 않습니다. */
export function registerCompositionProjectPage(
  projectName: string,
  targets: () => CompositionIdentity[],
  prepare: (cutId: string) => void,
) {
  const page = { targets, prepare };
  projectPages.set(projectName, page);
  return () => {
    if (projectPages.get(projectName) === page)
      projectPages.delete(projectName);
  };
}
export function registerCompositionOpener(
  identity: CompositionIdentity,
  open: () => void,
) {
  const key = keyOf(identity);
  const target = { identity, open };
  openers.set(key, target);
  return () => {
    if (openers.get(key) === target) openers.delete(key);
  };
}
export function listCompositionTargets() {
  const all = [...projectPages.values()]
    .flatMap((page) => page.targets())
    .concat([...openers.values()].map((item) => item.identity));
  return [
    ...new Map(
      all.map((identity) => [keyOf(identity), { ...identity }]),
    ).values(),
  ];
}
export function listCompositionSessions() {
  return [...sessions.values()].map((session) => {
    const { state: _state, ...info } = snapshot(session, "summary");
    return info;
  });
}
export function getCompositionSession(sessionId: string, detail: ControlDetail = "full") {
  const session = requireSession(parse(sessionIdSchema, sessionId));
  return {
    ...snapshot(session, detail),
    cameraPresets: SHOT_PRESETS.map(({ id, label }) => ({ id, label })),
    bones: EDITABLE_BONES.map(({ id, label }) => ({ id, label })),
    units: {
      position: "m",
      commandRotation: "degrees",
      storedCharacterRotation: "radians",
      roomRotation: "degrees",
      time: "seconds",
    },
  };
}
export function getCompositionChanges(input: unknown) {
  const request = parse(compositionChangesRequestSchema, input);
  const session = requireSession(request.sessionId);
  const latest = snapshot(session, request.detail);
  if (request.sinceRevision > session.revision)
    throw new CompositionControlError(
      "revision_conflict",
      "요청한 판이 현재 구도보다 앞섭니다.",
      { actualRevision: session.revision },
    );
  const changes = session.changes.filter(
    (item) => item.revision > request.sinceRevision,
  );
  const first = session.changes[0]?.revision ?? session.revision + 1;
  const projected = projectControlValue(changes, request.detail);
  // 본문 예산이 먼저 소진돼도 사람이 어느 판에서 무엇을 바꿨는지는 남겨야 합니다.
  const entries = request.detail === "full" ? projected.value : changes.map((change, index) => ({
    revision: change.revision,
    source: change.source,
    changedPaths: [...change.changedPaths],
    changes: projected.value[index]?.changes ?? [],
    truncated: change.truncated || projected.projection.truncated,
  }));
  return {
    sessionId: session.sessionId,
    revision: session.revision,
    changes: entries,
    changesProjection: projected.projection,
    fullSnapshotRequired:
      request.sinceRevision < first - 1 ||
      changes.some((item) => item.truncated) || projected.projection.truncated,
    snapshot: latest,
  };
}
export async function openComposition(input: unknown) {
  const target = parse(compositionOpenRequestSchema, input);
  const existing = [...sessions.values()].find(
    (item) => keyOf(item.identity) === keyOf(target),
  );
  if (existing) return snapshot(existing, target.detail);
  let opened = false;
  let prepared = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!prepared) {
      const page = projectPages.get(target.projectName);
      if (page) {
        if (!page.targets().some((item) => item.cutId === target.cutId))
          throw new CompositionControlError(
            "cut_not_found",
            "해당 프로젝트에 그 컷이 없습니다. 컷 목록을 다시 읽어 주세요.",
          );
        page.prepare(target.cutId);
        prepared = true;
      }
    }
    const opener = openers.get(keyOf(target));
    if (!opened && opener) {
      opener.open();
      opened = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const found = [...sessions.values()].find(
      (item) => keyOf(item.identity) === keyOf(target),
    );
    if (found) {
      await found.port.settle?.();
      return snapshot(found, target.detail);
    }
  }
  if (!prepared && !opened)
    throw new CompositionControlError(
      "target_not_mounted",
      "project_open으로 해당 프로젝트를 연 뒤 구도를 열어 주세요.",
    );
  throw new CompositionControlError(
    "session_not_ready",
    "구도 편집창이 준비되지 않았습니다.",
  );
}

async function exclusive<T>(
  session: Session,
  job: () => Promise<T>,
): Promise<T> {
  if (session.busy)
    throw new CompositionControlError(
      "session_busy",
      "이 구도에서 다른 명령을 처리하고 있습니다.",
    );
  session.busy = true;
  try {
    return await job();
  } finally {
    session.busy = false;
  }
}

export async function applyCompositionCommands(input: unknown) {
  const request = parse(compositionApplyRequestSchema, input);
  const session = requireSession(request.sessionId);
  return exclusive(session, async () => {
    guard(session, request.expectedRevision);
    let created: { index: number; id: string }[] = [];
    // 함수 안에서 최신 판으로 다시 계산합니다. 검증 중 실패한 명령은 history에 들어가지 않습니다.
    const read = session.port.read();
    const planned = reduceCompositionCommands(
      read.state,
      request.commands,
      read.context,
    );
    if (planned.state !== read.state) {
      session.source = "controller";
      try {
        session.port.apply((current) => {
          if (current !== read.state)
            throw new CompositionControlError(
              "revision_conflict",
              "적용 직전에 구도가 바뀌었습니다.",
            );
          created = planned.created;
          return planned.state;
        });
        reconcile(session);
      } finally {
        session.source = undefined;
      }
    }
    await settleAfterEdit(session, {
      applied: planned.state !== read.state,
      created,
    }, request.detail);
    return { ...snapshot(session, request.detail), created };
  });
}

/**
 * 파일 읽기가 필요한 내부 도메인 동작도 화면과 같은 history에 한 번만 넣습니다.
 * prepare는 앱 내부 함수입니다. 외부에서 함수·스크립트·저장 상태 전체를 받지 않습니다.
 */
export async function applyCompositionMutation<T>(
  input: unknown,
  prepare: (value: { state: CompositionState; identity: CompositionIdentity; context: CompositionCommandContext }) =>
    Promise<{ state: CompositionState; result: T }> | { state: CompositionState; result: T },
) {
  const request = parse(compositionSessionRequestSchema, input);
  const session = requireSession(request.sessionId);
  return exclusive(session, async () => {
    guard(session, request.expectedRevision);
    const read = session.port.read();
    const planned = await prepare({ state: read.state, identity: { ...session.identity }, context: read.context });
    // 결과를 읽고 리타깃하는 사이 사람은 계속 편집할 수 있습니다. 늦게 온 계산으로 덮지 않습니다.
    guard(session, request.expectedRevision);
    const applied = planned.state !== read.state;
    if (applied) {
      session.source = "controller";
      try {
        session.port.apply(current => {
          if (current !== read.state) throw new CompositionControlError("revision_conflict", "적용 직전에 구도가 바뀌었습니다.");
          return planned.state;
        });
        reconcile(session);
      } finally { session.source = undefined; }
    }
    await settleAfterEdit(session, { applied });
    const latest = reconcile(session);
    // 수천 개 관절 키를 다시 응답에 싣지 않습니다. 상세 상태는 composition_get으로 읽을 수 있습니다.
    return { ...session.identity, sessionId: session.sessionId, revision: session.revision,
      canUndo: latest.canUndo, canRedo: latest.canRedo, applied, result: planned.result };
  });
}

async function historyCommand(input: unknown, direction: "undo" | "redo") {
  const request = parse(compositionSessionRequestSchema, input);
  const session = requireSession(request.sessionId);
  return exclusive(session, async () => {
    guard(session, request.expectedRevision);
    const value = session.port.read();
    if (direction === "undo" ? !value.canUndo : !value.canRedo)
      throw new CompositionControlError(
        "history_empty",
        "되돌릴 구도 변경이 없습니다.",
      );
    session.source = direction;
    try {
      session.port[direction]();
      reconcile(session);
    } finally {
      session.source = undefined;
    }
    await settleAfterEdit(session, { applied: true, operation: direction }, request.detail);
    return snapshot(session, request.detail);
  });
}
export const undoComposition = (input: unknown) =>
  historyCommand(input, "undo");
export const redoComposition = (input: unknown) =>
  historyCommand(input, "redo");

async function settleAfterEdit(
  session: Session,
  result: {
    applied: boolean;
    created?: { index: number; id: string }[];
    operation?: string;
  },
  detail: ControlDetail = "summary",
) {
  try {
    await session.port.settle?.();
    requireSession(session.sessionId);
  } catch (error) {
    // 이미 들어간 편집을 단순 실패로 돌리면 LLM이 재시도해 마네킹·소품을 두 번 만듭니다.
    throw new CompositionControlError(
      "edit_confirmation_failed",
      "편집 처리 뒤 화면 확인을 끝내지 못했습니다. 적용 여부와 최신 판을 확인한 뒤 계속해 주세요.",
      {
        ...result,
        snapshot: snapshot(session, detail),
        sessionClosed: !sessions.has(session.sessionId),
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

export async function captureComposition(input: unknown) {
  const request = parse(compositionSessionRequestSchema, input);
  const session = requireSession(request.sessionId);
  return exclusive(session, async () => {
    guard(session, request.expectedRevision);
    await session.port.settle?.();
    guard(session, request.expectedRevision);
    const captures = await session.port.capture();
    guard(session, request.expectedRevision);
    return {
      sessionId: session.sessionId,
      revision: session.revision,
      ...captures,
    };
  });
}
export async function commitComposition(input: unknown) {
  const request = parse(compositionSessionRequestSchema, input);
  const session = requireSession(request.sessionId);
  return exclusive(session, async () => {
    guard(session, request.expectedRevision);
    await session.port.settle?.();
    guard(session, request.expectedRevision);
    const captures = await session.port.capture();
    guard(session, request.expectedRevision);
    // UI 저장과 같은 불변 판을 전달합니다. 전체 모캡을 JSON 왕복 복제하면 저장 직전 메모리가 급증합니다.
    const state = session.port.read().state;
    const result = await session.port.commit(state, captures);
    // 저장 도중 사람이 더 편집할 수 있습니다. 저장한 판과 현재 판을 구분해 성공을 과장하지 않습니다.
    const after = snapshot(session, request.detail);
    return {
      ...after,
      persistedRevision: request.expectedRevision,
      persistedLatest: after.revision === request.expectedRevision,
      result,
    };
  });
}

/** 내보내기 동안 같은 세션의 명령을 직렬화하고 수동 편집은 판 충돌로 알립니다. */
export async function exportCompositionVideo(
  input: unknown,
  options: CompositionVideoOptions,
  controls: CompositionVideoControls,
  persist: (video: SavedReferenceVideo, identity: CompositionIdentity) => Promise<void>,
) {
  const request = parse(compositionSessionRequestSchema, input);
  const session = requireSession(request.sessionId);
  return exclusive(session, async () => {
    guard(session, request.expectedRevision);
    if (!session.port.exportVideo) throw new CompositionControlError("export_unavailable", "이 구도 창은 영상 내보내기가 준비되지 않았습니다.");
    await session.port.settle?.();
    guard(session, request.expectedRevision);
    const sourceState = session.port.read().state;
    const assertCurrent = () => {
      if (controls.signal?.aborted) throw new DOMException("영상 만들기를 취소했습니다.", "AbortError");
      // 관절 키 수만 개를 프레임마다 직렬화하지 않습니다. 함수형 편집으로 참조가 바뀐 때 판을 다시 셉니다.
      if (sessions.get(session.sessionId) !== session || session.port.read().state !== sourceState)
        guard(session, request.expectedRevision);
      controls.assertCurrent?.();
    };
    const video = await session.port.exportVideo(options, { ...controls, assertCurrent });
    assertCurrent();
    guard(session, request.expectedRevision);
    // 파일 쓰기만 성공한 상태를 완료로 보고하지 않습니다. 프로젝트 저장 관문의 ack가 필요합니다.
    await persist(video, { ...session.identity });
    reconcile(session);
    return { ...video, sessionId: session.sessionId, sourceRevision: request.expectedRevision,
      revision: session.revision, persistedLatest: session.revision === request.expectedRevision,
      persisted: true, compositionSaved: false };
  });
}
