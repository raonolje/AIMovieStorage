import * as THREE from "three";
import { GroundedSkybox } from "three/examples/jsm/objects/GroundedSkybox.js";
import type { CompositionCubeFace, CompositionState } from "@/lib/composition";
import {
  roomsExtentOf,
} from "@/lib/compositionEdit";

/**
 * 구도잡기 3D 화면의 순수 도우미.
 *
 * React 에 기대지 않고 three 객체만 만드는 함수들을 모았습니다.
 * `CompositionViewport` 의 이펙트가 역할별로 나뉘면서, 인물·배경·앵커를 만드는
 * 코드가 여러 이펙트에서 같이 쓰여 한곳에 두는 편이 안전해졌습니다.
 */

/**
 * 바닥 격자의 한 변(m).
 *
 * 배경은 «무한히 먼 하늘» 이라 거리를 하나도 알려 주지 않습니다(카메라를
 * 따라다니고 깊이도 안 씁니다 — 아래 `markAsBackgroundMesh`). 그래서 화면에서
 * 거리를 읽을 수 있는 것은 이 격자뿐입니다. 24 는 좁았습니다 — 인물을 조금만
 * 물려도 격자가 끝나 버려 「저 인물이 몇 미터 뒤인지」 를 눈으로 셀 수 없었어요.
 *
 * «바닥에 세우기» 가 인물을 놓을 수 있는 범위이기도 합니다(`CompositionViewport`).
 * 지평선에 가까운 곳을 찍으면 d = h / tan θ 가 수 km 로 발산하는데, 격자 밖은
 * 세울 자리가 아니라 배경 그림이라 거기서 거부합니다.
 */
export const FLOOR_SIZE = 48;

/** 굵은 선 간격 — **몇 칸마다** 굵게 그을지. 눈으로 거리를 셀 수 있어야 축척을 맞춥니다. */
export const FLOOR_MAJOR_STEP = 5;

/**
 * 지금 그려야 할 바닥 한 변(m).
 *
 * «방» 모드에서는 격자가 곧 **방의 밑면**이라 방 크기 S 를 씁니다. 격자를 48m 로
 * 못 박아 두면 3m 짜리 방 안에 48m 격자가 깔려 벽 밖으로 한참 삐져나가고,
 * 「밑면은 3D 공간의 바닥면에 배치되는 거야」라는 이 모드의
 * 약속이 눈에서 바로 깨집니다. 나머지 두 모드는 배경이 무한히 먼 하늘이라
 * 거리를 알려 주는 것이 격자뿐이므로 예전 48m 그대로입니다.
 */
/**
 * 방 **밖에 나가 있는 것**까지 담으려면 격자 한 변이 얼마여야 하는가(m).
 *
 * 방 크기가
 * 고정되면서 문 밖에 세운 인물 아래에 바닥이 없어졌습니다 — 허공에 뜬 건지 서 있는 건지
 * 가늠할 수가 없습니다.
 *
 * **방은 그대로 두고 격자만** 넓힙니다. 방(배경 상자)은 실측이라 손대면 축척이 틀어지고,
 * 격자는 «거리를 읽는 자» 라 넓혀도 잃는 것이 없습니다. 방 안은 배경 그림이 위에 깔리므로
 * 눈으로도 «여기까지가 방» 이 구분됩니다.
 *
 * 여유 두 칸(2m)을 더 봅니다 — 인물이 정확히 격자 끝에 서면 발밑이 잘려 보입니다.
 */
function floorReachOf(composition: CompositionState): number {
  let reach = 0;
  const take = (position: { x: number; z: number }) => {
    reach = Math.max(reach, Math.abs(position.x), Math.abs(position.z));
  };
  composition.characters.forEach((item) => {
    if (!item.hidden) take(item.position);
  });
  composition.objects.forEach((item) => {
    if (item.visible) take(item.position);
  });
  (composition.glbTracks ?? []).forEach((item) => take(item.position));
  return reach > 0 ? (reach + 2) * 2 : 0;
}

/** 바닥 격자의 깊이(m). 가로는 `floorSizeOf` — 방이 직육면체라 둘이 다를 수 있습니다. */
export function floorDepthOf(composition: CompositionState): number {
  return Math.max(FLOOR_SIZE, roomsExtentOf(composition).depth, floorReachOf(composition));
}

export function floorSizeOf(composition: CompositionState): number {
  /*
    «구도만» 은 예전 구도잡기 그대로입니다 — 방이 없으니 격자를 방 크기로 줄일 까닭도
    없고, 줄이면 인물을 조금만 물려도 격자가 끝나 「저 인물이 몇 미터 뒤인지」 를 눈으로
    셀 수 없습니다().
    «배경 넣기» 에서는 격자가 곧 방의 밑면이라 방 한 변을 따라갑니다.
  */
  /*
    방이 여럿이면 **전부** 담습니다(`roomsExtentOf`). 활성 방만 보면 옆방 아래에 바닥이
    없어져, 「거실에서 주방으로 걸어간다」 를 잡을 때 인물이 허공에 뜬 것처럼 보입니다.

    **줄어들지는 않습니다.**
    5 m 방을 세우면 격자가 5 m 로 쪼그라들어, 옆에 세운 실외 100 m 방이 격자 밖으로 나가 «하늘에 뜬» 것처럼 보였습니다.
  */
  return Math.max(FLOOR_SIZE, roomsExtentOf(composition).width, floorReachOf(composition));
}

/**
 * 격자 한 칸의 크기(m). 방이 커지면 칸도 키웁니다.
 *
 * 1m 로 못 박으면 400m 방에서 선이 802 줄이라 화면이 그냥 회색으로 뭉개지고,
 * 「몇 미터 뒤인지 눈으로 센다」는 격자의 목적 자체가 사라집니다. 칸 수를
 * 32~64 줄 사이로 두면 어느 방 크기에서도 셀 수 있습니다.
 */
export function floorGridStepOf(size: number): number {
  if (size <= 64) return 1;
  if (size <= 160) return 2;
  return 5;
}

/**
 * 마네킹 모델. 없으면 단순 기둥으로 물러섭니다.
 *
 * **GLB 를 씁니다.** 원본 FBX 는 버전 6100 인데 three.js 의 FBXLoader 는
 * 7000 미만을 아예 거부합니다. Mixamo 가 예전에 내보낸 판이라 그래요.
 * FBX2glTF 로 변환해 두었고, 본 이름의 콜론(`mixamorig:Hips`)은 그대로
 * 살아 있습니다 — `boneOf` 가 접두사 세 가지를 다 시도합니다.
 */
export const MODEL_URLS = {
  male: "/models/male.glb",
  female: "/models/female.glb",
  neutral: "/models/male.glb",
} as const;

// ── 캐시 ─────────────────────────────────────────────────────────────────
//
// 셋 다 씬이 다시 만들어져도 살아남아야 합니다. 그래서 컴포넌트 바깥에 둡니다.
// 여러 씬이 공유하므로 dispose 하지 않습니다.

export const modelTemplates = new Map<string, THREE.Group>();
export const backgroundTextures = new Map<string, THREE.Texture>();
export const gltfCache = new Map<
  string,
  { scene: THREE.Group; animations: THREE.AnimationClip[] }
>();

export function loadCachedTexture(url: string) {
  const cached = backgroundTextures.get(url);
  if (cached) return cached;
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  backgroundTextures.set(url, texture);
  return texture;
}

// ── 배경 흐름 (UV 오프셋) ────────────────────────────────────────────────
/*
  면·돔 그림을 재생 시각에 맞춰 옆으로 흘립니다(`CompositionRoom.drift`). 구름이 지나가고,
  터널 조명이 흐르고, 차창 밖 풍경이 뒤로 갑니다 — 그림을 새로 뽑지 않고도 레퍼런스 영상에
  «배경이 움직인다» 를 남기는 길입니다.

  ## 왜 방마다 텍스처를 따로 뜨는가

  `loadCachedTexture` 는 **주소 하나에 텍스처 하나**를 씁니다 — 여러 방·여러 씬·파노라마 돔이
  같은 객체를 나눠 갖습니다. `offset` 은 텍스처에 달린 값이라 거기서 옮기면 **같은 그림을 쓰는
  다른 방까지** 같이 흐릅니다(`buildBackgroundCubeGeometry` 주석의 «repeat.x = −1 은 구 배경까지
  뒤집는다» 와 같은 사고). 그래서 흐르는 방만 제 몫의 텍스처를 따로 듭니다.

  `clone()` 이 아니라 **다시 읽는** 까닭도 같은 주석에 있습니다 — 로드 전에 복제하면 그림이
  빈 채로 굳습니다. 같은 주소라 브라우저 쪽 캐시가 받아 주므로 두 번째 읽기는 거의 공짜입니다.

  캐시는 모듈에 둡니다. 방 크기 슬라이더를 끄는 동안 상자가 **매 프레임 다시 세워지는데**
  (`roomShapeKey` 에 치수가 들어 있습니다) 그때마다 여섯 장을 새로 읽으면 벽이 깜박입니다.
*/

/** 흐르는 방의 텍스처 — 열쇠는 «방 id + 주소» 입니다. */
const roomDriftTextures = new Map<string, THREE.Texture>();

const driftKeyOf = (roomId: string, url: string) => `${roomId}\n${url}`;

export function loadRoomDriftTexture(roomId: string, url: string) {
  const key = driftKeyOf(roomId, url);
  const cached = roomDriftTextures.get(key);
  if (cached) return cached;
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 오프셋이 한 장을 넘어가면 이어 붙어야 합니다. 기본(ClampToEdge)이면 가장자리 한 줄이 늘어나 번집니다.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  roomDriftTextures.set(key, texture);
  return texture;
}

