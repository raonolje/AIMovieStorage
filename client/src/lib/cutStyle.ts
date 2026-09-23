/**
 * 컷 프롬프트에 얹는 연출 토글.
 *
 * # 무엇을 빼야 했나
 *
 * 처음에는 프레이밍 11개, 앵글 5개, 투·쓰리 샷, 카메라 무브먼트까지 전부
 * 토글이었습니다. 그런데 **구도잡기가 그걸 다 잽니다.** 카메라와 인물
 * 사이 거리에서 샷 크기가, 높이 차이에서 앵글이, 프리셋에서 무빙이 나와요.
 *
 * 두 곳에 있으면 반드시 어긋납니다. 구도잡기에서는 클로즈업인데 토글에는
 * 풀 샷이 켜져 있으면 어느 쪽이 맞는지 알 수 없어요. 그래서 **잴 수 있는
 * 것은 전부 뺐습니다.** 여기 남은 것은 잴 수 없는 것들뿐입니다 —
 * 분위기, 렌즈 느낌, 색감 같은.
 */

export interface CutToggleGroup {
  id: string;
  label: string;
  description: string;
  /** 하나만 고를지, 여럿 고를지 */
  single?: boolean;
  options: { id: string; label: string; hint?: string }[];
}

export const CUT_TOGGLE_GROUPS: CutToggleGroup[] = [
  {
    id: "style",
    label: "스타일",
    description: "이 컷이 어떤 그림으로 보일지",
    options: [
      { id: "cinematic", label: "시네마틱" },
      { id: "documentary", label: "다큐멘터리" },
      { id: "handheld-doc", label: "핸드헬드" },
      { id: "anime2d", label: "2D 애니메이션" },
      { id: "anime3d", label: "3D 애니메이션" },
      { id: "noir", label: "느와르" },
      { id: "dreamy", label: "몽환적" },
      { id: "gritty", label: "거친 질감" },
      { id: "mystery", label: "미스터리" },
      { id: "tension", label: "긴장감" },
      { id: "warm-mood", label: "따뜻함" },
      { id: "melancholy", label: "쓸쓸함" },
    ],
  },
  {
    id: "shooting",
    label: "촬영",
    description:
      "샷 크기·앵글·무빙은 구도잡기가 잽니다. 여기는 렌즈와 연출 의도만",
    // 초점거리를 다섯 단만 두었더니 «넓게» 와 «아주 넓게» 를 구분할 수
    // 없었습니다. 8mm 부터 600mm 까지 실제로 쓰는 단을 다 둡니다 —
    // 렌즈가 바뀌면 얼굴 왜곡과 배경 압축이 통째로 달라집니다.
    options: [
      { id: "lens-8", label: "8mm", hint: "어안. 직선이 휩니다" },
      { id: "lens-12", label: "12mm" },
      { id: "lens-14", label: "14mm" },
      { id: "lens-16", label: "16mm" },
      { id: "lens-20", label: "20mm" },
      { id: "lens-24", label: "24mm" },
      { id: "lens-28", label: "28mm" },
      { id: "lens-35", label: "35mm", hint: "가장 무난한 표준 광각" },
      { id: "lens-40", label: "40mm" },
      { id: "lens-50", label: "50mm", hint: "사람 눈에 가장 가까운 원근" },
      { id: "lens-65", label: "65mm" },
      { id: "lens-85", label: "85mm", hint: "인물용. 얼굴이 예쁘게 눌립니다" },
      { id: "lens-100", label: "100mm" },
      { id: "lens-135", label: "135mm" },
      { id: "lens-200", label: "200mm" },
      { id: "lens-300", label: "300mm" },
      { id: "lens-400", label: "400mm" },
      { id: "lens-600", label: "600mm", hint: "배경이 완전히 눌려 붙습니다" },
      { id: "shallow-dof", label: "얕은 심도" },
      { id: "deep-focus", label: "딥 포커스" },
      { id: "tilt-shift", label: "틸트시프트", hint: "초점면을 기울입니다. 미니어처처럼 보입니다" },
      { id: "long-take", label: "롱 테이크" },
      { id: "rack-focus", label: "포커스 이동" },
      { id: "reflection", label: "반사·거울" },
      { id: "foreground-frame", label: "전경 프레이밍" },
    ],
  },
  {
    id: "lighting",
    label: "조명",
    // 색감과 나눠 둡니다. 색감은 «몇 시의 빛인가»(골든아워·야간) 이고
    // 여기는 «빛을 어디에 어떻게 놓았나» 입니다. 한 그룹에 뭉쳐 두었더니
    // «골든아워 + 로우키» 같은 정상적인 조합을 고를 수 없었습니다.
    description: "빛을 어디에 어떻게 놓았는지. 시간대는 색감에서 고릅니다",
    options: [
      { id: "light-three-point", label: "3점 조명" },
      { id: "light-key", label: "키 라이트만" },
      { id: "light-rim", label: "림 라이트" },
      { id: "light-back", label: "백라이트" },
      { id: "silhouette", label: "실루엣" },
      { id: "light-top", label: "탑 라이트" },
      { id: "light-under", label: "언더 라이트" },
      { id: "light-side", label: "사이드 라이트" },
      { id: "light-rembrandt", label: "렘브란트" },
      { id: "light-soft", label: "소프트 박스" },
      { id: "light-hard", label: "하드 라이트" },
      { id: "light-bounce", label: "바운스" },
      { id: "light-practical", label: "실전광", hint: "화면 안에 보이는 등이 광원입니다" },
      { id: "light-gobo", label: "그림자 무늬", hint: "블라인드·나뭇잎 같은 무늬 그림자" },
      { id: "light-low-key", label: "로우 키" },
      { id: "light-high-key", label: "하이 키" },
    ],
  },
  {
    id: "color",
    label: "색감",
    description: "빛과 색. 같은 장소라도 여기서 시간대가 갈립니다",
    options: [
      { id: "golden-hour", label: "골든아워" },
      { id: "blue-hour", label: "블루아워" },
      { id: "daylight", label: "한낮" },
      { id: "overcast", label: "흐림" },
      { id: "night", label: "야간" },
      { id: "neon", label: "네온" },
      { id: "candlelight", label: "촛불" },
      { id: "moonlight", label: "달빛" },
      { id: "warm-grade", label: "따뜻한 보정" },
      { id: "cool-grade", label: "차가운 보정" },
      { id: "desaturated", label: "채도 낮게" },
      { id: "high-contrast", label: "강한 명암" },
    ],
  },
  {
    id: "texture",
    label: "질감 · 실사",
    description:
      "AI 티를 없애는 칸. 모델은 «예쁜 쪽» 으로 기울어 나오기 때문에 가만두면 얼굴이 플라스틱처럼 매끈해집니다",
    options: [
      { id: "skin-pores", label: "모공·솜털", hint: "피부의 미세 질감. 밀랍 얼굴을 가장 크게 되돌립니다" },
      { id: "skin-flaws", label: "잡티·홍조", hint: "점·주근깨·볼의 붉은 기. 완벽한 피부톤을 깹니다" },
      { id: "skin-oil", label: "유분·땀", hint: "이마·콧등의 번들거림. 빛이 피부에 닿은 증거입니다" },
      { id: "skin-lines", label: "잔주름", hint: "눈가·이마. 나이를 적었는데 피부가 매끈하면 가짜로 보입니다" },
      { id: "no-retouch", label: "보정 안 함", hint: "리터칭·뷰티필터를 되돌립니다" },
      { id: "eye-catchlight", label: "눈의 반사광", hint: "죽은 눈을 고치는 한 가지. 광원을 함께 적으세요" },
      { id: "eye-wet", label: "젖은 눈·속눈썹", hint: "아랫눈꺼풀의 물기와 속눈썹 뿌리" },
      { id: "hair-strands", label: "잔머리", hint: "흐트러진 머리카락 몇 올. 헬멧 같은 머리를 깹니다" },
      { id: "film-grain", label: "필름 그레인", hint: "고른 디지털 면을 깹니다" },
      { id: "halation", label: "헤일레이션", hint: "밝은 곳 둘레의 붉은 번짐. 필름의 물리적 특성입니다" },
      { id: "micro-shake", label: "미세 흔들림", hint: "손으로 든 카메라의 아주 작은 떨림" },
      { id: "candid", label: "연출 안 한 순간", hint: "포즈를 잡지 않은, 살짝 빗나간 프레이밍" },
    ],
  },
];

