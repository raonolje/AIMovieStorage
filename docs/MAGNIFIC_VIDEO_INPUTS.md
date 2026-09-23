# Magnific 영상 입력 계약

영상 모델 목록은 서버에서 읽고, 중첩된 `references`, `keyframes`, 필수·금지 조합을 보존해 전송 전에 검사합니다. 입력 영상이 지원되지 않으면 이를 버리거나 첫 프레임으로 바꾸지 않고 오류를 알립니다.

## Kling 3.0 Motion Control의 검증된 예외

`kling-motion-control-30` 모델의 한 카탈로그 형태는 `keyframes.start.assetType: video`라고 표시하지만 공통 `video_generate` 도구의 시작 프레임은 그림입니다. 실제 네이티브 연동에서 다음 조합의 접수와 영상 파일 출력 완료를 확인했습니다.

```json
{
  "slug": "kling-motion-control-30",
  "keyframes": { "start": { "type": "image", "url": "uploaded-start-image" } },
  "references": [{ "type": "video", "url": "uploaded-motion-video" }]
}
```

`normalizeMagnificVideoInputContract`는 이 slug, API, mode, 도구 종류, 시작 프레임과 영상 레퍼런스 제약이 확인한 형태와 일치할 때만 **검사용 사본**을 보정합니다. 시작 그림과 영상 한 개를 모두 요구합니다. 원문 카탈로그와 실제 전송 인자는 변경하지 않습니다. 모델 이름만 비슷하거나 제약이 바뀌면 이 예외를 적용하지 않습니다.

이 확인은 입력 수락과 출력 완료에 대한 것입니다. 해당 측정에서는 15초를 요청했으나 결과는 H.264, 416프레임, 약 13.8667초였습니다. 요청 길이와 실제 파일 길이는 다를 수 있으므로 생성 메타데이터의 요청·접수·실측 값을 구분해야 합니다. 동작의 정확한 일치, 카메라 경로 재현, 요청 길이 보장은 이 결과로 입증되지 않습니다.

회귀 검증은 `client/src/lib/magnificCatalog.test.ts`와 `client/src/lib/magnificVideoDelivery.test.ts`에서 수행합니다. 검증된 조합 허용, 영상 누락·초과 거절, 다른 모델·변경된 카탈로그 거절, 전송 인자 보존을 검사하며 유료 생성은 호출하지 않습니다.
