import { registerMaintenanceSave } from "./maintenanceGate";
import { useEffect, useRef } from "react";

/**
 * 손대는 것마다 저장합니다. **저장 단추를 누를 필요가 없어야 합니다.**
 *
 * # 왜 이게 따로 있는가
 *
 * 저장 시점을 화면마다 따로 정했더니 화면마다 구멍이 달랐습니다. 새 프로젝트는
 * 브라우저 저장소에만 남고 폴더에는 안 갔고, 이미 만든 프로젝트는 「다음」 이나
 * 「저장」 을 눌러야만 파일로 갔습니다. 작업실은 컷을 고칠 때만 저장하고
 * 이미지 표시는 안 했습니다.
 *
 * 문제는 **API 로 받은 값은 단추와 상관없이 도착한다**는 것입니다. 분석을
 * 돌려 놓고 창을 닫으면 돈 주고 받은 것이 통째로 날아갔습니다.
 * 그래서 «언제 저장하는가» 를 화면에서 떼어 여기 하나로 모았습니다.
 *
 * # 세 번 저장합니다
 *
 * 1. 손을 멈추고 잠시 뒤 (글자마다 파일을 쓰지 않으려고)
 * 2. 창을 가리거나 다른 앱으로 갈 때 — 여기서 안 쓰면 그대로 닫힐 수 있습니다
 * 3. 화면을 떠날 때
 *
 * 2·3 이 없으면 «막 받은 분석 → 바로 창 닫기» 가 딱 저 대기 시간 안에 들어가
 * 사라집니다. 실제로 그렇게 잃었습니다.
 */
export function useAutoSave<T>(options: {
  /** 지켜볼 값. 이게 바뀌면 저장이 예약됩니다 */
  value: T;
  /** 저장할 수 있는 상태인가. 제목이 없거나 아직 못 여는 동안은 false */
  enabled: boolean;
  /** 실제로 쓰는 곳. 부르는 쪽이 파일·폴더 어디로 갈지 정합니다 */
  save: (value: T) => void;
  /** 손을 멈추고 몇 밀리초 뒤에 쓸지 */
  delay?: number;
}): void {
  const latest = useRef(options.value);
  const save = useRef(options.save);
  const enabled = useRef(options.enabled);
  const dirty = useRef(false);

  latest.current = options.value;
  save.current = options.save;
  enabled.current = options.enabled;

  /** 예약을 기다리지 않고 지금 씁니다. 아직 쓸 것이 없으면 아무 일도 안 합니다. */
  const flush = useRef(() => {
    if (!dirty.current || !enabled.current) return;
    save.current(latest.current);
    dirty.current = false;
  });

  // 첫 그림에는 저장하지 않습니다. 방금 읽어 온 것을 그대로 되쓸 뿐이고,
  // 읽는 도중이면 반쯤 채워진 값을 덮어쓸 위험이 있습니다.
  const started = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      return;
    }
    if (!options.enabled) return;
    dirty.current = true;
    const timer = window.setTimeout(() => flush.current(), options.delay ?? 800);
    return () => window.clearTimeout(timer);
  }, [options.value, options.enabled, options.delay]);

  useEffect(() => {
    const unregister = registerMaintenanceSave(() => flush.current());
    const onHide = () => {
      // visibilitychange 만 믿지 않습니다. 브라우저마다 닫힐 때 어느 것이
      // 오는지 다릅니다. 둘 다 걸어 두고 먼저 오는 쪽에서 씁니다.
      if (document.visibilityState === "hidden") flush.current();
    };
    const onLeave = () => flush.current();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      unregister();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      // 화면을 떠날 때도 씁니다. 다른 프로젝트로 넘어가는 길목입니다.
      flush.current();
    };
  }, []);
}
