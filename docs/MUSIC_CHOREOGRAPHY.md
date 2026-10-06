# 음악 타임라인과 군무 동작

이 기능은 음원을 분석해 박자 후보를 표시하고, 저장된 모캡 동작을 음악 구간에 맞춰 여러 캐릭터에 적용한다. 같은 동작의 **자세 키**를 복제하므로 캐릭터의 배치, 기존 이동 키와 카메라 무빙은 유지된다. 구간마다 동작을 반복하는 현재 방식은 노래의 분위기·가사에 맞는 새 춤을 스스로 창작하거나 구간 경계를 자연스럽게 연결하지 않는다.

1. 구도잡기 타임라인에 음원을 놓고 **박자 분석**을 누른다. BPM·박자 수·확신도를 살핀 뒤 첫 박을 바로잡는다. 박자 감지가 약하면 BPM과 구간을 직접 편집한다. 분석 시각은 음원 기준이며 앱은 타임라인 오프셋을 반영한다.
2. **분석 박자로 구간 나누기**에서 마디 수를 고른다. 노래의 도입·후렴 등 의미 있는 경계와 비교하고 필요한 구간을 수동으로 고친다.
3. 댄스 영상의 기존 모캡 분석 결과를 선택하거나 **KIMODO BVH 가져오기**로 SOMA BVH를 프로젝트에 저장한다. 앱은 관절 좌표를 기존 모캡 형식으로 변환하고 원본 BVH와 변환 JSON을 모두 보관한다.
4. 원본의 인물 번호를 선택하고 **배치된 캐릭터 모두에게 적용**을 누른다. 몸 리그가 다른 캐릭터는 따로 적용한다. 적용 후 구간 경계, 손가락, 발 접지, 캐릭터 간 충돌을 타임라인에서 보고 고친다.

설정 → 로컬 모델의 **동작 생성 — NVIDIA KIMODO**에서 전용 Python/CUDA 환경을 설치한다. 시스템 Python이나 기존 이미지·영상 엔진을 덮어쓰지 않는다. 공식 소스 `1aece8c124d73d255ceff5086d983b844c9f4e94`로 설치 버전을 고정했다. 이 판은 일반 PC에서 CMake·C++ 빌드 도구를 요구하지 않도록 업스트림의 선택적 MotionCorrection 확장을 건너뛰어 설치한다. 확장이 없는 환경에서는 생성 시 C++ 후처리를 끄므로 발 접지·미끄러짐을 결과에서 직접 확인해야 한다. 환경 설치 완료는 가중치 다운로드 또는 생성 품질 통과를 뜻하지 않는다.

Hugging Face에서 `meta-llama/Meta-Llama-3-8B-Instruct` 접근 승인을 받고 앱 설정의 Hugging Face 토큰을 등록한다. 구도잡기 음악 탭에서 영문 동작 설명, SOMA-RP v1.1 또는 SOMA-SEED v1.1, 0.5~30초, 텍스트 인코더 GPU/CPU를 선택해 **동작 생성**한다. 선택 모델과 텍스트 인코더는 첫 생성 때 엔진 전용 캐시에 받는다. CPU 인코더는 GPU 메모리를 아끼지만 호스트 RAM을 쓰며 느릴 수 있다. 모델/인코더 위치를 바꾸면 이전 파이프라인을 재사용하지 않는다.

완료된 원본 BVH·변환 관절 JSON과 프롬프트·모델·길이·시드·스텝·인코더 위치를 프로젝트 모캡 목록에 보관한다. LLM은 `kimodo_install` → `kimodo_generate`로 동일한 경로를 사용하고 `job_get`으로 진행 상태를 확인한다. 같은 `operationId` 재요청은 기존 작업/등록 결과를 재사용한다. 작업 취소는 현재 생성이 끝나는 경계까지 기다리는 협조적 취소이며 GPU 추론 중 즉시 중단은 아직 지원하지 않는다.

외부 KIMODO의 BVH도 계속 가져올 수 있다. [공식 CLI](https://research.nvidia.com/labs/sil/projects/kimodo/docs/user_guide/cli.html)의 출력 예:

```text
kimodo_gen "A five-count upbeat dance phrase with clear arm accents and side steps." --model Kimodo-SOMA-RP-v1.1 --duration 5 --output dance_phrase --bvh --bvh_standard_tpose
```

KIMODO는 음악 파일을 직접 듣는 모델이 아니다. 노래 박자 분석과 동작 생성 요청은 별도 단계이며, 현재 앱은 생성된 BVH를 구간 길이에 맞춰 반복·리타깃한다. SOMA BVH에서 손가락 동작을 기존 33점 몸 랜드마크로 완전히 보존하지 못한다. 외부 모델 설치, 실제 GPU 생성, 실제 BVH와 구도잡기 영상의 품질 검증이 완료되기 전에는 음악에 맞는 안무 생성이 검증됐다고 표현하지 않는다.

LLM 조종기에서는 `composition_music_use` 또는 `composition_music_import` → `composition_music_analyze` → `music.update`/`music.split_detected_bars` → `kimodo_generate` 또는 `mocap_import_kimodo` 또는 저장된 영상 모캡 → `composition_apply_dance` → `composition_commit` 순서로 쓴다. 각 쓰기 뒤 최신 revision을 다시 읽는다.