const LABELS = new Map(
  CUT_TOGGLE_GROUPS.flatMap((group) => group.options.map((option) => [option.id, option.label])),
);

export function cutToggleLabel(id: string) {
  return LABELS.get(id) ?? id;
}

/**
 * 토글 → **영어 조각.**
 *
 * 그것을 고치려고 «질감» 칸을 만들다가 더 큰 것을 발견했습니다 — **토글이 영문
 * 프롬프트에 아예 안 실리고 있었습니다.** 규칙 조립이 한국어 쪽에만 라벨을 붙이고
 * 영문 쪽은 그대로 두었습니다(`applyRulePrompt`). 밖의 생성기 대부분이 영어를 훨씬
 * 잘 알아듣는데, 켜 둔 토글이 한 글자도 안 갔던 것입니다.
 *
 * 한국어 라벨을 그대로 번역하지 않고 **촬영 용어**로 적습니다. 「거친 질감」 을
 * `rough texture` 로 보내 봐야 아무 일도 안 일어납니다.
 */
const ENGLISH: Record<string, string> = {
  // 스타일
  cinematic: "cinematic film look, filmic contrast",
  documentary: "observational documentary look, available light",
  "handheld-doc": "handheld camera, natural unstabilised movement",
  anime2d: "2D cel animation, flat colour, clean line art",
  anime3d: "3D animated feature look, stylised shading",
  noir: "film noir, hard shadows, deep blacks, venetian blind light",
  dreamy: "soft diffusion, gentle bloom, hazy atmosphere",
  gritty: "gritty texture, heavy grain, dirt and wear on every surface",
  mystery: "withheld information, most of the frame in shadow",
  tension: "tight framing, unresolved space just outside the frame",
  "warm-mood": "warm tungsten palette, soft golden light",
  melancholy: "muted cool palette, empty space around the subject",
  // 촬영 — 렌즈는 초점거리를 그대로 적는 것이 가장 잘 듣습니다.
  "shallow-dof": "shallow depth of field, background falling out of focus",
  "deep-focus": "deep focus, foreground and background both sharp",
  "tilt-shift": "tilt-shift, tilted plane of focus",
  "long-take": "one continuous take, no cuts",
  "rack-focus": "rack focus shifting between foreground and background",
  reflection: "seen through a reflection in glass or a mirror",
  "foreground-frame": "framed through a foreground object in the near field",
  // 조명
  "light-three-point": "three-point lighting, key, fill and rim",
  "light-key": "single key light, unfilled shadow side",
  "light-rim": "rim light separating the subject from the background",
  "light-back": "backlight behind the subject",
  silhouette: "silhouette against a bright background",
  "light-top": "top light from directly above",
  "light-under": "light from below the face",
  "light-side": "hard side light, half the face in shadow",
  "light-rembrandt": "Rembrandt lighting, a small triangle of light on the shadow cheek",
  "light-soft": "large soft source, gentle wrap around the face",
  "light-hard": "hard undiffused source, sharp shadow edges",
  "light-bounce": "bounced light off a nearby surface",
  "light-practical": "practical lights visible in the frame as the only sources",
  "light-gobo": "patterned shadow cast across the subject",
  "light-low-key": "low key, most of the frame in shadow",
  "light-high-key": "high key, bright and evenly lit",
  // 색·시간
  "golden-hour": "golden hour, low warm sun, long shadows",
  "blue-hour": "blue hour, cool ambient light after sunset",
  daylight: "midday daylight, high sun",
  overcast: "flat overcast daylight, no sun, low contrast",
  night: "night exterior, darkness beyond the practical lights",
  neon: "neon signage, saturated colour reflections on wet surfaces",
  candlelight: "candlelight, flickering warm low light",
  moonlight: "moonlight, cool low-level illumination",
  "warm-grade": "warm colour grade",
  "cool-grade": "cool colour grade",
  desaturated: "muted desaturated palette",
  "high-contrast": "high contrast, crushed blacks",
  // 질감 — 플라스틱 얼굴을 되돌리는 칸.
  "skin-pores": "natural visible pores, subtle uneven skin texture, fine peach fuzz",
  "skin-flaws": "freckles and small blemishes, slight redness on the cheeks and nose",
  "skin-oil": "slight sheen of oil on the forehead and nose",
  "skin-lines": "fine lines around the eyes, natural forehead lines",
  "no-retouch": "unretouched skin, no beauty retouching",
  "eye-catchlight": "clear catchlight in both eyes from the key light",
  "eye-wet": "wet lower lid, visible eyelash roots, individual lashes",
  "hair-strands": "irregular hairline, a few flyaway strands",
  "film-grain": "fine film grain",
  halation: "subtle halation around the brightest highlights",
  "micro-shake": "handheld micro-shake",
  candid: "candid unposed moment, slightly off-centre framing",
};

/**
 * 프롬프트에 그대로 넣을 영어 조각. 없으면 빈 글자입니다 —
 * **한국어 라벨을 그대로 흘려보내지 않습니다.** 영문 프롬프트에 한국어가 섞이면
 * 생성기가 그 부분만 통째로 무시합니다.
 */
export function cutToggleEnglish(id: string): string {
  if (ENGLISH[id]) return ENGLISH[id];
  // 렌즈는 id 가 곧 초점거리입니다 — 여든 줄을 적지 않으려고 여기서 만듭니다.
  const lens = /^lens-(\d+)$/.exec(id);
  return lens ? `shot on a ${lens[1]}mm lens` : "";
}

/** 켜 둔 토글들을 영어 한 줄로. 빈 것은 버립니다. */
export function cutTogglesEnglish(ids: string[]): string {
  return ids.map(cutToggleEnglish).filter(Boolean).join(", ");
}
