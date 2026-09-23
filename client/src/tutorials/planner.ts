import type { Tutorial, TutorialStep } from "./types";

/*
  구도잡기 튜토리얼 — 기능이 많아 «주제별» 로 나눕니다.

   한 튜토리얼이 열두 걸음을 넘으면 어디까지 봤는지
  잊습니다. 창 훑어보기 · 방과 환경 · 인물과 포즈 · 소품 · 카메라 · 타임라인 · 레퍼런스 영상 ·
  모션 캡처 · 노래 · GLB · 단축키 — 막힌 데만 골라 보게 열한 갈래입니다.

  단추·칸 이름은 PlannerChrome · LayoutPanel · EnvironmentPanel · TimelinePanel · MoveTimeline ·
  MotionCaptureDialog · PosePanel 에 적힌 그대로입니다.
*/

const P = "/project/:id" as const;

/** 구도잡기 걸음은 전부 같은 주소·같은 화면이라 두 칸을 여기서 채웁니다. */
function step(fields: Omit<TutorialStep, "route" | "page">): TutorialStep {
  return { route: P, page: "planner", ...fields };
}

const BASICS: Tutorial = {
  id: "planner-basics",
  kind: "planner",
  page: "planner",
  title: "구도잡기 창 훑어보기",
  summary: "창의 머리줄 · 비율 칩 · 세 탭 · 3D 화면 조작 · 오른쪽 위 단추 · 저장까지.",
  steps: [
    step({
      id: "planner-basics-header",
      anchor: "planner-header",
      title: "머리줄",
      body:
        "«구도 잡기» 옆에는 인물을 세우면 샷·앵글·거리 요약이 글로 뜹니다. 오른쪽에 되돌리기(Ctrl+Z) · 다시 실행(Ctrl+Shift+Z) · 닫기. Esc 도 창을 닫습니다 — 관절 고르기에서 한 걸음 뒤로는 Esc 가 아니라 Ctrl+Tab 입니다.",
    }),
    step({
      id: "planner-basics-ratio",
      anchor: "planner-ratio-chips",
      title: "3D 배치와 비율 칩",
      body: "«3D 배치» 는 비율 제한 없는 자유 화면, 1:1 · 4:3 · 3:4 · 16:9 · 9:16 · 21:9 는 캡처 프레임입니다. 구도를 저장할 때 이 프레임대로 찍힙니다.",
    }),
    step({
      id: "planner-basics-tabs",
      anchor: "planner-tabs",
      title: "배치 · 환경 · 타임라인",
      body:
        "오른쪽 패널은 탭 셋입니다. «배치» 는 인물·소품·포즈, «환경» 은 방·배경·화면 표시, «타임라인» 은 노래·모션·GLB·레퍼런스 영상. 카메라 무빙은 탭이 아니라 화면 아래 타임라인에 있습니다. 열 때마다 «배치» 부터입니다.",
    }),
    step({
      id: "planner-basics-viewport",
      anchor: "planner-viewport",
      title: "3D 화면 조작",
      body:
        "화면에서 눌러 고르기 · 왼쪽 끌기 회전 · 오른쪽(또는 가운데) 끌기 이동 · 휠 줌. 더블클릭이나 F 로 회전 중심을 옮기고(Ctrl+F 는 화면 한가운데로), W/A/S/D · Q/E 로 카메라를 걷습니다(Shift 정밀 · Alt 성큼). 이미지 · .hdr/.exr · .glb 를 화면에 끌어다 놓으면 등록됩니다.",
    }),
    step({
      id: "planner-basics-ground",
      anchor: "planner-ground-place",
      title: "바닥에 세우기",
      body:
        "켜고 바닥을 찍으면 고른 인물이 그 자리로 갑니다. 지평선 위·격자 밖은 안 됩니다. 기즈모로 x·z 를 하나씩 끄는 것보다 «저 잔디밭 저쯤» 을 짚는 편이 훨씬 빠릅니다. 배치 탭에서 인물을 먼저 골라야 합니다.",
    }),
    step({
      id: "planner-basics-floor",
      anchor: "planner-floor-toggle",
      title: "방 크기 표시와 바닥면",
      body:
        "«방 N m» 은 방 크기이며 환경 탭에서 바꿉니다. «바닥면» 은 작업용 격자만 켜고 끕니다. 그림자는 환경 탭의 «그림자 · 바닥 격자와 별도» 에서 고르며, 격자를 꺼도 유지됩니다. 레퍼런스 영상에는 작업용 격자가 나오지 않습니다.",
    }),
    step({
      id: "planner-basics-save",
      anchor: "planner-save",
      title: "구도 저장",
      body:
        "«구도 저장» 은 지금 화면을 찍어 컷에 넘기고 창을 닫습니다. 컷 카드에 프레임 그림이 붙고 «구도에서 읽음» 이 채워집니다. 구도 그림은 프로젝트 폴더에 파일로 저장되어 스토리보드에서도 씁니다.",
      why: "«다시 찍기» 단추는 없앴습니다. 저장이 곧 찍는 것이라 둘을 나눠 두면 «찍는 것과 저장하는 것이 다른가» 하는 오해만 남겼습니다.",
    }),
    step({
      id: "planner-basics-undo",
      anchor: "planner-undo",
      title: "되돌리기",
      body: "Ctrl+Z 는 창 안 모든 편집에 듣습니다 — 인물 자리, 방 치수, 키, 모션 넣기까지. 손잡이를 끄는 동안은 한 동작으로 묶여, 한 번 끌기가 되돌리기 한 칸입니다.",
    }),
  ],
};

const ROOMS: Tutorial = {
  id: "planner-rooms",
  kind: "planner",
  page: "planner",
  title: "방과 환경",
  summary: "환경 탭 — 방 세우기, 치수, 돔과 방형, 가릴 면, 전개도·파노라마 만들기, 6면 세트, 방 라이브러리.",
  steps: [
    step({
      id: "planner-rooms-add",
      anchor: "env-room-add-indoor",
      title: "실내 · 실외 · 호리존",
      body:
        "새 컷에는 방이 없습니다 — 구도만 잡는 컷입니다. «실내» 는 여섯 면을 붙일 방(이미 방이 있으면 오른쪽에 벽을 맞대어 섭니다), «실외» 는 파노라마 한 장을 두르는 돔(한 변 100 m 공터로 섭니다), «호리존» 은 그림 없이 색 하나로 잇는 제품 컷 스튜디오입니다. 배경이 한쪽만 필요하면 방 대신 배치 탭의 «벽» 이 더 빠릅니다.",
    }),
    step({
      id: "planner-rooms-list",
      anchor: "env-room-list",
      title: "방 목록",
      body:
        "방을 누르면 그 아래가 펴지고 거기부터가 그 방의 속성입니다. 이름은 두 번 누르거나 연필로 고치고, 눈으로 잠시 숨기고, 휴지통으로 지웁니다(Ctrl+Z 로 되살림). 방이 둘 이상이면 «자리»(가로·깊이·높이·회전°)가 보이고, 3D 에서 Shift 로 방을 잡아 옮길 수도 있습니다.",
    }),
    step({
      id: "planner-rooms-size",
      anchor: "env-room-size",
      title: "치수 — 방 크기가 곧 축척",
      body:
        "실내는 가로 · 깊이 · 층고, 돔은 반지름 하나입니다. 밑면이 바닥이라 인물이 뜨지 않고, 크기를 줄이면 인물이 차지하는 비율이 커져 배경보다 커 보입니다. 이미지는 이 숫자대로 뽑히므로(프롬프트에 미터가 박힘) 인물을 놓고 눈으로 본 뒤 여기서 확정하세요.",
    }),
    step({
      id: "planner-rooms-drift",
      anchor: "env-room-drift",
      title: "배경 흐름 — 배경을 움직이게",
      body:
        "면·돔 그림은 정지 이미지라, 그대로 두면 레퍼런스 영상에 배경 움직임이 한 프레임도 안 찍힙니다. «배경 흐름» 을 켜고 방향과 속도를 주면 그림이 흘러 구름이 지나가고 차창 밖 풍경이 뒤로 갑니다. 기본은 꺼짐이고, 속도는 «한 바퀴 몇 초» 로 가늠하세요.",
      why: "영상 모델은 레퍼런스의 배경이 멈춰 있으면 그대로 따라 배경을 얼립니다. 재생·눈금 끌기·레퍼런스 영상에 그 시각대로 똑같이 찍힙니다.",
    }),
    step({
      id: "planner-rooms-video",
      anchor: "env-room-video",
      title: "배경 영상 — 면에 영상을 걸기",
      body:
        "흐름은 그림 전체가 한 방향으로 미끄러지는 것뿐이라 구름·터널 조명에는 맞지만 지나가는 차·파도·사람에는 모자랍니다. «배경 영상» 을 켜고 면(돔은 전체)을 고른 뒤 영상을 걸면 그 면이 진짜로 움직입니다. 걸 영상이 없으면 «이 면 그림으로 영상 만들기» 가 그 면 그림을 첫 프레임 삼아 2~4초 루프를 만들어 바로 걸어 줍니다.",
      why: "흐름과 따로 켜고 끕니다 — 함께 켜면 흐르면서 움직입니다. 재생·눈금 끌기·레퍼런스 영상에 그 시각의 프레임이 그대로 찍힙니다.",
    }),
    step({
      id: "planner-rooms-horizon",
      anchor: "env-horizon-color",
      title: "호리존 색",
      body: "호리존 방은 «호리존 색» 을 고르면 여섯 면 전부가 그 색으로 이어집니다. 컷 프롬프트에는 «이음매 없는 단색 배경(색 #…)» 으로 실립니다. 제품은 아래 «이 방의 소품» 으로 세웁니다.",
    }),
    step({
      id: "planner-rooms-shape",
      anchor: "env-outdoor-shape",
      title: "실외 — 돔이냐 방형이냐",
      body:
        "«무엇으로 두를까» 에서 «돔 (파노라마 한 장)» 은 카메라가 제자리에서 돌 때(이음매·시차 없음), «방형 (6면 세트)» 는 카메라가 옮겨 다닐 때(앞뒤·가림이 맞음) 씁니다. 돔은 한가운데 눈높이 1.6 m 에서 가장 정확하고 멀어지면 바닥이 번집니다.",
    }),
    step({
      id: "planner-rooms-occlude",
      anchor: "env-occlude-faces",
      title: "뒤를 가릴 면 · 외벽 투시",
      body:
        "실내만 있습니다. 누른 면만 벽이 되어 뒤를 가립니다. «방 밖에서 외벽 투시» 는 외벽 그림을 붙인 방을 밖에서 볼 때 안에 선 인물을 가리는 외벽만 반투명하게 걷습니다(기본 켜짐). 시간대별로 바꾸려면 아래 타임라인의 «방 · 가릴 면 · 소품» 줄에 키를 찍습니다.",
    }),
    step({
      id: "planner-rooms-place",
      anchor: "env-room-make-image",
      title: "전개도 만들기 · 파노라마 만들기",
      body:
        "«이 공간의 장소» 에서 «전개도 만들기» 또는 «파노라마 만들기» 를 누르면 지금 방 치수가 담긴 장소 카드가 열립니다. 생성한 전개도를 등록하면 6면을 검사하고, 빠진 면·비율·회색 여백이 의심되면 자동 커팅을 멈춥니다. 알림을 확인하고 가위 → «전개도 6면» 에서 선을 맞추거나 다시 생성하세요. 기존 장소는 목록에서 골라 «열기» 로 수정합니다.",
      why: "이름이 «…외벽» 인 세트는 바깥 껍질로, 아니면 안쪽으로 갑니다. 각각 비어 있을 때만 걸어 사람이 걸어 둔 것은 덮지 않습니다.",
    }),
    step({
      id: "planner-rooms-panorama",
      anchor: "env-panoramas",
      title: "파노라마 그림 (실외)",
      body:
        "실외 방에는 «파노라마 그림» 목록이 있습니다. 누르면 이 실외의 돔이 되고, «돔 풀기» 로 뗍니다. 밖에서 만든 360° 그림은 «불러오기» 나 끌어다 놓기로 넣습니다 — 2:1 등장방형이 가장 잘 맞습니다(앱에서 뽑은 16:9 는 위아래가 조금 눌립니다).",
    }),
    step({
      id: "planner-rooms-facesets",
      anchor: "env-face-sets",
      title: "6면 세트 (실내)",
      body:
        "잘린 세트를 누르면 여섯 면이 한 번에 걸립니다(«걸림» 표시). 면이 모자란 세트는 그 면을 비워 둡니다. «그림 전체보기» 는 배경 라이브러리 창 — 세트와 전개도 원본을 큰 화면으로 훑고 면에 직접 붙입니다.",
    }),
    step({
      id: "planner-rooms-props",
      anchor: "env-room-props",
      title: "이 방의 소품",
      body:
        "방에 딸린 배경 소품은 여기서 세웁니다(캐릭터 쪽 소품은 배치 탭). «붙일 면» 을 고르면 그 면에 닿아 방을 넓혀도 따라붙고, «투시» 를 켜면 뒤가 비치고 카메라를 막지 않습니다. «이 소품의 에셋 만들기» 는 에셋 카드를 만들어 이 소품에 바로 잇습니다.",
    }),
    step({
      id: "planner-rooms-library",
      anchor: "env-room-library",
      title: "장소 라이브러리 · 방 라이브러리",
      body:
        "«장소 라이브러리 — 관계도 · 보유 에셋» 은 씬 탭에 있던 배경 화면 그대로(계보 · 다른 원본 · 보유 에셋)를 창으로 엽니다. «방 라이브러리» 의 «지금 방 저장 — 방 + 안의 소품까지» 는 치수·여섯 면·소품·묶음·이어 둔 에셋을 한 덩어리로 담고, 누르면 다른 컷에서 그대로 세웁니다. 목록은 이 작품 것만이고 «다른 작품에서 방 끌어오기» 로 복사해 들여옵니다.",
    }),
    step({
      id: "planner-rooms-shadows",
      anchor: "env-shadows",
      advanceOn: "manual",
      title: "그림자 — 격자와 따로 고르기",
      body: "«자동 · 접지 그늘 · 방향광 · 끄기» 중 고르고 «그림자 세기» 와 «그림자 부드러움» 을 조절합니다. 자동은 사진을 붙인 방에서 접지 그늘을, 그 밖에는 방향광을 씁니다. 접지 그늘은 수평 바닥의 발 위치를 따르는 근사 표시이며 계단·소품의 정확한 그림자는 아닙니다. 이 선택은 구도 그림과 레퍼런스 영상에도 반영됩니다.",
      action: "해 볼 것: «접지 그늘» 과 «방향광» 을 비교하고 세기를 조절한 뒤, 바닥면을 꺼도 그림자가 남는지 보세요.",
    }),
    step({
      id: "planner-rooms-display",
      anchor: "env-display",
      title: "화면",
      body: "«이름표 — 캡처·영상에는 나오지 않습니다» · «인물 동선» · «배경 밝기 — 하늘 조명이 없을 때» 를 켜고 끕니다. 보기 설정일 뿐 프롬프트에는 안 갑니다.",
    }),
  ],
};

