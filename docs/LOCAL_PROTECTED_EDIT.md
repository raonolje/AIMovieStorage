# 원본 보호 CPU 편집

`protected_edit_status`와 `media_local_edit`는 기존 자산 ID·revision·저널·파일 저장 및 독립 CPU 대기열을 재사용한다. 실제 합성은 앞선 평면 합성의 Rust CPU 실행/로그/비덮어쓰기 출판 경로를 공유한다. 새 모델·자동 의미 분할·GPU·앱 자동 등록은 없다.

`mode:"compose"`는 같은 원본 크기의 교체 이미지와 선택/보호 마스크를 합성한다. 보호 마스크의 값이 0보다 크면 선택보다 우선한다. RGB/RGBA 교체 이미지의 투명도를 존중하고 최종 alpha=0인 원본 RGB를 그대로 유지한다. 준비한 회색 마스크와 교체 이미지는 기존 `comfy_masked_compose`에서도 사용할 수 있다. 현재 앱/프로젝트 쓰기 금지 때문에 QA를 등록하거나 제출하지 않았다.

`mode:"erase-text"`는 명시된 이진 글자 선택만 국소 종이/그림자 표면으로 채운다. 주변 색 기울기의 robust 선형 적합을 사용하고 보호 격자·손·펜·그림자 경계 및 그 주변 3px를 donor에서 제외한다. 실제 편집 alpha는 넓히지 않는다. 보호 픽셀과 alpha=0 픽셀은 최종에도 원본 일치를 검사한다. 넓은 글자 선택/부족한 참조 픽셀은 거절한다. 이것은 글자 인식이나 의미 분할이 아니며 복잡한 그림자 곡률/재질을 완전 복원한다고 주장하지 않는다.

선택 마스크는 원본 좌표 또는 명시적 crop 좌표를 사용한다. 원본 RGB는 리사이즈하지 않는다. crop mask는 픽셀 중심 `floor((sourceOffset+0.5)*maskExtent/cropExtent)`의 nearest 매핑으로 원본에 대응시키고 결과 JSON에 기록한다. 보호 마스크는 반드시 원본 크기의 L 영상이다. 순수 CPU 함수 `rasterize_matte`는 명시된 전경 다각형과 배경 구멍을 원본 크기로 만들 수 있다. 준비된 alpha/RGB/차이 미리보기는 실제 원본 크기로 검토해야 한다.

정확 문자 추가는 같은 원본 크기의 RGBA 레이어와 `requiredText:"내 시간"|"한국사"` 선언을 요구한다. 보호 영역과 글자 alpha가 한 픽셀이라도 겹치면 글자를 자르는 대신 작업을 거절한다. 선언은 OCR 검증이 아니며 실제 레이어의 글자를 사람이 봐야 한다. 임의 prompt/font/model/실행 경로는 MCP에서 받지 않는다.

입력은 같은 프로젝트 이미지 ID와 각 파일 SHA256, 최대 2천만 원본 픽셀이다. 작업 시작 시 최신 revision과 소유권을 확인한다. 같은 operationId 재요청은 기존 작업을 반환하고 다른 편집에는 같은 ID를 사용할 수 없다. 관리 설정은 앱 자료의 `local/tools/protected-edit/environment.json`에서 기존 Python/FFmpeg를 연결한다. QA는 이미 설치된 LTX Python의 NumPy/Pillow/OpenCV만 사용했다. 설정은 아직 설치하지 않았다.

출력은 PNG, 실제 alpha·선택/보호 마스크·RGB 차이와 로그다. 결과는 `attached:false,registrationRequired:true,qualityApproved:false`이며 취소 시 정상 종료를 기다린다. 기존 원본·대표·프롬프트를 바꾸지 않는다. 검수와 별도 앱 쓰기 허가 후 기존 media_register(makePrimary:false)로 등록하고 읽어서 확인해야 한다.

시계의 낡은 금빛·은색 혼합은 원문 소품 정보와 일치하므로 제거/재색칠 대상이 아니다. 현재 아버지 QA는 얼굴·시계·아이와 다른 방 픽셀을 보호한 좁은 배경 섬 수리다. 가방 내려놓기/시선/대사/배우 정체성이나 전신 matte 완성을 의미하지 않는다. P-K11 2초 정지 QA는 24fps·48프레임이며 쓰기 동작·P-K02 인접 동작을 만든 영상이 아니다. 작은 그림자 흔적·글꼴 미술·연속 재생·청취·최종 승인은 별도 검수 사항이다.
