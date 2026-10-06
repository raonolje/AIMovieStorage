# CPU 평면 화면 합성

`planar_overlay_status`와 `media_planar_overlay`는 GPU 생성과 독립된 `cpu` 대기열을 사용한다. 기존 프로젝트 읽기·자산 ID·revision·작업 저널·파일 저장 서비스를 재사용한다. 자동 추적이나 이미지 생성 기능은 아니다.

입력은 같은 프로젝트의 원본 동영상/대체 RGBA 이미지 자산 ID, 두 파일 SHA256, 실제 width/height/fps/frames, 모든 프레임의 TL/TR/BR/BL 볼록 사각형 좌표다. 입력 경로·실행 파일·마스크 크기는 MCP에서 받지 않는다. CFR 0초 시작만 허용하고 리타이밍하지 않는다. 짝수 해상도, 최대 6000프레임, 전체 1.5억 픽셀의 CPU 저장 예산을 적용한다. 같은 operationId의 같은 요청은 기존 작업을 반환하고 다른 요청은 거부한다.

마스크를 4픽셀 안쪽으로 줄여 베젤을 보호한다. RGBA 원근 변환과 내부 feather를 사용하고 무손실 PNG에서 alpha=0인 모든 픽셀이 원본과 정확히 같은지 검증한다. 최종 H264 MP4는 손실 압축이므로 마스크 밖 비트 일치를 주장하지 않는다. 원본 오디오는 스트림 복사하며 없으면 만들지 않는다. 실패/취소도 원본을 변경하지 않는다. CPU 취소는 정상 종료를 기다리며 강제 종료하지 않는다.

S02는 `contentMode:"non-text"`; S03 guho-cut-03-02는 `contentMode:"exact-text",requiredText:"한국사"`와 실제 해당 글자가 있는 raster가 필요하다. requiredText는 선언 검사이며 OCR이나 실제 글자 검수 보증이 아니다. 교과서 표지의 실제 제작/검수는 아직 하지 않았다.

관리 환경은 앱 데이터의 local/tools/planar-overlay/environment.json에서 기존 python/ffmpeg 경로를 읽는다. 새 패키지나 모델을 내려받지 않는다. 준비된 설정 파일은 현재 배포하지 않았다.

결과는 원본을 덮어쓰지 않는 별도 동영상, PNG/마스크/로그/결과 JSON이다. `attached:false,registrationRequired:true,qualityApproved:false`를 반환한다. 명시된 현재 앱 등록 보류 지시 때문에 자동 등록/대표 선택을 하지 않는다. 별도 승인된 단계에서 최신 revision으로 기존 media_register(makePrimary:false)를 사용하고 읽어 확인한다.