/**
 * 지금 살아 있는 방들의 것만 남기고 나머지는 해제합니다.
 *
 * 방을 지우거나 흐름을 끄면 그 텍스처는 다시 쓰이지 않습니다. 위 캐시가 모듈에 있어
 * 저절로 사라지지 않으므로, 상자를 세울 때마다 한 번 훑어 정리합니다.
 */
export function releaseRoomDriftTextures(live: Set<string>) {
  roomDriftTextures.forEach((texture, key) => {
    if (live.has(key.slice(0, key.indexOf("\n")))) return;
    texture.dispose();
    roomDriftTextures.delete(key);
  });
}

/**
 * 그 시각의 UV 오프셋을 겁니다. **재생 루프와 영상 렌더가 같이 부르는 한 벌입니다.**
 *
 * 시각 × 속도라 절대 시각으로 정해집니다 — 프레임마다 더해 가면 재생과 캡처의 프레임 수가
 * 달라 «화면에서 본 것과 영상에 찍힌 것» 이 어긋납니다. 눈금을 손으로 끌어도 그 시각의 배경이
 * 바로 보이는 것도 이 덕분입니다.
 *
 * `needsUpdate` 는 걸지 않습니다 — `offset` 은 재질의 uv 행렬로 가는 값이라 three 가 그릴 때
 * 다시 계산합니다(`matrixAutoUpdate`). 켜면 그림을 통째로 다시 올려 재생이 끊깁니다.
 */
export function applyRoomDrift(
  textures: THREE.Texture[],
  drift: { x: number; y: number } | null | undefined,
  time: number,
) {
  const x = (drift?.x ?? 0) * time;
  const y = (drift?.y ?? 0) * time;
  textures.forEach((texture) => {
    if (texture.offset.x === x && texture.offset.y === y) return;
    texture.offset.set(x, y);
  });
}

// ── 배경 영상 (VideoTexture) ─────────────────────────────────────────────
/*
  면·돔에 **영상**을 겁니다(`CompositionRoom.video`). 흐름(UV)은 그림 전체가 한 방향으로
  미끄러지는 것뿐이라 구름·터널 조명에는 맞지만 지나가는 차·파도·사람에는 모자랍니다 —
  진짜 움직임은 그 면에 움직이는 그림을 다는 것입니다.

  ## 왜 <video> 를 화면(DOM)에 안 붙이는가

  텍스처의 원본으로만 쓰므로 화면에 있을 까닭이 없고, 붙이면 **크기가 0 인 요소가 레이아웃에
  끼어들거나 다른 창의 z 순서를 흔듭니다.** 떼어 둔 요소도 디코딩·재생은 그대로 됩니다.
  대신 놓아 줄 때 `src` 를 떼고 `load()` 를 불러야 디코더가 실제로 풀립니다(아래 해제 절).

  ## 왜 방마다 따로 뜨는가

  흐름 텍스처와 같은 까닭입니다 — 한 주소에 하나만 두면 같은 영상을 건 두 방이 **같은 <video>**
  를 나눠 갖게 되어, 한쪽에서 시각을 옮기면 다른 방까지 따라 옮겨집니다. 방마다 제 몫을 듭니다.

  ## 왜 캐시를 모듈이 아니라 **씬이** 들고 있는가

  흐름 텍스처는 모듈에 두었습니다(그림이라 놓아 주지 않아도 메모리만 조금 씁니다). 영상은 다릅니다 —
  놓아 주지 않으면 **디코더가 살아 있습니다.** 모듈에 두면 구도잡기 창이 닫힐 때 아무도 안 놓아 주고,
  창을 여닫을 때마다 쌓입니다. 씬이 들면 씬이 사라질 때 함께 놓입니다.

  두 창을 같이 열었을 때도 이쪽이 안전합니다 — 한 창을 닫으면서 다른 창이 쓰는 영상까지 끊어 버리는
  일이 없습니다(같은 방 id 를 쓰는 복사된 컷에서 실제로 겹칩니다).

  상자를 다시 세우는 동안 깜박이지 않는 것은 그대로입니다 — 씬 얼개(`ViewportScene`)는 방을 다시
  세워도 살아 있어서, 크기 슬라이더를 끄는 내내 같은 `<video>` 를 그대로 씁니다.

  ## 소리는 끕니다

  `muted` 가 아니면 브라우저가 자동 재생을 막아 «재생을 눌렀는데 배경만 멈춰 있는» 상태가 됩니다.
  구도잡기의 소리는 타임라인의 노래가 맡습니다.
*/

/** 방에 건 영상 하나 — 텍스처와 그 원본 요소는 늘 함께 다닙니다(시각 맞추기가 요소를, 그리기가 텍스처를 씁니다). */
export interface RoomVideoTexture {
  /** 캐시의 열쇠(«방 id + 주소»). 살아 있는 것을 셀 때 부르는 쪽이 그대로 씁니다 — 모양을 두 벌 적지 않게. */
  key: string;
  texture: THREE.VideoTexture;
  video: HTMLVideoElement;
}

/** 한 씬이 띄운 영상들 — 열쇠는 «방 id + 주소» 입니다(흐름 텍스처와 같은 규칙). */
export type RoomVideoCache = Map<string, RoomVideoTexture>;

export function loadRoomVideoTexture(
  cache: RoomVideoCache,
  roomId: string,
  url: string,
): RoomVideoTexture {
  const key = driftKeyOf(roomId, url);
  const cached = cache.get(key);
  if (cached) return cached;
  const video = document.createElement("video");
  /*
    `crossOrigin` 을 anonymous 로 둡니다. 안 두면 `asset://` 에서 온 그림이 캔버스를 **오염시켜**
    레퍼런스 영상 내보내기가 통째로 막힙니다(`loadImageForCanvas` 머리말과 같은 사고).
    배경 그림도 `THREE.TextureLoader` 가 같은 값으로 읽고 있어 규약이 어긋나지 않습니다.
  */
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  // 자동 재생은 안 겁니다 — 시각은 구도잡기 눈금이 정합니다(`applyRoomVideoTime`).
  video.load();
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 흐름과 같이 켤 수 있습니다(흐르는 영상). 오프셋이 한 장을 넘어가면 이어 붙어야 합니다.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const entry = { key, texture, video };
  cache.set(key, entry);
  return entry;
}

/**
 * 지금 걸려 있는 것만 남기고 나머지는 **정리**합니다. `live` 는 살아 있는 `RoomVideoTexture.key` 들입니다.
 * 빈 `live` 를 주면 이 씬의 영상을 전부 놓습니다 — 창을 닫을 때 그렇게 부릅니다.
 *
 * 방을 바꾸거나 «배경 영상» 을 끄거나 **다른 영상으로 바꾸면** 그 요소는 다시 안 쓰입니다. 그냥 두면
 * 디코더가 쌓여 몇 번 만에 3D 화면이 버벅입니다. 흐름 텍스처와 달리 방 id 가 아니라 **열쇠 전체**로
 * 세는 까닭이 여기 있습니다 — 같은 방에서 영상만 갈아 끼우면 방 id 는 그대로라, 방으로 세면 옛 영상이
 * 영영 안 풀립니다.
 *
 * `dispose()` 만으로는 모자랍니다 — `<video>` 가 살아 있으면 디코더도 살아 있어서, `src` 를 떼고
 * `load()` 로 끊어 줘야 실제로 놓입니다.
 */
export function releaseRoomVideoTextures(cache: RoomVideoCache, live: Set<string>) {
  cache.forEach((entry, key) => {
    if (live.has(key)) return;
    entry.texture.dispose();
    entry.video.pause();
    entry.video.removeAttribute("src");
    entry.video.load();
    cache.delete(key);
  });
}

/**
 * 마지막으로 **우리가 시킨** 시각. 멈춘 채로 눈금을 안 건드리면 다시 안 옮깁니다.
 *
 * `currentTime` 과 견주지 않는 까닭: 옮긴 뒤 실제 값은 가장 가까운 **프레임**으로 붙어(0.04 초까지)
 * 우리가 시킨 값과 늘 조금 다릅니다. 그걸로 판단하면 멈춰 있는 동안에도 매 프레임 다시 옮기게 되어
 * 디코더가 계속 되감습니다.
 */
const roomVideoSeeks = new WeakMap<HTMLVideoElement, number>();

/** 이 영상에서 그 시각이 어디인가 — 루프라 길이로 나눈 나머지입니다. 길이를 아직 모르면 없음. */
function loopTimeOf(video: HTMLVideoElement, time: number): number | null {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return ((time % duration) + duration) % duration;
}

/**
 * 배경 영상을 **구도잡기 시각에 맞춥니다.** 재생 루프와 영상 렌더가 같이 부르는 한 벌입니다.
 *
 * - 재생 중이면 영상도 돌립니다. 다만 매 프레임 `currentTime` 을 쓰지는 않습니다 — 쓸 때마다
 * 되감기(seek)라 그림이 끊깁니다. 0.25 초 넘게 어긋났을 때만 한 번 맞춥니다.
 * - 멈춰 있으면 영상도 멈추고 그 시각의 프레임으로 갑니다. 눈금을 끌면 배경도 따라갑니다.
 */
export function applyRoomVideoTime(
  entries: RoomVideoTexture[],
  time: number,
  playing: boolean,
) {
  entries.forEach(({ video }) => {
    const wanted = loopTimeOf(video, time);
    if (wanted === null) return;
    if (playing) {
      if (video.paused) void video.play().catch(() => undefined);
      if (Math.abs(video.currentTime - wanted) > 0.25) {
        roomVideoSeeks.set(video, wanted);
        video.currentTime = wanted;
      }
      return;
    }
    if (!video.paused) video.pause();
    if (roomVideoSeeks.get(video) === wanted) return;
    roomVideoSeeks.set(video, wanted);
    video.currentTime = wanted;
  });
}

