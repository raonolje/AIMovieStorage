import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { CompositionState } from "@/lib/composition";
import type { UndoHistory } from "@/lib/useUndoStack";
import {
  CompositionControlError,
  observeCompositionSession,
  registerCompositionSession,
  type CompositionCapture,
  type CompositionIdentity,
} from "@/lib/compositionControl";
import type { CompositionCommandContext } from "@/lib/compositionControlCommands";
import type { CompositionVideoOptions, CompositionVideoControls, SavedReferenceVideo } from "@/lib/referenceVideoExport";

export type ControlledCapture = (options?: {
  backgroundOnly?: boolean;
  requireReady?: boolean;
}) => string;

/** 백그라운드 WebView는 rAF를 멈춥니다. 편집 완료는 화면 프레임이 아니라 React의 후속 효과를 기다립니다. */
export async function settleCompositionEditor(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** 화면이 쓰는 history를 그대로 등록합니다. 외부 명령만 별도 초안에 쓰면 다음 저장에서 서로 덮어씁니다. */
export function useCompositionControl(options: {
  open: boolean;
  identity: CompositionIdentity | null;
  history: UndoHistory<CompositionState>;
  context: CompositionCommandContext;
  capture: () => ControlledCapture | null;
  stopPlayback: () => void;
  exportVideo?: (options: CompositionVideoOptions, controls: CompositionVideoControls) => Promise<SavedReferenceVideo>;
  commit?: (
    state: CompositionState,
    captures: CompositionCapture,
  ) => Promise<unknown>;
}) {
  const current = useRef(options);
  current.current = options;
  const captureCurrent = useCallback(async () => {
    flushSync(() => current.current.stopPlayback());
    await settleCompositionEditor();
    let lastError: unknown;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!current.current.open)
        throw new CompositionControlError("session_closed", "캡처 중 구도 창이 닫혔습니다.");
      const capture = current.current.capture();
      if (capture) {
        try {
          return {
            guide: capture({ requireReady: true }),
            plate: capture({ backgroundOnly: true, requireReady: true }),
          };
        } catch (error) { lastError = error; }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new CompositionControlError(
      "assets_not_ready", "구도 자산을 다 읽지 못해 캡처하지 않았습니다.",
      String(lastError ?? "3D 화면 준비 중"),
    );
  }, []);
  useLayoutEffect(() => {
    if (options.open && options.identity)
      observeCompositionSession(options.identity);
  });
  useEffect(() => {
    if (!options.open || !options.identity) return;
    return registerCompositionSession(options.identity, {
      read: () => {
        const latest = current.current;
        return {
          state: latest.history.value,
          canUndo: latest.history.canUndo,
          canRedo: latest.history.canRedo,
          context: latest.context,
        };
      },
      apply: (updater) => {
        flushSync(() => current.current.history.set(updater));
      },
      undo: () => {
        flushSync(() => current.current.history.undo());
      },
      redo: () => {
        flushSync(() => current.current.history.redo());
      },
      // 자동 키·방 규칙도 기존 effect 한 벌이 적용합니다. 적용된 판을 읽기 전에 React와 viewport가 따라올 틈을 줍니다.
      settle: settleCompositionEditor,
      capture: captureCurrent,
      exportVideo: async (options, controls) => {
        if (!current.current.open || !current.current.exportVideo)
          throw new CompositionControlError("export_unavailable", "구도 창의 영상 내보내기가 준비되지 않았습니다.");
        await captureCurrent();
        controls.assertCurrent?.();
        return current.current.exportVideo(options, controls);
      },
      commit: async (state, captures) => {
        const commit = current.current.commit;
        if (!commit)
          throw new CompositionControlError(
            "commit_unavailable",
            "아직 저장되지 않은 프로젝트입니다.",
          );
        return commit(state, captures);
      },
    });
  }, [options.open, options.identity?.projectName, options.identity?.cutId]);
  return { capture: captureCurrent };
}
