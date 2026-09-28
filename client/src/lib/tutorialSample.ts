/*
  **튜토리얼용 예시 프로젝트** — 튜토리얼이 가리킬 것이 실제로 있는 작품 하나를 만듭니다.

  

  튜토리얼의 걸음은 화면의 자리(`data-tour`)를 가리킵니다. 그런데 그 자리 중 여럿은 **내용이 있어야
  생깁니다** — 뽑은 그림이 없으면 가위가 없고, 시트가 없으면 시트 선반이 없고, 컷이 없으면 컷 카드가
  없습니다. 갓 깐 사람에게는 그 자리들이 하나도 없어서 「이 단계의 자리가 지금 화면에 없습니다」 만
  줄줄이 뜹니다.

  그래서 «전부 채워진 작품» 을 하나 만들어 둡니다. 그림은 앱에 딸려 오는 네 장(`public/tutorial/`)을
  프로젝트 폴더로 복사해 씁니다 — 진짜 파일이라야 가위·폴더 열기·시트가 제 일을 합니다.

  지우는 것은 보통 작품과 똑같습니다. 숨기거나, 폴더를 지우면 됩니다.
*/

import { ensureProjectInbox, getMediaLibrarySettings, saveProjectMediaAsset } from "@/lib/mediaLibrary";
import { PANORAMA_DIR } from "@/lib/faceSets";
import { saveFaceSet } from "@/lib/faceSetSave";
import { COMPOSITION_CUBE_FACES, normalizeComposition, type CompositionState } from "@/lib/composition";
import { getLocalProject, loadProjects, projectFolderName, saveLocalProject } from "@/lib/localProjectStore";
import {
  newBackground,
  newCharacter,
  newCut,
  newProjectDraft,
  newScene,
  uid,
  type Background,
  type Character,
  type GeneratedImageAsset,
  type ProjectDraft,
  type ReferenceImage,
} from "@/lib/projectTypes";

/** 한 번만 만듭니다. 다시 누르면 같은 작품을 고쳐 씁니다 — 눌렀다 놓을 때마다 쌓이면 곤란합니다. */
export const TUTORIAL_SAMPLE_ID = "tutorial-sample";
export const TUTORIAL_SAMPLE_TITLE = "튜토리얼 예시 — 야간 순찰";

const CHARACTER_NAME = "카일로";
const PLACE_NAME = "항만 창고 앞";
const ROOM_NAME = "창고 안";

/**
 * 예시 방의 세 변(m). 6면 세트에 적어 두면 구도잡기가 방을 **이 크기로** 세웁니다.
 * (안 적으면 5.5×5.2×4.4 같은 기본값으로 서서 「50 미터를 원했는데」 가 됩니다 — 2026-09-15.)
 */
const ROOM_SIZE = { width: 12, depth: 9, height: 6 } as const;

/**
 * 파노라마에 찍어 두는 «이미 잘랐다» 표. 값은 시각이기만 하면 되고, 붙박이로 두면
 * 예시를 몇 번 다시 만들어도 같은 판이 나옵니다. 이게 없으면 카드를 열 때마다 자동 커팅이
 * 같은 파노라마를 또 잘라 여섯 장이 계속 불어납니다.
 */
const ALREADY_UNFOLDED = "2026-09-23T00:00:00.000Z";

/** 딸려 오는 그림. Vite 의 `public/` 이라 주소가 그대로입니다. */
const BUNDLED = {
  front: "/tutorial/character-front.jpg",
  face: "/tutorial/character-face.jpg",
  sheet: "/tutorial/character-sheet.jpg",
  place: "/tutorial/place.jpg",
  /**
   * **실내 전개도** — 등장방형 파노라마 한 장과 거기서 잘린 여섯 면.
   *
   * 앵커 찍기·표시하기·6면 세트 카드·파노라마 탭·구도잡기의 «방 줄» 은
   * 전부 **전개도가 붙은 장소**가 있어야 화면에 생기는 자리들입니다. 인물 사진으로는 설 수 없습니다.
   */
  panorama: "/tutorial/room-panorama.jpg",
  faces: {
    front: "/tutorial/room-front.jpg",
    back: "/tutorial/room-back.jpg",
    left: "/tutorial/room-left.jpg",
    right: "/tutorial/room-right.jpg",
    top: "/tutorial/room-top.jpg",
    bottom: "/tutorial/room-bottom.jpg",
  },
} as const;