/**
 * 그 시각의 프레임이 **정말 올라올 때까지** 기다립니다 — 레퍼런스 영상을 구울 때만 씁니다.
 *
 * 되감기는 비동기입니다. 시각을 옮기자마자 그려 버리면 **한 프레임 전 그림**이 찍혀, 배경만
 * 조금씩 밀린 영상이 나옵니다. 그래서 굽는 길에서는 `seeked` 를 기다린 뒤에 그립니다.
 *
 * 못 받아도 **멈추지는 않습니다**(0.5 초). 파일이 깨졌거나 디코더가 막혔을 때 영상 만들기가
 * 통째로 멈추는 것보다, 배경 한 프레임이 낡은 편이 낫습니다.
 */
export function seekRoomVideoTime(entries: RoomVideoTexture[], time: number): Promise<void> {
  return Promise.all(
    entries.map(
      ({ texture, video }) =>
        new Promise<void>((resolve) => {
          const wanted = loopTimeOf(video, time);
          if (wanted === null) return resolve();
          if (!video.paused) video.pause();
          if (Math.abs(video.currentTime - wanted) < 1e-3) return resolve();
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            video.removeEventListener("seeked", finish);
            window.clearTimeout(timer);
            // 멈춘 영상은 장 콜백이 안 와서 three 가 새 프레임을 못 올립니다 — 여기서 한 번 올려 줍니다.
            texture.needsUpdate = true;
            resolve();
          };
          const timer = window.setTimeout(finish, 500);
          video.addEventListener("seeked", finish);
          roomVideoSeeks.set(video, wanted);
          video.currentTime = wanted;
        }),
    ),
  ).then(() => undefined);
}

/**
 * 재질만 해제합니다. **텍스처는 건드리지 않습니다.**
 *
 * 배경 텍스처·HDRI 는 위 캐시가 들고 있어 여러 씬이 같이 씁니다. 재질을 지우며
 * 텍스처까지 지우면 다음에 캐시에서 꺼낸 텍스처가 빈 검정으로 나옵니다.
 */
export function disposeMaterials(material: THREE.Material | THREE.Material[]) {
  (Array.isArray(material) ? material : [material]).forEach((item) =>
    item.dispose(),
  );
}

/**
 * 이 씬에서 직접 만든 메시·선·스프라이트의 GPU 자원을 해제합니다.
 *
 * 예전에는 씬을 통째로 새로 지으면서 렌더러(WebGL 컨텍스트)까지 버렸기 때문에
 * 따로 지울 필요가 없었습니다. 이제 렌더러 하나를 계속 쓰므로, 인물·소품을
 * 다시 만들 때마다 지우지 않으면 본을 한 번 끌 때마다 GPU 메모리가 쌓입니다.
 *
 * **복제한 리그·GLB 에는 쓰면 안 됩니다.** `SkeletonUtils.clone` 은 지오메트리를
 * 캐시된 원본과 공유하므로, 여기서 지우면 원본이 깨져 다음 인물이 안 보입니다.
 */
export function disposeOwnedMesh(object: THREE.Object3D) {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
      node.geometry.dispose();
      disposeMaterials(node.material);
    } else if (node instanceof THREE.Sprite) {
      node.material.map?.dispose();
      node.material.dispose();
    }
  });
}

// ── 이름표 ────────────────────────────────────────────────────────────────

/**
 * 이름표 한 장의 기본 크기(m). 카메라를 아직 모를 때(붙이는 그 순간) 쓰는 값입니다.
 * 실제 크기는 매 프레임 `syncLabel` 이 화면 비율로 다시 정합니다.
 */
export const LABEL_BASE_SCALE = { x: 1.8, y: 0.34 } as const;

/** 글상자의 가로:세로. 화면 크기를 세로로 잡고 가로는 이 비로 따라갑니다. */
export const LABEL_ASPECT = LABEL_BASE_SCALE.x / LABEL_BASE_SCALE.y;

/**
 * 이름표의 **화면 세로 크기** — 화면 높이에 대한 비율(0.05 = 화면의 5%).
 *
 * 픽셀이 아니라 비율인 이유: 캡처·영상 렌더가 캔버스 크기를 바꿔 가며 그리는데
 * (`onVideoRenderReady`), 픽셀로 못 박으면 큰 화면에서만 글씨가 작아집니다.
 * 700px 높이의 창에서 35px — 512×96 텍스처의 52px 글자가 또렷하게 읽히는 크기입니다.
 */
export const LABEL_SCREEN_HEIGHT = 0.05;

/**
 * 이름표가 흐려지기 시작하는 거리와 완전히 사라지는 거리(m).
 *
 * ## 왜 멀면 지우는가
 *
 * 화면 크기를 고정하면 **멀리 있는 인물의 이름표가 그 인물보다 커집니다.**
 * 게다가 이름표는 `depthTest:false` 라 늘 앞에 그려져서, 40m 뒤에 세워 둔
 * 인물 셋의 이름표가 앞사람 얼굴을 가립니다. 그래서 격자의 반쪽(24m)부터
 * 흐려지기 시작해 격자 1.5배(72m — «바닥에 세우기» 가 허용하는 끝)에서 사라지게
 * 둡니다. 최소·최대 배율로 막는 길도 있지만, 그건 «멀면 작아진다» 를 되살리는
 * 것이라 사용자가 지적한 문제(「멀리서 보면 너무 작아지고」)로 되돌아갑니다.
 */
export const LABEL_FADE_NEAR = FLOOR_SIZE / 2;
export const LABEL_FADE_FAR = FLOOR_SIZE * 1.5;

export function createLabel(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  // 어두운 배경 + 인물 색 테두리 + 인물 색 글자.
  // 테두리가 없으면 인물이 셋만 넘어가도 이름표만 보고 누구인지 못 가립니다 —
  // 글자 색만으로는 작은 화면에서 구분이 안 됩니다.
  ctx.fillStyle = "rgba(10,12,18,0.78)";
  ctx.roundRect(4, 4, 504, 88, 16);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "600 52px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 50);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthTest: false,
      transparent: true,
    }),
  );
  sprite.scale.set(LABEL_BASE_SCALE.x, LABEL_BASE_SCALE.y, 1);
  /*
    기준점을 글상자의 **아래 가운데**로 옮깁니다.

    기본값 (0.5, 0.5) 은 «꼭대기 + 간격» 점을 글상자 한가운데에 두므로, 화면
    크기를 고정하려고 글상자를 키우면 절반이 **아래로** 자라 머리를 덮습니다
    (`depthTest:false` 라 늘 인물 앞에 그려집니다. 실측: 화각 40°·20m 에서
    0.04m, 40m 에서 0.41m 침범 — 원거리 샷과 광각에서 바로 걸립니다).
    아래끝을 기준으로 두면 글상자가 아무리 커져도 머리 위에서만 자랍니다.
  */
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 10;
  // 이름표는 화면에서 구분하려고 붙인 것이라 레퍼런스 영상에서는 숨깁니다.
  sprite.userData.helper = true;
  return sprite;
}

/**
 * 이름표를 «물체 크기를 따라가지 않게» 붙입니다.
 *
 * ## 왜
 *
 * 소품 그룹에는 `group.scale.set(item.scale…)` 이 걸립니다. 이름표가 그 그룹의
 * 자식이면 글상자까지 같이 늘어나서, 상자를 5 배로 키우면 이름표도 5 배가 됩니다
 * (2026-09-09 ).
 *
 * 부모 스케일을 그대로 되나눠 주면 화면에서의 글자 크기가 물체 크기와 **무관**
 * 해집니다. 높이도 같은 이유로 두 몫으로 나눠 계산합니다.
 * 월드 높이 = sy × (topY + gap / sy) = sy·topY + gap
 * 즉 «커진 물체의 꼭대기»(sy·topY) 위에 항상 같은 간격(gap)으로 뜹니다.
 * (카메라를 알게 되면 `syncLabel` 이 그 간격까지 화면 비례로 다시 잡습니다 —
 * `gap` 은 첫 프레임까지의 근사값입니다.)
 *
 * 이름표를 그룹 밖의 홀더에 다는 길도 있지만, 그러면 소품을 지울 때 홀더를
 * 따로 챙겨야 하고 기즈모로 물체를 옮겨도 이름표는 안 따라옵니다.
 *
 * @param holder 스케일이 걸릴 수 있는 부모(소품 그룹·인물 그룹)
 * @param topY **스케일 전** 물체 꼭대기 높이(부모 로컬, m)
 * @param gap 꼭대기에서 띄울 거리(m). 스케일과 무관합니다
 */
export function attachLabel(
  holder: THREE.Object3D,
  label: THREE.Sprite,
  topY: number,
  gap = 0.32,
): LabelAnchor {
  const anchor: LabelAnchor = { sprite: label, holder, topY, gap };
  // 카메라 없이 한 번 — 첫 프레임까지의 한 박자를 위한 근사입니다.
  syncLabel(anchor);
  holder.add(label);
  return anchor;
}

/** 이름표 하나와 그것이 매달린 부모. 재생 루프가 매 프레임 되돌리려고 들고 있습니다. */
export interface LabelAnchor {
  sprite: THREE.Sprite;
  holder: THREE.Object3D;
  /** 스케일 전 물체 꼭대기(부모 로컬, m) */
  topY: number;
  gap: number;
}

