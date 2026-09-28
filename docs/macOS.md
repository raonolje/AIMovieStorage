# macOS 시험 빌드

현재 맥 버전은 Apple Silicon에서 프로젝트 편집, 구도잡기, 타임라인, 파일 관리, 원격 API 및 외부 ComfyUI 서버 연동을 검증하기 위한 **시험판**입니다. 내장 로컬 이미지·영상·음악 모델과 내장 업스케일 워커는 Windows/NVIDIA CUDA 전용이라 맥에서는 설치하거나 실행하지 않습니다. Mac용 Metal/MPS 모델 구동은 별도 구현과 모델별 실측이 필요합니다.

Magnific 데스크톱 창을 자동 조종하는 `구성` 기능도 현재 Windows 전용입니다. Mac에서는 Magnific MCP 또는 웹에서 작업하며, 앱의 자동 구성 단추는 명시적인 미지원 오류를 돌려줍니다.

처음 실행할 때 앱 언어(한국어·영어·일본어·중국어)를 선택합니다. 이 설정은 이후 앱 설정에서 변경할 수 있습니다. Windows NSIS 설치 마법사에도 한국어·영어·일본어·중국어(간체) 설치 언어 선택을 표시합니다. 설치 마법사 언어와 앱 화면 언어는 각각 선택합니다.

macOS 기기에서 `pnpm install --frozen-lockfile` 후 `pnpm build:macos:public`을 실행하면 공개판 DMG가 `src-tauri/target/public/release/bundle/dmg/`에 생성됩니다. 원본 비공개판은 `pnpm build:macos`로 빌드합니다. 공개판은 `edition.json`의 제외 엔진을 번들에서 걸러냅니다. Windows에서 `--dry-run`으로 설정과 제외 목록을 점검할 수 있지만 실제 DMG 빌드는 macOS가 필요합니다.

GitHub 공개 저장소의 `main` 브랜치는 Apple Silicon 호스팅 러너에서 공개판 DMG를 만들어 Actions 작업 산출물로 보관합니다. 원본 GitLab에는 현재 macOS 러너가 없으므로 비공개판 DMG는 아직 자동 빌드되지 않습니다.

배포용 DMG는 Apple Developer ID 서명과 공증이 필요합니다. 이 설정과 Mac 실기기 실행 검증이 끝나기 전까지 시험 산출물을 정식 릴리스나 자동 업데이트 대상으로 올리지 않습니다. Mac 업데이트는 Tauri의 `.app.tar.gz` 서명 파일과 `darwin-aarch64` 플랫폼 항목을 기존 GitLab 업데이트 명세에 추가해야 합니다.
