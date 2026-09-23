import { characterLegend, objectLegend } from "@/lib/compositionLegend";
import type { CompositionCharacterSource, CompositionState } from "@/lib/composition";

/**
 * **타임라인에 줄로 세울 대상** — 인물 · 소품 · GLB.
 *
 * 2026-09-18 에 `CompositionPlanner.tsx` 에서 떼어 냈습니다. 화면 요소가 하나도 없는
 * 순수 계산인데, 색을 고르는 규칙(`characterLegend`)이 3D 화면과 짝이라 창 본문 한가운데
 * 있으면 「막대 색과 인형 색이 어긋난다」 를 고칠 때 두 파일을 오가며 찾아야 했습니다.
 */
export function plannerLayerTargets(
  state: CompositionState,
  plannerCharacters: CompositionCharacterSource[],
) {
  /*
  ── 타임라인 레이어로 세울 대상 ─────────────────────────────────────────
  

  색은 3D 인형의 **식별 색**을 그대로 씁니다(`characterLegend` — 뷰포트가 색을 고르는
  규칙과 같은 순번). 막대 색과 인형 색이 다르면 «노란 막대가 누구지» 가 됩니다.
  소품은 묶음에 든 낱개를 빼고 셉니다 — 상자 여섯 개로 만든 탁자가 줄 여섯 개가 되면
  카메라 줄을 찾을 수가 없습니다.
  */

  const people = characterLegend(state, (id) => {
    const source = plannerCharacters.find((item) => item.id === id);
    return source ? { name: source.name, gender: source.gender } : undefined;
  }).map((entry) => ({
    id: entry.characterId,
    name: entry.name,
    color: entry.hex,
    kind: "character" as const,
  }));
  const props = objectLegend(state)
    .filter((entry) => !state.objects.find((item) => item.id === entry.id)?.groupId)
    .map((entry) => ({
      id: entry.id,
      name: entry.label,
      color: entry.hex,
      kind: "object" as const,
    }));
  /*
    **GLB 도 타임라인 대상입니다.**

    GLB 는 제 애니메이션(클립)을 갖고 오지만, «그 사람이 어디서 어디로 걸어가는가» 는 우리 타임라인의 일입니다.
    인물·소품과 같은 트랙(`MotionTrack.targetId`)을 쓰므로 키를 찍는 방법도 같습니다.
  */
  const glbs = (state.glbTracks ?? []).map((track, index) => ({
    id: track.id,
    name: track.name || `GLB ${index + 1}`,
    color: "#7fd6a3",
    kind: "object" as const,
  }));
  return [...people, ...props, ...glbs];
}