// syncLabel 이 매 프레임 쓰는 임시 값들. 프레임마다 새로 만들면 GC 가 돌아 재생이 튑니다.
const labelWorldPosition = new THREE.Vector3();
const labelWorldScale = new THREE.Vector3();
const labelWorldQuaternion = new THREE.Quaternion();
const labelForward = new THREE.Vector3();
const labelToCamera = new THREE.Vector3();

/**
 * 이름표를 **화면에서 늘 같은 크기**로 맞춥니다. 물체 크기·카메라 거리·화각과 무관.
 *
 * ## 왜 한 곳에서 계산하는가
 *
 * 되돌릴 것이 둘입니다 — (1) 부모에 걸린 스케일(소품을 5배로 키우면 글상자도
 * 5배), (2) 원근(가까우면 커지고 멀면 작아짐). 두 곳에서 나눠 계산하면 한쪽만
 * 고쳤을 때 조용히 어긋나므로 여기 하나로 모읍니다.
 *
 * ## 수식
 *
 * 원근 카메라에서 시야 깊이 dz 에 있는 세로 H 인 것은 화면 높이의
 * `H / (2·dz·tan(fov/2))` 를 차지합니다. 이것이 늘 `LABEL_SCREEN_HEIGHT` 이려면
 *
 * H = LABEL_SCREEN_HEIGHT × 2 × dz × tan(fov/2)
 *
 * 화각이 들어 있으므로 렌즈를 바꿔도 이름표 크기는 그대로입니다. 스프라이트의
 * `scale` 은 월드 크기라 부모의 **월드** 스케일(전경 확대까지 포함)로 나눠 줍니다.
 *
 * dz 는 카메라까지의 직선 거리가 아니라 **시야 축에 내린 깊이**입니다. 투영이
 * 나누는 값이 그쪽이라, 직선 거리를 쓰면 화면 가장자리로 갈수록 이름표가
 * 조금씩 커집니다(화각 80° 가장자리에서 30%).
 *
 * @param view 원근 카메라. 없으면 원근 보정 없이 부모 스케일만 되돌립니다
 * (`attachLabel` 이 붙이는 순간 — 아직 그릴 카메라가 없습니다).
 */
export function syncLabel(anchor: LabelAnchor, view?: THREE.PerspectiveCamera) {
  const { sprite, holder, topY, gap } = anchor;
  const sy = holder.scale.y || 1;
  // 카메라를 아직 모를 때(붙이는 순간)의 자리 — 예전 규칙 그대로 월드 간격.
  sprite.position.y = topY + gap / sy;

  if (!view) {
    const sx = holder.scale.x || 1;
    sprite.scale.set(LABEL_BASE_SCALE.x / sx, LABEL_BASE_SCALE.y / sy, 1);
    return;
  }

  // 부모의 월드 행렬(조상 전부 포함 — 전경 확대가 여기 들어 있습니다).
  holder.updateWorldMatrix(true, false);
  holder.matrixWorld.decompose(
    labelWorldPosition,
    labelWorldQuaternion,
    labelWorldScale,
  );
  /*
    깊이는 **물체 꼭대기**에서 잽니다. 이름표 자리에서 재면 «자리 → 크기 → 자리»
    가 서로를 물어 한 프레임 뒤처집니다. 꼭대기와 이름표는 몇 십 cm 차이라
    화면 크기에는 영향이 없습니다.
  */
  labelWorldPosition.set(0, topY, 0).applyMatrix4(holder.matrixWorld);

  // 시야 깊이. 카메라의 앞 방향으로 내린 그림자 길이입니다.
  labelForward.set(0, 0, -1).applyQuaternion(view.quaternion);
  labelToCamera.subVectors(labelWorldPosition, view.position);
  // 뒤나 바로 코앞이면 0 으로 나누는 자리라 5cm 에서 막습니다.
  const depth = Math.max(0.05, labelToCamera.dot(labelForward));

  const worldHeight =
    LABEL_SCREEN_HEIGHT * 2 * depth * Math.tan((view.fov * Math.PI) / 360);
  sprite.scale.set(
    (worldHeight * LABEL_ASPECT) / (labelWorldScale.x || 1),
    worldHeight / (labelWorldScale.y || 1),
    1,
  );

  /*
    머리 위 간격도 **화면 비례**로 둡니다 — 글상자 높이의 35%.

    크기만 화면에 맞추고 간격을 월드 0.32m 로 두면 자리가 거리에 끌려다닙니다:
    2m 에서는 글상자 높이의 4.4배(화면의 22%)만큼 붕 떠서 인물 옆이 아니라 화면
    위쪽에 따로 놀고, 멀어지면 반대로 머리에 붙습니다. 「항상 일정한 크기」의 뜻은 화면에서 같아 보이는 것이라 자리도 같이 맞춥니다.

    나누는 값이 «월드 스케일» 인 이유: `sprite.position` 은 부모 로컬이라
    조상 스케일(전경 확대)까지 곱해져 월드로 나가기 때문입니다.
  */
  sprite.position.y = topY + (worldHeight * 0.35) / (labelWorldScale.y || 1);

  // 멀면 흐려지게. 크기를 줄이는 대신 투명도로 정리하는 까닭은 LABEL_FADE_NEAR 주석에.
  const fade =
    depth <= LABEL_FADE_NEAR
      ? 1
      : Math.max(
          0,
          1 - (depth - LABEL_FADE_NEAR) / (LABEL_FADE_FAR - LABEL_FADE_NEAR),
        );
  sprite.material.opacity = fade;
  // 완전히 투명한 것을 그리는 것도 비용이라 아예 뺍니다.
  sprite.visible = fade > 0.02;
}

// ── 인물 ──────────────────────────────────────────────────────────────────
/** GLB 가 없을 때 세우는 단순 기둥. 자리와 키만 보면 되는 상황에서는 이걸로 충분합니다. */
export function buildFallbackFigure(bodyColor: string, tall: number) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.46,
    metalness: 0.12,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.21, tall - 0.26, 14),
    material,
  );
  body.position.y = (tall - 0.26) / 2;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.115, 18, 14),
    material,
  );
  head.position.y = tall - 0.115;
  head.castShadow = true;
  group.add(head);

  // 어느 쪽을 보고 있는지. 이게 없으면 앞뒤를 알 수 없습니다.
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.045, 0.15, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  nose.position.set(0, tall - 0.115, -0.13);
  nose.rotation.x = -Math.PI / 2;
  group.add(nose);
  return group;
}