const CHARACTERS: Tutorial = {
  id: "planner-characters",
  kind: "planner",
  page: "planner",
  title: "인물 배치와 포즈",
  summary: "배치 탭 — 인물 목록, 마네킹, 키·체격·몸 색, 기즈모, 동선, 관절 고르기, 손 모양, 내 프리셋.",
  steps: [
    step({
      id: "planner-characters-list",
      anchor: "layout-characters",
      title: "인물 목록",
      body:
        "이 작품의 인물이 번호 색동그라미 · 이름 · 키cm 로 섭니다. 눈 단추가 «이 컷에서 빼기» — 프로젝트 인물은 지우지 않습니다. Ctrl 을 누르고 누르면 여럿을 함께 잡아 색을 한 번에 바꿉니다. «+ 남성형» «+ 여성형» 은 마네킹이고 «마네킹 제거» 로 지웁니다.",
    }),
    step({
      id: "planner-characters-mannequins",
      anchor: "layout-mannequins",
      title: "«+ 남성형» «+ 여성형» — 이름 없는 사람 자리",
      body: "작품에 등록한 인물 말고도 «사람 하나가 여기 선다» 를 세울 수 있습니다. 이 둘이 그것입니다 — 남성형·여성형 마네킹이 화면 한가운데에 서고, 목록에 «마네킹 1» 처럼 줄이 생깁니다. 지나가는 행인, 크기를 견줄 기준, 아직 정하지 않은 상대역에 씁니다. 마네킹 줄에는 × 가 하나 더 있어 목록에서 바로 구도에서 뺍니다.",
      action: "해 볼 것: «+ 남성형» 을 눌러 마네킹을 하나 세워 보세요.",
      why: "인물 카드를 만들지 않고도 사람 크기를 견줄 수 있어야 합니다 — 방 치수가 맞는지는 사람을 세워 봐야 압니다.",
    }),
    step({
      id: "planner-characters-fields",
      anchor: "layout-character-fields",
      title: "인물 이름 · 키 · 체격",
      body:
        "고른 인물의 칸이 목록 바로 아래에서 열립니다. 마네킹은 이름·키·체격(슬림·보통·덩치 큰)을 여기서 정하고, 프로젝트 인물의 체격은 캐릭터 카드에서 정합니다. 키는 마네킹 크기 자체라 크기 기즈모로는 안 바꿉니다.",
    }),
    step({
      id: "planner-characters-color",
      anchor: "layout-body-color",
      title: "몸 색",
      body:
        "«자동» 이면 인물마다 색을 나누고, 색 칩이나 고르개로 고정합니다. 작업 화면과 구도 그림의 색은 인물을 구분하는 표식입니다. 레퍼런스 영상은 회색 마네킹으로 뽑으며, 최종 피부·머리·옷은 캐릭터 시트로 지정합니다. 마네킹 색을 실제 의상으로 쓰지 마세요.",
    }),
    step({
      id: "planner-characters-gizmo",
      anchor: "layout-gizmo-mode",
      title: "수치 입력 — 이동 · 회전 · 크기",
      body:
        "«수치 입력» 줄의 이동 · 회전 · 크기는 1 · 2 · 3 키와 같고, 자유 · 바닥 · 높이는 Ctrl+1·2·3 입니다. «바닥» 은 바닥에 붙여 좌우·앞뒤로만, «높이» 는 위아래로만. 위치·회전 숫자 칸은 접혀 있고 맞춰야 할 때만 폅니다. «위치·회전 초기화» 로 되돌립니다.",
    }),
    step({
      id: "planner-characters-path",
      anchor: "layout-path",
      title: "캐릭터 동선",
      body:
        "«캐릭터 동선 (N)» 의 + 는 지금 서 있는 자리를 동선 점으로 더하고, 눈으로 3D 화면에 길을 보이거나 숨기며, 휴지통으로 전부 지웁니다. 재생 중 인물이 어디 있는지는 타임라인의 이동 키가 정합니다.",
    }),
    step({
      id: "planner-characters-tab",
      anchor: "bone-picker",
      title: "Tab — 관절 고르기",
      body:
        "인물을 잡고 Tab 을 누르면 마우스 자리에 파이 메뉴가 뜹니다. 고리를 따라 상체 · 왼쪽 · 오른쪽 · 손가락으로 들어가고, 한 걸음 뒤로는 Ctrl+Tab, 닫기는 Tab. 고른 관절에 3D 기즈모(빨·초·파 링)가 붙습니다. 다른 것을 잡았다가 다시 잡으면 처음부터입니다.",
      why: "Esc 로 뒤로 가게 하면 첫 고리에서 한 번 더 눌렀을 때 구도잡기 창이 통째로 닫혔습니다.",
    }),
    step({
      id: "planner-characters-joints",
      anchor: "layout-joints",
      title: "관절 세부 조정",
      body:
        "«관절을 고르면 3D 화면에 기즈모가 붙습니다 · N개 조정됨». 접이 그룹(상체 · 왼쪽 · 오른쪽 · 왼손 손가락 · 오른손 손가락)에서 관절을 고르면 X축 · Y축 · Z축 숫자와 행별 초기화가 뜹니다 — 색은 기즈모 링 색과 같고 0° 가 프리셋 원래 자세입니다. «미세 조정» 은 2cm · 2° 단위로 끊어 움직입니다. IK 이동은 없고 회전만입니다.",
    }),
    step({
      id: "planner-characters-pose-image",
      anchor: "layout-pose-from-image",
      title: "그림에서 포즈 가져오기",
      body:
        "사진 · 만화 · 실루엣 한 장을 끌어다 놓거나 프로젝트 그림(레퍼런스로 등록한 시트)에서 골라 포즈를 통째로 가져옵니다. 막대 인간은 못 읽습니다. 가져온 뒤 어긋난 관절만 아래에서 고치세요.",
    }),
    step({
      id: "planner-characters-hands",
      anchor: "layout-hands",
      title: "손 모양",
      // 내장 손 프리셋은 PosePanel 에서 걷어냈습니다 — 화면에 있는 것만 적습니다.
      body:
        "«손 모양» 판은 왼손 · 오른손 토글로 어느 손을 다룰지 고릅니다. 손가락은 위 «관절 세부 조정» 의 «왼손 손가락» «오른손 손가락» 그룹에서 마디를 골라 각도로 맞춥니다. 아래 «현재 각도 (Y / Z°)» 표가 열다섯 마디의 굽힘(Z)·벌림(Y)을 한눈에 보여 주고, «이 손 전체 펴기» 로 편 손으로 되돌립니다. 다 맞췄으면 «현재 자세 저장» 으로 내 프리셋에 담아 두세요.",
      why: "보자기 · 주먹 · 가위 같은 내장 프리셋과 폄 · 반 · 접음 3단계는 걷어냈습니다 — 손가락마다 굽는 축이 달라 각도 계산이 계속 틀어졌습니다. 직접 맞춰 저장한 값은 틀어질 일이 없습니다.",
    }),
    step({
      id: "planner-characters-presets",
      anchor: "layout-presets",
      title: "내 프리셋",
      body:
        "내장 포즈 목록은 없습니다. 자세를 맞춘 뒤 «+ 현재 자세 저장» 으로 이름 · 그룹 · 종류(전체 · 몸통·팔다리 · 손 모양)를 적어 저장하면 단추가 됩니다. 손은 «왼손 기준 · 오른손 기준» 으로 저장해 반대 손에는 뒤집어 적용합니다. 단추는 끌어서 순서를 바꾸고, × 는 «저장 폴더의 원본 파일도 함께 지워집니다» 를 묻습니다.",
      why: "프리셋 파일은 설정의 포즈 프리셋 폴더에 갑니다. 폴더가 없으면 «이 브라우저에만 저장됩니다» 경고가 뜹니다.",
    }),
    step({
      id: "planner-characters-cleanup",
      anchor: "layout-mocap-cleanup",
      title: "모캡 키 다듬기",
      body:
        "영상에서 모션을 넣은 인물에는 «모캡 키 다듬기» 가 뜹니다. 둔하게 · 보통 · 예민하게로 민감도를 두고, «자동 다듬기» 는 지그재그·외톨이 튐을 규칙으로 잇고, «AI 분석 다듬기» 는 구간 숫자표를 LLM 에 보내 «인식 오류 / 의도한 빠른 동작» 을 가려 오류만 잇습니다. Ctrl+Z 로 되돌립니다.",
    }),
  ],
};

const OBJECTS: Tutorial = {
  id: "planner-objects",
  kind: "planner",
  page: "planner",
  title: "소품 · 조명 · 에셋",
  summary: "배치 탭의 소품 — 세우기, 묶기, 색, 관절에 붙이기, 시트로 바꿔 그리기, 조명, 벽 그림.",
  steps: [
    step({
      id: "planner-objects-kinds",
      anchor: "layout-object-kinds",
      title: "세우기 — 벽 · 박스 · 구 · 실린더 · 핀 조명 · LED 조명",
      body: "«소품 · 조명» 의 단추를 누르면 화면 한가운데에 섭니다. 테이블·크레이트는 없습니다 — 상자를 눌러 만들고 여러 개를 묶으면 됩니다. 조명을 안 세우면 «스카이 조명 사용 중» 입니다.",
    }),
    step({
      id: "planner-objects-list",
      anchor: "layout-objects",
      title: "목록 — 이름 · 숨기기 · Ctrl 로 여럿",
      body: "이름은 두 번 눌러 고치고, 눈으로 잠시 숨기고, 휴지통으로 지웁니다. Ctrl(맥은 ⌘)을 누르고 누르면 함께 잡히고, 둘 이상이면 아래에 «함께 잡은 N개를 한 덩어리로» 가 뜹니다.",
    }),
    step({
      id: "planner-objects-group",
      anchor: "layout-object-group",
      title: "덩어리",
      body:
        "묶으면 목록에서 한 줄로 서고 끌면 통째로 움직입니다(회전·크기는 한가운데를 축으로). 덩어리를 고르면 색 · 이름 · «무엇으로 바꿀까요 — 예: 바닥에 깔린 옅은 안개» · 묶음 에셋만 뜨고, «풀기» 로 풉니다(소품은 남음).",
    }),
    step({
      id: "planner-objects-fields",
      anchor: "layout-object-swap",
      title: "고른 소품 — 수치 · 색 · 무엇으로 바꿔 그릴까",
      body:
        "«수치 입력 · 색» 은 접혀 있고 위치 · 회전 · 크기(가로 · 높이 · 깊이)와 «위치·회전·크기 모두 초기화». 색은 화면 구분용이면서 프롬프트의 낱말이라 «the red box = 가방» 처럼 실립니다. «무엇으로 바꿔 그릴까 — 만들어 둔 시트» 에서 에셋 시트를 고르면 «이 자리에 «수화의 검» 을 그려라» 가 프롬프트에 들어가고, 안 고르면 이름만 나갑니다.",
    }),
    step({
      id: "planner-objects-asset",
      anchor: "layout-object-asset",
      title: "이 소품의 에셋 만들기",
      body:
        "박스 · 구 · 실린더에만 있습니다. 누르면 에셋 카드가 소품 이름 그대로 생기고 이 소품에 걸린 채로 열립니다. 이미 걸어 둔 에셋이 있으면 «열기 — 시트 뽑기». 띄우는 목록은 캐릭터·장소 화면의 공용 에셋 목록과 같습니다.",
    }),
    step({
      id: "planner-objects-attach",
      anchor: "layout-attach-bone",
      title: "인물에 붙이기",
      body:
        "«인물에 붙이기 — 포즈를 따라 함께 움직입니다» 에서 인물과 관절(오른손 · 왼손 · 팔뚝 · 머리 · 목 · 가슴 · 허리 · 발)을 고르면 좌표의 뜻이 그 관절 기준으로 바뀌고 자리가 0 으로 돌아갑니다. «손잡이 자리(m)» 는 소품 안에서 관절에 닿는 점 — 검은 손잡이가 손에 잡혀야지 한가운데가 잡히면 안 됩니다.",
    }),
    step({
      id: "planner-objects-light",
      anchor: "layout-light",
      title: "조명",
      body: "조명을 고르면 종류(하늘 · 포인트 · 스팟 · 면광) · 세기 · 색이 뜹니다. 하늘 조명이 없을 때의 배경 밝기는 환경 탭 «화면» 에 있습니다.",
    }),
    step({
      id: "planner-objects-wall",
      anchor: "layout-wall-image",
      title: "벽과 이 벽의 그림",
      body:
        "«벽» 을 세워 크기를 맞추면 «이 벽의 그림» 에 인물에서 몇 m 뒤인지가 뜹니다. «그림 고르기 — 만들어 둔 것» 에서 붙이거나 «이 크기로 배경 그림 만들기» 로 벽 크기와 거리가 적힌 장소 카드를 엽니다. 한 컷에 필요한 배경은 대개 정면 한 장이라, 여섯 면을 다 갖춘 방은 카메라가 도는 컷에서만 필요합니다.",
    }),
    step({
      id: "planner-objects-transparent",
      anchor: "env-room-props",
      title: "붙일 면 · 투시 (방 소품)",
      body:
        "방에 딸린 소품은 환경 탭의 «이 방의 소품» 에서 «붙일 면»(바닥 · 벽 · 천장)을 고르면 닿는 축만 방이 잡고, «투시» 를 켜면 뒤가 비치고 카메라를 막지 않습니다. 시간대별로는 타임라인의 그 소품 줄에 키를 찍습니다.",
    }),
  ],
};

const CAMERA: Tutorial = {
  id: "planner-camera",
  kind: "planner",
  page: "planner",
  title: "카메라와 샷",
  summary: "렌즈 화각, 조작 속도, 저장한 카메라, 무빙의 출발 구도, 앵커.",
  steps: [
    step({
      id: "planner-camera-fov",
      anchor: "planner-camera-fov",
      title: "샷 크기 — 렌즈 화각",
      body:
        "망원(약 75mm) · 준망원 · 표준(약 33mm, 기본) · 광각 · 초광각(약 14mm). 화각을 바꾸면 인물도 배경도 화면 크기가 똑같이 변해 둘의 비율이 안 틀립니다 — «구도를 유지한 채 원거리·근거리» 의 정답입니다. 카메라를 앞뒤로 빼는 것(달리)은 그 비율 자체를 바꿉니다.",
    }),
    step({
      id: "planner-camera-speed",
      anchor: "planner-camera-speed",
      title: "조작 속도 — 회전 · 이동 · 줌",
      body: "회전 감도는 화각으로 자동으로 잡히고 여기서 정한 배수가 그 위에 곱해집니다. 걷기는 Shift 로 0.3배(정밀), Alt 로 3배입니다.",
    }),
    step({
      id: "planner-camera-focus",
      anchor: "planner-camera-hint",
      title: "F · Ctrl+F · M · G",
      body:
        "더블클릭이나 F 는 회전 중심을 그 점으로, Ctrl+F 는 화면 한가운데로 옮깁니다. M 은 보던 방향 그대로 고른 것 앞으로 카메라를 글라이드합니다(화면에 꽉 차는 거리). G 는 활성 구도(저장한 카메라)로 돌아갑니다.",
    }),
    step({
      id: "planner-camera-shots",
      anchor: "planner-shot-save",
      title: "저장한 카메라 — 지금 구도 저장",
      body:
        "화면을 맞춘 뒤 «지금 구도 저장» 을 누르면 목록에 쌓입니다. 눌러서 그 구도로 바로 돌아오고, 이름은 두 번 눌러 고치며, 재저장 단추는 «이 구도를 지금 카메라로 덮어씁니다». 이 구도가 카메라 무빙의 출발점입니다 — 저장한 카메라가 없으면 무빙을 놓을 수 없습니다.",
    }),
    step({
      id: "planner-camera-presets",
      anchor: "bottom-shot-presets",
      title: "무빙 아이콘 — 달리 · 오빗 · 팬 · 휩 팬 · 틸트 · 트럭 · 크레인 · 줌 · 달리 줌 · 자유 경로",
      body:
        "타임라인 위의 아이콘을 누르면 클립이 더해지고, 끌어서 클립 위에 놓으면 그 클립의 무빙이 바뀝니다(자리와 길이는 그대로). 앵커를 쓰는 무빙(오빗 · 달리)만 노란 기가 돕니다 — 팬 · 틸트 · 트럭 · 크레인 · 줌은 앵커와 무관합니다. 달리 인/아웃은 이동량의 부호 차이라 하나로 합쳐져 있습니다.",
    }),
    step({
      id: "planner-camera-start",
      anchor: "bottom-clip-start",
      title: "출발 구도 — «이어서»",
      body:
        "클립 왼쪽 칸이 어느 저장 구도에서 출발할지입니다. 비워 두면(«이어서») 앞 클립이 끝난 자세에서 이어지고, 고르면 그 시각에 컷이 바뀝니다 — 한 타임라인에 카메라 여러 대를 세우는 셈입니다. 첫 클립만 출발 카메라가 자동으로 붙습니다.",
    }),
    step({
      id: "planner-camera-anchor",
      anchor: "bottom-anchor",
      title: "앵커 — 무엇을 중심으로 돌까",
      body:
        "앵커 X/Y/Z 는 늘 보이고 손으로 적을 수 있습니다. 배치 탭에서 대상을 고르면 «…의 머리 · 가슴 · 허리 · 발» 로 붙이고, «따라가기» 를 켜면 걸어가는 사람을 돌며 찍습니다. «손으로» 는 앵커를 3D 에서 끌어 옮기는 기즈모입니다. «앵커: 내 것 · 전부 첫 클립 · 다른 클립» 은 이 클립이 어느 앵커를 따를지 — A 키로도 넘깁니다.",
      why: "발밑이 아니라 가슴 높이가 기본인 까닭 — 사람을 중심으로 돌 때 발밑을 축으로 잡으면 머리가 화면 밖으로 휘둘립니다.",
    }),
    step({
      id: "planner-camera-warnings",
      anchor: "bottom-timeline",
      advanceOn: "manual",
      title: "카메라 경로 경고 — 시각을 눌러 확인",
      body: "타임라인 위 경고는 카메라 클립 없는 구간, 총 길이 밖으로 나간 끝부분, 표시된 상자 방의 경계 통과를 알려 줍니다. 경고를 누르면 해당 시각으로 이동하고, 클립 경고는 그 클립도 고릅니다. 이동량이나 길이를 자동으로 고치지는 않습니다. 경계 검사는 표본 경로 기준이며 대상 따라가기는 실제 재생으로 확인하세요.",
      action: "해 볼 것: 경고가 있으면 눌러 그 시각의 구도를 보고, 필요한 경우 클립 길이나 이동량을 직접 조절하세요.",
    }),
    step({
      id: "planner-camera-options",
      anchor: "bottom-axis",
      title: "축 · 앵커 보기 · 손떨림",
      body:
        "«축: 수평» 은 사람 주위를 돌고, «수직» 은 위아래로 넘어가며, «나선» 은 둘 다. «앵커 보기» 를 켜면 앵커가 화면 한가운데로 오고, 끄면 잡아 둔 구도를 지킨 채 움직입니다. «앵커 표시» 는 3D 의 십자. «손떨림» 은 0% 삼각대 · 12% 어깨 · 25% 손으로 든 다큐 · 50% 뛰면서 · 80% 흔들어 찍는 액션.",
    }),
  ],
};

