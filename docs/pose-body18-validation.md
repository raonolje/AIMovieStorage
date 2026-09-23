# 모캡 몸 18점 및 LTX Union 연결 검증

확인일: 2026-09-23. 모델 추론·안무 일치도 평가는 이 문서의 단위 시험 결과에 포함하지 않는다.

## 기존 문제와 수정

`client/src/lib/poseFrames.ts`는 MediaPipe의 33점 연결 목록에 OpenPose와 다른 색 순서를 적용하고, 모든 관절을 흰색으로 그렸다. 저장 형식의 신뢰도는 `CapturePoint.v`인데 렌더러는 `visibility`만 읽어 낮은 신뢰도의 관절도 연결했다. 없는 인덱스까지 보이는 것으로 판단할 수 있었다.

수정 후 몸 18점 순서와 선·관절의 RGB를 따로 맞췄다. 목은 양 어깨가 모두 신뢰도 0.3 초과일 때만 중점으로 만든다. `v`를 먼저 읽고 이전 입력 형식인 `visibility`는 대체값으로만 허용한다. 없는 점, 비정상 좌표·신뢰도는 생략한다. 화면 좌우 반전은 좌표만 바꾸고 신체 부위의 의미와 색을 유지한다.

| 몸 18점 인덱스 | 부위 | 저장된 MediaPipe 인덱스 |
| --- | --- | --- |
| 0 | 코 | 0 |
| 1 | 목 | 11·12 중점 |
| 2·3·4 | 오른 어깨·팔꿈치·손목 | 12·14·16 |
| 5·6·7 | 왼 어깨·팔꿈치·손목 | 11·13·15 |
| 8·9·10 | 오른 엉덩이·무릎·발목 | 24·26·28 |
| 11·12·13 | 왼 엉덩이·무릎·발목 | 23·25·27 |
| 14·15 | 오른 눈·왼 눈 | 5·2 |
| 16·17 | 오른 귀·왼 귀 | 8·7 |