/** 선택된 인물 발치에 그리는 링. */
export function buildSelectionRing() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.37, 28),
    new THREE.MeshBasicMaterial({ color: 0xc084fc, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  ring.userData.helper = true;
  return ring;
}

// ── 바닥 ──────────────────────────────────────────────────────────────────
/**
 * 바닥 격자(1 m) + 5 m 굵은 선 + 그림자를 받는 면.
 *
 * ## 왜 굵은 선을 따로 긋는가
 *
 * `GridHelper` 는 «가운데 선» 색 하나만 다르게 줄 수 있고 «몇 칸마다 굵게» 는
 * 못 합니다. `GridHelper(50, 10)` 으로 5 m 격자를 하나 더 겹치는 방법도 있지만
 * 48 은 5 로 나누어떨어지지 않아 50 짜리가 1 m 격자 밖으로 삐져나와 두 겹의
 * 가장자리가 어긋납니다. 그래서 ±20 m 까지의 5 m 선만 직접 긋습니다.
 *
 * 굵은 선은 y 를 살짝(2 mm) 띄웁니다. 같은 높이면 1 m 격자와 z-fighting 이 나서
 * 카메라를 돌릴 때 선이 깜박입니다.
 *
 * ## 왜 크기를 받는가
 *
 * «방» 모드에서는 이 격자가 곧 방의 밑면입니다(`floorSizeOf`). 한 변이 딱
 * 맞아야 벽 아래가 격자의 가장자리와 만나, 「큐브 밑면이 바닥」 이 눈으로
 * 보입니다. 대신 칸이 정확히 1 m 가 아니게 됩니다 — 3.2 m 방이면 3 칸으로
 * 나뉘어 한 칸이 1.07 m 입니다. 칸을 1 m 로 고집하면 방과 격자가 어긋나는데,
 * 이 모드에서 더 중요한 것은 «방 = 바닥» 쪽이라 그렇게 골랐습니다.
 */
/**
 * 바닥 격자·그림자 면. 가로와 깊이가 다를 수 있습니다(직육면체 방).
 *
 * `GridHelper` 는 정사각형만 만들므로 선을 직접 긋습니다 — 정사각형 격자를 눌러 쓰면 칸이
 * 직사각형이 되어 「한 칸이 몇 미터」 를 눈으로 셀 수 없습니다.
 */
export function buildFloor(size = FLOOR_SIZE, depthSize = size) {
  const step = floorGridStepOf(Math.max(size, depthSize));
  const halfX = size / 2;
  const halfZ = depthSize / 2;
  const minor: THREE.Vector3[] = [];
  const lastMinorX = Math.floor(halfX / step) * step;
  const lastMinorZ = Math.floor(halfZ / step) * step;
  for (let x = -lastMinorX; x <= lastMinorX + 1e-6; x += step)
    minor.push(new THREE.Vector3(x, 0, -halfZ), new THREE.Vector3(x, 0, halfZ));
  for (let z = -lastMinorZ; z <= lastMinorZ + 1e-6; z += step)
    minor.push(new THREE.Vector3(-halfX, 0, z), new THREE.Vector3(halfX, 0, z));
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(minor),
    new THREE.LineBasicMaterial({ color: 0x2f2f3e }),
  );
  grid.userData.helper = true;

  const half = size / 2;
  // 굵은 선은 «5 칸마다». 칸이 커지면(먼 방) 굵은 선 간격도 같이 커집니다.
  const majorStep = step * FLOOR_MAJOR_STEP;
  const last = Math.floor(half / majorStep) * majorStep;
  const lastDepth = Math.floor(halfZ / majorStep) * majorStep;
  const points: THREE.Vector3[] = [];
  for (let d = -lastDepth; d <= lastDepth + 1e-6; d += majorStep)
    points.push(
      new THREE.Vector3(-halfX, 0, d),
      new THREE.Vector3(halfX, 0, d),
    );
  for (let d = -last; d <= last + 1e-6; d += majorStep)
    points.push(
      new THREE.Vector3(d, 0, -halfZ),
      new THREE.Vector3(d, 0, halfZ),
    );
  const majorGrid = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x5a5f7a }),
  );
  majorGrid.position.y = 0.002;
  majorGrid.userData.helper = true;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, depthSize),
    new THREE.ShadowMaterial({ opacity: 0.32 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  return { grid, majorGrid, floor };
}

// ── 배경 상자(6면) ────────────────────────────────────────────────────────

/**
 * BoxGeometry 가 재질을 받는 순서(+X, −X, +Y, −Y, +Z, −Z)에 맞춘 면 이름.
 *
 * 안쪽에서 보므로 −Z 가 정면입니다. `panorama.ts` 의 자르기도 «경도 0 = −Z» 로
 * 맞춰져 있습니다. 이 순서와 아래 `buildBackgroundCubeGeometry` 의 uv 보정은
 * 같은 규약을 두 번 쓰는 것이라 반드시 한곳에 둡니다 — 따로 두었다가 한쪽만
 * 고치면 여섯 장이 또 어긋납니다.
 */
export const CUBE_FACE_ORDER: CompositionCubeFace[] = [
  "right",
  "left",
  "top",
  "bottom",
  "back",
  "front",
];

/** 배경 상자의 한 변. 옆 벽은 예전(48×32×48)과 같은 자리(±24)에 섭니다. */
export const BACKGROUND_CUBE_SIZE = 48;

/*
  «배경 상자의 중심 높이»(옛 BACKGROUND_CUBE_CENTER_Y) 는 없앴습니다.

  배경은 이제 매 프레임 **카메라 자리로 따라옵니다**(`CompositionViewport` 의
  재생 루프). 눈이 늘 상자 한가운데라 어디로 걸어가든 큐브 투영이 정확하고,
  «상자 바닥면이 우리 바닥과 어긋난다» 는 문제도 사라집니다 — 면은 투영면일
  뿐 바닥이 아니니까요. 그래서 고정 높이를 둘 자리가 없습니다.

  세 자리 고정과 견준 실측(three 로 눈에서 광선을 쏴 «그 자리에 그려진 방향»
  과 «실제 시선» 의 각도 차이를 잰 값, scratchpad/cube-check/probe-eyelock.mjs):
    눈 (0,1.6,4)   6면 평균 6.8°  최대 9.5°   → 카메라에 붙이면 0.000°
    눈 (0,1.6,12)  6면 평균 20.4° 최대 27.9°  → 0.000°
    눈 (14,3,−10)  6면 평균 29.7° 최대 45.6°  → 0.000°
  지평선도 고정 배치에서는 부감(0,6,6)일 때 10.4° 밀렸는데 0° 가 됩니다.

  «이 배경을 몇 미터 눈높이에서 본 것으로 볼지»(축척)는 별개의 값입니다 —
  `composition.backgroundEyeHeight`.

  **«방» 모드는 다시 월드에 못 박습니다.** 다만 옛 «중심 높이» 처럼 아무 높이가
  아니라 **밑면이 y=0** 이 되는 자리(중심 y = S/2)입니다. 그때 밑면은 투영면이
  아니라 진짜 바닥이 되어, 눈이 한가운데를 벗어나도 인물의 발이 바닥 그림에서
  떨어지지 않습니다. 옛 고정 배치가 실패한 까닭은 «높이가 틀려서» 였지 «월드에
  못 박아서» 가 아니었습니다 — 위 절의 «방» 설명 참고.
*/

/** 배경은 다른 것보다 **먼저** 그립니다. 음수라 인물·소품(기본 0)보다 앞섭니다. */
export const BACKGROUND_RENDER_ORDER = -1000;

/**
 * 배경 메시를 «무한히 먼 하늘» 로 표시합니다.
 *
 * ## 왜 depthWrite 를 끄는가 — 크기를 키우는 대신
 *
 * 배경 상자는 반쪽이 24m 라, 카메라를 따라다니면 **24m 보다 먼 물체는 전부
 * 상자 밖**입니다. 깊이를 그대로 쓰면 멀리 둔 GLB·인물이 배경에 가려 사라져요.
 * 길은 둘입니다.
 *
 * 1. 상자를 카메라 far(400)의 절반쯤으로 키운다 — 텍스처 반복이 없으니 그림은
 * 그대로지만, 깊이 버퍼의 정밀도를 200m 까지 늘려 쓰게 되어 near 0.05 와
 * 맞물리면 가까운 물체끼리 z-fighting 이 납니다. 그러고도 «far 보다 먼 것»
 * 은 여전히 가려집니다.
 * 2. **깊이를 아예 쓰지 않는다** — 먼저 그리고(renderOrder 음수) 깊이는 쓰지
 * 않으니(depthWrite:false) 뒤에 그리는 모든 것이 위에 얹힙니다. 배경은
 * 무한히 먼 하늘이 되고 상자 크기는 그림에 아무 영향이 없습니다.
 *
 * 2번을 씁니다. 크기는 48/반지름 60 그대로 두어 깊이 정밀도를 아끼고,
 * 카메라를 따라다니므로 near·far 안에 늘 들어옵니다.
 *
 * **«방» 모드에서도 깊이는 그대로 끕니다.** 방은 유한한 상자지만, 깊이를 켜면
 * 방보다 큰 인물·GLB 가 벽에 파묻혀 몸이 잘립니다. 「인물이 큐브의 천장을 뚫고
 * 나가게 되니까」 를 다루는 방법은 방을 넓히거나 천장 면을 숨기는 쪽이지
 * 인물을 자르는 쪽이 아닙니다 — 그래서 배경은 언제나 «맨 뒤» 로 둡니다.
 * (depthTest 는 켠 채로 둡니다 — 배경보다 먼저 그려지는 것이 없어 늘 통과하고,
 * 끄면 오히려 다음에 올 후처리에서 규칙이 하나 더 늘어납니다.)
 */
export function markAsBackgroundMesh(
  mesh: THREE.Mesh,
  baseSide: THREE.Side = THREE.BackSide,
) {
  mesh.renderOrder = BACKGROUND_RENDER_ORDER;
  setBackgroundOcclusion(mesh, () => false, baseSide);
  return mesh;
}

/**
 * 방 한 칸의 **껍질 하나**를 세웁니다 — 안쪽(벽지)이든 바깥쪽(외벽)이든 같은 상자입니다.
 *
 *
 *
 * 면이 빈 자리는 **안쪽만** 어두운 색으로 채웁니다. 「아직 안 넣었다」 가 보여야 하니까요.
 * 바깥 껍질에서 같은 짓을 하면 안 붙인 면이 검은 판이 되어 방 밖에서 안이 아예 안 보입니다 —
 * 바깥은 «붙인 면만» 그리고 나머지는 투명하게 둡니다.
 *
 * **호리존**(`solidColor`)은 그림을 아예 안 봅니다 — 여섯 면 전부가 그 색 하나입니다(). `dim`(하늘 조명이 없을 때의 배경 어둡히기)도 안 곱합니다 — 사람이 «흰색» 을 골랐는데
 * 회색으로 서면 고른 색을 못 믿게 됩니다. 어둡게 쓰고 싶으면 어두운 색을 고르면 됩니다.
 */
export function buildRoomShell(
  images: Partial<Record<CompositionCubeFace, string>>,
  options: {
    shell: "inner" | "outer";
    dim: number;
    loadTexture: (source: string) => THREE.Texture;
    /** 옆 네 면 그림의 아래 몇 할을 안 붙일지 — `CompositionRoom.sideCropBottom`. */
    sideCropBottom?: number;
    /** 호리존 — 여섯 면을 이 색(`#rrggbb`) 하나로. 있으면 `images` 는 무시합니다. */
    solidColor?: string;
  },
): THREE.Mesh {
  const { shell, dim, loadTexture, sideCropBottom, solidColor } = options;
  const inner = shell === "inner";
  const side = inner ? THREE.BackSide : THREE.FrontSide;
  const materials = CUBE_FACE_ORDER.map((face) => {
    if (solidColor) return new THREE.MeshBasicMaterial({ color: new THREE.Color(solidColor), side });
    const source = images[face];
    if (!source)
      return inner
        ? new THREE.MeshBasicMaterial({ color: 0x14141c, side })
        : new THREE.MeshBasicMaterial({
            side,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          });
    return new THREE.MeshBasicMaterial({
      map: loadTexture(source),
      side,
      color: new THREE.Color(dim, dim, dim),
    });
  });
  return markAsBackgroundMesh(
    new THREE.Mesh(buildBackgroundCubeGeometry(BACKGROUND_CUBE_SIZE, shell, sideCropBottom), materials),
    side,
  );
}

/**
 * **파노라마 돔** — 등장방형 한 장을 구 안쪽에 감습니다.
 *
 *
 * 둘레는 반지름 `radius` 의 구라 상자처럼 모서리에서 꺾이지 않고, 구를 눈높이 `eye` 만큼 올려 두어
 * **지평선이 눈높이에 옵니다** — 파노라마를 찍은 높이가 곧 서 있는 사람의 눈높이입니다.
 *
 * # 왜 지면 투영(`GroundedSkybox`)이 기본이 아닌가
 *
 * `GroundedSkybox` 는 지평선 아래를 **바닥 평면에 펴 바릅니다.**
 * 반지름 100 m 에 눈높이 1.6 m 면 비가 62:1 이라, 그림 맨 아랫줄 몇 픽셀이 바닥 100 m 를 덮습니다 —
 * 그게 화면의 방사형 번짐입니다. 게다가 우리가 뽑는 파노라마는 16:9 라 **발밑(천저)이 아예 안 찍혀 있습니다.**
 * 없는 픽셀을 늘리는 셈이라 어떤 값을 줘도 깨끗해지지 않습니다.
 *
 * 그래서 기본은 **그냥 구**입니다. 발밑은 작게 뭉칠 뿐 번지지 않고, 어차피 바닥은 우리 격자와 `floor` 가 맡습니다.
 * 카메라가 한가운데 머무는 컷에서 진짜 2:1 파노라마를 쓸 때만 `grounded` 로 지면 투영을 켭니다.
 *
 * 돌려주는 그룹의 원점은 **방 밑면 한가운데**(y=0 이 바닥)입니다.
 * 깊이를 안 쓰고 맨 뒤에 칠합니다 — 인물이 돔에 파묻혀 잘리지 않게(`markAsBackgroundMesh` 와 같은 까닭).
 */
/**
 * 파노라마가 아직 없을 때 **돔의 모양만** 그려 주는 안내선.
 *
 * 맞습니다.
 * 여태 «돔» 은 고르기만 했고, 그림이 걸리기 전까지 화면에는 상자가 서 있었습니다.
 * 고른 모양과 보이는 모양이 다르면 크기를 가늠할 수가 없습니다.
 *
 * 반구 격자와 바닥 원, 그리고 눈높이 고리를 그립니다. 눈높이 고리가 있어야
 * «파노라마의 수평선이 어디에 오는가» 를 인물과 견줘 볼 수 있습니다.
 */
export function buildDomeGuide(options: {
  radius: number;
  eye: number;
  color?: number;
}): THREE.Group {
  const group = new THREE.Group();
  const color = options.color ?? 0x6f7a90;
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(options.radius, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.16,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  shell.renderOrder = BACKGROUND_RENDER_ORDER;
  group.add(shell);

  const ring = (radius: number, y: number, opacity: number) => {
    const SEGMENTS = 96;
    const points = Array.from({ length: SEGMENTS + 1 }, (_, index) => {
      const angle = (index / SEGMENTS) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    );
    line.renderOrder = BACKGROUND_RENDER_ORDER + 1;
    return line;
  };
  // 바닥 테두리와 눈높이 고리 — 눈높이가 파노라마의 수평선 자리입니다.
  group.add(ring(options.radius, 0.01, 0.5));
  const eyeRadius = Math.sqrt(Math.max(options.radius ** 2 - options.eye ** 2, 0.01));
  group.add(ring(eyeRadius, options.eye, 0.28));
  return group;
}

export function buildPanoramaDome(options: {
  panorama: string;
  radius: number;
  eye: number;
  dim: number;
  loadTexture: (source: string) => THREE.Texture;
  floor?: { source: string; width: number; depth: number } | null;
  /** 지평선 아래를 바닥 평면에 펴 바를지. 기본은 끔 — 위 주석의 «바닥 번짐». */
  grounded?: boolean;
}): THREE.Group {
  const group = new THREE.Group();
  const texture = options.loadTexture(options.panorama);
  const radius = Math.max(options.radius, options.eye * 4);
  const tint = new THREE.Color(options.dim, options.dim, options.dim);
  let dome: THREE.Object3D;
  if (options.grounded) {
    const grounded = new GroundedSkybox(texture, options.eye, radius, 128);
    const material = grounded.material as THREE.MeshBasicMaterial;
    material.color = tint;
    material.depthWrite = false;
    dome = grounded;
  } else {
    /*
      안쪽에서 보는 구. `scale(-1, 1, 1)` 로 면을 뒤집습니다 — `BackSide` 로만 두면 그림이
      좌우로 뒤집혀 보여, 「왼쪽에 달이 있었는데」 가 오른쪽에 뜹니다.
    */
    const geometry = new THREE.SphereGeometry(radius, 64, 40);
    geometry.scale(-1, 1, 1);
    dome = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ map: texture, color: tint, depthWrite: false }),
    );
  }
  dome.position.y = options.eye;
  dome.renderOrder = BACKGROUND_RENDER_ORDER;
  group.add(dome);
  if (options.floor) {
    const floorMaterial = new THREE.MeshBasicMaterial({
      map: options.loadTexture(options.floor.source),
      color: new THREE.Color(options.dim, options.dim, options.dim),
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(options.floor.width, options.floor.depth), floorMaterial);
    /*
      저장된 바닥 면은 앱 규약대로 위아래가 뒤집혀 있습니다(`crossUnfold.FLIPPED_FACES` — 그림 **아래** 끝이 정면 쪽).
      +90° 로 눕히면 그림 위 끝이 +Z(뒤), 아래 끝이 −Z(정면)로 가서 상자의 바닥 면과 같은 방향이 됩니다.
    */
    plane.rotation.x = Math.PI / 2;
    plane.position.y = 0.002;
    plane.renderOrder = BACKGROUND_RENDER_ORDER + 1;
    group.add(plane);
  }
  return group;
}

/**
 * 배경 상자가 **뒤에 있는 것을 가릴지** 바꿉니다.
 *
 * 방 모드에서는 상자가
 * 진짜 벽이라, 켜면 벽 뒤에 선 인물이 제대로 가려집니다 — 문 밖에 세운 인물이 정말 밖에
 * 있는지 눈으로 확인할 수 있습니다.
 *
 * 켤 때는 `renderOrder` 도 0 으로 되돌립니다. 음수인 채로 깊이만 켜면 배경이 **먼저**
 * 그려지면서 깊이를 남겨, 뒤에 그리는 인물이 실제 거리와 상관없이 가려집니다.
 */
export function setBackgroundOcclusion(
  mesh: THREE.Mesh,
  occludes: (face: CompositionCubeFace) => boolean,
  /** 안 가릴 때 어느 쪽만 그릴지. 바깥 껍질은 `FrontSide` 입니다. */
  baseSide: THREE.Side = THREE.BackSide,
) {
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  /*
    ── 가려도 상자는 **배경 칠하는 순서에 그대로** 둡니다 ─────────────────────

    예전에는 한 면이라도 가리면 상자 전체를 «맨 뒤»(renderOrder 0)로 꺼냈습니다. 방이
    하나일 때는 괜찮았는데, **방 안에 방**을 넣자 터졌습니다. 은신처의 오른쪽 면 하나를 가리게
    켜는 순간 은신처 상자가 통째로 회합방 **뒤에** 칠해져, 가리지도 않는 나머지 다섯 면(골목)
    이 회합방 벽을 덮었습니다(WebGL 실측 24/24 장면).

    재질은 상자 하나에 면마다 붙어 있어 «그 면만» 순서를 옮길 수가 없습니다. 그런데 옮길
    까닭도 없습니다 — 방 상자는 이제 **실제 크기·실제 자리**의 벽이라, 먼저 칠해도 깊이는
    진짜 거리로 남습니다. 가리는 면이 남긴 깊이는 그보다 **먼** 인물·벽만 지우고, 가까운
    것은 그대로 통과합니다. («먼저 칠하면 거리와 상관없이 가린다» 는 경고는 카메라에 붙어
    다니던 하늘 상자 시절의 것이었습니다.)

    이미 칠하는 순서(`orderBackgroundRooms` 가 매긴 음수 자리)가 있으면 건드리지 않습니다.
  */
  if (mesh.renderOrder >= 0) mesh.renderOrder = BACKGROUND_RENDER_ORDER;
  list.forEach((material, slot) => {
    const on = occludes(CUBE_FACE_ORDER[slot] ?? "front");
    {
      /*
        «투시» (`applyWallCutaway`)가 벽을 잠깐 걷었다가 **되돌릴 값**을 여기 적어 둡니다.
        처음 한 번만 투명도를 적는 까닭: 바깥 껍질의 안 붙인 면은 처음부터 투명(0)이라,
        투시가 걷고 되돌릴 때 1 로 돌려놓으면 보이지 않던 판이 검게 나타납니다.
      */
      if (!material.userData.cutawayBase)
        material.userData.cutawayBase = {
          transparent: material.transparent,
          opacity: material.opacity,
        };
      material.userData.occludes = on;
      material.userData.cut = false;
      material.depthWrite = on;
      /*
        **방 밖에서 볼 때도** 가리려면 양면을 그려야 합니다.

        
        안쪽 껍질은 안에서 보도록 `BackSide` 로 그립니다 — 밖에서 보면 면이 아예 안 그려지고,
        안 그려지니 깊이도 안 남아 뒤엣것이 그대로 보입니다. 가리기를 켜면 `DoubleSide` 로
        바꿔 바깥 면도 그립니다. 끄면 원래대로 — 안쪽만 그리는 편이 싸고, 어차피 깊이를
        안 쓰므로 바깥 면은 뜻이 없습니다.

        **바깥 껍질(`FrontSide`)은 양면으로 바꾸지 않습니다.** 바깥 껍질은 이미 밖에서
        보이는 쪽을 그리고 있어 양면이 될 까닭이 없고, 양면으로 만들면 건물 **안에서**
        외벽 그림이 보입니다. 실제로 방 A 안에서 옆방 B 쪽을 보면 B 의 외벽이 A 의 벽
        위에 덮여 그려졌습니다(2026-09-14 헤드리스 실측: 자기 벽 파랑 대신 B 외벽 색).
        그래서 «양면으로 넓히기» 는 안쪽 껍질에서만 뜻이 있습니다.
      */
      material.side =
        on && baseSide === THREE.BackSide ? THREE.DoubleSide : baseSide;
      material.needsUpdate = true;
    }
  });
}

/**
 * 여섯 면을 안쪽에 붙일 배경 상자.
 *
 * ## 왜 옆 네 면의 uv 를 좌우로 되돌리는가
 *
 * `BoxGeometry` 의 uv 는 «상자 **밖에서** 볼 때» 바로 보이도록 매겨져 있습니다.
 * `side: BackSide` 로 안에서 보면 **여섯 면이 모두** 좌우로 뒤집힙니다(닫힌 상자를
 * 안에서 보면 당연합니다 — 실제 `BoxGeometry` 로 uv 를 찍어 확인했습니다).
 *
 * 그런데 `panorama.ts` 의 `FACE_VECTORS` 는 옆 네 장만 «사람이 보기 바른» 방향으로
 * 자르고, 천장·바닥 두 장은 **이미 거울**입니다(위에서 내려다본 그림의 좌우가
 * 뒤집혀 저장됩니다). 그래서 보정을 옆 네 면에만 걸면
 * 옆면 = 뒤집힘 × 보정 = 바름, 천장·바닥 = 뒤집힘 × 거울 = 바름
 * 으로 여섯 장이 모두 맞습니다. 보정 전에는 옆면만 거울이라 모서리마다 전혀 다른
 * 경도의 그림이 맞닿았습니다 — 2026-09-09
 *
 * **천장·바닥의 uv 를 같이 뒤집으면 안 됩니다.** 그러면 이미 거울인 그림이 한 번 더
 * 뒤집혀 어긋납니다. 저장 파일 쪽(`panorama.ts`)을 바로잡는 길도 있지만, 그러면
 * 이미 잘라 둔 세트가 전부 어긋나므로 지금 규약을 유지합니다.
 *
 * 세 가지 처방 중 uv 를 고르는 이유:
 * - `mesh.scale.x = -1` (파노라마 구가 쓰는 방법) — 옆면은 맞지만 +X/−X 자리가
 * 바뀌어 왼쪽·오른쪽 그림이 서로 가고, 멀쩡하던 천장·바닥이 뒤집힙니다.
 * - 텍스처 `repeat.x = -1` — `loadCachedTexture` 는 **주소 하나에 텍스처 하나**를
 * 여러 씬·파노라마 구와 함께 씁니다. 여기서 건드리면 구 배경까지 뒤집힙니다.
 * (`clone()` 은 로드 전이면 `image` 참조가 갈려 빈 그림이 되고, 캐시 밖이라
 * 따로 지워야 해서 새기 쉽습니다.)
 * - **uv** — 이 지오메트리 안에서만 끝납니다. 그래서 이걸 씁니다.
 *
 * 저장된 여섯 PNG 는 그대로 둡니다. 잘라 둔 세트를 다시 만들 필요가 없고,
 * 파일 자체는 글씨가 바로 읽히는 «레퍼런스로 쓸 수 있는» 그림이어야 합니다.
 *
 * ## 왜 정육면체인가
 *
 * 예전에는 48×32×48 이었습니다. 90° 로 자른 정사각형 면을 세로가 눌린 벽에
 * 붙이면 탄젠트가 2/3 로 눌려(벽) 1.5 로 늘어나(천장·바닥) 이음매를 가로지르는
 * 직선이 22.6° 꺾입니다. 정육면체면 이 오차가 0 입니다.
 */
export function buildBackgroundCubeGeometry(
  size = BACKGROUND_CUBE_SIZE,
  shell: "inner" | "outer" = "inner",
  /** 옆 네 면 uv 의 아래 끝을 이만큼 올립니다(0~0.9). 천장·바닥은 그대로. */
  sideCropBottom = 0,
) {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const uv = geometry.attributes.uv;
  /*
    **바깥 껍질은 정반대로 뒤집습니다.**

    위 설명의 «안쪽» 규약은 [옆 네 면 보정 + 천장·바닥 그대로] 였습니다. 바깥에서 보는
    껍질은 `FrontSide` 라 거울이 아예 없으므로, 옆 네 면은 보정이 필요 없고 대신 **이미
    거울로 저장된** 천장·바닥만 되돌려야 합니다. 즉 뒤집을 면이 서로 여집합입니다.

    이렇게 두면 같은 여섯 장을 안쪽에 붙이든 바깥에 붙이든 글씨가 바로 읽힙니다 —
    전개도를 «안쪽판»·«바깥판» 으로 따로 뽑더라도 자르는 도구(`crossUnfold.ts`)는
    하나로 씁니다.
  */
  const flip = (face: CompositionCubeFace) =>
    shell === "inner"
      ? face !== "top" && face !== "bottom"
      : face === "top" || face === "bottom";
  // 면 분할이 1 이라 면마다 정점이 딱 4개, 순서는 CUBE_FACE_ORDER 와 같습니다.
  CUBE_FACE_ORDER.forEach((face, slot) => {
    if (!flip(face)) return;
    for (let k = slot * 4; k < slot * 4 + 4; k += 1) uv.setX(k, 1 - uv.getX(k));
  });
  /*
    실외 세트는 옆면 사진의 아래쪽을 버립니다(`CompositionRoom.sideCropBottom` 의 기하). uv 의 y 를 [0,1] → [crop,1] 로
    눌러 담으면 벽 바닥에는 그림의 crop 높이가, 벽 꼭대기에는 그림 꼭대기가 옵니다. 텍스처를 잘라 새로 만들지 않는 까닭 —
    같은 그림을 방 여러 개가 캐시로 나눠 쓰므로 원본은 그대로 두고 상자마다 uv 만 다르게 둡니다.
  */
  const crop = Math.min(0.9, Math.max(0, sideCropBottom || 0));
  if (crop > 0)
    CUBE_FACE_ORDER.forEach((face, slot) => {
      if (face === "top" || face === "bottom") return;
      for (let k = slot * 4; k < slot * 4 + 4; k += 1) uv.setY(k, crop + uv.getY(k) * (1 - crop));
    });
  uv.needsUpdate = true;
  return geometry;
}

// ── 카메라 무빙 앵커 ──────────────────────────────────────────────────────
// 달리·오빗의 기준점이라 눈에 보여야 구도를 잡을 수 있습니다.
export function buildAnchorMarker() {
  const group = new THREE.Group();
  group.userData.helper = true;

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 14, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb347 }),
  );
  group.add(ball);
  const cross = new THREE.Group();
  [
    [0.35, 0, 0],
    [0, 0.35, 0],
    [0, 0, 0.35],
  ].forEach(([x, y, z]) => {
    const bar = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-x, -y, -z),
        new THREE.Vector3(x, y, z),
      ]),
      new THREE.LineBasicMaterial({ color: 0xffb347 }),
    );
    cross.add(bar);
  });
  group.add(cross);
  return group;
}