/**
 * 딸려 온 그림 하나를 프로젝트 폴더로 복사합니다.
 *
 * `fetch` 로 읽어 `File` 로 감싸 넘깁니다 — 저장하는 길(`saveProjectMediaAsset`)이 사람이 끌어다
 * 놓은 파일과 **완전히 같아야** 이름 규칙(«인물_번호»)과 폴더 자리가 어긋나지 않습니다.
 */
async function bundledFile(url: string): Promise<File | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], url.split("/").pop() || "sample.jpg", { type: blob.type || "image/jpeg" });
  } catch {
    return null;
  }
}

async function copyBundled(
  url: string,
  options: {
    projectName: string;
    assetType: "character-generated" | "character-reference" | "background-generated" | "background-reference";
    ownerName: string;
    subdir?: typeof PANORAMA_DIR;
  },
): Promise<{ path: string; name: string } | null> {
  try {
    const file = await bundledFile(url);
    if (!file) return null;
    return await saveProjectMediaAsset(file, options);
  } catch {
    // 그림이 없어도 작품은 만듭니다 — 글이 든 자리만으로도 걸음 대부분은 섭니다.
    return null;
  }
}

function image(saved: { path: string; name: string } | null, extra: Partial<GeneratedImageAsset> = {}): GeneratedImageAsset[] {
  if (!saved) return [];
  return [{ id: uid(), name: saved.name, thumb: "", file: null, filePath: saved.path, ...extra }];
}

function reference(saved: { path: string; name: string } | null, label: string): ReferenceImage[] {
  if (!saved) return [];
  return [{ id: uid(), name: saved.name, thumb: "", file: null, filePath: saved.path, label }];
}

function sampleCharacter(parts: {
  references: ReferenceImage[];
  generated: GeneratedImageAsset[];
}): Character {
  const base = newCharacter();
  return {
    ...base,
    name: CHARACTER_NAME,
    role: "주인공",
    kind: "human",
    gender: "male",
    heightCm: 175,
    build: "athletic",
    description:
      "26세 남성 경비 요원. 짧게 자른 검은 곱슬머리, 짙은 갈색 눈, 둥근 턱선, 턱에 짧은 수염. " +
      "남색 라운드 티 위에 검은 방탄조끼, 남색 카고 바지, 손가락 없는 검은 장갑, 검은 전투화.",
    references: parts.references,
    referenceMode: "keep",
    generatedImages: parts.generated,
    analysis:
      "정면 전신 기준. 머리는 작고 갸름하며 어깨는 넓지 않다. 피부는 따뜻한 중간 갈색이고 " +
      "볼에 옅은 자국이 있다. 팔 바깥쪽에 점이 여러 개 — 칸이 바뀌어도 이 점 자리가 같아야 같은 사람이다.",
    profile: {
      callName: "카일",
      age: "26",
      mbti: "ISTJ",
      tagline: "말수가 적고 먼저 움직인다",
      personality: "겁이 없다기보다 겁을 뒤로 미룬다. 위기에서 오히려 차분해진다.",
      speech: "짧게 끊어 말한다. 존댓말과 반말을 상대에 따라 섞는다.",
      habits: "생각할 때 장갑 끝을 만진다.",
      background: "항만 경비로 3년. 야간 순찰조.",
      directing: "클로즈업에서 시선을 먼저 준다. 과장된 표정은 쓰지 않는다.",
    },
    promptKo:
      "26세 남성 경비 요원, 175cm 탄탄한 체격, 짧은 검은 곱슬머리, 짙은 갈색 눈, 둥근 턱선, " +
      "남색 라운드 티 위 검은 방탄조끼, 남색 카고 바지, 손가락 없는 검은 장갑, 검은 전투화, " +
      "회색 무지 스튜디오 배경, 부드러운 정면광, 전신이 머리부터 신발까지 프레임 안에, 실사",
    promptEn:
      "A 26-year-old male security operative, 175 cm, athletic build, short black curly hair cropped close, " +
      "deep brown eyes, rounded jawline, plain navy crew-neck T-shirt under a matte black ballistic vest, " +
      "navy cargo trousers, black fingerless gloves, black lace-up combat boots, flat neutral grey studio " +
      "backdrop, soft frontal lighting, full length shot with the entire body from head to boots inside the " +
      "frame and both feet visible, photorealistic",
    negativeKo: "글자, 로고, 여러 사람, 허벅지에서 잘림",
    negativeEn: "text, watermark, logo, multiple people, cropped at the thigh",
  };
}

