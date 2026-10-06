# 로컬 생성의 다운로드 금지 계약

일반 내장 생성 요청은 `local-only`입니다. GUI 실행 환경의 HF 변수에 의존하지 않습니다.

공식 `media_generate.options.local_files_only`는 생략 또는 true만 허용합니다. false는 스키마에서 거부합니다. Rust `generate_blocking`이 공유 작업자 요청에 `network_policy: local-only`를 직접 넣습니다. Python 작업자는 load/generate 요청에서 정책 완화를 거부하며, 정책이 생략된 기존 요청에도 local-only를 적용합니다.

생성 범위에서 HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE을 강제하고, 이미 import된 Hub/Transformers의 오프라인 값도 제한합니다. Python socket 연결·전송·DNS 함수는 외부 접속 전에 명확한 오류를 냅니다. LTX/Wan pipeline, 공통 양자화 component, LTX 두 단계 upsampler의 from_pretrained에는 local_files_only=True를 명시합니다. 생성 완료 응답에 network_policy를 기록합니다.

파일이 없거나 읽을 수 없으면 `로컬 전용 생성: 필요한 모델 파일이 없거나 읽을 수 없습니다. 다운로드하지 않았습니다.` 오류를 전달합니다. 일반 네트워크 시도는 `네트워크 접근을 차단했습니다`로 끝납니다. 모델 준비 단계에서 자동으로 받는다는 진행 문구를 제거했습니다.

기존의 별도 설치/prefetch 명령은 생성 범위와 구분합니다. scope 종료 시 정책 임시 패치를 복원하므로 별도 prefetch 기능을 몰래 삭제하거나 완료 기록을 고치지 않습니다. 이번 작업에서는 설치/prefetch를 호출하지 않았습니다.

## 준비 상태 증거

- `weightsReady`는 호환성을 위한 기존 완료 플래그입니다. `prefetchCompleted`와 `installationRecordVersion`을 별도 의미의 이름으로 함께 제공합니다.
- `readinessEvidence.files`는 현재 파일 확인입니다. 현재 검사는 기본 LTX 2.5 단일 단계 Diffusers snapshot에 한정하며 다른 엔진은 not-checked입니다. config/tokenizer/weight 파일의 존재·비어 있지 않음, model_index의 pipeline, shard index 참조를 확인합니다.
- present는 가중치 무결성·로드·생성 성공이 아닙니다. hashVerified/loadVerified/networkSafetyVerified는 false로 남습니다. 두 단계 부품·LoRA·시험용 repo override·native A2V 준비 판정으로 사용하지 않습니다.
- `readinessEvidence.runtime`은 설치된 diffusers METADATA의 Version입니다. 설치 당시 버전 기록과 구분하며 importVerified/gpuVerified는 false입니다. Python이나 모델을 실행하여 버전을 조회하지 않습니다.
- 설정 카드에 사전 받기 완료 기록 유무, 현재 파일 검사, 배포판 메타데이터, 설치 기록을 각각 표시합니다. 카탈로그에도 생성 local-only 정책과 다운로드 불허를 제공합니다.

## 검증 범위

CPU 테스트는 동일 worker.main의 JSON 요청/오류 경로를 가짜 엔진으로 실행하고, 실제 설치 Hub 라이브러리로 작은 임시 cache의 존재/누락을 검사합니다. 네트워크·DNS/전송 호출이 차단되고, 완화 요청이 거부되고, 별도 prefetch 계약이 유지되는지 확인합니다. LTX/Wan endpoint 및 두 단계 CPU 계약도 재검사합니다.

이것은 공유 local/worker.py 생성 경로의 코드 정책입니다. OS 방화벽이나 임의 native 라이브러리/별도 실행 파일에 대한 보안 sandbox를 새로 만들지 않습니다. 별도 native A2V와 외부 Comfy 경로는 기존 계약을 유지하며 이번 새 socket 정책의 실행 검증 범위에 포함하지 않습니다.

현재 설치에 반영하지 않았습니다. 앱 업데이트/재시작과 GPU 생성은 승인되지 않았으며 stage133의 거부된 요청도 계속 중단 상태입니다. CPU 계약 통과가 해당 요청의 허용·실제 GPU 성공·제작 품질 합격을 뜻하지 않습니다.