// ── «방» 의 돔 — 지면 투영(ground-projected) 배경막 ─────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 방이 여럿일 때 — 칠하는 순서와 투시
// ─────────────────────────────────────────────────────────────────────────────

/** 순서·투시 계산에 필요한 방 한 칸. `CompositionViewport` 의 `background.rooms` 한 줄과 같은 모양. */
export interface BackgroundRoomRig {
  inner: THREE.Mesh;
  outer: THREE.Mesh | null;
  width: number;
  depth: number;
  height: number;
  position: { x: number; y: number; z: number };
  /** 도(°). */
  rotationY: number;
}

/** 방의 가운데(밑면 한가운데 + 층고의 절반). */
function roomCenter(room: BackgroundRoomRig): THREE.Vector3 {
  return new THREE.Vector3(
    room.position.x,
    room.position.y + room.height / 2,
    room.position.z,
  );
}

/** 세계 좌표 한 점을 **방의 좌표**로(가운데가 원점, 회전을 되돌린 것). 크기는 미터 그대로. */
function toRoomLocal(room: BackgroundRoomRig, point: THREE.Vector3): THREE.Vector3 {
  const local = point.clone().sub(roomCenter(room));
  local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -(room.rotationY * Math.PI) / 180);
  return local;
}

/** 방 좌표의 점이 상자 안인가. `margin` 만큼 안쪽으로 줄여 봅니다. */
function insideRoom(room: BackgroundRoomRig, local: THREE.Vector3, margin = 0): boolean {
  return (
    Math.abs(local.x) <= room.width / 2 - margin &&
    Math.abs(local.y) <= room.height / 2 - margin &&
    Math.abs(local.z) <= room.depth / 2 - margin
  );
}

