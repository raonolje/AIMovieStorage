import type { Tutorial } from "./types";

/** Legacy direct-generation UI remains in source but is no longer a tutorial target. */
export const RETIRED_DIRECT_GENERATION_ANCHORS = ["card-local-generate", "bgm-local-generate"] as const;

export const COMFY_WORKFLOW_TUTORIAL: Tutorial = {
  "id": "page-comfy-workflow",
  "kind": "page",
  "page": "settings",
  "pages": [
    "basics",
    "characters",
    "scenes",
    "finish",
    "bgm"
  ],
  "title": "ComfyUI workflow 시작하기",
  "summary": "라이브러리 가져오기부터 역할·참조·프롬프트·검사·작업과 결과 등록까지. 후보와 실제 실행 지원을 구분합니다.",
  "steps": [
    {
      "id": "page-comfy-workflow-support",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "후보와 실행 preset은 다릅니다",
      "body": "중앙 폴더의 27후보·35등록 파일은 오프라인 검사를 통과한 초안입니다. 현재 실제 실행 registry는 exact Music3만 지원합니다. H3/LTX 등 다른 후보, 혼합 모델 역할, maskVideo, 검토되지 않은 custom TTS/SDNQ는 차단될 수 있습니다. 실제 생성·청취·수집등록 검증은 0회입니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-endpoint",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "실제 Comfy 서버 주소 확인",
      "body": "설정의 «ComfyUI workflow (그림·영상·음악·목소리)»에서 «Comfy 서버 주소»와 «검사한 Comfy 설치 폴더»를 확인합니다. 사용할 인스턴스가 켜져 있어야 합니다. 기존 주소는 보존되며 «연결 저장»으로 선택한 주소를 적용합니다. 과거 Desktop 8189와 별도 8188을 같은 서버로 추정하지 마세요.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-index",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "중앙 INDEX에서 후보 선택",
      "body": "«등록 entry / INDEX.json 파일 가져오기»로 저장소의 Workflows\\ComfyUI\\INDEX.json을 선택합니다. 목록에서 원하는 V1/V2 «등록 초안 가져오기»를 고릅니다. 기존 앱 라이브러리에서는 저장된 버전·hash·역할을 다시 선택할 수 있습니다. 가져오기는 실행 허가가 아닙니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-import",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "API graph와 등록 entry 불러오기",
      "body": "개별 app-registration-entry.json도 같은 가져오기 버튼으로 읽습니다. 새 workflow.api.json은 «API JSON 고르기» → «API graph 읽기 및 입력 역할 편집» 순서입니다. ComfyUI 편집용 nodes/links JSON은 API 실행 JSON과 다릅니다. 편집 화면에서 API 형식으로 export하고, 앱은 이를 임의 변환해 실행하지 않습니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-requirements",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "필요한 노드·모델 오류 확인",
      "body": "«초안 검사·라이브러리 등록»이 보여 주는 정확한 node class·입출력 schema·모델 파일·full SHA·허가 사유를 확인합니다. 파일 이름이 비슷하거나 노드가 설치됐다는 사실만으로 지원하지 않습니다. cached enum 미등록은 디스크 파일 부재를 단정하지 않으며, 이 앱의 옛 직접 모델 다운로드로 해결하지 않습니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-revision",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "프로젝트 검사와 버전 보존",
      "body": "«검사·허가 대상 프로젝트»를 선택하고 역할을 확인한 뒤 등록합니다. 다른 프로젝트의 ID는 «이 프로젝트에 새 ID로 복사»로 분리합니다. graph는 앱 전용 snapshot/hash/revision으로 보관하고 V2 원문을 저장·복구합니다. 가져온 manifest·grant·실행 boolean은 신뢰된 허가 기록으로 채택하지 않습니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-prompt",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "선택한 모델·역할로 프롬프트 작성",
      "body": "카드·컷의 «Comfy 모델·작업·역할»에서 workflow를 고른 뒤 «프롬프트 작성»을 사용합니다. positive/negative는 선택한 역할과 지원 여부를 따릅니다. 선택이나 hash가 바뀌면 이전 작성 기록은 stale로 표시되지만 수동 문장은 유지됩니다. 새 규칙을 적용하려면 명시적으로 다시 선택·재작성하세요.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-references",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "이미지·영상·오디오 참조 순서",
      "body": "«workflow 역할별 입력·참조·LoRA»에서 같은 프로젝트에 등록된 참조를 역할별로 고릅니다. 0/1/2/N fixed variant의 min/max와 순서를 맞추고 «입력 저장»으로 보관합니다. 초과·누락을 몰래 생략하거나 이미지를 합성·복제하지 않습니다. 영상은 실제 fps·프레임·길이와 오디오 트랙을 검사합니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-variants",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "참조 의미와 지원 variant 구분",
      "body": "첫/끝 프레임, identity 참조, face/body 교체, native inpainting, pose/depth/camera, driving audio는 서로 다른 조건입니다. 이름만 보고 대체하지 않습니다. 정적 마스크 합성을 native inpainting이나 모션 제어로 표시하지 않으며, maskVideo는 현재 차단됩니다. 지원되지 않는 역할·혼합 모델은 오류를 확인하세요.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-timebase",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "참조 시간축과 실제 입력 값",
      "body": "fps·프레임 수·길이 슬롯은 실제로 바인딩한 값이 우선입니다. 여러 값이 충돌하거나 누락되면 차단합니다. 해당 슬롯이 없을 때만 검토된 graph의 고정값을 사용합니다. 알 수 없는 계산·alias를 추정하지 않습니다. 길이 오류는 참조 구간과 variant의 규칙을 확인해 수정하세요.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-shared",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "개별·일괄·조종기는 같은 검사",
      "body": "«입력 저장»의 역할별 참조 ID·scalar는 «컴피로 뽑기», 일괄 생성, 조종기의 공통 workflow 요청에 사용됩니다. 프로젝트 기본과 컷 override가 선택한 workflowId/hash/roleId/modelRuleId를 유지합니다. 어느 경로도 unsupported 조건이나 실행 registry를 우회하지 않습니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-music",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "BGM Comfy와 Suno를 구분",
      "body": "BGM의 «생성 도구»에서 Comfy를 고르면 등록된 음악 workflow의 모델·역할로 스타일과 가사를 작성합니다. Suno는 외부 도구용 Style/Lyrics·Exclude Styles를 준비하는 별도 선택입니다. Music3의 연주곡 변환과 가사 끝 [end] 1회 규칙을 보존하지만 보컬·무보컬 품질은 실제 청취로 확인해야 합니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-voice",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "TTS는 본문·언어·목소리 입력",
      "body": "«목소리 레퍼런스»의 TTS는 읽을 본문을 그대로 두고 언어·목소리 프로필·연기 톤·voiceReference를 분리합니다. 노래나 시각 장면 프롬프트로 바꾸지 않습니다. 대표 영상에서 음성을 추출하는 기능은 별도입니다. custom TTS는 정적 검사를 통과해도 실제 다운로드 차단·소스 증거가 없으면 실행이 막힙니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-jobs",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "상단 작업·출력 폴더·수집 등록",
      "body": "상단 «작업»에서 대기·진행·실패 사유를 확인합니다. graph의 output nodes와 실제 job 결과를 검사한 뒤 프로젝트/BGM/목소리 폴더에 수집·등록합니다. 출력 파일 존재와 등록 완료는 다릅니다. «대기 중지 (서버 작업 유지)»는 서버 생성을 취소하지 않습니다. 이 튜토리얼은 실제 생성 없이 확인합니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    },
    {
      "id": "page-comfy-workflow-updates",
      "route": "/settings",
      "page": "settings",
      "anchor": "settings-comfy-generation",
      "advanceOn": "manual",
      "title": "Comfy 업데이트 뒤 재검사",
      "body": "Comfy core·Python·Torch·node 버전과 소스·입출력 schema fingerprint가 바뀌면 등록 검사 기록이 무효화됩니다. 같은 버전이라도 schema가 달라지면 차단합니다. 원본을 보존하고 새 revision으로 다시 검사하세요. 앱의 LoRA 다운로드 중복 관리는 종료됐으며 HF/Civitai 토큰은 기존 저장소에 보존하고 workflow·manifest·내보내기에 넣지 않습니다.",
      "action": "해 볼 것: 해당 설정과 차단 사유를 확인하고 다음으로 넘어가세요. 실제 생성은 실행하지 않습니다."
    }
  ]
};