const TIMELINE: Tutorial = {
  id: "planner-timeline",
  kind: "planner",
  page: "planner",
  title: "타임라인 · 키 · 재생",
  summary: "화면 아래 무빙 타임라인 — 접기, 길이·fps, 재생, 클립 손잡이, 키, 속도 그래프, 인물·방 레이어.",
  steps: [
    step({
      id: "planner-timeline-collapse",
      anchor: "bottom-collapse",
      title: "높이 조절 · 접기 · 펴기",
      body: "펼친 타임라인의 위쪽 손잡이를 위아래로 끌어 높이를 조절합니다. 트랙이 많으면 판 안에서 스크롤합니다. «접기» 또는 Ctrl+Space로 접어도 재생 단추와 시각은 남고, 다시 펴면 마지막 높이를 유지합니다.",
    }),
    step({
      id: "planner-timeline-duration",
      anchor: "bottom-duration",
      title: "총 길이 · 프레임 수 · 배율",
      body:
        "왼쪽 칸의 초를 누르면 «타임라인 총 길이» 를, «24f» 를 누르면 «프레임 수»(실사 24 · 방송 30 · 게임 60)를 입력합니다. 줄여도 클립은 안 지워지고 밖으로 밀려나 안 보일 뿐입니다. 배율은 + / − 키나 배율 단추로 — 모캡 키가 따닥따닥 들어갔을 때 옆으로 늘려 집습니다.",
    }),
    step({
      id: "planner-timeline-play",
      anchor: "bottom-play",
      title: "재생 · 스페이스 · 스크럽",
      body:
        "«재생» 이나 스페이스로 돌리고, 재생 중에는 타임라인 어디를 눌러도 멈춥니다. 눈금자는 누른 채 끌면 따라옵니다. 앞 · 다음 키프레임 단추로 정확히 그 자리로 갑니다 — 손으로 맞추면 0.05초씩 어긋나 새 키가 생깁니다. 재생 중에는 3D 왼쪽 위에 «카메라 무빙 미리보기» 배지가 뜨고, 화면을 돌리면 해제됩니다.",
    }),
    step({
      id: "planner-timeline-clip",
      anchor: "bottom-clip-amount",
      title: "클립 — 이동량 · 길이",
      body:
        "프리셋 클립은 «지금 자세에서 얼마나» 라 손잡이가 셋입니다 — «이동량»(도 · 배율 · 미터) · «길이»(초) · 속도 그래프. 몸통을 끌면 시각, 오른쪽 끝을 끌면 길이, 두 번 누르면 초 입력, 골라 두고 Delete 로 삭제. ▲▼ 로 줄 차례를 바꾸고, 눈으로 잠시 끕니다. 오빗 90도도 이동량을 45로 바꾸면 그만입니다.",
    }),
    step({
      id: "planner-timeline-keys",
      anchor: "bottom-clip-length",
      title: "이동량 키 · 자유 경로 키",
      body:
        "클립 중간에 속도를 꺾고 싶을 때만 이동량 키를 씁니다(«+ 키 전부» 는 재생 머리 자리에 지금 카메라를 통째로). 자유 경로는 «카메라 자리(m)» «바라보는 곳(m)» «줌(배율)» 세 줄에 키가 따로 서고, 재생 머리를 옮기고 3D 에서 카메라를 움직이면 자동으로 키가 됩니다. 키는 한 번 누르면 값 판이 열리고, 끌어서 옮기고, Delete 로 지웁니다. 여럿을 잡으면 «키 N개 잡음» 이 뜨고 함께 움직입니다.",
    }),
    step({
      id: "planner-timeline-easing",
      anchor: "bottom-easing",
      title: "속도 그래프",
      body:
        "«속도 그래프» 는 이 키에서 다음 키까지의 완급입니다 — 프리셋 칩(리니어 · 이즈 인·아웃 · 슬로우 스타트 · 급가속 후 정지 · 예비 동작 · 오버슛…)과 곡선. 마지막 키를 고르면 «마지막 키 — 뒤 구간이 없습니다» 가 뜹니다. 인물 레이어에서는 고른 키의 구간을 고칩니다.",
    }),
    step({
      id: "planner-timeline-layers",
      anchor: "bottom-layers",
      title: "인물 · 소품 레이어",
      body:
        "카메라 클립과 같은 모양입니다 — 막대가 있는 동안만 화면에 서고, 몸통을 끌면 옮기고 양 끝을 끌면 자릅니다. ▸ 로 아래 속성 줄(이동 · 회전 · 자세, 소품은 크기)을 펴고, 줄마다 + 로 지금 값을 키로 찍습니다. 눈은 잠시 끄기, ∿ 는 속도 그래프. 두 번 누르면 «나타나는 시각» 을 숫자로.",
    }),
    step({
      id: "planner-timeline-k",
      anchor: "bottom-layers",
      title: "K · Shift+K — 키 찍기",
      body:
        "대상을 고르고 1·2·3 으로 속성을 고른 뒤 K 를 누르면 화면에 보이는 값 그대로 키가 찍힙니다 — 값이 안 바뀌어 자동 키가 안 생길 때(«3초까지 그대로 있다가 4초까지 움직이기»)에 씁니다. 자세는 관절을 고른 채 K, 프리셋만 눌렀으면 Shift+K. 인물 크기는 키로 찍지 않습니다.",
    }),
    step({
      id: "planner-timeline-pose-rows",
      anchor: "bottom-layers",
      title: "자세 줄 펼치기",
      body:
        "«▸ 자세» 를 펴면 움직인 관절마다 줄이 서고 움직인 구간이 막대로 보입니다. 점을 누르면 그 시각으로 가서 그 관절을 잡고(그 자리에서 기즈모로 돌리면 자동 키), 끌면 그 관절만 옮기고, Delete 는 그 관절만 지웁니다. 접힌 자세 줄의 요약 점은 그 자리 관절 점 전부를 한 번에 움직입니다.",
    }),
    step({
      id: "planner-timeline-rooms",
      anchor: "bottom-room-rows",
      title: "방 · 가릴 면 · 소품 줄",
      body:
        "«방 · 가릴 면 · 소품» 묶음에서 방마다 ▸ 로 면 줄(정면 · 후면 · 왼쪽 · 오른쪽 · 천장 · 바닥)을 펴고, 「가림 / 열림」 을 누르면 이 시각부터 뒤집는 키가 찍힙니다. 키가 없는 면은 환경 탭 체크를 따릅니다. 방 소품의 «투시 / 막음» 도 같은 묶음, 같은 모양입니다 — 카메라가 벽을 넘어 들어가는 컷에 씁니다.",
    }),
    step({
      id: "planner-timeline-delete",
      anchor: "bottom-timeline",
      title: "Delete · 되돌리기",
      body: "고른 키가 있으면 키가 먼저, 없으면 고른 클립이 Delete 로 지워집니다. 빈 자리를 톡 누르면 잡아 둔 키가 풀립니다. 전부 Ctrl+Z 로 되돌립니다.",
    }),
  ],
};

const RENDER: Tutorial = {
  id: "planner-render",
  kind: "planner",
  page: "planner",
  title: "레퍼런스 영상 뽑기",
  summary: "타임라인 탭 «레퍼런스 영상» — 통째로 또는 조각으로 MP4 를 뽑고, 컷이 쓸 것을 고릅니다.",
  steps: [
    step({
      id: "planner-render-section",
      anchor: "timeline-render",
      title: "레퍼런스 영상 칸",
      body:
        "«N프레임 (24fps · N초)» 이 뜹니다 — 길이와 fps 는 화면 아래 타임라인에서 고칩니다. 카메라 무빙 · 인물 키 · GLB 애니메이션이 이 시계를 함께 따르고, 영상에는 격자 · 이름표 · 경로선 · 앵커가 나오지 않습니다.",
    }),
    step({
      id: "planner-render-split",
      anchor: "timeline-render-split",
      title: "통째로 · 5초 · 10초 · 14초 · 15초 · 30초 · 1분 · 2분 · 노래 N구간",
      body:
        "«통째로» 는 한 파일로 — 컷에 영상으로 적힙니다. 초 단위는 그 길이씩 잘라 여러 파일로(마지막 조각만 남은 길이), 14초는 AI 영상 기본 길이라 따로 둡니다. 노래를 올린 컷이면 «노래 N구간» 이 구간 경계에서 자릅니다 — 이어 붙이면 박자가 맞습니다. 파일 이름에 part 번호와 구간이 붙습니다.",
    }),
    step({
      id: "planner-render-run",
      anchor: "timeline-render-run",
      title: "● 레퍼런스 영상 만들기 (MP4)",
      // 이름 규칙은 useReferenceVideo.ts 의 fileName 그대로 — 씬 제목 · cutNN · 샷 이름, 조각이면 partNN 과 초 구간.
      body: "누르면 «0 / 0 프레임» 진행이 돌고 «취소» 로 끊습니다. 인코더는 WebCodecs 라 최신 WebView·브라우저면 됩니다 — 데스크톱 앱에서는 프로젝트 폴더에 저장되고, 브라우저(pnpm dev)에서는 MP4 가 내려받기로 떨어집니다. 파일 이름은 «{씬}_{cutNN}_{샷}.mp4» 꼴이고, 조각으로 뽑으면 «_partNN_구간» 이 뒤에 붙습니다.",
    }),
    step({
      id: "planner-render-list",
      anchor: "timeline-renders-list",
      title: "뽑아 둔 영상",
      body:
        "«뽑아 둔 영상 N편 — 누르면 이 컷이 그것을 씁니다». 조각까지 한 줄씩 남아 «그때 그 12초짜리» 를 다시 고를 수 있고, 목록에서 빼도 파일은 폴더에 남습니다. 길이를 바꿔 여러 번 뽑아 놓고 고르는 것이 실제 작업 방식입니다.",
    }),
    step({
      id: "planner-render-cut",
      anchor: "cut-ref-video-list",
      title: "컷 카드에서 고르기",
      body:
        "컷 카드의 «구도잡기에서 뽑은 영상 (N)» 에서 고르고 바로 재생할 수 있습니다. «레퍼런스 영상 쓰기» 를 켠 뒤 «Magnific 입력 지원» 에서 모델이 영상 전체를 받는지 확인하세요. 첫 프레임 그림만 받는 모델에는 시간에 따른 동작·카메라 경로가 영상으로 전달되지 않습니다. «영상으로» 구성 후에는 실제 캔버스의 모델과 영상 노드 연결도 확인하세요.",
    }),
    step({
      id: "planner-render-fps",
      anchor: "bottom-fps",
      title: "fps 와 길이는 아래 타임라인에서",
      body: "«24f» 칸이 초당 프레임 수, 그 옆이 총 길이입니다. 재생과 영상 내보내기가 이 값을 씁니다. 5초는 기본값이지 한계가 아닙니다.",
    }),
  ],
};