/** 방 B 가 방 A 안에 통째로 들어 있는가 — B 의 여덟 귀퉁이가 전부 A 안인가. */
function roomContains(outer: BackgroundRoomRig, inner: BackgroundRoomRig): boolean {
  const hw = inner.width / 2;
  const hh = inner.height / 2;
  const hd = inner.depth / 2;
  const angle = (inner.rotationY * Math.PI) / 180;
  const up = new THREE.Vector3(0, 1, 0);
  const center = roomCenter(inner);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const corner = new THREE.Vector3(sx * hw, sy * hh, sz * hd)
          .applyAxisAngle(up, angle)
          .add(center);
        // 벽을 딱 맞대 넣은 방도 «안» 으로 칩니다 — 1cm 여유.
        if (!insideRoom(outer, toRoomLocal(outer, corner), -0.01)) return false;
      }
  return true;
}

/**
 * 방들을 **칠할 순서**로 늘어놓습니다 — 먼저 칠할 방이 앞.
 *
 * 배경 상자는 깊이를 안 씁니다(방보다 큰 인물이 벽에 파묻혀 잘리지 않게). 그래서 순서가
 * 곧 앞뒤이고, 나중에 칠한 방이 먼저 칠한 방을 덮습니다.
 *
 * # 겹친 방은 «감싸는 방 먼저»
 *
 * 처음에는 «가운데가 먼 방부터» 만 봤습니다. 옆으로 늘어선 방에는 맞지만, **방 안에 방을
 * 넣으면** 틀립니다. 은신처(12×10×5)와 회합방(7×7×4)은 가운데가 같은 자리라 거리가
 * 거의 같고, 카메라가 조금만 움직여도 순서가 뒤집혀 은신처 안쪽 면이 회합방 벽을 덮었다
 * 말았습니다.
 *
 * 안에 든 방의 벽은 **어느 방향에서 봐도** 감싸는 방의 벽보다 가깝습니다. 그러니 겹친 방은
 * 카메라와 상관없이 «바깥 방 먼저, 안쪽 방 나중» 이 늘 맞습니다. 그래서
 *
 * 1. 몇 겹 안에 들어 있는가(0 = 가장 바깥) — 작은 쪽이 먼저
 * 2. 같은 겹이면 가운데까지 거리 — 먼 쪽이 먼저(옆으로 늘어선 방의 옛 규칙 그대로)
 */
