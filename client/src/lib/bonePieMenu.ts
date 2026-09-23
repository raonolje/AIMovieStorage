import { FINGER_NAMES, type FingerName } from "@/lib/composition";
import { FINGER_LABELS } from "@/lib/rig";

/**
 * 관절 파이 메뉴의 **차림표** — 몸을 따라 내려가는 계단식 목록.
 *
 *
 *
 * # 왜 데이터로 두는가
 *
 * 자리(각도)가 뜻을 가집니다. 「왼쪽은 화면 왼쪽, 다리는 아래」 라야 읽지 않고 손이 갑니다.
 * 자리를 코드가 계산하면(항목 수로 균등 분할) 항목이 하나 늘 때마다 전부 돌아가 버려서,
 * 손에 붙은 방향이 무너집니다. 그래서 **각도를 사람이 적습니다.**
 *
 * 각도는 **시계 기준**입니다 — 0이 12시, 90이 3시, 180이 6시, 270이 9시.
 *
 * # 왼쪽·오른쪽에서 이름의 «왼/오른» 을 떼는 까닭
 *
 * 「왼쪽 → 왼팔 → 왼 팔꿈치」 는 같은 말을 세 번 합니다. 이미 «왼쪽» 가지 안에 들어와
 * 있으니 거기서는 「팔」·「팔꿈치」 로 충분합니다. 한가운데에 지금 어느 가지인지 적힙니다.
 */
export interface BonePieNode {
  key: string;
  label: string;
  /** 시계 각도(0=12시, 90=3시, 180=6시, 270=9시). */
  at: number;
  /** 누르면 잡을 관절. 없으면 `children` 으로 한 단계 내려갑니다. */
  bone?: string;
  children?: BonePieNode[];
}

type Side = "Left" | "Right";

/** 손가락 하나의 세 마디. 안쪽에서 바깥으로 — 첫마디 12시, 중간 4시, 끝 8시. */
function fingerJoints(side: Side, finger: FingerName): BonePieNode[] {
  return [
    {
      key: `${side}Hand${finger}1`,
      label: "첫마디",
      at: 0,
      bone: `${side}Hand${finger}1`,
    },
    {
      key: `${side}Hand${finger}2`,
      label: "중간",
      at: 120,
      bone: `${side}Hand${finger}2`,
    },
    {
      key: `${side}Hand${finger}3`,
      label: "끝",
      at: 240,
      bone: `${side}Hand${finger}3`,
    },
  ];
}

/**
 * 다섯 손가락. **손을 펼친 모양 그대로** 부채꼴로 놓습니다.
 *
 * 왼손은 엄지가 왼쪽(10시)에서 소지가 오른쪽(2시)으로, 오른손은 그 **거울**입니다.
 * 실제 손을 손등 쪽에서 봤을 때와 같은 배치라, 어느 손인지 보지 않고도 엄지가 어디인지
 * 손이 압니다. 두 손을 같게 두면 오른손에서 매번 좌우를 되짚게 됩니다.
 */
function fingers(side: Side): BonePieNode[] {
  const left = [310, 335, 0, 25, 50];
  const spread = side === "Left" ? left : left.map((at) => (360 - at) % 360);
  return FINGER_NAMES.map((finger, index) => ({
    key: `${side}-finger-${finger}`,
    label: FINGER_LABELS[finger],
    at: spread[index],
    children: fingerJoints(side, finger),
  }));
}

/**
 * 한쪽 **팔·다리**. 몸을 따라 위에서 아래로 돕니다.
 *
 * 손가락으로 가는 길이 둘이면 «어느 쪽으로 들어왔더라» 가 생깁니다.
 * 손은 팔의 끝이니 팔 안에만 둡니다.
 */
function sideBranch(side: Side): BonePieNode[] {
  return [
    {
      key: `${side}-arm`,
      label: "팔",
      at: 0, // 위 — 팔은 어깨에서 시작합니다
      children: [
        { key: `${side}Arm`, label: "팔", at: 0, bone: `${side}Arm` },
        {
          key: `${side}ForeArm`,
          label: "팔꿈치",
          at: 90,
          bone: `${side}ForeArm`,
        },
        { key: `${side}Hand`, label: "손목", at: 180, bone: `${side}Hand` },
        {
          key: `${side}-arm-fingers`,
          label: "손가락",
          at: 270,
          children: fingers(side),
        },
      ],
    },
    {
      key: `${side}-leg`,
      label: "다리",
      at: 180, // 아래 — 다리는 몸의 아래입니다
      children: [
        { key: `${side}UpLeg`, label: "허벅지", at: 0, bone: `${side}UpLeg` },
        { key: `${side}Leg`, label: "무릎", at: 120, bone: `${side}Leg` },
        { key: `${side}Foot`, label: "발", at: 240, bone: `${side}Foot` },
      ],
    },
  ];
}

/**
 * 첫 고리 — 상체·왼쪽·오른쪽.
 *
 * 상체는 위, 왼쪽은 화면 왼쪽(9시), 오른쪽은 화면 오른쪽(3시). **화면 기준**입니다 —
 * 인물이 이쪽을 보고 있으면 인물의 왼팔이 화면 오른쪽에 오지만, 손이 가는 곳은 화면이라
 * 화면을 기준으로 두는 편이 헷갈리지 않습니다.
 */
export const BONE_PIE_ROOT: BonePieNode[] = [
  {
    key: "torso",
    label: "상체",
    at: 0,
    children: [
      { key: "Head", label: "머리", at: 0, bone: "Head" },
      { key: "Neck", label: "목", at: 72, bone: "Neck" },
      { key: "Spine2", label: "가슴", at: 144, bone: "Spine2" },
      { key: "Spine", label: "허리", at: 216, bone: "Spine" },
      { key: "Hips", label: "골반", at: 288, bone: "Hips" },
    ],
  },
  { key: "left", label: "왼쪽", at: 270, children: sideBranch("Left") },
  { key: "right", label: "오른쪽", at: 90, children: sideBranch("Right") },
];

/** 어느 관절이 어느 가지에 있는지 — 창을 열 때 그 자리부터 보여 주려고 씁니다. */
export function bonePiePath(bone: string | null): BonePieNode[][] {
  if (!bone) return [];
  const walk = (
    nodes: BonePieNode[],
    trail: BonePieNode[][],
  ): BonePieNode[][] | null => {
    for (const node of nodes) {
      if (node.bone === bone) return trail;
      if (node.children) {
        const found = walk(node.children, [...trail, node.children]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(BONE_PIE_ROOT, [BONE_PIE_ROOT]) ?? [];
}