참조 구현은 [DWPose wholebody.py](https://github.com/IDEA-Research/DWPose/blob/main/ControlNet-v1-1-nightly/annotator/dwpose/wholebody.py)의 목 생성·순서 변환, [util.py](https://github.com/IDEA-Research/DWPose/blob/main/ControlNet-v1-1-nightly/annotator/dwpose/util.py)의 `draw_bodypose`, [검출기 래퍼](https://github.com/IDEA-Research/DWPose/blob/main/ControlNet-v1-1-nightly/annotator/dwpose/__init__.py)의 표시 기준이다. 17개 몸 연결을 먼저 어둡게 그리고 18개 관절에 각 색을 사용한다. Canvas와 OpenCV의 타원 경계·정수 반올림은 다르므로 픽셀 단위 동일 출력이라고 주장하지 않는다.

이 변환은 저장된 몸 관절을 다시 그리는 기능이며 DWPose 검출기를 실행하는 기능이 아니다. 손가락 21점과 얼굴 세부점은 33점 몸 좌표로 지어내지 않는다. 현재 출력은 몸 18점 한 사람이며 별도 `hands` 데이터도 이번 출력에 추가하지 않는다. 원본 검출 오차·가림·사람 추적 오류를 고치는 기능도 아니다.

## 원본 시간 구간과 반전

MCP `media_generate.poseSource`에 선택적 `sourceStartSeconds`와 `durationSeconds`를 추가했다. 시작은 분석 시작으로부터의 상대값이 아니라 **원본 영상의 절대 초**다. 예를 들어 원본6–11초 동작으로 5초 영상을 만들려면 `sourceStartSeconds: 6`, `durationSeconds: 5`, `options.seconds: 5`를 함께 지정한다.

- 두 구간 값을 생략하면 기존대로 분석 전체를 굽는다. `options.seconds`만으로 원본 구간을 몰래 줄이지 않는다.
- 시작만 있으면 그 시각부터 분석 끝까지, 길이만 있으면 분석 시작부터 그 길이만큼 굽는다.
- 분석 범위를 벗어나거나 길이/FPS가 0·음수·비정상 값이면 프레임 저장과 생성 전에 거절한다. 선택 구간에 해당 사람의 표본이 없을 때도 거절한다.
- 입력 분석 fps와 출력 fps가 다르면 선택 구간 안의 가장 가까운 표본을 출력 시각마다 고른다. 구간 밖 표본을 끌어오지 않는다. 보간·속도 변경이나 검출 공백 복원은 하지 않는다.
- 작업 결과의 `poseSource`에는 실제 선택 시작/끝·길이·fps·프레임 수가 남는다. 기존 UI의 동작 기준 선택은 분석 전체를 사용하는 흐름을 유지한다.

`captureVideo()`와 `assembleCapture()`는 분석할 때 이미 x축 반전과 좌우 관절 교환을 좌표에 적용한다. 따라서 포즈 굽기는 `source.mirror`를 다시 적용하지 않는다. `result.mirrored`는 좌표의 설명이며 한 번 더 반전하라는 지시가 아니다. 이 표식이 없는 옛 저장본도 저장된 좌표 그대로 사용한다. 저수준 `drawPoseFrame(..., mirror)`의 명시적인 그림 반전은 별도 기능이다.

회귀 시험은 30fps 분석6–11초를 24fps/120장으로 만드는 시각 선택, 기존 전체 범위, 잘못된 범위/FPS, 선택 구간 밖 표본 배제, 실제 JSON 조립에서 반전된 좌표의 추가 반전 방지를 검사한다. 실제 GPU 영상 생성에서 안무가 일치하는지는 별도 실측이다.

## 19B Pose 대신 공식 22B Union 사용

[기존 Pose 모델 카드](https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Pose-Control)는 기본 모델을 LTX-2-19b로 명시한다. 이것만으로 LTX 2.5의 22B 체크포인트와 호환된다고 볼 수 없어 기존 자동 부착을 교체했다.

확인된 공식 경로는 다음과 같다.

- [LTX Union 가이드](https://docs.ltx.io/open-source-model/feature-guides/structural-control/union-control)는 LTX 2.5 distilled와 LTX 2.3 **22B Union** 재사용을 명시하며 Pose 입력을 DWPose로 안내한다.
- [공식 2.5 Union 워크플로](https://github.com/Lightricks/ComfyUI-LTXVideo/blob/master/example_workflows/2.5/LTX-2.5_ICLoRA_Union_Control_Distilled.json)에도 `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors`가 포함된다.
- [22B Union 모델 카드](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control)는 Canny·Depth·Pose 및 출력 대비 참조 해상도 0.5배를 명시한다.

`src-tauri/resources/local/engines/ltx25.py`는 해당 22B 파일을 사용하고 `LTX2InContextPipeline`에 `reference_conditions`와 `reference_downscale_factor=2`를 전달한다. 첫 장면은 별도의 `conditions`로 유지한다. 화풍 LoRA를 바꾸어 모든 어댑터가 해제되면 Union도 다시 연결하고 활성 어댑터 목록을 함께 설정한다. 세기 0은 1로 바꾸지 않는다. 모캡 원본 fps와 생성 fps가 달라도 같은 시각의 프레임을 고른다.

설치된 diffusers 0.40.0의 `pipeline_ltx2_ic_lora.py`에서 절반 크기 VAE 입력과 2배 공간 좌표 처리를 직접 확인했다. 절반 참조도 32배수여야 하므로 Union 요청의 출력은 64배수로 맞추고 실제 크기를 로그·반환값에 기록한다. 예: 960×544 요청은 960×512, 기본 1280×704는 그대로다. 참조 이미지에만 몰래 적용되는 크기 감소를 막기 위한 조정이다.

앱은 기존 단일 생성 패스를 유지한다. 공식 ComfyUI 예제의 두 번째 업스케일·재샘플링 단계 전체를 구현한 것은 아니다. **공식 조합과 호출 형식 확인, 가짜 파이프라인 시험 통과는 실제 동작 일치도·화질 검증을 대신하지 않는다.**

## Distilled 설정과 PyAV

[공식 LTX 2.5 Diffusers 카드](https://huggingface.co/Lightricks/LTX-2.5-Diffusers)는 기본 `transformer`가 distilled라고 명시한다. 이에 따라 설치 라이브러리의 `DISTILLED_SIGMA_VALUES`를 사용하고 CFG·오디오 CFG=1, STG·오디오 STG=0, modality·오디오 modality=1을 전달한다. 기본 경로는 8단계 고정이며 일반 steps/guidance 옵션을 이 체크포인트에 적용하지 않는다. 실제 적용한 단계 수와 CFG를 반환한다. 개발용 `LTX25_REPO`의 다른 모델까지 distilled로 가정하지 않는다.

확인 당시 설치 환경은 diffusers 0.40.0, torch 2.11.0+cu128였으며 PyAV는 없었다. 설치 코드의 `apply_image_conditioning_crf`를 모델 없이 실행해 첫 장면 재압축의 PyAV 누락 예외를 재현했다. `engines/ltx25/requirements.txt`에 `av==15.1.0`을 추가하고 첫 장면 요청은 큰 모델 로딩 전에 누락 여부를 검사한다. 학습 시의 첫 장면 압축을 우회하는 `crf=0`으로 숨기지 않는다. 모델 카드의 main 설치 안내와 달리 설치된 0.40.0에는 Gemma4·2.5 처리 및 필요한 파라미터가 있으므로 확인 없이 전체 라이브러리를 변경하지 않았다. 환경 패키지 설치와 실제 생성 재검증은 별도 실측 담당이 진행한다.

## 검증과 남은 실측

- `pnpm test client/src/lib/poseFrames.test.ts client/src/lib/localControlCapabilities.test.ts`: 23개 통과. 몸 순서·목·`v`·가림·비정상 입력·연결/관절 색·반전을 검증한다.
- `python -X utf8 -m unittest src-tauri/resources/local/test_control_policy.py`: 14개 통과. 실제 파일 읽기/PIL 시간축, worker 시작 전 입력 거절, 가짜 파이프라인의 Union 파일·반해상도·0 세기·스타일 어댑터 공존, distilled 인자, PyAV 사전 실패를 검증한다. 모델 다운로드·추론은 실행하지 않았다.
- `pnpm check`: 오류 0.
- 저장된 단일 인물 모캡의 0·5·10초 표본을 읽기만 하여 별도 헤드리스 Canvas에서 몸 18점 그림을 생성·육안 확인했다. 세 표본 모두 18점이 보였으며 원본 파일과 프로젝트는 변경하지 않았다. 공개 회귀 시험은 `client/src/lib/poseFrames.test.ts`에서 점 순서·신뢰도·색·반전을 검증한다. 별도 실측 표본과 결과 이미지는 저장소에 포함하지 않는다.

실측으로 남은 항목은 설치 환경의 I2V 성공, 실제 22B Union 어댑터 로딩/활성화, 사람·배경을 바꾼 출력의 안무 시간·몸 방향·관절 위치 일치도이다. 손가락·얼굴 세부 추적은 이번 몸 18점 출력의 검증 범위에 포함하지 않는다.