export function orderBackgroundRooms<T extends BackgroundRoomRig>(
  rooms: readonly T[],
  eye: THREE.Vector3,
): T[] {
  const depthOf = rooms.map(
    (room) => rooms.filter((other) => other !== room && roomContains(other, room)).length,
  );
  return rooms
    .map((room, index) => ({
      room,
      nest: depthOf[index],
      far: eye.distanceToSquared(roomCenter(room)),
    }))
    .sort((a, b) => a.nest - b.nest || b.far - a.far)
    .map((item) => item.room);
}

/** 투시로 걷은 벽의 투명도. 벽이 «있다» 는 것은 보여야 해서 0 이 아닙니다. */
export const CUTAWAY_OPACITY = 0.14;

/** 면마다 바깥쪽 법선이 가리키는 축과 부호. `CUBE_FACE_ORDER` 와 같은 뜻입니다. */
const FACE_AXIS: Record<CompositionCubeFace, { axis: "x" | "y" | "z"; sign: 1 | -1 }> = {
  right: { axis: "x", sign: 1 },
  left: { axis: "x", sign: -1 },
  top: { axis: "y", sign: 1 },
  bottom: { axis: "y", sign: -1 },
  back: { axis: "z", sign: 1 },
  front: { axis: "z", sign: -1 },
};

/**
 * 이 면이 카메라와 인물 **사이를 막고 있는가.**
 *
 * 카메라에서 인물까지 선을 긋고, 그 선이 면(유한한 사각형)을 지나는지 봅니다.
 * 카메라가 면의 **바깥쪽**에 있고 인물이 **안쪽**에 있을 때만 셉니다.
 */
function faceBlocks(
  room: BackgroundRoomRig,
  face: CompositionCubeFace,
  eye: THREE.Vector3,
  subject: THREE.Vector3,
): boolean {
  const { axis, sign } = FACE_AXIS[face];
  const half = { x: room.width / 2, y: room.height / 2, z: room.depth / 2 };
  const plane = sign * half[axis];
  if (sign * eye[axis] <= half[axis]) return false; // 카메라가 면 안쪽
  if (sign * subject[axis] >= half[axis]) return false; // 인물이 면 바깥쪽
  const t = (plane - eye[axis]) / (subject[axis] - eye[axis]);
  if (t <= 0 || t >= 1) return false;
  const hit = eye.clone().lerp(subject, t);
  return (["x", "y", "z"] as const)
    .filter((other) => other !== axis)
    .every((other) => Math.abs(hit[other]) <= half[other]);
}

/**
 * **투시** — 방 밖에서 볼 때, 안에 선 인물을 가리는 벽만 반투명하게 걷습니다.
 *
 * 은신처 외벽은 «그림을 붙인 면은 가린다» 규칙대로 깊이를 써서, 밖에서
 * 보면 안의 사람이 전부 가려졌습니다. 진짜 건물로는 맞지만 구도를 잡는 화면에서는
 * 사람을 볼 수 있어야 합니다(인형의 집처럼).
 *
 * # 9/14 의 «가리기» 와 부딪치지 않게
 *
 * 사용자 2026-09-14 에는 반대로 「방 밖에서 볼 때도 가려져야」 라고 해서 가리기를 넣었습니다.
 * 둘을 함께 살리려고 걷는 경우를 **좁혔습니다.**
 *
 * - 카메라가 그 방 **밖**이고
 * - 인물이 그 방 **안**이고
 * - 그 벽이 둘 **사이를 실제로 막을 때**만
 *
 * 문 밖에 세운 인물을 방 안에서 보는 경우(카메라 안·인물 밖)는 그대로 가려집니다 —
 * 9/14 에 사용자가 확인하려던 것이 그것입니다.
 *
 * # 사람이 체크한 면은 **절대** 안 걷습니다 — 바깥 껍질만
 *
 * 처음에는 안쪽 껍질도 걷었습니다. 그랬더니 ,
 * 「어느 각도에서는 벽이 가려지고 어느 각도에서는 안 가려지고 하네」. 사람이 정한 것을
 * 자동 규칙이 이기면, 각도마다 결과가 달라져 **무엇을 체크했는지가 뜻을 잃습니다.**
 *
 * 그래서 걷는 대상은 **바깥 껍질**(외벽 그림을 붙였다는 이유만으로 자동으로 깊이를 쓰는 면)
 * 뿐입니다. 안쪽 «가릴 면» 은 사람이 체크했거나 타임라인에 키로 적은 그대로 갑니다.
 * 기본값은 켜짐입니다(`outerCutaway`) — 투시 자체는 사용자가 원한 것이고, 문제는 «체크한 벽까지»
 * 걷은 것이었습니다.
 */
export function applyWallCutaway(
  room: BackgroundRoomRig,
  eye: THREE.Vector3,
  subjects: readonly THREE.Vector3[],
  enabled = true,
) {
  const localEye = toRoomLocal(room, eye);
  const eyeInside = insideRoom(room, localEye);
  const localSubjects =
    enabled && !eyeInside
      ? subjects.map((point) => toRoomLocal(room, point)).filter((point) => insideRoom(room, point))
      : [];

  // 안쪽 껍질(사람이 체크한 «가릴 면»)은 건드리지 않습니다 — 위 주석의 9/15 절.
  [room.outer].forEach((mesh) => {
    if (!mesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    list.forEach((material, slot) => {
      if (!material.userData.occludes) return;
      const face = CUBE_FACE_ORDER[slot] ?? "front";
      const cut = localSubjects.some((subject) => faceBlocks(room, face, localEye, subject));
      if (material.userData.cut === cut) return;
      material.userData.cut = cut;
      const base = material.userData.cutawayBase as
        | { transparent: boolean; opacity: number }
        | undefined;
      /*
        걷을 때는 깊이를 **끕니다** — 반투명으로만 두고 깊이를 쓰면, 그려지지도 않는 벽이
        뒤의 인물을 계속 지웁니다. 되돌릴 때는 가리기 규칙이 적어 둔 값으로 돌아갑니다.
      */
      material.depthWrite = cut ? false : true;
      material.transparent = cut ? true : (base?.transparent ?? false);
      material.opacity = cut ? CUTAWAY_OPACITY : (base?.opacity ?? 1);
      material.needsUpdate = true;
    });
  });
}

/**
 * **주광의 그림자 카메라를 바닥 넓이에 맞춥니다.**
 *
 * 두 곳에서 필요합니다 — 씬을 세울 때 한 번(격자 48m 기준), 그리고 «방» 에서 격자가
 * 방 크기를 따라갈 때마다 다시(3m 도 되고 400m 도 됩니다). 예전에는 같은 계산이 두 벌로
 * 적혀 있었고, 그 탓에 사고가 **두 번** 났습니다.
 *
 * - 좌우만 넓히고 near/far 를 안 따라가게 두면, 빛이 `1.5S` 만큼 물러나는 큰 방에서
 * 씬이 통째로 far 뒤로 넘어가 그림자가 하나도 안 남습니다(실측: S=340m 부터 발·머리·
 * 반대 구석 전부 사라짐). 반대로 아주 작은 방에서는 빛이 코앞이라 near=0.5 가 머리를 자릅니다.
 * - 절두체는 빛 방향으로 **누운 정사각형**이라, S×S 격자를 어느 방향에서 보든 덮으려면
 * 반쪽이 아니라 «반대각선»(S/2·√2)이 필요합니다. 반쪽으로 두면 격자 네 귀퉁이에서만
 * 그림자가 빠져, 원인을 찾기가 특히 어렵습니다.
 *
 * 정사영이라 near 가 0 이나 음수여도 됩니다 — 원근이 아니어서 나눗셈이 없습니다.
 */
export function fitShadowToFloor(light: THREE.DirectionalLight, floorSize: number) {
  const range = (floorSize / 2) * Math.SQRT2;
  const camera = light.shadow.camera;
  camera.left = -range;
  camera.right = range;
  camera.top = range;
  camera.bottom = -range;
  const span = floorSize * 1.5;
  const distance = light.position.length();
  camera.near = distance - span;
  camera.far = distance + span;
  camera.updateProjectionMatrix();
}