function samplePlace(parts: { references: ReferenceImage[]; generated: GeneratedImageAsset[] }): Background {
  const base = newBackground("exterior");
  return {
    ...base,
    name: PLACE_NAME,
    location: "항만 물류 구역",
    description:
      "밤의 컨테이너 야적장 앞. 노란 나트륨 등 두 개가 바닥을 비추고, 젖은 아스팔트에 빛이 길게 번진다. " +
      "왼쪽에 셔터가 반쯤 내려간 창고, 오른쪽에 쌓인 컨테이너.",
    references: parts.references,
    referenceMode: "keep",
    generatedImages: parts.generated,
    promptKo: "밤의 항만 창고 앞, 젖은 아스팔트, 나트륨 등 두 개, 반쯤 내린 셔터, 쌓인 컨테이너, 인물 없음, 실사",
    promptEn:
      "A port warehouse frontage at night, wet asphalt reflecting two sodium lamps, a half-lowered shutter on the " +
      "left, stacked containers on the right, no people, photorealistic, wide establishing shot",
  };
}

/**
 * **실내 전개도가 붙은 장소.** 파노라마 원본 한 장 + 잘린 여섯 면.
 *
 * 튜토리얼이 여기 기대는 자리 — 6면 세트 카드(«세트 업스케일»), 파노라마 탭, 앵커 찍기·표시하기,
 * 구도잡기의 «방 줄»(방이 있어야 생깁니다), 환경 탭의 «면 가리기».
 */
function sampleRoomPlace(parts: { generated: GeneratedImageAsset[] }): Background {
  const base = newBackground("interior");
  return {
    ...base,
    name: ROOM_NAME,
    location: "항만 물류 구역",
    description:
      "반쯤 내린 셔터 안쪽. 가로 12m · 깊이 9m · 층고 6m 의 창고. 천장 트러스에 나트륨 등 두 개, " +
      "양 옆으로 철제 선반, 안쪽 벽에 컨테이너가 쌓여 있다. 바닥은 젖은 콘크리트에 노란 통로선.",
    generatedImages: parts.generated,
    promptKo:
      "밤의 항만 창고 내부, 가로 12m 깊이 9m 층고 6m, 천장 트러스에 나트륨 등 두 개, 양 옆 철제 선반, " +
      "안쪽 벽에 쌓인 컨테이너, 젖은 콘크리트 바닥과 노란 통로선, 인물 없음, 실사",
    promptEn:
      "The interior of a port warehouse at night, 12 m wide by 9 m deep with a 6 m ceiling, two sodium lamps on " +
      "the roof trusses, steel racking along both side walls, stacked shipping containers on the far wall, wet " +
      "concrete floor with yellow walkway lines, no people, equirectangular 360 panorama, photorealistic",
  };
}

