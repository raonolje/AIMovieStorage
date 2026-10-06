# 원본 보존 CPU 구간 편집

조종기에 `media_edit_status`, `media_edit_probe`, `media_edit`를 추가합니다. 기존 GPU/Comfy/3D 경로와 구분된 CPU 작업이며 모델을 생성하거나 원본을 고치지 않습니다.

## 입력과 검증

probe는 같은 프로젝트의 컷에 연결된 영상 자산 ID로 실제 SHA256, CFR 프레임 수, 분수 FPS, 선택 프레임의 RGB24 SHA256, 오디오 metadata를 읽습니다. 프로젝트 revision과 원본 SHA가 검사 중 바뀌면 실패합니다. 선택 프레임 해시는 시각 검수나 청정 배경 판정이 아닙니다.

edit는 최신 revision, operationId, 대상 컷, 각 원본 자산 ID·원본 컷 ID·SHA256·원본 전체 프레임 수, 동일한 크기와 분수 FPS를 요구합니다. 각 clip은 `[startFrame,endFrameExclusive)`의 정수 프레임 구간입니다. 원본은 PTS=0에서 시작하는 CFR 한 영상 트랙이어야 합니다. 크기/FPS 변경, 루프·역순·겹치는 원본 구간은 거부합니다.

hold는 직전 clip의 마지막 프레임만 반복합니다. 같은 원본 SHA, 마지막 source frame index, 실제 decoded RGB24 hash와 `reviewDeclaration: explicitly-reviewed-frame`을 요구합니다. 선언은 호출자가 제공한 검수 기록이며 작업자가 프레임을 직접 보았거나 '깨끗한 배경'으로 승인했다는 의미가 아닙니다. 임의 그림 대체·차량 지우기·그레인/밝기 합성은 하지 않습니다.

expectedOutputFrames와 세그먼트 합계가 같아야 합니다. 총 6000프레임·1.5억 픽셀 이내 CPU 예산으로 제한합니다. 프레임 경계는 전 구간에서 정확한 분수 타임베이스로 검사합니다. 다른 크기/FPS/PTS를 자동 보정하지 않습니다. SHA가 같은 원본의 다른 자산/파일 복사본도 같은 원본으로 보아 구간 반복을 차단합니다.

## 출력·오디오

출력은 다른 이름의 RGB24 lossless H264 MP4입니다. PNG 중간 프레임과 최종 decoded RGB24가 각 선택 원본 프레임의 hash와 모두 일치해야 공개합니다. 압축 패킷·원본 metadata를 그대로 복사하는 작업은 아닙니다. 일반 플레이어/앱의 RGB H264 호환성은 설치 후 확인해야 합니다. 배포용 YUV420 변환은 이번 최소 기능에 포함하지 않습니다.

오디오 정책은 반드시 명시합니다.

- `omit`: 오디오를 넣지 않습니다.
- `clip-and-silence`: 원본 48kHz stereo를 PCM16으로 decode해 같은 프레임 구간의 samples를 이어 붙이고, hold 또는 원본 오디오 없는 구간은 명시적 디지털 무음을 넣습니다. 최종 ALAC의 decoded PCM16은 계산한 PCM과 전 sample에서 일치해야 합니다. 오디오를 반복·늘이거나 자동 fade하지 않습니다. source/hold 경계가 정수 sample에 맞지 않으면 오류로 끝납니다. 다른 샘플레이트/채널·비영점 오디오 시작은 현재 지원하지 않습니다. 오디오가 전혀 없는 입력들에 새 무음 트랙을 만들지 않습니다.

원본 float decode precision이나 압축 오디오 패킷의 bit-exact 복사를 주장하지 않습니다. 비교 형식은 stereo-s16le-48000입니다. 원본과 최종 오디오의 모든 decoded frame PTS가 영점 시작 연속 sample clock에 맞는지 확인합니다. 시간 간격이 있는 원본은 자동 보정하지 않습니다. 추가 무음 sample 수와 segment 경계를 결과 metadata에 기록합니다. 청취나 자연스러운 오디오 전환을 수치 정합으로 대체하지 않습니다.

## 기존 앱 서비스 재사용

기존 CPU lane/journal에 독립 작업을 넣고 동일 operationId/payload 재호출은 기존 작업을 사용합니다. 같은 ID에 다른 payload는 거부합니다. 실행 때 컷·자산·revision을 다시 검사합니다.

기존 saveProjectMediaAsset/releaseEmptyProjectAsset으로 파생 결과 자리를 마련합니다. 기존 planar/protected의 CPU subprocess/log 처리와 non-overwriting hard-link publication helper를 공유합니다. 실행 파일 경로는 조종기가 지정하지 않고 기존 관리 CPU 환경 설정에서만 읽습니다. Python/FFmpeg는 설치된 것을 사용하며 새 패키지/모델을 받지 않습니다.

편집 결과를 자동 등록하거나 대표로 삼지 않습니다. 검수 후 기존 `media_register`에 최신 revision과 makePrimary=false를 명시해 비대표 후보로 등록합니다. 카드 prompt/source/primary를 바꾸지 않습니다. 취소는 현재 CPU 프로세스가 끝날 때까지 기다리며 강제 종료하지 않습니다.

## stage165 적용의 별도 QA

16fps 원본 33프레임 + 마지막 frame32의 추가 홀드 143프레임은 176프레임=11초입니다. 추가 홀드는 8.9375초이며, 원본 frame32 구간을 포함한 마지막 정지 화면은 9초입니다. 합성 fixture에서 기계 정합만 확인했습니다.

실제 제작 영상 연결은 설치 후 별도 QA입니다. stage153 native frame88(약 5.5초)는 새 파란 헤드라이트가 있어 청정 배경으로 사용하면 안 됩니다. 이번 테스트는 해당 영상/프레임과 stage147/149 실제 제작 소스를 사용하지 않았습니다. 설치 후 원본 clip의 확인된 마지막 frame32를 실제 SHA로 결합하고, 접합 전후 모든 프레임·배경/램프/그레인과 연속 재생의 정지감, 오디오 전환을 검수해야 합니다. 11초 길이 정합은 자연스러운 완성 영상 판정이 아닙니다.

현재 설치·외부 MCP 연결·GPU·거부된 stage133 LTX 요청은 변경하거나 실행하지 않았습니다.
