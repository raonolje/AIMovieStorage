import { useEffect } from "react";

import { useCurrentTutorialAnchor, useTutorial } from "@/lib/tutorialStore";
import { ALWAYS_KEEP } from "@/lib/tutorialPanels";

/*
  **겹쳐 뜨는 것이 스스로 물러납니다.** 튜토리얼이 도는 동안에만.

  「아니면 닫으라도 하던가」 「자꾸 같은 수정을
  반복하네?」.

  같은 고장을 다섯 번 고쳤습니다 — 캐릭터 카드, 구도잡기 창, 접이식, 일괄 생성 창, 그리고 또 일괄
  생성 창. 모양이 전부 같습니다: **걸음이 가리키는 자리를 겹쳐 뜬 것이 덮고 있거나, 그 뒤에 있다.**
  창마다 고치니 다음 창에서 또 납니다.

  그래서 «여는 쪽» 과 «닫는 쪽» 을 한 벌로 맞췄습니다.

  - 여는 쪽: 문(단추)에 `data-tour-open="<열면 생기는 앵커들>"`. 안내 창이 그 문을 밝히고
    「먼저 이것을 누르세요」 라고 적습니다(`TutorialOverlay`).
  - 닫는 쪽: 겹쳐 뜬 것이 이 훅으로 «내가 품은 앵커들» 을 알립니다. 지금 걸음의 자리가 그 목록에
    없으면 이 창은 이 걸음에 쓸모가 없으니 **스스로 닫습니다.**

  Radix 창이든 손으로 만든 덮개든 상관없습니다 — 닫는 방법(`onClose`)만 저마다 넘기면 됩니다.
  `ui/dialog.tsx` 의 `DialogContent` 는 `tutorialHolds` 한 줄로 이 훅을 대신 불러 줍니다.

  튜토리얼이 안 돌 때는 아무 일도 하지 않습니다. 사람이 제 손으로 연 창을 닫아 버리면 안 됩니다.
*/
export function useTutorialPanel(options: {
  /** 지금 떠 있는가. 닫혀 있으면 할 일이 없습니다. */
  open: boolean;
  /**
   * 이 창이 품은 `data-tour` 이름들. 띄어쓰기로 나눕니다.
   *
   * **빈 글자면 «아무것도 안 품었다»** — 튜토리얼이 도는 동안에는 곧바로 닫힙니다. 그것이 기본인
   * 까닭은
   * 걸음과 상관없는 창이 떠 있으면 그 걸음의 자리를 덮어 버립니다 — 칸 자르기 창이 «뽑은 그림
   * 등록» 걸음을 통째로 가린 일이 그것입니다.
   */
  holds: string;
  /** 닫는 법. 부모가 쥔 상태를 내리는 것이라야 합니다(감추기만 하면 상태가 어긋납니다). */
  onClose: () => void;
}) {
  const { active } = useTutorial();
  const anchor = useCurrentTutorialAnchor();
  const { open, holds, onClose } = options;

  useEffect(() => {
    if (!active || !open) return;
    // «*» 는 «튜토리얼과 무관하게 떠 있어야 하는 것» — 확인 창처럼 튜토리얼 자신이 띄우는 것입니다.
    if (holds === ALWAYS_KEEP) return;
    if (anchor && holds.split(/\s+/).filter(Boolean).includes(anchor)) return;
    onClose();
    // `onClose` 는 부르는 쪽에서 새로 만들어 넘기는 일이 많아 의존성에 넣지 않습니다 —
    // 넣으면 걸음이 그대로인데도 매 렌더마다 닫습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open, anchor, holds]);
}


export * from "@/lib/tutorialPanels";