/**
 * 예시 작품을 만들어 저장하고 **그 id** 를 돌려줍니다.
 *
 * 두 번 저장하는 까닭 — 그림을 넣을 폴더 이름은 «처음 저장할 때» 정해집니다. 그래서 먼저 글만
 * 저장해 폴더를 얻고, 그 폴더로 그림을 복사한 다음, 경로가 박힌 판을 다시 저장합니다.
 */
export async function createTutorialSample(): Promise<string> {
  const skeleton: ProjectDraft = {
    ...newProjectDraft(),
    title: TUTORIAL_SAMPLE_TITLE,
    logline: "야간 순찰을 돌던 경비 요원이 창고 앞에서 열린 컨테이너를 발견한다.",
    synopsis:
      "항만 경비 3년 차 카일로는 늘 같은 길을 돈다. 그날 밤 셔터가 반쯤 열린 창고 앞에서 " +
      "평소와 다른 것을 본다. 이 예시 작품은 튜토리얼이 가리킬 자리를 모두 갖추려고 만든 것이라, " +
      "마음대로 고치거나 지워도 됩니다.",
    tone: "차분하고 건조한 밤의 톤",
    runtime: "30초",
    genre: "스릴러",
    genres: ["스릴러"],
    style: "실사",
    styles: ["실사"],
    eras: ["현대"],
    progress: { "1": true, "2": true, "3": true },
  };

  // 1) 글만 먼저 — 폴더 이름을 얻습니다.
  saveLocalProject(skeleton, TUTORIAL_SAMPLE_ID);
  const projectName = projectFolderName(TUTORIAL_SAMPLE_ID, TUTORIAL_SAMPLE_TITLE);
  await ensureProjectInbox({ projectName });

  // 2) 딸려 온 그림을 그 폴더로.
  const [front, face, sheet, place] = await Promise.all([
    copyBundled(BUNDLED.front, { projectName, assetType: "character-generated", ownerName: CHARACTER_NAME }),
    copyBundled(BUNDLED.face, { projectName, assetType: "character-generated", ownerName: CHARACTER_NAME }),
    copyBundled(BUNDLED.sheet, { projectName, assetType: "character-generated", ownerName: CHARACTER_NAME }),
    copyBundled(BUNDLED.place, { projectName, assetType: "background-generated", ownerName: PLACE_NAME }),
  ]);
  const frontRef = await copyBundled(BUNDLED.front, {
    projectName,
    assetType: "character-reference",
    ownerName: CHARACTER_NAME,
  });
  const placeRef = await copyBundled(BUNDLED.place, {
    projectName,
    assetType: "background-reference",
    ownerName: PLACE_NAME,
  });

  const character = sampleCharacter({
    references: reference(frontRef, "이 인물 그대로"),
    generated: [
      ...image(front, { isPrimary: true }),
      ...image(face),
      // 시트 한 장 — 이것이 있어야 «제작한 캐릭터 시트» 선반이 생깁니다.
      ...image(sheet, { isCompositeSheet: true, sheetType: "character", sheetLabel: "정면 · 우측 · 후면 · 얼굴" }),
    ],
  });
  const background = samplePlace({
    references: reference(placeRef, "이 장소 그대로"),
    generated: image(place, { isPrimary: true }),
  });

  /*
    3) 실내 전개도 — 파노라마 한 장과 여섯 면.

    여섯 면은 **`saveFaceSet` 으로** 저장합니다. 이름 규칙(`장소_정면_001`)·번호 세기·하위 폴더를
    한 벌로 들고 있는 것이 그것뿐이라, 여기서 따로 적으면 세트가 갈립니다(같은 규칙 두 벌 금지).
    파노라마에는 `unfoldedAt` 을 찍어 둡니다 — 안 찍으면 카드를 열 때마다 자동 커팅이 같은 그림을
    또 잘라 여섯 장이 계속 불어납니다.
  */
  const panorama = await copyBundled(BUNDLED.panorama, {
    projectName,
    assetType: "background-generated",
    ownerName: ROOM_NAME,
    subdir: PANORAMA_DIR,
  });
  const faceFiles = await Promise.all(
    COMPOSITION_CUBE_FACES.map(async (face) => {
      const file = await bundledFile(BUNDLED.faces[face]);
      return file ? { file, face } : null;
    }),
  );
  const faceSet = await saveFaceSet({
    files: faceFiles.filter((item): item is { file: File; face: (typeof COMPOSITION_CUBE_FACES)[number] } => Boolean(item)),
    projectName,
    assetType: "background-generated",
    ownerName: ROOM_NAME,
    prefix: ROOM_NAME,
    spaceKind: "interior",
  });

  const faceImages: GeneratedImageAsset[] = faceSet.saved.map((saved) => ({
    id: uid(),
    name: saved.name,
    thumb: "",
    file: null,
    filePath: saved.path,
    face: saved.face,
    faceSet: saved.faceSet,
    faceSetSize: { ...ROOM_SIZE },
    unfoldedAt: "not-unfold",
  }));
  const roomPlace = sampleRoomPlace({
    generated: [
      ...image(panorama, { isPrimary: true, unfoldedAt: ALREADY_UNFOLDED }),
      ...faceImages,
    ],
  });

  /*
    **방이 세워진 구도.** 이것이 없으면 구도잡기를 열어도 방이 없어, 타임라인의 «방 · 가릴 면 · 소품»
    줄과 환경 탭의 방 목록·면 가리기가 **아예 안 그려집니다**(없는 자리를 가리키고 있었습니다).
    여섯 면에는 그림 **id** 를 넣습니다. 파일 경로가 아니라 id 인 것은 `cutCompositionSync` 와 같은 규칙입니다.
  */
  const roomFaces: Partial<Record<(typeof COMPOSITION_CUBE_FACES)[number], string>> = {};
  for (const item of faceImages) {
    if (item.face) roomFaces[item.face] = item.id;
  }
  const composition: CompositionState = normalizeComposition({
    rooms: [
      {
        id: "tutorial-room",
        name: ROOM_NAME,
        width: ROOM_SIZE.width,
        depth: ROOM_SIZE.depth,
        height: ROOM_SIZE.height,
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        backgroundId: roomPlace.id,
        faces: roomFaces,
        // 앞벽만 가려 둡니다 — «가림 / 열림» 을 눌러 볼 것이 하나는 있어야 그 걸음이 섭니다.
        occludeFaces: { front: true },
      },
    ],
    activeRoomId: "tutorial-room",
    characters: [
      {
        characterId: character.id,
        position: { x: 0, y: 0, z: 1.5 },
        rotation: { x: 0, y: 0, z: 0 },
        pose: "walk",
      },
    ],
  });

  // 4) 장면과 컷 — 컷 카드의 자리들이 여기서 생깁니다.
  const scene = newScene();
  const cutOne = { ...scene.cuts[0], title: "순찰", description: "카일로가 창고 앞을 지나간다" };
  const cutTwo = newCut(2);
  const filledScene = {
    ...scene,
    title: "01 · 창고 앞",
    summary:
      "야간 순찰 중인 카일로가 반쯤 열린 셔터를 발견하고 걸음을 멈춘다. 카메라는 멀리서 따라가다 " +
      "그가 멈추는 순간 가까이 붙는다.",
    cuts: [
      {
        ...cutOne,
        characterIds: [character.id],
        backgroundId: background.id,
        plannedSeconds: 6,
        promptKo: "젖은 아스팔트를 걸어오는 경비 요원, 뒤로 반쯤 내린 셔터, 나트륨 등, 풀샷, 눈높이",
        promptEn:
          "A security operative walking across wet asphalt, a half-lowered shutter behind him, sodium lamps, " +
          "full shot, eye level, night, photorealistic",
        acting: "천천히 걷다가 셔터 쪽으로 고개를 돌린다",
        styleTags: ["실사", "야간"],
        composition,
      },
      {
        ...cutTwo,
        title: "발견",
        description: "셔터 안쪽을 들여다본다",
        characterIds: [character.id],
        backgroundId: background.id,
        plannedSeconds: 4,
      },
    ],
  };

  const full: ProjectDraft = {
    ...skeleton,
    characters: [character],
    backgrounds: [background, roomPlace],
    scenes: [filledScene],
  };

  saveLocalProject(full, TUTORIAL_SAMPLE_ID);
  return TUTORIAL_SAMPLE_ID;
}