const MOCAP: Tutorial = {
  id: "planner-mocap",
  kind: "planner",
  page: "planner",
  title: "영상에서 모션 가져오기",
  summary: "영상을 올려 사람마다 이동 · 몸 방향 · 관절을 읽고 캐릭터 키로 넣습니다.",
  steps: [
    step({
      id: "planner-mocap-open",
      anchor: "timeline-mocap-open",
      title: "영상 올려서 캐릭터에 모션 입히기",
      body:
        "타임라인 탭의 «영상에서 모션 가져오기» 에서 엽니다. 전신이 보이는 영상에서 사람마다 이동 · 몸 방향 · 관절을 읽어 손으로 찍은 키와 똑같은 키로 넣습니다 — 넣은 뒤에는 똑같이 고칩니다. 고정 카메라 · 앞이나 옆에서 찍은 영상이 가장 정확하고, 손에 든 카메라 · 모션블러가 심한 영상은 조각이 납니다.",
    }),
    step({
      id: "planner-mocap-sources",
      anchor: "mocap-add-video",
      title: "영상 추가",
      body:
        "«영상 추가» 로 MP4 · WebM · MOV 를 여러 개 한 번에 넣습니다. 프로젝트 폴더에 담기고, 이름은 두 번 눌러 고칩니다(타임라인 레이어에 «수화(춤선…)» 으로 뜨는 이름). 목록에서 빼도 원본 파일은 지우지 않습니다. 오른쪽 재생기에 지금 보는 장의 뼈대와 번호가 겹쳐 그려집니다.",
    }),
    step({
      id: "planner-mocap-engine",
      anchor: "mocap-analyze",
      title: "1 · 분석 — 모델 · 구간 · 초당 장 · 거울",
      body:
        "«MediaPipe · 앱 내장» 또는 설치된 로컬 모델을 고릅니다. 모델마다 가림·뒤돈 자세에 대한 결과가 달라 미리보기를 확인하세요. «구간» · «초당 장(키)» · «거울 영상(좌우 뒤집기)» 를 정하고 «사람 찾기 · 관절 분석» 을 누릅니다. SAM 3D Body의 «손가락 함께 분석» 은 기본 켜짐이며 끄면 몸만 분석합니다. 다른 분석 중이면 순서대로 줄에 섭니다.",
      why: "창을 닫아도 분석은 멈추지 않고, 끝나는 대로 프로젝트 폴더에 적힙니다.",
    }),
    step({
      id: "planner-mocap-hands",
      anchor: "mocap-analyze",
      advanceOn: "manual",
      title: "손가락 추가 추적 — 몸 분석 뒤에",
      body: "몸 분석을 마치면 «손가락 추가 추적 · MediaPipe» 가 나타납니다. 기존 몸 분석의 시각에 맞춰 양손을 따로 추적하고, 손목 가까운 사람에게 연결합니다. 가려지거나 누구의 손인지 모호한 장은 기존 손 데이터를 유지합니다. 영상은 로컬에서 처리하며, 완료 후 «타임라인에 넣기» 를 다시 눌러야 캐릭터 키가 바뀝니다.",
      action: "해 볼 것: 몸 분석이 끝난 영상에서 단추 위치를 확인하세요. 손 추적을 실행했다면 미리보기를 확인한 뒤 타임라인에 다시 넣으세요.",
    }),
    step({
      id: "planner-mocap-cleanup",
      anchor: "mocap-cleanup",
      title: "2 · 다듬기 — 튐 보정 · 떨림 줄이기 · 디딘 발 고정",
      body:
        "«튐 보정»(끔 · 보통 · 강)은 한두 장 튀는 팔다리 · 좌우 뒤바뀜 · 몸 방향 뒤집힘을 앞뒤로 메웁니다. «떨림 줄이기»(약 · 보통 · 강)는 가만히 선 손 떨림은 누르고 빠른 동작은 살립니다. «디딘 발 고정 — 미끄러짐 없애기» 는 땅에 디딘 동안 발이 그 자리에 머물게 골반을 밀어 줍니다. 아래에 «튄 관절 N곳 · 통째로 메운 장 N · 좌우 뒤바뀜 N번» 이 숫자로 뜹니다.",
    }),
    step({
      id: "planner-mocap-match",
      anchor: "mocap-match",
      title: "3 · 번호 ↔ 캐릭터",
      body:
        "찾은 사람마다 «N번 · 몇 초~몇 초» 가 뜨고 드롭다운에서 캐릭터 · «새 마네킹(남) · (여)» · «안 씀» 을 고릅니다. 번호를 누르면 처음 나오는 장으로 갑니다. «타임라인 시작» 은 이 영상의 키가 몇 초부터 들어갈지, «영상 속 대형 그대로» 는 여럿을 넣을 때 서로의 간격·앞뒤를 영상대로 둘지입니다. 같은 캐릭터가 같은 시간에 두 번 들어가면 막습니다.",
    }),
    step({
      id: "planner-mocap-apply",
      anchor: "mocap-apply",
      title: "이동 · 몸 방향 · 관절 → 타임라인에 넣기",
      body:
        "아래 체크로 이동 · 몸 방향 · 관절 중 넣을 채널을 고릅니다. «타임라인에 넣기» 는 선택한 구간의 해당 키를 바꾸고, 짧은 타임라인은 늘립니다. 손을 못 찾은 장은 기존 손가락 키의 시각과 값을 유지하지만 보간 곡선까지 완전히 같지는 않을 수 있습니다. Ctrl+Z 한 번에 되돌립니다.",
    }),
    step({
      id: "planner-mocap-menu",
      anchor: "bottom-layers",
      title: "레이어 오른쪽 단추 — 모션 바꾸기 · 다시 분석",
      body:
        "타임라인의 인물 레이어를 오른쪽 단추로 누르면 «다른 모션으로 바꾸기»(분석해 둔 영상 중에서 고름) 와 «이 모션 다시 분석»(보정을 고쳐 다시 돌림) 이 뜹니다. 둘 다 모션 창을 그 줄과 그 사람을 미리 고른 채로 엽니다.",
    }),
    step({
      id: "planner-mocap-after",
      anchor: "layout-mocap-cleanup",
      title: "넣은 뒤 — 모캡 키 다듬기",
      body:
        "배치 탭에서 그 인물을 고르면 «모캡 키 다듬기» 가 뜹니다. «자동 다듬기» 는 규칙으로, «AI 분석 다듬기» 는 LLM 이 «인식 오류 / 의도한 동작» 을 가려 오류만 잇습니다. 키가 촘촘하면 타임라인을 + 로 늘려 집으세요.",
    }),
    step({
      id: "planner-mocap-limits",
      title: "어떤 영상이 잘 되나",
      body:
        "고정 카메라 · 밝은 조명 · 발끝과 손이 보이는 영상부터 확인하세요. 가림·뒤돌기·빠른 손동작은 누락되거나 잘못 이어질 수 있습니다. 손 21점이 잡혀도 캐릭터의 15개 손가락 마디에 옮긴 결과는 원본과 비교해야 합니다. 검출하지 못한 손을 새 포즈로 덮지 않는 것과 정확히 복원하는 것은 다릅니다.",
    }),
    step({
      id: "planner-mocap-list",
      anchor: "mocap-sources",
      title: "영상 줄 — 눌러서 고르기",
      body: "왼쪽 «영상 N개» 목록의 한 줄이 올린 영상 하나입니다. 줄 아래 작은 글씨가 그 영상의 형편 — 분석 전에는 «MediaPipe · 앱 내장 · 분석 전», 도는 동안은 «분석 중…», 끝나면 «N명 · 짝 N · 0.00초부터» 입니다. 줄을 누르면(줄에 초점이 가 있으면 Enter 도 같습니다) 가운데 미리보기와 오른쪽 «1 · 분석» «2 · 다듬기» «3 · 번호 ↔ 캐릭터» 가 통째로 그 영상 것으로 바뀝니다 — 모델 · 구간 · 초당 장 · 거울 · 짝짓기는 영상마다 따로 살기 때문에, 값을 고치기 전에 «어느 줄이 켜져 있는지» 를 먼저 보세요. 이름은 두 번 눌러 고치고(타임라인 레이어에 이 이름이 뜹니다), 휴지통은 «목록에서 빼기 — 원본 영상 파일은 그대로» 입니다.",
      action: "해 볼 것: 영상을 둘 올린 뒤 두 줄을 번갈아 누르며, 오른쪽 세 단이 줄마다 다른 값을 들고 있는 것을 보세요.",
      why: "군무 한 편과 솔로 여러 편을 섞어 쓰는 것이 이 창의 본래 쓰임이라, 설정을 창 전체가 아니라 영상마다 둡니다.",
    }),
    step({
      id: "planner-mocap-preview",
      anchor: "mocap-preview",
      title: "미리보기 — «재생 / 멈춤» 과 재생 위치 막대",
      body: "가운데는 고른 영상의 미리보기입니다. «재생 / 멈춤» 은 이 영상만 돌립니다(소리는 나오지 않습니다). 분석이 끝난 영상이면 장마다 찾아낸 사람의 뼈대와 번호가 영상 위에 겹쳐 그려져 — «2번이 누구인지» 와 «뼈대가 사람을 제대로 따라가는지» 를 눈으로 확인하는 자리입니다. 그 아래 라벨 없는 긴 막대가 재생 위치로, 끌면 0.01초 단위로 그 자리로 건너뛰고 멈춘 채로도 겹쳐 그린 뼈대가 따라옵니다. 오른쪽 «0.00 / 12.3초» 가 지금 자리와 전체 길이라, 여기서 읽은 초를 오른쪽 «구간» 칸에 그대로 적어 넣으면 됩니다. 거울 영상을 켜 두면 미리보기도 좌우가 뒤집혀 보입니다.",
      action: "해 볼 것: 분석이 끝난 영상에서 막대를 천천히 끌어, 뼈대가 사람에게서 벗어나거나 좌우가 뒤바뀐 구간이 없는지 훑어보세요.",
    }),
    step({
      id: "planner-mocap-cancel",
      anchor: "mocap-analyze",
      title: "분석 중 — 진행률과 «취소»",
      body: "«사람 찾기 · 관절 분석» 을 누르면 그 단추 자리가 초록 진행률 막대와 지금 무엇을 하는 중인지 적힌 줄로 바뀌고, 줄 오른쪽 끝에 «취소» 가 생깁니다. 지금 도는 분석뿐 아니라 «줄에 세우기 — 끝나는 대로 분석» 으로 차례를 기다리던 것도 이 «취소» 로 뺍니다. 취소한 영상은 «분석 전» 로 돌아갈 뿐 올린 파일도 이름도 구간 설정도 그대로 남아, 모델이나 초당 장을 바꿔 다시 누르면 됩니다. 진행률은 창이 아니라 저장소가 적어 주므로, 창을 닫았다 열어도 같은 자리에서 이어집니다.",
      action: "해 볼 것: 자리만 확인하세요. 누르면 몇 분씩 돌던 분석이 버려지고, 다시 누르면 처음 장부터 다시 돕니다.",
    }),
    step({
      id: "planner-mocap-close",
      anchor: "mocap-close",
      title: "× — 창 닫기 (분석은 계속 돕니다)",
      body: "머리줄 오른쪽 끝 × 가 이 창을 닫습니다. 닫아도 돌고 있는 분석은 멈추지 않습니다 — 저장소가 계속 돌려 끝나는 대로 프로젝트 폴더에 적고, 타임라인 탭의 «영상에서 모션 가져오기» 로 다시 열면 하던 진행률부터 이어 보입니다. 긴 영상을 걸어 두고 닫아서 그동안 구도를 손봐도 됩니다. 분석을 정말로 그만두려면 × 가 아니라 «취소» 입니다. 또 × 로 닫는 것만으로는 캐릭터 키가 하나도 바뀌지 않습니다 — 키가 들어가는 것은 «타임라인에 넣기» 를 눌렀을 때뿐이고, 그때는 창이 스스로 닫힙니다.",
      action: "해 볼 것: 분석을 걸어 둔 채 × 로 닫았다가 «영상 올려서 캐릭터에 모션 입히기» 로 다시 열어, 진행률이 이어지는 것을 보세요.",
      why: "「창을 닫으면 분석이 날아간다」 고 여겨 몇 분씩 창을 붙들고 기다리는 일이 있었습니다. 분석은 창이 아니라 저장소가 돌립니다.",
    }),
    step({
      id: "planner-mocap-log",
      anchor: "layout-mocap-cleanup",
      title: "지난 다듬기 — 무엇을 잇고 무엇을 두었나",
      body: "배치 탭의 «모캡 키 다듬기» 판에서 «자동 다듬기» 나 «AI 분석 다듬기» 를 한 번이라도 누르면 판 맨 아래에 «지난 다듬기 — AI · 키 N개 바뀜»(규칙으로 했으면 «자동») 이라는 접힌 줄이 생깁니다. 삼각형을 눌러 펴면 흔들림 후보 구간마다 한 줄씩, «이음» 인지 «둠» 인지 · 어느 관절 몇 초께인지 · AI 면 왜 그렇게 판단했는지가 최대 80줄까지 늘어섭니다. 이 목록이 «다듬기가 무엇을 만졌는지» 를 보는 유일한 자리입니다 — «둠» 만 잔뜩이면 손을 거의 안 댄 것이니 민감도를 «예민하게» 로 올려 다시, 반대로 살아야 할 빠른 동작이 «이음» 으로 뭉개졌으면 Ctrl+Z 로 되돌린 뒤 «둔하게» 로 내려 다시 누르세요. 마지막으로 다듬은 한 판만 남고, 다른 인물을 골랐다 돌아오면 사라집니다.",
      action: "해 볼 것: 한 번 «자동 다듬기» 를 누른 뒤 이 줄을 펴서, «둠» 으로 남긴 구간이 정말 살려야 할 빠른 동작인지 하나만 짚어 보세요.",
    }),
  ],
};

const MUSIC: Tutorial = {
  id: "planner-music",
  kind: "planner",
  page: "planner",
  title: "노래와 뮤직비디오",
  summary: "타임라인 탭 «노래» — 곡 올리기, 타임라인 길이 맞추기, 구간 나누기, 나눠 뽑기.",
  steps: [
    step({
      id: "planner-music-pick",
      anchor: "timeline-music-pick",
      title: "BGM에서 고르기 · 음원 올리기",
      body:
        "«BGM에서 고르기 — 뽑아 둔 곡» 은 BGM 프로젝트에서 뽑은 곡을 그대로 씁니다. «음원 올리기 — BGM · 업로드 폴더에 들어갑니다» 는 밖에서 받은 파일을 «<씬>_컷NN_» 이름으로 옮겨 올립니다. 재생하면 같이 울리고 «바꾸기» 와 빼기 단추로 갈거나 뗍니다(파일은 그대로).",
    }),
    step({
      id: "planner-music-length",
      anchor: "timeline-music",
      title: "노래 길이로",
      body: "타임라인이 노래보다 짧으면 뒤쪽은 뽑을 화면이 없습니다. «노래 길이(N초)로» 를 누르면 타임라인 길이가 곡에 맞고, «노래를 민 자리» 로 시작 시각을 밉니다 — 3분 곡이면 타임라인도 3분.",
    }),
    step({
      id: "planner-music-sections",
      anchor: "timeline-music-sections",
      title: "구간 나누기 · 여기서 자르기",
      body:
        "«빠르기»(BPM) 와 «마디씩» 을 적고 «구간 나누기» 를 누르면 한 번에 나뉩니다. 들으며 «N초에서 자르기» 로 재생 머리 자리에서 둘로 나눌 수도 있습니다. 구간마다 이름(도입 · 후렴)을 적고, 휴지통으로 지웁니다.",
    }),
    step({
      id: "planner-music-row",
      anchor: "bottom-timeline",
      title: "타임라인 맨 윗줄의 노래",
      body: "화면 아래 타임라인 맨 윗줄에 «노래 · 이름» 과 구간 칸, 그 뒤에 파형이 깔립니다. 구간을 누르면 그 자리로 갑니다. 파형이 있어야 «어디가 후렴인지» 를 읽습니다.",
    }),
    step({
      id: "planner-music-split",
      anchor: "timeline-render-split",
      title: "노래 구간대로 나눠 뽑기",
      body: "구간을 나눠 두면 «레퍼런스 영상» 의 나누기 선택지에 «노래 N구간» 이 뜹니다. 그 경계에서 잘라 뽑으면 이어 붙였을 때 노래와 박자가 맞습니다.",
    }),
    step({
      id: "planner-music-dance",
      anchor: "timeline-mocap-open",
      title: "춤은 «영상에서 모션 가져오기» 로",
      body: "댄스 커버 영상을 올려 번호마다 캐릭터를 고르면 그 춤이 캐릭터 키로 들어갑니다. 노래 · 모션 · 나눠 뽑기가 이 탭 하나에 있는 까닭입니다.",
    }),
  ],
};

const GLB: Tutorial = {
  id: "planner-glb",
  kind: "planner",
  page: "planner",
  title: "GLB 애니메이션과 블렌더",
  summary: "블렌더에서 만든 움직임을 GLB 로 들여와 타임라인에 얹습니다.",
  steps: [
    step({
      id: "planner-glb-prompt",
      anchor: "timeline-blender-prompt",
      title: "블렌더 작업 지시문 만들기",
      body: "지금 구도(방 · 인물 자리 · 카메라)를 글로 적은 지시문을 띄웁니다. LLM 에 붙여넣고 블렌더 MCP 로 실행하세요. 인물 동작은 앱이 알 수 없으니 주석 자리에 원하는 움직임을 적어 넣습니다. «복사» 로 가져갑니다.",
    }),
    step({
      id: "planner-glb-add",
      anchor: "timeline-glb",
      title: "GLB 파일 추가 (.glb / .gltf)",
      body: "블렌더에서 glTF/GLB 로 내보내면 애니메이션이 함께 들어옵니다. 단추로 고르거나 3D 화면에 끌어다 놓아도 됩니다. Mixamo FBX 는 안 됩니다 — GLB 로 바꿔 오세요.",
    }),
    step({
      id: "planner-glb-track",
      anchor: "timeline-glb",
      title: "트랙 카드 — 클립 · 시작 시각 · 재생 속도 · 크기 배율",
      body:
        "파일 안의 클립을 고르고, «시작 시각»(타임라인 몇 초부터), «재생 속도»(1 = 원래), «크기 배율»(블렌더와 단위가 다를 때)을 적습니다. «컷 끝까지 반복 재생» 을 끄면 한 번만 재생하고 마지막 프레임에서 멈춥니다. 클립 길이와 프레임 수가 아래에 뜹니다.",
    }),
    step({
      id: "planner-glb-place",
      anchor: "timeline-glb",
      title: "위치 · 회전 · 화면에서 직접 옮기기",
      body: "위치 X/Y/Z · 회전 X°/Y°/Z° 를 적거나 «화면에서 직접 옮기기» 로 기즈모를 붙여 끕니다(«기즈모 해제» 로 뗌). 눈으로 잠시 숨기고 × 로 제거합니다.",
    }),
    step({
      id: "planner-glb-render",
      anchor: "timeline-render",
      title: "레퍼런스 영상에 같이 담깁니다",
      body: "GLB 애니메이션은 카메라 무빙과 같은 시계를 따라 «레퍼런스 영상 만들기» 에 그대로 담깁니다. 미리보기 중 화면을 돌리면 해제됩니다.",
    }),
  ],
};

