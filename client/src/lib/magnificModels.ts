import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * **마그니픽이 가진 모델 목록.**
 *
 *
 *
 * # 목록을 **박아 두지 않습니다**
 *
 * 마그니픽은 모델을 자주 갈아 끼웁니다. 우리 코드에 이름을 적어 두면 새 모델이 나와도
 * 못 고르고, 없어진 모델을 계속 보여 줍니다. 그래서 `images_models_list` ·
 * `video_models_list` 를 **그때그때 물어봅니다.**
 *
 * 한 번 받아 두면 이번 세션 동안 다시 묻지 않습니다 — 목록 하나 받자고 왕복을 되풀이할
 * 이유가 없습니다.
 */

export type { MagnificModel } from "./magnificCatalog";
import { parseMagnificCatalog, type MagnificModel } from "./magnificCatalog";

const cache: Partial<Record<"image" | "video", MagnificModel[]>> = {};
const pending: Partial<Record<"image" | "video", Promise<MagnificModel[]>>> = {};

export async function loadMagnificModels(
  kind: "image" | "video",
  /** 참이면 받아 둔 것을 버리고 다시 묻습니다 — 「불러오기」 단추가 이걸 씁니다. */
  fresh = false,
): Promise<MagnificModel[]> {
  if (!fresh && cache[kind]) return cache[kind]!;
  // 컷마다 안내를 띄워도 같은 카탈로그 요청을 동시에 여러 번 보내지 않습니다.
  if (pending[kind]) return pending[kind]!;
  const request = readMagnificModels(kind);
  pending[kind] = request;
  try { return await request; }
  finally { delete pending[kind]; }
}

async function readMagnificModels(kind: "image" | "video"): Promise<MagnificModel[]> {
  const reply = await invoke<unknown>("magnific_call", {
    tool: kind === "image" ? "images_models_list" : "video_models_list",
    args: {},
  });
  const made = parseMagnificCatalog(reply);
  /*
    빈 목록은 **성공이 아닙니다.** 오류도 없이 비어 있으면 「연결했는데 왜 안 뜨지」 를
    알 길이 없습니다. 받아 온 것을 그대로 붙여 까닭을 보여 줍니다.
  */
  if (!made.length) {
    const peek = typeof reply === "string" ? reply.slice(0, 200) : JSON.stringify(reply).slice(0, 200);
    throw new Error(`모델 목록을 읽지 못했습니다. 받은 답: ${peek || "(빈 답)"}`);
  }
  cache[kind] = made;
  return made;
}

/**
 * 이 씬의 길이를 **그 모델이 받아 주는 길이**로 맞춥니다.
 *
 *
 *
 * 러닝타임을 정하는 것은 **컷 길이의 합**입니다. 그런데 생성기마다 받아 주는 길이가
 * 정해져 있어서(5초·10초만 되는 모델이 흔합니다) 그대로는 못 보냅니다. 그렇다고 우리가
 * 10초로 못 박아 두면, 20초를 받는 모델을 골라도 10초로 잘립니다 — 예전 코드가 그랬습니다.
 *
 * 그래서 **모델에게 물어보고** 가장 가까운 값으로 맞춥니다. 목록이 없으면 위 한계까지만
 * 자르고, 그것도 없으면 씬이 정한 길이를 그대로 보냅니다.
 */
export function fitDuration(models: MagnificModel[], slug: string | undefined, wanted: number): number {
  const model = slug ? models.find((item) => item.slug === slug) : undefined;
  const choices = model?.durations ?? [];
  if (choices.length) {
    // 모자란 것보다 넘치는 편이 낫습니다 — 컷이 잘리면 이야기가 끊깁니다.
    const over = choices.filter((item) => item >= wanted).sort((a, b) => a - b)[0];
    if (over) return over;
    return Math.max(...choices);
  }
  return wanted;
}

/**
 * 화면에서 쓰는 목록. 연결 전이거나 실패하면 **빈 목록**입니다 —
 * 그때는 「마그니픽이 알아서」 하나만 고를 수 있습니다.
 */
export function useMagnificModels(kind: "image" | "video", enabled: boolean) {
  const [models, setModels] = useState<MagnificModel[]>(cache[kind] ?? []);
  const [failed, setFailed] = useState("");
  const [loading, setLoading] = useState(false);

  /**
   * 목록을 받아 옵니다.
   *
   *
   *
   * 저절로 한 번 받아 보되, 안 되면 **까닭을 적고 단추를 내놓습니다.** 조용히 비어 있으면
   * 「연결했는데 왜 안 뜨지」 를 알 길이 없습니다 — 연결이 끊겼는지, 도구 이름이 바뀌었는지,
   * 그냥 느린 건지.
   */
  const reload = useCallback(
    async (fresh = true) => {
      setLoading(true);
      setFailed("");
      try {
        setModels(await loadMagnificModels(kind, fresh));
      } catch (error) {
        setFailed(String(error));
      } finally {
        setLoading(false);
      }
    },
    [kind],
  );

  useEffect(() => {
    if (!enabled || cache[kind]) return;
    void reload(false);
  }, [kind, enabled, reload]);

  return { models, failed, loading, reload };
}