/**
 * 예시 작품이 **쓸 만하게** 있는가.
 *
 * «있는가» 만 보면 안 됩니다. 기본 저장 폴더를 정하기 전에 만들면 그림을 한 장도 못 넣는데
 * (`saveProjectMediaAsset` 이 조용히 null 을 돌려줍니다) 프로젝트 행은 멀쩡히 만들어집니다.
 * 그 반쪽짜리를 «있다» 고 보면 폴더를 정한 뒤에도 다시 만들지 않아, 가위도 시트도 없는 작품에서
 * 튜토리얼이 영영 헛돕니다. 그래서 **그림이 붙어 있는가**까지 봅니다.
 */
export function tutorialSampleReady(): boolean {
  const saved = getLocalProject(TUTORIAL_SAMPLE_ID);
  if (!saved) return false;
  const draft = saved.draft as {
    characters?: Array<{ generatedImages?: Array<{ filePath?: string }> }>;
    backgrounds?: Array<{ generatedImages?: Array<{ face?: string }> }>;
  };
  const images = draft.characters?.[0]?.generatedImages ?? [];
  if (!images.some((image) => Boolean(image.filePath))) return false;
  /*
    **전개도까지 있어야 «다 됐다» 입니다.** 2026-09-23 이전에 만든 예시에는 여섯 면이 없어서,
    전개도·파노라마·앵커·표시하기 걸음이 설 자리가 없습니다. 인물 그림만 보고 «있다» 로 넘기면
    그 반쪽짜리가 굳어 영영 고쳐지지 않습니다 — 폴더를 정한 뒤에도 다시 안 만들던 것과 같은 고장입니다.
  */
  return (draft.backgrounds ?? []).some((place) =>
    (place.generatedImages ?? []).some((image) => Boolean(image.face)),
  );
}