const SHORTCUTS: Tutorial = {
  id: "planner-shortcuts",
  kind: "planner",
  page: "planner",
  title: "단축키",
  summary: "구도잡기 창의 키 한 벌. 입력칸 안에서는 전부 물러납니다.",
  steps: [
    step({
      id: "planner-shortcuts-camera",
      anchor: "planner-camera-hint",
      title: "카메라 — W/A/S/D · Q/E · F · Ctrl+F · M · G",
      body: "W/A/S/D · Q/E 로 걷고(Shift 정밀 · Alt 성큼), 더블클릭이나 F 로 회전 중심을 옮기고, Ctrl+F 는 화면 한가운데로, M 은 고른 것 앞으로, G 는 활성 구도로 돌아갑니다.",
    }),
    step({
      id: "planner-shortcuts-gizmo",
      anchor: "layout-gizmo-mode",
      title: "기즈모 — 1 · 2 · 3 · Ctrl+1·2·3",
      body: "1 이동 · 2 회전 · 3 크기. Ctrl 과 함께면 자유 · 바닥 · 높이 제한입니다.",
    }),
    step({
      id: "planner-shortcuts-keys",
      anchor: "bottom-layers",
      title: "키 — K · Shift+K · Delete",
      body: "K 는 고른 대상의 «지금 고른 속성» 에 화면에 보이는 값 그대로 키를 찍습니다. Shift+K 는 자세 키(프리셋만 눌러 관절을 안 고른 채). Delete 는 고른 키, 없으면 고른 클립. 재생 중에는 K 를 안 받습니다.",
    }),
    step({
      id: "planner-shortcuts-timeline",
      anchor: "bottom-play",
      title: "타임라인 — 스페이스 · Ctrl+Space · + / −",
      body: "스페이스 재생·멈춤(어디를 눌러도 멈춤), Ctrl+Space 접기·펴기, + / − 가로 배율. 눈금자는 누른 채 끌면 스크럽.",
    }),
    step({
      id: "planner-shortcuts-anchor",
      anchor: "bottom-anchor",
      title: "앵커 — A",
      body: "클립을 고른 채 A 를 누르면 따라갈 앵커 레이어를 넘깁니다 — 내 것 → 전부 첫 클립 → 다른 클립들 → 다시 내 것.",
    }),
    step({
      id: "planner-shortcuts-bones",
      anchor: "bone-picker",
      title: "관절 — Tab · Ctrl+Tab",
      body: "인물을 잡고 Tab 으로 관절 고르기 파이 메뉴, Ctrl+Tab 으로 한 걸음 뒤로, Tab 으로 닫기. Esc 는 창을 닫는 키라 여기서는 안 씁니다.",
    }),
    step({
      id: "planner-shortcuts-select",
      anchor: "layout-objects",
      title: "여럿 잡기 — Ctrl · Shift",
      body: "Ctrl(맥은 ⌘)을 누르고 누르면 인물·소품을 함께 잡습니다. Shift 로 방을 잡아 3D 에서 옮깁니다.",
    }),
    step({
      id: "planner-shortcuts-undo",
      anchor: "planner-undo",
      title: "되돌리기 — Ctrl+Z · Ctrl+Shift+Z",
      body: "창 안 모든 편집에 듣습니다. 자동 키 · 방 규칙처럼 «사람이 한 편집이 아닌 것» 은 되돌리기에 쌓이지 않습니다.",
    }),
    step({
      id: "planner-shortcuts-typing",
      title: "입력칸 안에서는 물러납니다",
      body: "이름을 고치거나 숫자를 치는 동안은 스페이스 · K · Tab · Delete 가 글자로 들어갑니다. 칸 밖을 한 번 누른 뒤 키를 쓰세요.",
    }),
  ],
};

const PLANNER_HANDLES: Tutorial = {
  id: "planner-handles",
  kind: "planner",
  page: "planner",
  title: "배치 탭의 작은 손잡이들",
  summary: "배치 탭 — 섹션 머리줄 접기·펴기, 숫자칸 ↑↓와 축 하나만 초기화, 이름칸 Enter·Esc, 마네킹과 벽 그림 떼기, 덩어리 줄, 관절 초기화, 파이 메뉴에서 빠져나오기.",
  steps: [
    {
      id: "planner-handles-sections",
      route: P,
      page: "planner",
      anchor: "layout-characters",
      title: "«인물» 머리줄 — 접기 · 펴기",
      body: "오른쪽 판은 인물 · 소품 · 조명 · 덩어리 · 포즈가 세로로 줄줄이 이어져, 아래쪽 묶음이 화면 밖으로 밀려납니다. 머리줄을 누르면 그 묶음이 통째로 접혀 지금 만지는 것만 펴 두고 볼 수 있습니다 — 판 전체가 같은 모양이라 한 번 익히면 다 같습니다. 제목 옆 숫자는 이 컷에 선 인물 수로, 접어 두어도 남아 있어서 펴지 않고도 몇 명인지 압니다.",
      action: "해 볼 것: «인물» 머리줄을 눌러 목록을 접었다가, 한 번 더 눌러 펴 보세요.",
      why: "배경 그림이 늘어나면 판이 한없이 길어져 스크롤로는 못 찾습니다. 그래서 묶음마다 접을 자리를 두었습니다.",
    },
    {
      id: "planner-handles-mannequin-remove",
      route: P,
      page: "planner",
      anchor: "layout-characters",
      title: "마네킹 줄의 × — 구도에서 지우기",
      body: "눈 단추는 «이 컷에서 빼기» 라 목록에는 줄이 남지만, 마네킹 줄에만 붙는 빨간 × («이 마네킹을 지웁니다»)는 그 마네킹 자체를 구도에서 없앱니다. 여기서 세운 임시 인물이라 지울 자리가 있어야 합니다 — 프로젝트 인물에는 × 가 없습니다(그건 캐릭터 단계의 것이라 여기서 지우면 안 됩니다). 지우던 마네킹을 고른 채였으면 선택도 함께 풀려 아래 칸이 닫힙니다.",
      action: "해 볼 것: «+ 남성형» 으로 마네킹을 하나 세운 뒤 그 줄의 × 를 눌러 지워 보세요 — Ctrl+Z 로 되살아납니다.",
    },
    {
      id: "planner-handles-color-pick",
      route: P,
      page: "planner",
      anchor: "layout-body-color",
      title: "«함께 잡은 것 풀기»",
      body: "Ctrl 을 누르고 인물을 여럿 누르면 몸 색을 한 번에 칠하려고 함께 잡히고, 잡힌 줄은 테두리가 노랗게 뜹니다. 잡아 둔 채로 다른 색을 고르면 엉뚱한 사람까지 물들므로, 다 칠했으면 «함께 잡은 것 풀기» 로 비웁니다. 둘 이상 잡았을 때만 보이는 줄이라, 안 보이면 이미 풀린 것입니다.",
      action: "해 볼 것: 인물 둘을 Ctrl 로 잡아 둔 뒤 «함께 잡은 것 풀기» 를 눌러 보세요.",
    },
    {
      id: "planner-handles-name-input",
      route: P,
      page: "planner",
      anchor: "layout-character-fields",
      title: "이름칸 — Enter 확정 · Esc 되돌리기",
      body: "인물 이름 칸과 덩어리 이름 칸은 치는 동안에는 아직 반영되지 않습니다. Enter 를 누르거나 칸 밖을 한 번 누르면 그때 들어가고, Esc 를 누르면 고치던 것을 버리고 원래 이름으로 돌아옵니다 — 잘못 지웠을 때 Ctrl+Z 를 찾을 필요가 없습니다.",
      action: "해 볼 것: 이름칸에 아무 글자나 덧붙인 뒤 Esc 를 눌러, 원래 이름으로 돌아오는지 보세요.",
      why: "한 글자 칠 때마다 반영하면 3D 가 글자마다 다시 그려져 타자가 밀립니다. 그래서 확정하는 순간까지 미룹니다.",
    },
    {
      id: "planner-handles-axis-reset",
      route: P,
      page: "planner",
      anchor: "layout-gizmo-mode",
      title: "축 하나만 초기화 · 숫자칸 ↑ ↓",
      body: "«수치 입력» 아래 위치 · 회전 · 크기 칸은 축 라벨 옆마다 회살표 단추가 붙어 있습니다(«X 축만 초기화»). 아래쪽 전체 초기화는 세 축을 다 날리지만 이것은 그 축 하나만 기본값으로 돌려, 「Z 만 잘못 건드렸는데 X·Y 까지 날아가는」 일이 없습니다 — 이미 기본값인 축은 흐려져 눌리지 않습니다. 숫자칸에 커서를 둔 채 ↑ ↓ 를 누르면 정해진 눈금만큼 오르내립니다: 위치 0.1 m · 회전 15° · 관절 5° · 소품 손잡이 0.05 m.",
      action: "해 볼 것: 위치 X 칸을 눌러 ↑ 를 두어 번 누른 뒤, 그 축의 회살표로 되돌려 보세요.",
    },
    {
      id: "planner-handles-cleanup-log",
      route: P,
      page: "planner",
      anchor: "layout-mocap-cleanup",
      title: "«지난 다듬기» 펼쳐 보기",
      body: "다듬기를 한 번 돌리고 나면 «지난 다듬기 — AI/자동 · 키 N개 바뀜» 줄이 생깁니다. 눌러서 펴면 구간마다 «이음» 인지 «둠» 인지, AI 로 돌렸다면 왜 그렇게 판단했는지 까닭까지 최대 80줄이 나옵니다 — 「팔이 왜 저기서 부드러워졌지」 를 확인하는 자리입니다. 잘못 이었으면 Ctrl+Z 로 통째로 되돌리고 민감도를 바꿔 다시 돌립니다.",
      action: "해 볼 것: 자리만 확인하세요. 다듬기를 한 번 돌린 뒤라야 이 줄이 생기고, «AI 분석 다듬기» 는 LLM 을 불러 시간이 걸립니다.",
    },
    {
      id: "planner-handles-objects-section",
      route: P,
      page: "planner",
      anchor: "layout-objects",
      title: "«소품 · 조명» 머리줄과 덩어리 줄",
      body: "머리줄을 누르면 소품 목록 전체가 접히고, 옆 숫자는 캐릭터 쪽 소품 개수입니다 — 방에 딸린 배경 소품은 여기 안 세고 환경 탭에 있습니다. 목록에서 덩어리는 한 줄로 서는데, 그 줄을 Ctrl(맥은 ⌘)로 누르면 덩어리째 잡혀 다른 소품과 섞어 더 큰 한 덩어리로 다시 묶을 수 있습니다. 줄 오른쪽 눈은 «덩어리를 숨깁니다» — 속한 소품이 모두 함께 사라지고, 한 번 더 누르면 «다시 보이게» 돌아옵니다.",
      action: "해 볼 것: «소품 · 조명» 머리줄을 눌러 접었다 편 뒤, 덩어리 줄의 눈으로 통째로 숨겨 보세요.",
    },
    {
      id: "planner-handles-group-section",
      route: P,
      page: "planner",
      anchor: "layout-group-section",
      title: "«덩어리» 머리줄",
      body: "소품을 묶고 그 덩어리를 고르면 아래에 «덩어리» 묶음이 붙습니다 — 색 · 이름 · 무엇으로 바꿔 그릴지 · 묶음 에셋이 그 안에 듭니다. 머리줄을 누르면 이 카드가 접혀, 위쪽 소품 목록만 길게 펴 두고 볼 수 있습니다. 덩어리를 안 골랐으면 이 묶음 자체가 안 보입니다.",
      action: "해 볼 것: 덩어리를 하나 고른 뒤 «덩어리» 머리줄을 눌러 카드를 접었다 펴 보세요.",
    },
    {
      id: "planner-handles-group-asset",
      route: P,
      page: "planner",
      anchor: "layout-group-asset",
      title: "«이 덩어리의 에셋 만들기»",
      body: "상자 몇 개로 쌓아 둔 덩어리를 그림에서는 「그 물건 하나」 로 그려야 할 때 씁니다. 누르면 덩어리 이름 그대로 에셋 카드가 생겨 이 덩어리에 바로 걸리고, 그 카드에서 시트를 뽑으면 프롬프트에 「이 자리에 «…» 를 그려라」 가 실립니다. 이미 걸어 둔 카드가 있으면 단추가 «…» 열기 — 시트 뽑기 로 바뀌어 그 카드를 엽니다 — 낱개 소품의 «이 소품의 에셋 만들기» 와 같은 에셋 목록을 씁니다.",
      action: "해 볼 것: 자리만 확인하세요. 누르면 이 작품에 에셋 카드가 하나 새로 생기고 카드 창이 열립니다.",
    },
    {
      id: "planner-handles-wall-detach",
      route: P,
      page: "planner",
      anchor: "layout-wall-image",
      title: "벽 그림의 × — 그림만 떼기",
      body: "«이 벽의 그림» 에 붙여 둔 그림 옆 × 는 «그림만 뗍니다 — 벽은 그대로 서 있습니다». 벽 자체를 없애려면 소품 목록의 휴지통이고, 이 × 는 붙인 배경만 걷어 다른 그림으로 갈아 끼울 때 씁니다. 그림이 붙어 있을 때만 보이고, 떼고 나면 «아직 없습니다 — 아래에서 고르거나 이 크기로 새로 뽑으세요» 로 바뀝니다.",
      action: "해 볼 것: 벽에 그림이 붙어 있으면 × 로 떼어 보세요 — 벽은 그대로 섭니다. Ctrl+Z 로 되돌립니다.",
    },
    {
      id: "planner-handles-pose-section",
      route: P,
      page: "planner",
      anchor: "layout-pose-section",
      title: "«포즈» 머리줄",
      body: "인물을 고르면 판 맨 아래에 «포즈» 묶음이 붙습니다 — 내 프리셋 단추, 관절 세부 조정, 손 모양이 전부 그 안입니다. 판 셋이 겹쳐 세로로 길어 자리를 많이 먹으므로, 인물 자리만 잡는 동안에는 머리줄을 눌러 접어 두고 위쪽 인물 칸을 넓게 씁니다.",
      action: "해 볼 것: 인물을 하나 고른 뒤 «포즈» 머리줄을 눌러 접었다 펴 보세요.",
    },
    {
      id: "planner-handles-joint-reset",
      route: P,
      page: "planner",
      anchor: "layout-joints",
      title: "«전체 초기화» · «이 관절 초기화»",
      body: "관절 판 머리의 «전체 초기화» 는 그 인물의 관절 각도와 손가락을 모두 지워 기본 자세로 돌립니다 — 이리저리 돌리다 엉킨 자세를 버리고 처음부터 잡을 때 씁니다. 조정한 관절이 하나도 없으면 흐려져 눌리지 않고, 옆의 «N개 조정됨» 이 지금 몇 곳을 건드렸는지 알려 줍니다. 관절 하나를 고르면 그 칸 오른쪽에 «이 관절 초기화» 가 따로 있어, 나머지는 그대로 둔 채 그 관절의 세 축만 한 번에 0 으로 돌립니다.",
      action: "해 볼 것: 관절 하나를 골라 각도를 바꿔 본 뒤 «이 관절 초기화» 로 되돌려 보세요.",
    },
    {
      id: "planner-handles-bone-picker-exit",
      route: P,
      page: "planner",
      anchor: "bone-picker",
      title: "파이 메뉴에서 빠져나오기 — 한가운데 점 · 바깥 누르기",
      body: "Tab 으로 연 관절 고르기 메뉴는 고리를 따라 상체 · 왼쪽 · 오른쪽 · 손가락 안으로 들어갑니다. 한가운데 점을 누르면 «한 걸음 뒤로», 첫 고리에서라면 «닫기» 입니다 — 키보드의 Ctrl+Tab 과 같은 일을 마우스로 합니다. 메뉴 바깥 빈 자리를 누르면 그대로 닫히니, 잘못 열었을 때 손을 키보드로 옮기지 않고 빠져나올 수 있습니다.",
      action: "해 볼 것: 인물을 고른 채 Tab 으로 메뉴를 연 뒤, 바깥 빈 자리를 눌러 닫아 보세요.",
      why: "Esc 는 구도잡기 창을 닫는 키라 여기서는 안 씁니다 — 첫 고리에서 한 번 더 눌렀다가 창이 통째로 닫힌 일이 있었습니다.",
    },
    {
      id: "planner-handles-preset-hand",
      route: P,
      page: "planner",
      anchor: "layout-presets",
      title: "«손 프리셋 적용 대상» · 저장 «취소»",
      body: "손 프리셋은 한쪽 손만 맞춰 저장합니다. «손 프리셋 적용 대상» 의 «왼손» · «오른손» 이 지금 누르는 프리셋을 어느 손에 넣을지 정하고, 저장한 기준과 반대쪽이면 좌우를 뒤집어 넣습니다 — 그래서 프리셋 하나로 양손을 다 씁니다. «+ 현재 자세 저장» 을 눌러 이름·그룹을 적다가 그만둘 때는 «취소» 로, 적던 글자를 버리고 저장 판만 닫습니다(인물의 자세는 건드리지 않습니다).",
      action: "해 볼 것: «손 프리셋 적용 대상» 에서 «오른손» 을 눌러 대상을 바꿔 보세요.",
    },
  ],
};

