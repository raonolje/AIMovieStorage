import { assetSrc } from "@/lib/mediaLibrary";

/**
 * **노래 파형** — 타임라인에 소리를 눈으로 보여 줍니다.
 *
 * 맞습니다 — 여태 그 줄에는 «구간» 칸만 있었고, 구간을 안 나눠 두면 **텅 비어** 있었습니다.
 * 노래를 올렸는지조차 알 수 없었습니다. 파형은 「소리가 여기 있다」 를 한눈에 말해 주고,
 * 덤으로 어디가 후렴인지도 눈에 보입니다.
 *
 * # 봉우리만 기억합니다
 *
 * 3분짜리 노래는 44.1kHz 로 800만 개 값입니다. 그걸 다 들고 그리면 화면이 멎습니다.
 * 한 번 읽어 **막대 수만큼 최대·최소**로 줄여 둡니다(`PEAK_BUCKETS`). 그 뒤로는 그리기가
 * 배열 한 줄 훑는 일이라 타임라인을 끌어도 버벅이지 않습니다.
 *
 * # 한 번만 읽습니다
 *
 * 디코딩은 수 초가 걸립니다. 같은 파일을 다시 그릴 때마다 읽으면 구도잡기가 멈춥니다.
 * 경로를 열쇠로 캐시하고, 읽는 중이면 **그 약속을 나눠 줍니다** — 여러 곳이 동시에
 * 물어도 디코딩은 한 번입니다.
 */

/** 파형을 몇 칸으로 줄일까. 화면 폭보다 넉넉하면 늘려 그려도 뭉개지지 않습니다. */
const PEAK_BUCKETS = 1800;

export interface AudioPeaks {
  /** 칸마다 위쪽 봉우리(0~1). */
  max: Float32Array;
  /** 칸마다 아래쪽 봉우리(-1~0). */
  min: Float32Array;
  /** 실제 길이(초). 카드에 적힌 값과 다를 수 있어 이쪽이 진짜입니다. */
  seconds: number;
}

const cache = new Map<string, Promise<AudioPeaks>>();

async function decode(path: string): Promise<AudioPeaks> {
  const source = assetSrc(path);
  if (!source) throw new Error("노래 파일을 찾지 못했습니다.");
  const bytes = await (await fetch(source)).arrayBuffer();

  /*
    `AudioContext` 를 새로 열고 바로 닫습니다. 열어 둔 채로 두면 탭마다 하나씩 쌓여
    브라우저가 더 못 열게 막습니다(하드웨어 한도가 있습니다).
  */
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(bytes);
    const channel = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(channel.length / PEAK_BUCKETS));
    const max = new Float32Array(PEAK_BUCKETS);
    const min = new Float32Array(PEAK_BUCKETS);
    for (let bucket = 0; bucket < PEAK_BUCKETS; bucket += 1) {
      const from = bucket * step;
      const to = Math.min(channel.length, from + step);
      let high = 0;
      let low = 0;
      /*
        여기는 **인덱스 for 가 맞습니다.** 800만 개를 훑는 자리라 `slice`·`reduce` 는
        그때마다 배열을 새로 만듭니다.
      */
      for (let index = from; index < to; index += 1) {
        const value = channel[index];
        if (value > high) high = value;
        if (value < low) low = value;
      }
      max[bucket] = high;
      min[bucket] = low;
    }
    return { max, min, seconds: buffer.duration };
  } finally {
    void ctx.close();
  }
}

/** 그 파일의 파형. 읽는 중이면 같은 약속을 돌려줍니다. */
export function audioPeaks(path: string): Promise<AudioPeaks> {
  const found = cache.get(path);
  if (found) return found;
  const made = decode(path).catch((error) => {
    // 실패한 것은 캐시에서 빼 둡니다 — 파일을 고쳐 넣고 다시 열면 읽혀야 합니다.
    cache.delete(path);
    throw error;
  });
  cache.set(path, made);
  return made;
}