/** 예시 작품 행이 (반쪽이라도) 있는가. */
export function tutorialSampleExists(): boolean {
  return Boolean(getLocalProject(TUTORIAL_SAMPLE_ID));
}

/**
 * **튜토리얼이 설 작품**을 확보합니다 — 없거나 반쪽이면 (다시) 만듭니다.
 *
 *
 * 갓 만든 빈 작품에서 튜토리얼을 돌리면 가위도, 시트도, 뽑은 그림도 없어 걸음 절반이 헛돕니다.
 *
 * 저장 폴더가 아직 없으면 **만들지 않고 물러납니다.** 그때 만들어 봤자 그림 없는 껍데기가 되고,
 * 그것이 굳으면 폴더를 정한 뒤에도 고쳐지지 않습니다. 한 바퀴는 폴더를 정하는 걸음을 앞에 두었으니,
 * 프로젝트가 필요해지는 걸음에 이르렀을 때 여기 다시 옵니다 — 그때는 폴더가 있습니다.
 */
export async function ensureTutorialSample(): Promise<string> {
  /*
    폴더를 먼저 읽습니다. 이 함수는 튜토리얼이 열리는 순간에도 불리는데, 그때 프로젝트 보드가
    아직 폴더를 안 읽었으면 «예시가 없다» 고 잘못 보고 같은 작품을 다시 만들어 덮어씁니다.
  */
  await loadProjects().catch(() => []);
  if (tutorialSampleReady()) return TUTORIAL_SAMPLE_ID;
  if (!getMediaLibrarySettings().baseDirectory.trim()) {
    throw new Error("기본 저장 폴더가 아직 없습니다");
  }
  return createTutorialSample();
}