const PLANNER_SCREEN: Tutorial = {
  id: "planner-screen",
  kind: "planner",
  page: "planner",
  title: "3D 화면 손으로 다루기",
  summary: "구도잡기에서 «화면을 직접 만지는» 것만 모아 새 갈래 planner-screen(9걸음)을 세웁니다 — 빈 곳 눌러 선택 풀기 · 기즈모 손잡이 · 끌 때 뜨는 수치 배지 · 바닥에 세우기 십자 커서 · 재생 중 fps 배지 · 조작 속도 칩 네 개 · 저장한 구도 이름 고치기와 지우",
  steps: [
    {
      id: "planner-screen-tutorial",
      route: P,
      page: "planner",
      anchor: "planner-header",
      title: "«튜토리얼» — 구도잡기 갈래 열한 개",
      body: "머리줄 오른쪽, 책 아이콘의 «튜토리얼» 이 이 창 전용 갈래를 펴는 자리입니다 — 창 훑어보기 · 방과 환경 · 인물 배치와 포즈 · 소품 · 조명 · 에셋 · 카메라와 샷 · 타임라인 · 레퍼런스 영상 · 영상에서 모션 가져오기 · 노래 · GLB · 단축키. 구도잡기 갈래는 이 창이 열려 있는 동안에만 목록에 오르므로 위 띠가 아니라 여기가 유일한 입구입니다. 한 번 본 갈래에는 초록 체크가 붙어 어디까지 봤는지 남습니다.",
      action: "해 볼 것: 머리줄 오른쪽 끝의 «튜토리얼» 자리를 눈으로 확인해 두세요 — 작업하다 막히면 막힌 갈래만 골라 여기서 다시 엽니다.",
      why: "창이 닫힌 채로 열면 가리킬 자리가 없고, 위 띠는 이 창에 가려 손이 닿지 않습니다 — 그래서 이 갈래는 구도잡기 안에서만 열립니다.",
    },
    {
      id: "planner-screen-select",
      route: P,
      page: "planner",
      anchor: "planner-viewport",
      title: "화면에서 고르기 · 빈 곳 눌러 풀기",
      body: "인물과 소품은 오른쪽 목록뿐 아니라 3D 화면에서 바로 눌러 고릅니다. 누른 자리에서 3px 안에 떼야 «고른 것» 이고, 더 움직였으면 «화면을 돌린 것» 으로 봐서 선택이 안 바뀝니다. 아무것도 없는 빈 곳을 누르면 선택이 풀려 손잡이(기즈모)가 치워집니다 — 손잡이가 구도를 가릴 때 치울 자리가 여기입니다. 재생 중 · 손잡이를 끄는 중 · «바닥에 세우기» 가 켜진 동안에는 고르기가 멈춥니다.",
      action: "해 볼 것: 인물을 한 번 눌러 잡은 뒤, 아무것도 없는 빈 하늘을 눌러 손잡이가 사라지는지 보세요.",
      why: "누르자마자 고르게 했더니 돌리려고 누른 것까지 잡혀 화면을 돌릴 때마다 고른 것이 바뀌었습니다.",
    },
    {
      id: "planner-screen-gizmo",
      route: P,
      page: "planner",
      anchor: "planner-viewport",
      title: "손잡이로 끌기 — 화살표 · 링 · 상자",
      body: "고른 것에 붙는 색 손잡이가 기즈모입니다 — 화살표는 이동, 링은 회전, 상자는 크기이고 1 · 2 · 3 키로 갈아 낍니다(빨강 X · 초록 Y · 파랑 Z). 인물 · 소품 · GLB · 방이 전부 같은 손잡이로 옮겨지고 돌아가고 커집니다. 손을 뗄 때 «잡은 축의 값만» 저장되므로 Y 링만 돌렸는데 X·Z 가 따라 틀어지는 일이 없습니다. 방은 Shift 를 누르고 잡으며, 키운 배율은 방 치수(가로 · 깊이 · 층고)에 곱해 들어간 뒤 손잡이는 1 로 되돌아갑니다.",
      action: "해 볼 것: 인물을 고르고 화살표 하나만 잡아 끌어 보세요. 2 를 누르면 같은 자리에 회전 링이 뜹니다.",
      why: "잡은 축만 적는 까닭 — 회전은 YXZ 순서로 다시 풀어 저장하는데, 세 축을 통째로 덮으면 Y 를 90° 넘길 때 X·Z 가 튀면서 각도가 되돌아갑니다.",
    },
    {
      id: "planner-screen-readout",
      route: P,
      page: "planner",
      anchor: "planner-viewport",
      title: "끌면서 뜨는 수치",
      body: "손잡이를 끄는 동안 커서 오른쪽 위에 지금 값이 따라다닙니다 — 이동은 «X 1.20 m», 회전은 «Y −35.0°», 크기는 «×1.240». 축 손잡이를 잡았으면 그 축 하나만, 한가운데를 잡아 세 축이 함께 움직이면 셋을 나란히 적습니다. «이번에 얼마나 움직였나» 가 아니라 «지금 몇인가» 라 오른쪽 패널의 숫자 칸과 같은 값이고, 손을 떼고 1.5초 뒤 사라집니다.",
      action: "해 볼 것: 회전 링을 천천히 끌면서 커서 옆 숫자가 도(°)로 바뀌는 것을 보고, 손을 뗀 뒤 잠시 두면 사라지는지 보세요.",
      why: "지금 돌리고 있는 축 옆에 숫자가 붙어 있어야 합니다. 화면 맨 위에 적었더니 손은 손잡이를 잡고 눈은 위를 보는 꼴이었습니다.",
    },
    {
      id: "planner-screen-ground",
      route: P,
      page: "planner",
      anchor: "planner-ground-place",
      title: "십자 커서 — 지금은 «세우는 중»",
      body: "«바닥에 세우기» 를 켜면 단추가 초록으로 바뀌고 3D 화면의 커서가 십자(+)가 됩니다. 켜진 동안 화면을 누르는 것은 «고르기» 가 아니라 «고른 인물을 그 자리로 옮기기» 라, 커서 모양이 곧 «지금 누르면 무슨 일이 일어나는가» 입니다. 다시 누르기 전까지 켜져 있으니 배경과 인물의 축척을 맞추느라 인물을 앞뒤로 여러 번 옮길 때는 켜 둔 채로 계속 찍으면 됩니다.",
      action: "해 볼 것: «바닥에 세우기» 를 켜고 커서를 3D 화면 위로 옮겨 십자가 되는지 보세요. 끌 때는 같은 단추를 다시 누릅니다.",
      why: "커서가 그대로면 «클릭이 왜 인물을 옮기지» 가 됩니다 — 모드가 켜진 것을 화면에서 알 길이 커서밖에 없습니다.",
    },
    {
      id: "planner-screen-fps",
      route: P,
      page: "planner",
      anchor: "planner-viewport",
      title: "재생 중 fps 배지",
      body: "미리보기를 돌리는 동안에만 3D 화면 왼쪽 아래에 «60 fps» 가 뜹니다 — 0.5초마다 다시 재서 50 이상이면 초록, 28 이상이면 노랑, 그 아래면 빨강입니다. 28 밑으로 떨어지면 앱이 스스로 해상도를 한 단계 내려 끊김을 막고, 55 를 넘으면 되돌립니다. 빨강이 이어지면 인물 · 방 · GLB 가 무겁다는 뜻이니 안 쓰는 것을 눈 단추로 잠시 숨기고 다시 재생해 보세요.",
      action: "해 볼 것: 스페이스로 잠깐 재생해 왼쪽 아래 숫자와 색을 보고, 다시 스페이스로 멈추세요.",
      why: "값이 눈에 보여야 무엇을 줄일지 판단할 수 있습니다. 이 배지는 화면에만 뜨고 뽑은 레퍼런스 영상 파일에는 안 담깁니다.",
    },
    {
      id: "planner-screen-speed",
      route: P,
      page: "planner",
      anchor: "planner-camera-speed",
      title: "조작 속도 칩 — ×0.3 · ×0.5 · ×1 · ×2",
      body: "슬라이더 아래 네 칩은 조작 속도를 한 번에 못 박습니다 — 회전 · 걷기 · 줌이 한 덩어리로 이 배수를 따릅니다. 좁은 방에서 인물 얼굴에 카메라를 맞출 때는 ×0.3, 한 변 100 m 공터를 가로지를 때는 ×2 가 편합니다. 칩을 안 바꿔도 걷는 동안 Shift 를 누르면 0.3배(정밀), Alt 를 누르면 3배로 그때만 바뀝니다.",
      action: "해 볼 것: ×0.3 을 누르고 화면을 돌려 보세요 — 같은 손놀림에 훨씬 조금 돕니다. 돌아올 때는 ×1.",
      why: "회전 감도는 화각에서 자동으로 잡히고 여기서 정한 배수가 그 위에 곱해집니다 — 망원으로 좁게 볼수록 저절로 느려집니다.",
    },
    {
      id: "planner-screen-shots",
      route: P,
      page: "planner",
      anchor: "planner-shot-list",
      title: "저장한 구도 — 이름 고치기 · 지우기",
      body: "«저장한 카메라» 목록에서 이름을 누르면 그 구도로 카메라가 가고, 두 번 누르면 이름을 고칩니다 — «수화 클로즈업» 처럼 적어 두면 카메라 무빙의 출발 구도를 고를 때 알아봅니다. 고치는 동안 Enter 는 확정, Esc 는 취소, 칸 밖을 한 번 누르면 그대로 확정입니다. 옆의 저장 아이콘은 이 구도를 지금 카메라로 덮어쓰기(재저장), × 는 지우기입니다.",
      action: "해 볼 것: 구도 이름을 두 번 눌러 고치고 Enter 로 확정해 보세요. × 는 자리만 확인하세요. 누르면 ««이름» 을 지울까요? / 저장해 둔 구도가 사라집니다. 되돌릴 수 없습니다» 를 묻습니다.",
      why: "이름을 치는 동안은 창 단축키가 물러납니다 — 스페이스 · K · Delete 가 재생이나 키 찍기가 아니라 글자로 들어갑니다.",
    },
    {
      id: "planner-screen-undo",
      route: P,
      page: "planner",
      anchor: "planner-undo",
      title: "되돌리기 — Ctrl+Z · Ctrl+Shift+Z · Ctrl+Y",
      body: "머리줄의 두 화살표가 되돌리기(Ctrl+Z)와 다시 실행(Ctrl+Shift+Z)입니다. 화면에는 안 적혀 있지만 Ctrl+Y 도 똑같이 다시 실행이라, 다른 편집 도구에서 손에 익은 쪽을 그대로 쓰면 됩니다. 손잡이를 한 번 끄는 것이 되돌리기 한 칸이고, 자동으로 찍히는 키나 방 규칙처럼 «사람이 한 편집이 아닌 것» 은 쌓이지 않습니다. 이름이나 숫자를 치는 중에는 창의 되돌리기 대신 글자 되돌리기가 그대로 듣습니다.",
      action: "해 볼 것: 인물을 손잡이로 옮긴 뒤 Ctrl+Z 로 되돌리고, Ctrl+Y 로 다시 살려 보세요.",
    },
  ],
};

const PLANNER_TIMELINE_TAB: Tutorial = {
  id: "planner-timeline-tab",
  kind: "planner",
  page: "planner",
  title: "타임라인 탭 훑어보기",
  summary: "구도잡기 오른쪽 «타임라인» 탭 자체를 다루는 새 튜토리얼 7걸음을 planner.ts 에 더하자는 제안입니다(id: planner-timeline-tab, PLANNER_TUTORIALS 에서 TIMELINE 다음 자리). 네 칸(«노래» · «영상에서 모션 가져오기» · «GLB 애",
  steps: [
    {
      id: "planner-timeline-tab-open",
      route: P,
      page: "planner",
      anchor: "planner-tabs",
      title: "타임라인 탭 — 칸 넷",
      body: "오른쪽 패널의 «타임라인» 을 누르면 칸이 넷 세로로 섭니다 — 위에서부터 «노래» · «영상에서 모션 가져오기» · «GLB 애니메이션» · «레퍼런스 영상». 넷 다 «이 컷이 시간 위에서 어떻게 흐르는가» 를 다룹니다. 시간 자체(총 길이 · fps · 재생 · 키)는 이 탭이 아니라 화면 아래 타임라인에 있고, 여기 칸들은 그 시계에 무엇을 얹고(노래 · 모션 · GLB) 거기서 무엇을 뽑을지(레퍼런스 영상)를 정합니다. 창을 열면 늘 «배치» 탭부터라 이 탭은 한 번 눌러 들어와야 합니다.",
      action: "해 볼 것: 오른쪽 패널 위의 «타임라인» 을 누르세요.",
    },
    {
      id: "planner-timeline-tab-music",
      route: P,
      page: "planner",
      anchor: "timeline-music",
      title: "«노래» 칸 — 처음에는 접혀 있습니다",
      body: "칸 머리줄 왼쪽의 ▸ 와 ▾ 가 접기·펴기입니다. 네 칸 중 «노래» 만 처음에 접혀 있습니다 — 뮤직비디오가 아닌 컷에서는 곡을 깔지 않아서요. 머리줄을 누르면 펴지면서 «BGM에서 고르기 — 뽑아 둔 곡» 과 «음원 올리기» 가 나옵니다. 접어도 머리줄은 남으니 언제든 다시 폅니다. 접고 편 상태는 이 컷의 구도잡기가 기억해 창을 닫았다 열어도 그대로이고, 앱을 껐다 켜면 기본(«노래» 만 접힘)으로 돌아옵니다.",
      action: "해 볼 것: «노래» 머리줄을 눌러 펴 보세요.",
      why: "«BGM에서 고르기» 목록은 이 탭에 들어올 때 한 번 읽습니다 — 칸을 접었다 펴는 것으로는 다시 읽지 않습니다. BGM 화면에서 갓 뽑은 곡이 여기 안 보이면 «배치» 탭에 갔다 돌아오거나 창을 닫았다 여세요.",
    },
    {
      id: "planner-timeline-tab-mocap",
      route: P,
      page: "planner",
      anchor: "timeline-mocap",
      title: "«영상에서 모션 가져오기» 칸 — 처음부터 펴짐",
      body: "이 칸 안에는 단추가 하나뿐입니다 — «영상 올려서 캐릭터에 모션 입히기». 댄스 영상 속 사람의 움직임을 캐릭터에 옮기는 입구라 눈에 띄어야 해서 처음부터 펴 둡니다. 머리줄을 누르면 한 줄로 접혀 아래 칸들이 넓어집니다 — 모션을 다 넣은 뒤 GLB 나 영상 뽑기를 만질 때 접어 두세요. 단추는 창을 열 뿐이고, 몇 분씩 걸리는 분석은 그 창 안에서 따로 시작합니다.",
      action: "해 볼 것: «영상에서 모션 가져오기» 머리줄을 눌러 접었다 펴 보세요.",
    },
    {
      id: "planner-timeline-tab-glb",
      route: P,
      page: "planner",
      anchor: "timeline-glb",
      title: "«GLB 애니메이션» 칸 — 머리줄의 숫자 뱃지",
      body: "블렌더에서 만들어 온 움직임을 이 컷에 얹는 칸입니다. 머리줄 제목 옆에 지금 얹힌 트랙 수가 동그란 숫자로 붙고, 하나도 없으면 아무것도 안 붙습니다 — 접어 두어도 이 숫자는 보이니 «뭔가 얹혀 있었나» 를 펴지 않고 압니다. 트랙 카드(클립 · 시작 시각 · 재생 속도 · 크기 배율 · 위치 · 회전)는 칸을 펴야 나오므로, 얹어 둔 것을 고치려면 먼저 펴세요.",
      action: "해 볼 것: «GLB 애니메이션» 머리줄을 눌러 접었다 펴 보세요 — 접어도 숫자 뱃지는 머리줄에 남습니다.",
    },
    {
      id: "planner-timeline-tab-axis-reset",
      route: P,
      page: "planner",
      anchor: "timeline-glb",
      title: "축별 초기화 ↺ — 한 축만 0 으로",
      body: "GLB 트랙 카드의 «위치» 와 «회전» 은 각각 X · Y · Z 세 칸이고, 축 이름 옆마다 작은 ↺ 가 하나씩 붙어 모두 여섯 개입니다(«X 축만 초기화» · «Y 축만 초기화» · «Z 축만 초기화»). 누르면 그 축만 0 으로 돌아가고 나머지 둘은 건드리지 않습니다. 이미 0 인 축은 흐리게 꺼져 눌리지 않으니, 진한 ↺ 가 곧 «내가 건드린 축» 입니다.",
      action: "해 볼 것: 얹어 둔 GLB 가 있으면 «회전» 의 X 를 조금 바꾼 뒤 그 옆 ↺ 를 눌러 되돌려 보세요.",
      why: "전체 초기화 하나만 두었더니 «Z 만 잘못 건드렸는데 X·Y 까지 날아가는» 일이 났습니다. 그리고 여기 보이는 축은 블렌더 규약입니다 — Y 가 앞뒤, Z 가 위아래. 블렌더에서 가져온 것을 맞추는 칸이니 거기서 보던 숫자와 뜻이 같아야 합니다.",
    },
    {
      id: "planner-timeline-tab-arrows",
      route: P,
      page: "planner",
      anchor: "timeline-glb",
      title: "숫자칸은 ↑ / ↓ 로도 바뀝니다",
      body: "이 탭의 숫자칸은 칸 안을 한 번 누른 뒤 위·아래 화살표 키로 정해진 단위만큼 오르내립니다 — «시작 시각» 0.1초 · «재생 속도» 0.1 · «크기 배율» 0.05 · 위치 0.1m · 회전 15° · «노래를 민 자리» 0.5초. 회전이 15° 인 까닭은 여섯 번 누르면 정확히 90° 라서입니다. 최솟값이 있는 칸은 거기서 멈춥니다 — «재생 속도» 는 0.05, «크기 배율» 은 0.01, «시작 시각» 과 «노래를 민 자리» 는 0 아래로 안 내려갑니다. 화면에는 이 안내가 없습니다.",
      action: "해 볼 것: 숫자칸 하나를 누르고 ↑ 를 몇 번 눌러 보세요 — «시작 시각» 이나 «노래를 민 자리» 면 됩니다.",
    },
    {
      id: "planner-timeline-tab-render",
      route: P,
      page: "planner",
      anchor: "timeline-render",
      title: "«레퍼런스 영상» 칸 머리줄",
      body: "맨 아래 칸입니다. 펴면 «가로×세로 · N프레임 (24fps · N초)» 요약 · 나눠 뽑기 선택 줄 · «● 레퍼런스 영상 만들기 (MP4)» · «뽑아 둔 영상» 목록이 차례로 있어 이 탭에서 가장 깁니다. 머리줄을 누르면 통째로 접혀 위 칸들을 한 화면에서 봅니다. 뽑는 도중에 접어도 만드는 일은 그대로 이어지지만 «0 / 0 프레임» 진행 줄과 «취소» 가 함께 가려지니, 돌고 있는 동안은 펴 두는 편이 낫습니다.",
      action: "해 볼 것: «레퍼런스 영상» 머리줄을 눌러 접었다 펴 보세요. 안의 «● 레퍼런스 영상 만들기 (MP4)» 는 누르면 프레임 수만큼 몇 분 돌아갑니다 — 여기서는 머리줄만 확인하세요.",
    },
  ],
};

