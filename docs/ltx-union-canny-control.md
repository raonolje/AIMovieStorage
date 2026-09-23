# LTX 2.5 구도 레퍼런스의 윤곽 구조 제어

구도잡기에서 **타임라인 카메라와 인물 동작을 함께 렌더한 영상**의 윤곽을 LTX Union의 구조 기준으로 전달합니다. 원본 모캡의 뼈 그림만 전달하는 기존 포즈 입력과는 다릅니다. 독립적인 카메라 좌표 API가 아니며, 카메라 궤적·인물 동작·정체성의 정확한 복제를 보장하지 않습니다. 모델의 실제 추종 품질은 생성 결과로 확인해야 합니다.

## 공식 모델과 앱 경로

- 기본 모델은 `Lightricks/LTX-2.5-Diffusers`입니다.
- Union은 `Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control`의 `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors`입니다. 파일명의 2.3은 임의 구형 대체가 아닙니다. [LTX 공식 2.5 Union 가이드](https://docs.ltx.io/open-source-model/feature-guides/structural-control/union-control)가 이 파일을 지정합니다.
- `LTX2InContextPipeline`의 `reference_conditions`와 `reference_downscale_factor=2`를 사용합니다. 첫 이미지가 있으면 별도의 `LTX2VideoCondition`으로 넣습니다.
- 기본은 기존 distilled 단일 단계입니다. «LTX 품질 → 2단계 고해상도 정제»를 선택하면 절반 크기의 8단계 생성 → 공간 latent 2배 확대 → 3단계 정제를 수행합니다. [공식 Python IC-LoRA 경로](https://github.com/Lightricks/LTX-2/blob/main/packages/ltx-pipelines/src/ltx_pipelines/ic_lora.py)처럼 Union과 사용자가 고른 LoRA는 첫 단계에만 적용합니다. 첫 이미지 조건은 두 단계에 전달하고, 원본 프레임 수와 FPS는 유지합니다.
- Canny 기본 임계값은 공식 가이드의 92/200입니다. 원본을 출력 크기로 맞춘 뒤 윤곽을 만들고 절반 크기로 전달합니다. 첫 이미지와 구조 참조 모두 전체 화면을 같은 출력 눈금으로 맞추므로, 다른 화면비를 지정하면 늘어날 수 있습니다.
- [공식 워크플로에서 사용하는 Canny 주석기 구현](https://github.com/Fannovel16/comfyui_controlnet_aux/blob/main/src/custom_controlnet_aux/canny/__init__.py)처럼 RGB 배열에 Canny를 적용합니다. 먼저 회색으로 바꾸어 밝기가 비슷한 색상 경계를 잃지 않습니다. 앱은 출력 눈금을 먼저 확정하므로 해당 주석기의 별도 `detect_resolution` 패딩 단계는 사용하지 않습니다.

## 화면에서 선택

구도잡기에서 레퍼런스 영상을 저장하고 컷의 «레퍼런스 영상 쓰기»를 켭니다. «로컬 영상»에서 LTX 2.5를 선택한 뒤 «구도잡기 레퍼런스 · 윤곽 구조 제어»에 표시된 영상을 고릅니다. 원본 시작 시각, 사용·생성 길이, 세기(0~1), 필요하면 임계값을 정합니다. 포즈와 윤곽 입력의 동시 선택은 거절합니다. 다른 엔진으로 바꿔도 남아 있는 윤곽 입력을 조용히 버리지 않습니다.

PyAV 15.1.0과 OpenCV headless 4.12.0.88이 필요합니다. 기존 설치에 OpenCV가 없으면 모델을 올리기 전에 재설치 안내를 표시합니다.

2단계의 크기 설정은 **최종 출력 크기**입니다. Union 입력은 최종 변을 128픽셀 배수로, 참조 없는 생성은 64픽셀 배수로 맞춥니다. 예를 들어 2048×1152 Union 출력은 1024×576에서 시작합니다. 약 1GB 공간 업샘플러를 추가로 읽으며 없는 부품은 기존 Hugging Face 인증으로 받습니다. 본체를 새로 한 벌 받는 기능이 아닙니다. 정제는 세부 질감을 다시 생성하므로 얼굴·카메라·동작의 정확한 보존은 결과를 비교해야 합니다. 현재 마지막 영상 복원은 기존 convolutional VAE이며, 별도의 2.5 diffusion decoder까지 적용한 경로는 아닙니다.

## 외부 조종 입력

`assets_list`에서 현재 프로젝트의 컷 `refVideoPath` 에셋(예: `cut-id:refVideoPath`) 또는 저장된 영상 에셋을 선택합니다. `media_generate`의 예:

```json
{
  "projectId": "project-id",
  "target": { "kind": "cut", "id": "cut-id" },
  "engine": "ltx25",
  "operationId": "unique-operation-id",
  "options": { "prompt": "장면의 시각적 내용", "seconds": 5, "fps": 24 },
  "structureSource": {
    "assetId": "cut-id:refVideoPath",
    "kind": "canny",
    "sourceStartSeconds": 6,
    "durationSeconds": 5,
    "weight": 1,
    "thresholds": { "low": 92, "high": 200 }
  }
}
```

`durationSeconds`는 1~60초이며 생략할 수 없습니다. 시작 기본값은 0, 세기 기본값은 1입니다. 출력 요청 길이는 선택 구간보다 길 수 없습니다. 해당 프로젝트에 없는 에셋, 영상이 아닌 에셋, 임의 경로, 미지원 종류·엔진, 포즈와의 병용은 실행 전에 거절합니다. 원본 파일의 실제 길이를 넘는 선택은 모델을 올리기 전에 거절합니다.

2단계는 `options.ltx_quality: "two-stage"`로 명시합니다. 생략하거나 `"single"`이면 기존 동작입니다. 요청/실제 최종 크기, 첫 단계 크기, 8+3단계 수, 참조·LoRA 적용 범위는 `meta.two_stage`에 남습니다. 공식 설명 페이지의 '4 steps'와 달리 실제 공식 JSON은 시그마 `[0.909375, 0.725, 0.421875, 0]`의 세 구간을 사용하므로 실행 규약은 3회 정제입니다.

## 시간축과 결과 기록

출력 프레임마다 `sourceStartSeconds + index / outputFPS`에 가장 가까운 원본 PTS 프레임을 사용합니다. 선택 구간 밖은 사용하지 않고, 원본 끝을 정지 프레임으로 늘이지 않습니다. 시작 직전 키프레임부터 디코드하므로 전체 원본을 미리 배열로 만들지 않습니다. 긴 키프레임 간격과 큰 참조 배열에는 명시적 한도가 있습니다.

기존 LTX의 `8n+1` 프레임 내림 규칙을 유지합니다. 24fps·5초 요청은 113프레임, 즉 약 4.7083초입니다. 원본 자체가 113프레임/24fps이면 선택 구간과 출력 요청도 실제 4.7083초 이내로 지정해야 합니다. 5초짜리 원본이라고 가장하지 않습니다.

작업 결과의 `meta.structure_control`에 원본 길이·FPS·선택 시작/끝, 실제 첫/마지막 표본 시각, 디코드 수, 전달 프레임 수와 길이, 출력 FPS, 임계값, 눈금 변환, 세기를 남깁니다. 요청한 `structureSource`도 결과에 유지합니다. 이것은 입력 전달 증거이며 생성 영상의 추종 성공 판정은 아닙니다.

## 회귀 검증 범위

CPU 시험은 실제 임시 동영상을 생성해 구간 seek, 24→16fps 시간 정렬, 윤곽 변화, 절반 해상도, 잘린 파일의 끝 패딩 거절, 모델 로드 전 범위 검증을 확인합니다. 가짜 파이프라인 시험으로 첫 이미지·Union·세기 0·113프레임·메타데이터 전달을 확인합니다. TypeScript 시험은 프로젝트 에셋 경계·동시 입력 거절·UI 번역을 확인합니다. 이 시험들만으로 GPU 추종 품질을 입증하지 않습니다.

2단계 CPU 회귀는 최종 해상도 해석, 프레임/FPS·오디오 latent 전달, 고해상도 첫 이미지 조건, 정제의 참조/LoRA 분리, 실패 후 scheduler/LoRA 복구, 고정 revision의 확대 부품, 설치된 실제 scheduler의 시그마를 검사합니다. 실제 MCP 요청의 두 단계 GPU 생성도 1건 완료했습니다. 1024×576에서 8회 생성한 뒤 2048×1152로 확대·3회 정제해 24fps·65프레임을 내보냈고 컷 연결을 확인했습니다. 작업 후 워커 종료와 메모리 해제를 별도로 확인했습니다. 이 결과는 실행 경로·입출력 규약의 실측이며 다양한 장면의 추종 품질이나 장시간 안정성 보장은 아닙니다.
