import { useEffect, useRef, useState } from "react";

/**
 * 구도잡기 재생 시계.
 *
 * 카메라 무빙·GLB 애니메이션이 함께 따르는 마스터 타임라인의 재생 위치입니다.
 * 상태는 `CompositionPlanner` 가 부르는 이 훅 하나에 있고, 뷰포트·타임라인 탭은
 * 여기서 받은 ref 와 갱신 함수만 씁니다.
 */
export function usePlannerPlayback(
  timelineDuration: number,
  /**
   * 타임라인에 깔린 노래 — 재생하면 **같이 울립니다**().
   *
   * 소리는 브라우저가 제 시계로 돌립니다. 우리 시계(`playheadRef`)와 둘이 따로 가므로, 시작·멈춤·머리 옮기기 때
   * **한 번씩만 맞춰 줍니다.** 프레임마다 맞추면 소리가 끊깁니다(지직거림).
   */
  music?: { src: string; offset: number; startTime: number } | null,
) {
  const [playing, setPlaying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  const previewingRef = useRef(false);
  previewingRef.current = previewing;
  /**
   * **지금 시계가 돌고 있는가** — 재생 루프가 읽습니다(프레임마다 React 상태를 읽으면 3D 씬이 통째로 다시 만들어집니다).
   *
   * `previewing` 과 다릅니다. 저쪽은 «카메라를 타임라인이 몹니다» 라 눈금을 한 번 끌기만 해도 켜지고,
   * 사람이 화면을 돌릴 때까지 켜진 채로 남습니다. 배경 영상처럼 «돌릴까 멈출까» 를 정해야 하는 쪽은
   * 저 값을 믿으면 **멈춘 뒤에도 배경만 계속 움직입니다.**
   */
  const playingRef = useRef(false);
  playingRef.current = playing;

  // 재생 중 눈금·슬라이더는 React 를 거치지 않고 DOM 을 직접 씁니다.
  // 이 컴포넌트는 패널이 많아 한 번 리렌더할 때 비용이 큽니다.
  // 초당 열두 번씩 통째로 다시 그리면 그게 곧 재생 끊김으로 보입니다.
  const playheadLabelRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  /**
   * 화면 아래 타임라인의 **빨간 세로선**. 재생 중에도 여기만 직접 옮깁니다.
   *
   * 선 자리를
   * React 상태(`playhead`)로 그리고 있어서, 재생 중에는 상태를 안 바꾸는 이 훅의 규칙
   * 때문에 **선이 멈춰 있었습니다.** 눈금 글씨는 움직이는데 선만 안 움직이니 어디를
   * 재생 중인지 알 수가 없었어요.
   */
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const paintPlayhead = (time: number) => {
    if (playheadLabelRef.current)
      playheadLabelRef.current.textContent = `${time.toFixed(2)}s`;
    if (scrubRef.current) scrubRef.current.value = String(time);
    if (playheadLineRef.current) {
      const span = Math.max(0.5, timelineDuration);
      const ratio = Math.min(1, Math.max(0, time / span));
      playheadLineRef.current.style.left = `${ratio * 100}%`;
    }
  };

  /**
   * 노래를 울리는 <audio>. 화면에 안 붙이고 여기서만 듭니다 — 손잡이(재생·멈춤)는 이미 타임라인에 있고,
   * 소리 요소가 화면에 하나 더 있으면 어느 쪽이 «진짜 재생» 인지 헷갈립니다.
   */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicSrc = music?.src || "";
  const musicOffset = music?.offset ?? 0;
  const musicStartTime = music?.startTime ?? 0;
  useEffect(() => {
    if (!musicSrc) {
      audioRef.current?.pause();
      audioRef.current = null;
      return;
    }
    const audio = new Audio(musicSrc);
    audio.preload = "auto";
    audioRef.current = audio;
    return () => {
      audio.pause();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [musicSrc]);

  /** 노래를 **우리 시계에 맞춥니다.** 타임라인 t 초에서 노래는 t+민 자리 초가 울려야 합니다. */
  const syncMusic = (time: number) => {
    const audio = audioRef.current;
    if (!audio) return false;
    const at = time - musicStartTime + musicOffset;
    // 노래보다 뒤로 가면 울릴 것이 없습니다 — 소리만 멈추고 화면은 계속 갑니다.
    if (at < 0 || (audio.duration && at > audio.duration)) {
      audio.pause();
      return false;
    }
    if (Math.abs(audio.currentTime - at) > 0.12) audio.currentTime = at;
    return true;
  };

  const seek = (time: number) => {
    const clamped = Math.min(timelineDuration, Math.max(0, time));
    playheadRef.current = clamped;
    paintPlayhead(clamped);
    setPlayhead(clamped);
    syncMusic(clamped);
  };

  // 재생 루프. 화면 갱신은 뷰포트가 ref 를 읽어 처리하고,
  // 여기서는 DOM 텍스트만 직접 건드립니다. 상태는 멈출 때 한 번만 맞춥니다.
  useEffect(() => {
    if (!playing) {
      audioRef.current?.pause();
      return;
    }
    setPreviewing(true);
    /*
      **끝에서 다시 누르면 처음부터.**

       재생이 끝나면 머리가 맨 끝에 서는데, 그대로 다시 누르면
      «끝에서 끝까지» 라 한 프레임 만에 멈췄습니다 — 눌러도 아무 일이 없는 것처럼 보여요.
    */
    if (playheadRef.current >= timelineDuration - 0.001) {
      playheadRef.current = 0;
      paintPlayhead(0);
      setPlayhead(0);
    }
    // 소리는 시작할 때 한 번 맞추고 그다음은 브라우저에 맡깁니다.
    if (syncMusic(playheadRef.current)) void audioRef.current?.play().catch(() => {
      /* 파일을 못 읽거나 브라우저가 막으면 소리만 없이 갑니다 — 재생 자체를 멈추면 구도 확인이 안 됩니다. */
    });
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // 탭이 잠깐 멈췄다 돌아오면 delta 가 몇 초씩 튑니다. 한 프레임 분량으로 제한합니다.
      const delta = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = playheadRef.current + delta;
      if (next >= timelineDuration) {
        playheadRef.current = timelineDuration;
        paintPlayhead(timelineDuration);
        setPlayhead(timelineDuration);
        setPlaying(false);
        audioRef.current?.pause();
        return;
      }
      playheadRef.current = next;
      paintPlayhead(next);
      // 음원 레이어가 0초 뒤에 시작하면 재생선이 그 시작점을 지날 때 소리를 켭니다.
      if (audioRef.current?.paused && next >= musicStartTime && next < musicStartTime + (audioRef.current.duration || Infinity) - musicOffset) {
        if (syncMusic(next)) void audioRef.current.play().catch(() => {});
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      audioRef.current?.pause();
      // 멈춘 자리에서 상태를 한 번 맞춰야 다른 UI 가 어긋나지 않습니다.
      setPlayhead(playheadRef.current);
    };
  }, [playing, timelineDuration, musicSrc, musicOffset, musicStartTime]);

  return {
    playing,
    setPlaying,
    previewing,
    setPreviewing,
    playhead,
    playheadRef,
    previewingRef,
    playingRef,
    playheadLabelRef,
    playheadLineRef,
    scrubRef,
    seek,
  };
}

export type PlannerPlayback = ReturnType<typeof usePlannerPlayback>;