const PLANNER_KEYS: Tutorial = {
  id: "planner-keys",
  kind: "planner",
  page: "planner",
  title: "타임라인 키 다루기",
  summary: "화면 아래 무빙 타임라인의 손끝 — 눈금자와 재생선, 키 점 집기, 고무줄로 여럿 잡기, 관절 줄, 이동량 값 고치기, 자유 경로 갈래 키, 떠 있는 값 판, 방 가림 네모.",
  steps: [
    {
      id: "planner-keys-start",
      route: P,
      page: "planner",
      anchor: "bottom-start-shot",
      title: "출발: 어느 구도에서 시작하는가",
      body: "머리줄의 «출발: {구도 이름}» 은 이 타임라인의 무빙 전체가 어느 저장 구도에서 출발하는지입니다. 3D 화면을 아무리 돌려 놓아도 출발점은 따라오지 않습니다 — 그게 글자로 박혀 있어야 «지금 보는 화면» 과 «무빙이 시작하는 화면» 을 헷갈리지 않습니다. 누르면 재생 머리가 0초로 가서 그 자리를 바로 봅니다. 저장한 카메라가 하나도 없으면 이 단추 자체가 안 보입니다 — 카메라 탭에서 «지금 구도 저장» 을 먼저 하세요. 오른쪽의 «0.00s / 5.0s» 는 읽기만 하는 칸으로, 앞이 재생 머리 시각 · 뒤가 총 길이입니다.",
      action: "해 볼 것: «출발: …» 을 눌러 재생 머리를 0초로 보내 보세요.",
      why: "계산은 처음부터 맞았는데 화면에 안 보여 「구도 1로 잡은 카메라가 의미가 없네」 가 됐습니다. 출발점은 글자로 보여야 믿을 수 있습니다.",
    },
    {
      id: "planner-keys-ruler",
      route: P,
      page: "planner",
      anchor: "bottom-ruler",
      title: "눈금자와 재생선 — 시각을 옮기는 자리는 여기 하나",
      body: "빨간 세로선과 그 위의 오각형 머리가 «지금 몇 초를 보고 있는가» 입니다. 이 선은 손이 닿지 않습니다 — 끌 수 없게 만들어 두었습니다. 시각을 옮기려면 그 위 눈금자를 누르거나, 누른 채 좌우로 끄세요(스크럽). 선을 끌 수 있게 두면 촘촘한 키 위를 지나다 키를 잘못 집습니다. 재생 중에는 이 선만 따로 움직이고 나머지 화면은 그대로입니다 — 프레임마다 화면을 다시 그리면 3D 씬이 통째로 새로 지어지기 때문입니다. 정확히 키 자리로 가려면 눈금자 대신 머리줄의 앞 · 다음 키프레임 단추를 쓰세요(손으로 맞추면 0.05초씩 어긋나 새 키가 생깁니다).",
      action: "해 볼 것: 눈금자를 누른 채 좌우로 끌어 보세요. 빨간 선과 3D 화면이 같이 따라옵니다.",
    },
    {
      id: "planner-keys-empty",
      route: P,
      page: "planner",
      anchor: "bottom-shot-presets",
      title: "«아직 무빙이 없습니다» 가 떴을 때",
      body: "클립이 하나도 없으면 목록 자리에 «아직 무빙이 없습니다 — 카메라는 고정입니다» 가 뜹니다. 그 뒤에 적힌 «무빙 더하기» 와 «카메라 탭» 은 지금 화면에 없는 옛 이름이니 찾지 마세요 — 무빙을 더하는 자리는 바로 위의 무빙 아이콘 줄(달리 · 오빗 · 팬 · 틸트 · 트럭 · 크레인 · 줌 · 자유 경로)이고, 아이콘 하나를 누르면 클립이 한 줄 생깁니다. 클립이 없어도 인물 · 소품 · 방 키는 따로 찍을 수 있습니다 — 그때는 카메라만 가만히 있는 컷입니다.",
      action: "해 볼 것: 무빙 아이콘 줄에서 아이콘 하나를 눌러 클립을 한 줄 세워 보세요.",
    },
    {
      id: "planner-keys-dots",
      route: P,
      page: "planner",
      anchor: "bottom-layers",
      title: "키 점 — 마름모 하나가 «그 시각의 값»",
      body: "인물 · 소품 줄의 작은 마름모가 키 하나입니다 — «이 시각에 이 값이었다» 고 박아 둔 못이고, 못과 못 사이는 앱이 이어 줍니다. 끌면 그 키의 시각이 옮겨지고, 한 번 누르면 골라져 하얗게 되며 Delete 로 지웁니다. 주황색으로 보이는 키는 다음 걸음의 «고무줄» 로 잡아 둔 키입니다. 보이는 점은 아주 작지만 눌림을 받는 판은 그보다 넓게 깔려 있어, 모캡으로 들어온 촘촘한 키도 점 가까이만 누르면 집힙니다(그래도 안 집히면 배율 «+» 로 옆으로 늘리세요). 마우스를 올리면 «누구 · 무슨 채널 · 몇 초» 가 뜹니다.",
      action: "해 볼 것: 키 점 하나를 눌러 고른 뒤 좌우로 살짝 끌어 보세요. Ctrl+Z 로 되돌아옵니다.",
    },
    {
      id: "planner-keys-band",
      route: P,
      page: "planner",
      anchor: "bottom-layers",
      title: "고무줄 — 빈 자리를 끌어 여러 키를 한꺼번에",
      body: "키 줄의 빈 자리를 누른 채 옆으로 끌면 노란 띠가 생기고, 그 구간에 든 키가 잡힙니다. 어느 줄에서 끌었든 모든 인물 · 모든 채널의 키를 함께 잡는 것이 중요합니다 — 한 동작은 이동 · 회전 · 자세가 같이 움직여야 하고, 둘이 함께 추는 춤은 둘을 같이 밀어야 하니까요. 잡아 둔 키 하나를 끌면 무리가 통째로 따라옵니다(«도입부를 1초 뒤로 통째로 밀기» 가 이것입니다). 끈 폭이 아주 좁으면, 즉 톡 누른 셈이면 잡은 것이 전부 풀립니다.",
      action: "해 볼 것: 키 줄의 빈 자리를 누른 채 옆으로 끌어 키 여러 개를 잡아 보세요.",
    },
    {
      id: "planner-keys-badges",
      route: P,
      page: "planner",
      anchor: "bottom-key-band",
      title: "«키 N개 잡음 · 풀기» 와 «끝 뒤 N개»",
      body: "«키 N개 잡음 · 풀기» 는 고무줄로 몇 개를 잡아 두었는지 세어 보여 주고, 누르면 전부 풉니다(키 줄의 빈 자리를 톡 눌러도 풀립니다). 잡아 둔 것을 잊은 채 키 하나를 끌면 무리가 통째로 따라와 놀라므로, 잡은 수는 늘 세어 둡니다. 바로 옆의 «끝 뒤 N개» 는 총 길이 뒤로 밀려나 화면에서 가려진 키 수입니다 — 지워진 것이 아닙니다. 길이를 5초로 줄이면 7초의 키는 안 보일 뿐 그대로 있고, 다시 늘리면 제자리에 돌아옵니다.",
      action: "해 볼 것: 키를 몇 개 잡은 뒤 «키 N개 잡음 · 풀기» 를 눌러 풀어 보세요.",
      why: "길이를 줄였다가 「키가 지워졌다」 고 읽는 일이 있었습니다. 세어 주면 오해가 없습니다.",
    },
    {
      id: "planner-keys-bones",
      route: P,
      page: "planner",
      anchor: "bottom-layers",
      title: "관절 줄 — 이름을 누르면 그 관절이 잡힙니다",
      body: "인물 레이어의 «▸ 자세» 를 펴면 움직인 관절마다 «· 왼팔» «· 머리» 처럼 이름 줄이 섭니다. 이름을 누르면 그 인물의 그 관절이 잡혀 3D 화면에 기즈모(빨 · 초 · 파 링)가 붙습니다 — 배치 탭으로 건너가 파이 메뉴를 다시 열 필요 없이, 타임라인에서 손을 떼지 않고 그 자리에서 각도를 고칩니다. 잡힌 줄은 초록으로 밝아집니다. 이름에 마우스를 올리면 그 관절의 키가 «1.20초 12°·0°·−30°» 꼴로 줄줄이 떠, 숫자만 훑어도 어느 키가 튀었는지 보입니다 — 모캡으로 들어온 키를 손보는 가장 빠른 길입니다.",
      action: "해 볼 것: «▸ 자세» 를 펴고 관절 이름 하나를 눌러 3D 화면에 기즈모가 붙는지 보세요.",
    },
    {
      id: "planner-keys-amount",
      route: P,
      page: "planner",
      anchor: "bottom-clip-length",
      title: "이동량 키의 값 고치기",
      body: "프리셋 클립(달리 · 오빗 · 팬 …)의 «이동량» 은 클립 전체가 «지금 자세에서 얼마나» 가는지이고, 클립 안의 작은 키는 «그 시각에는 여기까지» 입니다. 키 점을 한 번 누르면 손잡이 줄에 «1.20초» 와 숫자칸이 열려 그 자리 이동량만 고칩니다 — 클립 전체 이동량 옆에 나란히 놓여 «이 클립은 −2.5까지 가는데 1.2초에는 −1» 을 같이 보며 맞출 수 있습니다. 점을 두 번 누르면 «1.20초의 이동량» 입력 창이 떠, 이 무빙의 단위(도 · 배율 · 미터)가 무엇인지 안내와 함께 숫자를 받습니다. 중간에서 속도를 꺾을 일이 없으면 키 없이 클립 이동량 하나로 충분합니다.",
      action: "해 볼 것: 클립 안의 이동량 키 점을 두 번 눌러 값 입력 창을 열어 보세요.",
    },
    {
      id: "planner-keys-free",
      route: P,
      page: "planner",
      anchor: "bottom-free-key",
      title: "자유 경로 — 갈래마다 따로 찍는 키와 값 판",
      body: "«자유 경로» 클립은 아래에 «↳ 이동» «↳ 바라보는 곳» «↳ 줌» 세 줄을 따로 내줍니다. 줄 끝의 «+» 는 재생 머리 자리에 그 갈래 하나만 키로 찍습니다 — 위의 «+ 키 전부» 가 자리 · 시선 · 줌을 통째로 찍는 것과 다릅니다. «카메라는 가만두고 줌만 천천히 당기기» 가 그래서 됩니다. 키를 누르면 타임라인 위에 «자유 경로 · N초 키» 값 판이 떠서 «카메라 자리(m)» 와 «바라보는 곳(m)» 을 숫자로 받습니다 — 회전을 각도가 아니라 «보는 점» 으로 적는 까닭은 같은 그림을 만드는 각이 여럿이라 손으로 맞추기가 아주 어렵기 때문입니다(인물 발밑이 (0,0,0) 이면 그 값을 그대로 적으면 됩니다). 다 고쳤으면 판 오른쪽 위 «닫기»(X) 로 내려야 아래 키 줄이 다시 보입니다.",
      action: "해 볼 것: 자유 경로 클립의 «↳ 줌» 줄에서 «+» 를 눌러 줌 키만 하나 찍어 보세요.",
    },
    {
      id: "planner-keys-graph",
      route: P,
      page: "planner",
      anchor: "bottom-easing",
      title: "속도 그래프 판 — 속도 · 진행률 · 닫기",
      body: "«속도 그래프» 를 누르면 타임라인 위에 겹쳐 작은 판이 뜹니다(타임라인 안에 끼우면 판이 그래프 높이만큼 자라 구도잡기 머리말까지 밀어 올립니다). 판 왼쪽 위의 «속도» «진행률» 은 같은 곡선을 두 그림으로 보는 전환일 뿐, 어느 쪽에서 고쳐도 고쳐지는 것은 하나입니다 — «속도» 는 기울기를 그린 포물선이라 «어디서 빨라지고 어디서 멈추나» 를, «진행률» 은 0에서 1로 오르는 S자라 «지금까지 얼마나 갔나» 를 읽습니다. 한쪽이 눈에 안 들어오면 다른 쪽으로 넘겨 보세요. 볼 일이 끝나면 오른쪽 위 «닫기»(X) 로 내려야 가려졌던 키 줄이 다시 보입니다.",
      action: "해 볼 것: «속도 그래프» 를 열고 «속도» 와 «진행률» 을 번갈아 눌러 같은 곡선이 어떻게 달리 보이는지 견줘 보세요.",
    },
    {
      id: "planner-keys-rooms",
      route: P,
      page: "planner",
      anchor: "bottom-room-rows",
      title: "방 키 네모 — 가림 · 투시",
      body: "«방 · 가릴 면 · 소품» 묶음의 키만 마름모가 아니라 네모입니다. 꽉 찬 네모가 «가림»(소품 줄에서는 «투시»), 빈 네모가 «안 가림»(«막음») — 색만으로는 안 갈려서 모양을 달리했습니다. 네모도 똑같이 끌어서 시각을 옮기고, 눌러 고른 뒤 Delete 로 지웁니다. 카메라가 벽을 넘어 들어가는 컷에서 «3초까지는 앞벽이 가리고 그 뒤로는 열린다» 를 이 줄 하나로 적습니다. 호리존 방을 폈는데 «↳ 소품 없음» 만 뜬다면 빈 것이 아니라 호리존에는 가릴 면이 아예 없어서입니다 — 환경 탭의 «이 방의 소품» 으로 제품을 세우면 그 투시 줄이 여기 생깁니다.",
      action: "해 볼 것: 방 줄의 «가림 / 열림» 을 눌러 키를 하나 찍고, 생긴 네모를 좌우로 끌어 보세요.",
    },
  ],
};

