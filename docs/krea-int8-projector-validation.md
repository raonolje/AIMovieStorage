# Krea int8 텍스트 결합 층 오류와 좁은 수정

2026-09-23. Krea2 int8 이미지 생성 시험은 약 48초 뒤 `view size is not compatible with input tensor's size and stride`로 실패했다. 같은 조건군의 bf16 생성은 성공 기록이 있다. 이것만으로 이미지 품질이나 모든 양자화 실행의 성공을 판단하지 않는다.

## 확인한 경로

앱의 Krea2 워커 로그에서 확인한 실제 스택:

1. 앱 `_image.py`의 `common.run_attention_safe` → `Krea2Pipeline`.
2. 설치된 diffusers `transformer_krea2.py:216`, `text_fusion.projector(hidden_states)`.
3. bitsandbytes `MatMul8bitLt.forward` → `int8_vectorwise_quant`.
4. bitsandbytes 0.48.1 `backends/cuda/ops.py:145`, `torch.argwhere(outliers.any(dim=0)).view(-1)`.

해당 설치 소스에서 Krea의 입력은 `[batch, token, text_layer, feature]`를 `[batch, token, feature, text_layer]`로 바꾼 4차원이다. `projector`는 마지막 축을 1로 줄이는 작은 `Linear(num_text_layers, 1, bias=False)`다. BNB의 `MatMul8bitLt`는 3차원 입력만 2차원으로 편다. 따라서 4차원 입력은 outlier 좌표 추출식까지 그대로 도달한다. 실제 실패 때의 전체 텐서 값은 저장되어 있지 않으며, 여기서 차원은 설치 소스의 실행 경로에 근거한다.

CPU에서 동일한 4차원 배치·축 순서와 임곗값 이상 값을 만들면, 같은 좌표 추출식에서 동일한 `view` 오류가 발생한다. `.view`만 `.reshape`로 치환하면 토큰·특징의 좌표까지 열 인덱스로 섞이므로 그 수정은 하지 않았다. 앞서 로그에 있던 빠른 어텐션 fallback과 이 오류는 발생 지점이 다르다.

## 변경

- Krea에만 `text_fusion.projector` 제외 목록을 지정했다. diffusers의 공식 `llm_int8_skip_modules`를 사용해 이 작은 층은 원래 dtype을 유지하고, 큰 트랜스포머의 나머지 양자화는 유지한다. 같은 층은 nf4에서도 보존한다.
- 공용 `ImageEngine`과 `common.quantized_component`는 선택적인 제외 목록을 전달한다. Krea 이외 호출자의 기본값은 바꾸지 않았다.
- 설치 패키지·BNB CUDA 커널·어텐션·사용자 모델 파일은 수정하지 않았다.

공식 설정 근거: [diffusers 양자화 설정](https://huggingface.co/docs/diffusers/api/quantization), [모듈 양자화 제외 안내](https://github.com/huggingface/diffusers/blob/main/docs/source/en/quantization/bitsandbytes.md). 현재 설치된 diffusers의 재귀 교체 함수가 정확한 `text_fusion.projector` 경로 제외를 처리하는 것도 CPU 시험으로 확인했다.

## 검증 및 한계

`src-tauri/resources/local/test_krea_quantization.py` 7개 통과. 설치된 Krea Python 환경에서 `CUDA_VISIBLE_DEVICES=-1`, `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`로 실행했다.

- 실측 오류에 해당하는 4차원 outlier 좌표식의 CPU 재현.
- 작은 실제 `Krea2TextFusion`에 실제 BNB 층 교체 적용: projector는 bf16 원형 유지, 별도 Linear는 int8/nf4로 교체됨.
- 교체 전후 projector를 포함한 TextFusion 출력이 원소 단위로 같고 `[batch, token, feature]` 형태를 유지함.
- 실제 앱 load 경로의 Krea 제외 목록 전달, bf16 경로 유지, Qwen/Z-Image 제외 목록 없음, 공용 기본값 및 목록 복사 확인.
- 기존 `test_image_guidance.py` 6개 및 `pnpm check` 통과.

모델 전체의 GPU 생성·이미지 품질·메모리 절감량은 이 시험의 범위가 아니다. 재측정할 때는 실패했던 요청을 새 작업 ID로 다시 실행하고, int8 완료·출력 파일·실제 정밀도 기록을 함께 확인해야 한다. 이미 상주하는 워커에는 새 소스가 아직 로드되지 않았을 수 있다.
