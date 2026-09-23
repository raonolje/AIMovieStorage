# H3 상주 모델의 RoPE 장치 배치

개발 소스에서 확인한 실패와 좁은 수정이다. 기존 릴리스의 수정 완료나 H3 전체 생성 성공을 뜻하지 않는다.

## 확인한 실패

영상 레퍼런스를 입력한 실제 H3 생성이 `MiniMaxH3RotaryPosEmbed.forward`의 다음 연산에서 실패했다.

```python
freqs = position_ids.unsqueeze(-1) * self.inv_freq.view(1, 1, -1)
```

`position_ids`는 CUDA, `inv_freq`는 CPU에 있어 장치 불일치가 발생했다. 설치된 diffusers의 `transformer_minimax_h3.py`에서 `inv_freq`는 `persistent=False` 버퍼이며 체크포인트에 저장되지 않는다. 따라서 transformer를 `device_map="cuda"`로 읽었다는 것만으로 이 버퍼의 장치까지 일치한다고 가정할 수 없었다.

## 수정 범위

`src-tauri/resources/local/engines/minimaxh3.py`에서 int8 양자화·VRAM 80GB 이상인 상주 transformer 경로에만 `transformer.rope.to(device=...)`를 추가했다. 장치만 지정하고 dtype은 전달하지 않아 주파수 버퍼의 float32를 유지한다.

transformer 전체나 양자화 가중치를 다시 복사하지 않는다. 작은 GPU의 group offload 분기와 bf16 auto offload 분기는 변경하지 않았다. 이들 분기의 성공을 이번 시험으로 보장하지 않는다.

## 회귀와 한계

`src-tauri/resources/local/test_h3_device_placement.py`:

- 일반 CPU 계약 시험은 RoPE 모듈에 장치만 전달하고 전체 transformer 이동·dtype 변환을 요청하지 않는지 검사한다.
- H3 설치 환경의 실제 `MiniMaxH3RotaryPosEmbed`로 CPU 위치값의 기준 결과를 구한 뒤, 버퍼 이동 전 CUDA 위치값에서 장치 불일치를 재현했다. 이동 후에는 같은 위치값의 GPU 결과가 CPU 기준과 일치했다.
- 실제 버퍼의 float32와 `state_dict`에서 제외되는 성질도 보존됐다. 실제 모듈 시험 2개가 통과했으며 모델 가중치를 다시 내려받거나 전체 영상 추론을 실행한 시험은 아니다.
- CI는 일반 계약 시험을 실행한다. H3용 torch/diffusers가 없으면 실제 모듈 시험을, CUDA가 없으면 GPU 시험을 명시적으로 건너뛴다. 이 건너뜀을 GPU 검증 성공으로 세지 않는다.

전체 H3 영상 생성은 별도 재실측이 필요하다. 이번 수정은 확인된 RoPE 장치 불일치 한 지점을 해결하며, 메모리 사용량·다른 연산의 장치 배치·참조 동작 재현 정확도까지 검증하지 않는다.