const PLANNER_ENV: Tutorial = {
  id: "planner-env",
  kind: "planner",
  page: "planner",
  title: "환경 탭 구석구석",
  summary: "planner.ts 의 기존 «방과 환경»(planner-rooms) 은 이미 11걸음이라 14개를 얹으면 16을 넘깁니다. 그래서 그 뒤를 잇는 새 갈래 planner-env(kind \"planner\", page \"planner\", 12걸음)를 냅니다 — 숫자 칸 키 조작 · 호리존 ",
  steps: [
    {
      id: "planner-env-sections",
      route: P,
      page: "planner",
      anchor: "env-room-section",
      title: "접히는 칸과 안 접히는 칸",
      body: "«방» 머리줄 왼쪽에 화살표가 있지만 늘 아래를 가리키고, 눌러도 접히지 않습니다 — 방이 없으면 이 탭에서 할 일이 없어 늘 펴 둡니다. 맨 아래 «화면» 도 같습니다. 이 탭에서 진짜로 접히는 머리줄은 «방 라이브러리» 하나뿐입니다. 방을 누르면 그 아래로 펴지는 것(치수 · 뒤를 가릴 면 · 6면 세트 · 파노라마 그림 · 이 방의 소품)은 섹션이 아니라 그 방 줄에 딸린 속성이라, 다른 방을 누르면 그쪽이 펴지고 이쪽이 닫힙니다.",
      action: "해 볼 것: «방» 머리줄을 한 번 눌러 보세요 — 안 접히는 것이 맞습니다. 아래 «방 라이브러리» 머리줄은 접힙니다.",
      why: "방 목록을 접을 수 있게 두었더니 «방이 없는 컷» 과 «접어 둔 컷» 이 화면에서 똑같아 보였습니다. 새 컷에는 방이 없는 것이 기본이라 그 둘은 구분되어야 합니다.",
    },
    {
      id: "planner-env-number-keys",
      route: P,
      page: "planner",
      anchor: "env-room-size",
      title: "숫자 칸에서 ↑ / ↓",
      body: "구도잡기의 숫자 칸은 치수든 자리든 전부 같은 입력칸입니다. 칸을 누르고 ↑ 를 누르면 한 눈금 오르고 ↓ 면 내립니다 — 마우스로 끌 손잡이가 없으니 «조금만 더» 는 이 키로 맞추는 것이 가장 빠릅니다. 눈금은 칸마다 다릅니다: 방의 가로 · 깊이 · 층고는 0.1 m, 돔의 반지름은 0.5 m, 회전은 15°. 방 치수는 0.4 m 아래로 내려가지 않고 소품 크기는 0.1 아래로 내려가지 않습니다 — 키를 계속 눌러도 거기서 멈춥니다. 소수점과 음수도 그냥 칠 수 있습니다(«-» 만 친 중간 상태도 0 으로 튀지 않습니다).",
      action: "해 볼 것: «가로 (m)» 칸을 누르고 ↑ 를 세 번 눌러 방을 0.3 m 넓혀 보세요.",
    },
    {
      id: "planner-env-horizon-presets",
      route: P,
      page: "planner",
      anchor: "env-horizon-color",
      title: "호리존 여섯 색",
      body: "호리존 방에는 색 칩이 여섯 있습니다 — «흰색» · «밝은 회색» · «18% 회색» · «검정» · «크로마 그린» · «크로마 블루». 제품 컷의 기본은 순백이 아니라 «밝은 회색» 입니다(순백은 노출이 날아가 제품 모서리가 배경에 먹힙니다). «18% 회색» 은 노출을 재는 기준이 되는 중간 회색이고, 크로마 두 색은 나중에 배경을 갈아 끼울 작정일 때 쓰는 합성용입니다. 칩 한 번이 여섯 면 전부를 그 색으로 잇고 되돌리기 한 칸이 됩니다. 지금 색과 같은 칩에는 파란 테두리가 켜져 «지금 무슨 색인지» 를 알려 줍니다. 여섯 밖의 색이 필요하면 오른쪽 위 «#f2f2f2» 칩을 눌러 고르개로 찍습니다.",
      action: "해 볼 것: 호리존 방이 있으면 «18% 회색» 을 눌러 보고 Ctrl+Z 로 되돌리세요.",
      why: "색 고르개는 끄는 동안 눈금마다 색이 바뀝니다. 그걸 그대로 되돌리기에 쌓으면 한 번 고른 색이 앞의 기록을 통째로 밀어내서, 창을 여는 순간 한 번만 기록하게 해 두었습니다 — 고르개로 한참 끌어도 Ctrl+Z 한 번이면 열기 전 색입니다.",
    },
    {
      id: "planner-env-group",
      route: P,
      page: "planner",
      anchor: "env-room-props",
      title: "덩어리 줄 — 함께 숨기기 · 덩어리 에셋",
      body: "소품 여럿을 묶으면 «이 방의 소품» 목록에 색 사각형과 «N개» 가 붙은 덩어리 줄이 한 줄로 섭니다. 줄의 눈은 그 덩어리에 속한 소품을 **전부 함께** 숨기고 함께 보입니다 — 의자 넷을 하나씩 끄지 않아도 되고, 하나만 남아 보이는 일도 없습니다. 덩어리를 고르면 아래에 «이 덩어리의 에셋 만들기 — 시트를 뽑아 바로 잇습니다» 가 뜹니다. 누르면 덩어리 이름 그대로 에셋 카드가 생겨 이 덩어리에 걸리고, 이미 걸어 둔 카드가 있으면 ««식탁 세트» 열기 — 시트 뽑기» 로 바뀌어 배경 에셋 창에서 그 카드를 엽니다. 묶음에 에셋을 걸어야 프롬프트에도 의자 넷이 아니라 «식탁 세트» 하나로 실립니다.",
      action: "해 볼 것: 덩어리가 있으면 줄의 눈을 눌러 통째로 숨겼다가 다시 보이게 해 보세요.",
    },
    {
      id: "planner-env-axis-reset",
      route: P,
      page: "planner",
      anchor: "env-room-props",
      title: "축 하나만 되돌리는 ↺",
      body: "고른 소품의 «위치» · «회전» · «크기» 는 각각 세 칸입니다(크기 칸 이름은 X·Y·Z 가 아니라 가로 · 높이 · 깊이). 칸 이름 옆마다 아주 작은 ↺ 가 하나씩 있고, 그 축 **하나만** 기본값으로 돌립니다 — 위치와 회전은 0, 크기는 1. 이미 기본값인 축의 ↺ 는 흐리게 꺼져 있어서, 켜져 있는 것만 훑어도 «내가 건드린 축» 이 어디인지 보입니다. 세 축을 한꺼번에 되돌리는 단추는 없습니다 — ↺ 를 셋 누르거나 Ctrl+Z 로 돌아가세요.",
      action: "해 볼 것: 소품을 하나 고르고 «회전» 의 Z 를 바꾼 뒤 그 옆 ↺ 를 눌러 그 축만 되돌려 보세요.",
      why: "축마다 따로 둔 까닭은 «높이만 잘못 만졌다» 가 훨씬 잦기 때문입니다. 셋을 한 번에 되돌리면 애써 맞춘 나머지 둘까지 날아갑니다.",
    },
    {
      id: "planner-env-object-color",
      route: P,
      page: "planner",
      anchor: "env-room-props",
      title: "소품 색 — 열두 칩과 직접 고르기",
      body: "색은 3D 화면에서 어느 상자가 무엇인지 가리는 표시이면서, 그대로 프롬프트의 낱말이 됩니다(구도 캡처에는 이름표가 안 나가기 때문에 «저 상자가 소파» 라는 말을 색으로 합니다). 칩은 회색 · 빨강 · 주황 · 노랑 · 초록 · 청록 · 파랑 · 보라 · 분홍 · 갈색 · 흰색 · 검정 열둘이고, 맨 끝의 작은 색칸(«소품 색 직접 고르기»)으로 그 밖의 색도 찍을 수 있습니다. 다만 프롬프트에는 «#e2534f» 가 아니라 **가장 가까운 열두 색의 이름**으로 번역되어 실립니다 — 생성기는 그림에서 «빨간 상자» 는 찾아도 코드값은 못 찾습니다. 칸 아래 한 줄이 «빨강 box = 가방» 처럼 지금 실릴 문장을 그대로 보여 줍니다.",
      action: "해 볼 것: 소품을 고르고 «소품 색 직접 고르기» 로 아무 색이나 찍어 보세요 — 아래 문장의 색 이름이 열두 색 중 하나로 바뀝니다.",
    },
    {
      id: "planner-env-gallery",
      route: P,
      page: "planner",
      anchor: "env-gallery-search",
      title: "배경 라이브러리 — 이름으로 찾기",
      body: "«6면 세트» 옆 «그림 전체보기» 를 누르면 화면을 덮는 «배경 라이브러리» 가 뜹니다. 오른쪽 판의 작은 칸에서는 안 보이던 세트를 큰 그림으로 훑고, 눌러서 이 방에 통째로 거는 자리입니다. 머리줄의 «이름 검색...» 은 세트 이름과 아래 전개도 원본 이름을 **같이** 걸러 냅니다 — «카페» 를 치면 «카페 6면 세트» 와 «카페 전개도» 가 함께 남습니다. 다 봤으면 검색칸 바로 오른쪽 X(«닫기»)로 덮개를 걷고 환경 탭으로 돌아옵니다. 세트를 하나 누르면 방에 걸면서 저절로 닫히니, X 는 «아무것도 안 걸고 나갈 때» 쓰는 것입니다.",
      action: "해 볼 것: «그림 전체보기» 를 열고 검색 칸에 방 이름 한 글자를 쳐 보세요.",
    },
    {
      id: "planner-env-gallery-sources",
      route: P,
      page: "planner",
      anchor: "env-gallery-sources",
      title: "전개도 원본 · 배경 그림",
      body: "배경 라이브러리를 아래로 굴리면 두 번째 묶음이 나옵니다. 여기 있는 것은 여섯 면으로 잘리기 **전** 한 장짜리 원본이라, 눌러도 아무 일이 없습니다 — 일부러 그렇게 두었습니다. 방에 붙는 것은 잘린 여섯 면이고, 원본은 «이 세트가 무엇에서 나왔나» 를 눈으로 대조하는 자리입니다. 머리줄에 «세트 N개 · 전개도 원본 N장» 으로 둘의 수가 따로 적혀 있어, 뽑아 둔 전개도 중 아직 안 잘린 것이 있는지도 여기서 셉니다.",
      action: "해 볼 것: 아래 «전개도 원본 · 배경 그림» 줄까지 굴려 내려, 세트가 어느 한 장에서 잘렸는지 견주어 보세요.",
      why: "예전에는 이 창이 낱장 목록이라 고른 그림이 «지금 면»(정면) 한 장에만 붙었습니다. 세트를 보여 주면서 한 면만 거는 것은 화면이 거짓말을 하는 것이라, 거는 목록은 세트로 바꾸고 원본은 보기만 하는 자리로 갈라 두었습니다.",
    },
    {
      id: "planner-env-borrow",
      route: P,
      page: "planner",
      anchor: "env-room-borrow",
      title: "다른 작품에서 방 끌어오기",
      body: "«방 라이브러리» 목록은 이 작품 것만 담습니다 — 작품이 쌓일수록 목록이 한없이 길어지지 않게 그렇게 나눠 두었습니다. 그래서 다른 작품에서 저장해 둔 방은 «다른 작품에서 방 끌어오기» 로 **복사해** 들여옵니다. 창에는 방마다 한 줄씩 «이름 · 어느 작품 · 소품 N개 · 걸린 면 N장» 이 서고, 줄을 누르면 왼쪽 ✓ 가 켜집니다. 여럿 켜 두고 «가져오기» 를 한 번 누르면 한꺼번에 복사되고, «닫기» 는 아무것도 안 가져오고 나갑니다. 가져온 뒤에는 원래 작품과 아무 관계가 없어서, 여기서 고치거나 지워도 저쪽은 그대로입니다. 걸려 있는 면 그림만 따라오고 안 건 면은 안 옵니다.",
      action: "해 볼 것: «다른 작품에서 방 끌어오기» 를 열어 목록만 보고 «닫기» 로 나오세요. 저장해 둔 방이 없으면 «끌어올 방이 없습니다» 가 뜹니다.",
    },
    {
      id: "planner-env-library-remove",
      route: P,
      page: "planner",
      anchor: "env-room-library",
      title: "«라이브러리에서 지우기» — 목록에서만",
      body: "방 라이브러리 줄 오른쪽 끝의 작은 X 입니다. 이름 그대로 목록에서 그 저장본만 빼는 단추이고, 이미 세워 둔 방도 걸어 둔 그림 파일도 건드리지 않습니다 — 잃을 것이 없으니 묻지도 않고 바로 사라집니다. 이 탭의 다른 지우기들과 헷갈리지 마세요: 아래 «파노라마 그림» 의 × 는 폴더의 원본까지 지우고, 장소 카드 창의 휴지통은 카드를 작품에서 지웁니다. 잘못 빼도 그 방을 세운 컷에서 «지금 방 저장 — 방 + 안의 소품까지» 를 한 번 더 누르면 다시 담깁니다.",
      action: "해 볼 것: 자리만 확인하세요. 누르면 묻지 않고 그 저장본이 목록에서 사라집니다 — 세워 둔 방과 그림은 그대로입니다.",
    },
    {
      id: "planner-env-panorama-delete",
      route: P,
      page: "planner",
      anchor: "env-panoramas",
      title: "파노라마 카드의 × — 폴더의 원본까지",
      body: "실외 방의 «파노라마 그림» 목록에서 카드 오른쪽 위에 겹쳐 있는 작은 × 입니다(줄을 하나 더 쓰면 카드가 반으로 작아져 그림 위에 얹었습니다). 이것은 목록에서 빼는 단추가 **아닙니다** — «저장 폴더의 원본 파일도 함께 지워집니다. 되돌릴 수 없습니다» 를 한 번 묻고, 예라고 하면 프로젝트 폴더의 그 그림 파일 자체를 지웁니다. 지금 걸어 둔 돔을 떼기만 할 생각이었다면 × 가 아니라 위쪽의 «돔 풀기» 입니다. 목록에 다시 채우려면 «파노라마 만들기» 로 뽑거나 360° 그림을 이 자리에 끌어다 놓으면 됩니다.",
      action: "해 볼 것: 자리만 확인하세요. 누르면 확인 창이 뜨고, 예라고 하면 저장 폴더의 원본 그림까지 지워집니다.",
      why: "목록에서만 빼면 폴더를 다시 읽을 때 그 그림이 되살아나 «지웠는데 또 있네» 가 됩니다. 그래서 이 앱은 «화면에서 지우면 폴더의 원본도 지운다» 로 통일해 두었고, 여기만은 Ctrl+Z 도 소용없습니다 — 파일이 이미 없습니다.",
    },
    {
      id: "planner-env-place-remove",
      route: P,
      page: "planner",
      anchor: "env-place-remove",
      title: "장소 카드의 «지우기»",
      body: "«전개도 만들기»(실외는 «파노라마 만들기») 나 «열기» 로 뜨는 장소 카드 창에서, 이름칸 오른쪽의 빨간 휴지통입니다. 창 오른쪽 맨 끝 X 는 창만 닫는 단추이니 헷갈리지 마세요 — 그래서 둘 사이를 일부러 비워 두었습니다. 휴지통을 누르면 이 장소 카드를 작품에서 지우고 창이 함께 닫히며, 그 카드가 지금 방에 이어 둔 것이었으면 방의 «장소» 이음까지 끊어 빈 칸으로 돌아갑니다(벽 그림 카드는 방과 무관해서 이음을 안 건드립니다). 사라지는 것은 카드와 그 안의 프롬프트·분석이고 폴더의 그림 파일은 남지만, 묻지 않고 지우며 구도잡기의 Ctrl+Z 로도 안 돌아옵니다 — Ctrl+Z 는 구도(방 · 인물 · 소품)만 되돌립니다. 방에서 떼기만 할 생각이면 카드를 지우지 말고 환경 탭 장소 드롭다운 옆 × 를 쓰세요.",
      action: "해 볼 것: 자리만 확인하세요. 누르면 묻지 않고 장소 카드가 사라지고 창이 닫힙니다.",
    },
  ],
};

export const PLANNER_TUTORIALS: Tutorial[] = [
  BASICS,
  ROOMS,
  CHARACTERS,
  OBJECTS,
  CAMERA,
  TIMELINE,
  RENDER,
  MOCAP,
  MUSIC,
  GLB,
  SHORTCUTS,
  PLANNER_SCREEN,
  PLANNER_HANDLES,
  PLANNER_ENV,
  PLANNER_TIMELINE_TAB,
  PLANNER_KEYS,
];
