# MediaPipe Hand Landmarker

- 제공자: Google / MediaPipe
- 파일: `hand_landmarker.task`
- 고정 모델 판: `hand_landmarker/hand_landmarker/float16/1`
- 공식 다운로드: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- 파일 크기: 7,819,105 bytes
- SHA-256: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`
- 확인일: 2026-09-23

공식 [Hand tracking 모델 카드](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf)는 Apache License 2.0을 명시합니다. 라이선스 전문은 함께 배포한 `hand_landmarker.LICENSE.txt`를 보세요. 모델은 수정하지 않았습니다. 앱의 기존 MIT 라이선스와 구분하여 고지합니다.

[공식 JavaScript 안내](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)에 따라 image/world 각 21점을 읽습니다. 앱은 모델과 WASM을 번들로 제공하며 실행 중 모델을 인터넷에서 다운로드하지 않습니다.

작거나 가려진 손, 빠른 움직임, 겹친 사람에서는 검출이 빠질 수 있습니다. 추가 추적은 기존 몸 분석의 손목에 명확히 매칭되는 결과만 적용하며 누락·모호한 프레임의 기존 손 데이터는 유지합니다. 이 모델의 출력은 관절별 가림 신뢰도를 제공하지 않습니다.
