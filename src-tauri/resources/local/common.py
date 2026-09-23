# -*- coding: utf-8 -*-
"""로컬 생성 엔진이 같이 쓰는 도구 — 로그·장치·가중치 내려받기·시드.

엔진 모듈이 구현할 것은 세 함수뿐입니다(업스케일 쪽과 같은 모양).

    load(root, opts)                    — 모델을 올린다(이미 올라가 있으면 그냥 돌아온다)
    generate(output, opts, report)      -> dict (덧붙일 값: seconds·width·height·seed 등)
    unload()                            — VRAM 을 비운다

# 가중치는 왜 «첫 생성 때» 받는가

업스케일 엔진의 가중치는 파일 한두 개라 manifest 에 URL·sha256 을 적어 두고 설치 때
받습니다. 생성 모델은 **하나가 수십 개 파일로 흩어진 diffusers 저장소**라 그 목록을
손으로 적어 둘 수가 없습니다(판이 바뀌면 통째로 어긋납니다). 그래서 설치는 파이썬
환경까지만 하고, 가중치는 huggingface_hub 가 **이어받기와 해시 확인을 스스로 하면서**
첫 생성 때 받습니다. 받은 것은 `<엔진>/models/` 안에 남아 다음부터는 바로 씁니다.

# 다만 영상 엔진(미니맥스·완)은 설치 때 미리 받습니다

 첫 생성 때 받는 방식은 **그때 쓰는 덩어리만** 받습니다 —
미니맥스의 `transformer_ref/`(레퍼런스 영상, 62 GB)와 완의 I2V 판(60 GB)은 사용자의 기계에 없었고,
처음 쓰는 날 «생성 중» 안에서 말없이 받게 돼 있었습니다. 그래서 엔진 모듈에 `prefetch(root, report)`
가 있으면(manifest 의 `prefetch: true`) 설치 끝에 저장소를 통째로 받아 둡니다. 받는 한 벌은
`engines/_hf.py` 의 `snapshot` 입니다 — 재시도·토큰·진행 표시를 엔진마다 적지 않습니다.
"""

import os
import sys
import time
import random

# HF 캐시를 엔진 폴더 안으로. 사용자 홈(C:)에 수십 GB 를 흘리지 않습니다 —
# 제거를 누르면 엔진 폴더 하나만 지우면 깨끗해져야 합니다.
_engine_root = {"path": None}
"""지금 엔진의 폴더. «이 모델은 빠른 어텐션이 안 된다» 를 적어 두는 자리를 찾는 데 씁니다."""


def _fast_attention_mark():
    """이 엔진에 «빠른 어텐션 쓰지 말 것» 표시가 있는지 볼 파일 자리."""
    root = _engine_root["path"]
    return os.path.join(root, "빠른어텐션-못씀.txt") if root else None


def use_engine_cache(root):
    _engine_root["path"] = root
    models = os.path.join(root, "models")
    os.makedirs(models, exist_ok=True)
    os.environ["HF_HOME"] = models
    # 옛 이름(HUGGINGFACE_HUB_CACHE)과 새 이름(HF_HUB_CACHE)을 **둘 다** 잡습니다 — 허브는 새 이름을 먼저 보므로,
    # 사람 환경에 HF_HUB_CACHE 가 있으면 옛 이름만 잡아서는 가중치가 엔진 폴더 밖으로 갑니다(2026-09-22 점검).
    os.environ["HUGGINGFACE_HUB_CACHE"] = os.path.join(models, "hub")
    os.environ["HF_HUB_CACHE"] = os.path.join(models, "hub")
    os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    _avoid_symlinks()
    return models


def _avoid_symlinks():
    """**윈도우에서 심볼릭 링크를 못 만드는 계정이 있습니다.**

    2026-09-18 실측: ACE-Step 이 가중치를 7.7 GB 까지 받아 놓고 마지막에 죽었습니다 —
    「[WinError 1314] 클라이언트가 필요한 권한을 가지고 있지 않습니다」. 허깅페이스 캐시는
    `snapshots/…` 에서 `blobs/…` 로 심볼릭 링크를 겁니다. 개발자 모드가 꺼져 있고
    관리자도 아니면 못 겁니다.

    hub 안에 «못 걸면 복사» 하는 길이 있긴 한데 그쪽은 `PermissionError` 만 받아 냅니다.
    1314 는 파이썬에서 그냥 `OSError` 라 그 손을 빠져나갑니다. 환경 변수로 끄는 길도
    이 판(0.36)에는 없습니다 — 그래서 **«심볼릭 링크 되나?» 를 늘 아니오로** 만듭니다.
    그러면 hub 가 스스로 복사·이동 쪽으로 갑니다.

    안 되는 판이면 조용히 지나갑니다 — 이 손질이 없어도 되는 환경(리눅스·개발자 모드)에서
    쓸데없이 실패하면 안 됩니다.
    """
    try:
        from huggingface_hub import file_download
    except Exception:
        return
    try:
        if file_download.are_symlinks_supported():
            return
    except Exception:
        pass
    file_download.are_symlinks_supported = lambda *args, **kwargs: False


def _sage_kernel_runs():
    """SageAttention 커널이 **이 GPU 에서 실제로 도는지** 한 번 굴려 봅니다.

    diffusers 가 기대하는 모양은 (batch, seq, heads, dim) 입니다 — 축을 (B, H, N, D) 로
    놓고 재면 말도 안 되는 숫자가 나옵니다(2026-09-18 에 제가 그렇게 잘못 쟀습니다).
    """
    try:
        import torch
        from sageattention import sageattn
    except Exception:
        return False
    if not torch.cuda.is_available():
        return False
    try:
        shape = (1, 128, 2, 64)  # 아주 작게. 커널이 붙는지만 보면 됩니다.
        q, k, v = (torch.randn(shape, dtype=torch.bfloat16, device="cuda") for _ in range(3))
        sageattn(q, k, v, tensor_layout="NHD")
        torch.cuda.synchronize()
        return True
    except Exception as error:
        log("SageAttention 이 이 GPU 에서 돌지 않아 건너뜁니다: {}".format(error))
        return False


def use_fast_attention(*models):
    """**어텐션을 빠른 것으로 바꿉니다** — 되는 것 중 가장 빠른 하나로.

    

    diffusers 0.40 은 모델마다 `set_attention_backend` 로 어텐션 커널을 갈아 끼웁니다.
    빠른 순서대로 시도하고, 못 쓰면 다음 것으로 넘어갑니다 — 마지막은 늘 기본값이라
    **아무것도 못 바꿔도 그림은 나옵니다.**

    · `sage`     SageAttention 2.x. int8 QK + fp8 PV 라 긴 영상에서 가장 빠릅니다.
                 **다만 2.x 는 PyPI 에 없습니다**(1.0.6 뿐). 윈도우에서 쓰려면 소스로
                 빌드하거나 커뮤니티 휠을 받아 넣어야 합니다 — 깔려 있으면 여기서 잡힙니다.
    · `sage_hub` 허브에서 미리 빌드된 커널을 받아 씁니다. 리눅스는 되는데 **윈도우 빌드가
                 아직 없습니다**(2026-09-18 확인: `build does not exist` 404).
    · `flash_hub`·`_native_cudnn` 은 이 기계에서 실제로 쓸 수 있는 것들입니다.

    어느 것이 걸렸는지 로그에 남깁니다 — 「왜 안 빨라졌지」 를 여기서 알 수 있어야 합니다.
    """
    wanted = ["sage", "sage_hub", "flash_hub", "_native_cudnn"]
    # `set_attention_backend("sage")` 는 **꾸러미가 import 되는지만** 봅니다. 커널이 이 GPU 에서
    # 도는지는 안 봅니다. 그래서 여기서 손바닥만 한 텐서로 한 번 굴려 봅니다 — 안 돌면 목록에서
    # 뺍니다. 이걸 안 하면 다른 사람 PC(암페어 미만이거나 휠이 어긋난 경우)에서 **다 올린 뒤
    # 생성 도중에** 죽습니다().
    if not _sage_kernel_runs():
        wanted = [name for name in wanted if name != "sage"]
    # 한 번 «이 모델은 안 된다» 를 겪었으면 다시 시도하지 않습니다. 안 그러면 워커를 새로
    # 띄울 때마다 첫 생성이 20초쯤 헛돌고 되돌아옵니다(Krea 2 실측).
    mark = _fast_attention_mark()
    if mark and os.path.exists(mark):
        log("빠른 어텐션은 이 모델에서 못 씁니다(지난번에 겪었습니다). 기본으로 갑니다.")
        return None
    picked = None
    for model in models:
        if model is None or not hasattr(model, "set_attention_backend"):
            continue
        for name in wanted:
            try:
                model.set_attention_backend(name)
                picked = name
                break
            except Exception:
                continue
    log("어텐션: {}".format(picked or "기본값(바꾸지 못했습니다)"))
    return picked


def plain_attention(pipe):
    """빠른 어텐션을 **끄고 기본으로 되돌립니다.**

    `reset_attention_backend()` **하나로는 안 됩니다**(2026-09-18 실측). diffusers 의
    `set_attention_backend` 는 두 군데를 건드립니다 — 부품마다의 `_attention_backend`,
    그리고 **전역** `_AttentionBackendRegistry._active_backend`. 그런데 되돌리기는 앞의
    것만 지웁니다. 그래서 되돌린 뒤에도 전역에 남은 sage 로 다시 가서 똑같이 죽었습니다.
    둘 다 원래대로 돌려놔야 합니다.
    """
    for name in ("transformer", "transformer_2", "unet"):
        part = getattr(pipe, name, None)
        if part is None or not hasattr(part, "reset_attention_backend"):
            continue
        try:
            part.reset_attention_backend()
        except Exception:
            pass
    try:
        from diffusers.models.attention_dispatch import (
            AttentionBackendName,
            _AttentionBackendRegistry,
        )

        _AttentionBackendRegistry.set_active_backend(AttentionBackendName.NATIVE)
    except Exception as error:
        log("전역 어텐션을 되돌리지 못했습니다: {}".format(error))


DORA_TAIL = ".magnitude"

"""«로라» 라고 부르지만 속은 여러 갈래입니다 — 갈래마다 붙이는 법이 다릅니다.

받아 오는 파일이 전부 LoRA 인 줄 알고 있다가, 안 붙는 것을 만나면 「맞는 자리가 하나도
없습니다」 라는 말만 나옵니다(2026-09-23 Anima 실측 — 실은 LoKr 이었습니다). 그 말로는
**무엇을 하면 되는지**를 알 수 없습니다. 그래서 갈래를 먼저 알아보고 이름을 불러 줍니다.
"""
LORA_TAILS = (".lora_A.weight", ".lora_B.weight", ".lora_down.weight", ".lora_up.weight")
"""**쓸 수 있는 로라 키**의 꼬리. 이게 하나라도 있으면 로라입니다.

한때 «못 쓰는 꼬리가 보이면 막는다» 로 적었다가, 진짜 로라를 막았습니다 — Wan 2.2 의
4스텝 증류 로라는 `lora_down`/`lora_up` 810개에 편향·노름 차분(`.diff`·`.diff_b`)이
얹혀 있습니다. 차분은 ComfyUI 가 따로 얹는 덤이지 «로라가 아니라는 증거» 가 아닙니다.
그래서 **있는 것**을 먼저 보고, 없을 때만 «그럼 무엇인가» 를 봅니다.
"""

LORA_FAMILIES = (
    # (꼬리, 갈래 이름) — 쓸 수 있는 로라 키가 **하나도 없을 때만** 봅니다.
    (".lokr_w1", "LoKr"),
    (".lokr_w2", "LoKr"),
    (".hada_w1_a", "LoHa"),
    (".oft_blocks", "OFT"),
    (".diff", "차분(diff)만 든 파일"),
)


def lora_head(path):
    """safetensors 머리말(JSON)만 읽습니다 — 수 GB 짜리를 통째로 올리지 않습니다."""
    try:
        import json
        import struct

        with open(path, "rb") as handle:
            raw = handle.read(8)
            if len(raw) < 8:
                return {}
            (size,) = struct.unpack("<Q", raw)
            if size <= 0 or size > os.path.getsize(path):
                return {}
            return json.loads(handle.read(size).decode("utf-8"))
    except Exception:
        return {}


def lora_family(path):
    """이 파일이 어떤 갈래인가 — `(갈래이름, 올릴 수 있는가)`.

    보통 LoRA 면 `("LoRA", True)`. 모르는 것이면 `(None, True)` 로 두고 그냥 시도합니다 —
    아는 갈래만 막고, 나머지는 실제로 올려 보는 편이 낫습니다(우리가 모르는 것도 있습니다).
    """
    keys = [key for key in lora_head(path) if key != "__metadata__"]
    if not keys:
        return None, True
    # **쓸 수 있는 키가 있으면 로라입니다.** 곁다리가 얹혀 있어도 그건 덤입니다.
    if any(key.endswith(tail) for key in keys for tail in LORA_TAILS):
        if any(key.endswith(DORA_TAIL) for key in keys):
            return "DoRA", True
        return "LoRA", True
    for tail, label in LORA_FAMILIES:
        if any(key.endswith(tail) for key in keys):
            return label, False
    return None, True


def lora_has_dora(path):
    """이 로라가 **DoRA** 인가 — 파일 머리말만 읽어 봅니다(통째로 올리지 않습니다).

    DoRA 는 로라에 «크기(magnitude)» 한 벌을 더 붙인 것입니다. 받아 오는 파일 가운데
    제법 있는데, 그 키 이름이 학습 도구마다 다릅니다. ComfyUI 계열은 `<모듈>.magnitude`
    로 적고, peft 는 `<모듈>.lora_magnitude_vector.weight` 를 기대합니다.

    이름이 어긋나면 diffusers 가 `lora_A`·`lora_B` 만 먹고 `.magnitude` 를 남긴 채
    **「state_dict should be empty at this point」 로 생성을 통째로 실패**시킵니다
    (2026-09-23 Krea 2 로라 실측). 화면에는 키 이름 수백 개가 쏟아집니다.
    """
    return any(
        key.endswith(DORA_TAIL) for key in lora_head(path) if key != "__metadata__"
    )


def fix_dora_keys(state_dict):
    """`<모듈>.magnitude` → `<모듈>.lora_magnitude_vector.weight`.

    diffusers 는 키에 `lora_magnitude_vector` 가 하나라도 있으면 `use_dora` 를 스스로
    켭니다(`diffusers.utils.peft_utils.get_peft_kwargs`). 그러니 **이름만** 맞춰 주면
    나머지는 알아서 됩니다.

    이미 맞는 이름으로 온 파일은 손대지 않습니다.
    """
    if not any(key.endswith(DORA_TAIL) for key in state_dict):
        return state_dict
    out, moved = {}, 0
    for key, tensor in state_dict.items():
        if key.endswith(DORA_TAIL):
            key = key[: -len(DORA_TAIL)] + ".lora_magnitude_vector.weight"
            moved += 1
        out[key] = tensor
    log("DoRA 로라입니다 — 크기 값 {}개의 이름을 맞췄습니다.".format(moved))
    return out


def lora_load_error(error, path, dora):
    """로딩이 터졌을 때 **사람이 읽을 수 있는 말**로 바꿉니다.

    diffusers 의 변환기는 아는 키를 하나씩 꺼내 쓰고 **하나라도 남으면** 남은 키 이름을
    통째로 적어 던집니다. 화면에는 키 수백 개가 쏟아지고, 정작 「이 로라는 이 모델에
    안 맞는다」 라는 한 줄이 없습니다(2026-09-23 Krea 2 · DoRA 실측 — 120줄이 쏟아졌습니다).

    고칠 수 있는 것이 아니라 **고를 때 알아야 하는 것**이라, 무엇을 하면 되는지까지 적습니다.
    """
    text = str(error)
    name = os.path.basename(path)
    if "should be empty at this point" not in text:
        return error
    if dora:
        return IOError(
            "«{}» 는 DoRA 로라입니다 — 지금 이 모델의 로더가 받지 못합니다. "
            "같은 로라의 보통 로라(LoRA) 판이 있으면 그것을 쓰세요.".format(name)
        )
    return IOError(
        "«{}» 는 이 모델에 맞지 않습니다 — 로더가 모르는 칸이 남았습니다. "
        "다른 모델용으로 만들어진 로라일 수 있습니다(밑모델을 확인해 주세요).".format(name)
    )


def fit_lora_keys(state_dict):
    """로라 키를 **이 모델이 아는 이름**으로 맞춥니다.

    받아 온 로라마다 키 앞머리가 다릅니다 — 하나는 `diffusion_model.blocks.…`,
    다른 하나는 `transformer_blocks.…`·`token_refiner.…` 로 시작합니다. diffusers 에
    `prefix="transformer"` 로 넘기면 둘 다 한 개도 안 맞아 **조용히 아무 일도 안 일어납니다.**
    그런데도 겉보기에는 성공이라, 뽑은 영상이 로라 없는 것과 바이트까지 같았습니다.

    그래서 앞머리를 떼어 맞춥니다. `lora_A.default.weight` 처럼 중간에 낀 어댑터 이름도
    뗍니다 — 그 이름은 저장할 때 붙은 것이고, 올릴 때는 우리가 다시 붙입니다.
    """
    out = {}
    for key, tensor in state_dict.items():
        # 곁다리는 버립니다 — 편향·노름 «차분»(`.diff`·`.diff_b`·`.diff_m`)과 알파입니다.
        # ComfyUI 가 따로 얹는 덤이라 diffusers 로더는 모르고, 그대로 넘기면 「남은 키가
        # 있다」 며 생성을 통째로 실패시킵니다(2026-09-23 Wan 2.2 증류 로라 실측 —
        # 쓸 수 있는 키 810개 옆에 덤이 690개 있었습니다).
        if key.endswith((".diff", ".diff_b", ".diff_m", ".alpha")):
            continue
        name = key
        for head in ("diffusion_model.", "transformer.", "model.diffusion_model."):
            if name.startswith(head):
                name = name[len(head):]
                break
        name = name.replace(".lora_A.default.weight", ".lora_A.weight")
        name = name.replace(".lora_B.default.weight", ".lora_B.weight")
        name = name.replace(".lora_A.default_0.weight", ".lora_A.weight")
        name = name.replace(".lora_B.default_0.weight", ".lora_B.weight")
        # `lora_down`·`lora_up` 은 `lora_A`·`lora_B` 의 옛 이름입니다(kohya 계열).
        name = name.replace(".lora_down.weight", ".lora_A.weight")
        name = name.replace(".lora_up.weight", ".lora_B.weight")
        out[name] = tensor
    # DoRA 의 «크기» 이름도 여기서 같이 맞춥니다 — 길이 둘이면 한쪽을 빠뜨립니다.
    return fix_dora_keys(out)


def lora_fits(model, state_dict):
    """이 로라의 키가 모델의 모듈 이름과 **실제로 만나는가.**

    diffusers 는 한 개도 안 맞아도 예외를 던지지 않고 경고만 찍고 넘어갑니다. 그래서
    «먹였습니다» 라고 적어 놓고 아무 일도 안 한 채 돌던 것입니다. 여기서 미리 셉니다.
    """
    names = {name for name, _ in model.named_modules()}
    hit = 0
    for key in state_dict:
        base = key.split(".lora_A")[0].split(".lora_B")[0]
        if base in names:
            hit += 1
    return hit


def fit_kohya_keys(model, state_dict):
    """**kohya 식 이름**을 이 모델의 모듈 이름으로 되돌립니다.

    Civitai 에서 가장 흔한 모양입니다:

        lora_unet_blocks_0_adaln_modulation_cross_attn_1.lora_down.weight
        lora_unet_blocks_0_adaln_modulation_cross_attn_1.lora_up.weight
        lora_unet_blocks_0_adaln_modulation_cross_attn_1.alpha

    점을 밑줄로 바꿔 한 덩이로 만든 이름이라, 글자만 봐서는 어디가 점이었는지 되돌릴 수
    없습니다(`cross_attn_1` 이 `cross_attn.1` 인지 `cross.attn.1` 인지 모릅니다). 그래서
    **모델에게 물어봅니다** — 모듈 이름의 점을 밑줄로 바꿔 사전을 만들어 두고 맞춰 봅니다.
    짐작이 아니라 대조라, 맞으면 확실히 맞고 안 맞으면 확실히 안 맞습니다.

    `lora_down`·`lora_up` 은 `lora_A`·`lora_B` 의 옛 이름입니다. 알파는 버립니다 —
    랭크가 텐서 모양에 들어 있어 peft 가 스스로 읽고, 알파를 함께 넘기면 diffusers 가
    거절합니다(까닭은 `minimaxh3` 의 로라 대목에).
    """
    table = {}
    for name, _module in model.named_modules():
        if name:
            table[name.replace(".", "_")] = name
    out, hit = {}, 0
    for key, tensor in state_dict.items():
        if key.endswith(".alpha"):
            continue
        for head in ("lora_unet_", "lora_transformer_"):
            if key.startswith(head):
                key = key[len(head):]
                break
        else:
            # 글 인코더 쪽(`lora_te_…`)은 우리가 거는 부품이 아닙니다.
            if key.startswith("lora_te"):
                continue
        if ".lora_down.weight" in key:
            stem, tail = key.split(".lora_down.weight")[0], ".lora_A.weight"
        elif ".lora_up.weight" in key:
            stem, tail = key.split(".lora_up.weight")[0], ".lora_B.weight"
        else:
            continue
        real = table.get(stem)
        if real is None:
            continue
        out[real + tail] = tensor
        hit += 1
    if hit:
        log("kohya 식 이름입니다 — {}개를 이 모델의 이름으로 맞췄습니다.".format(hit))
    return out


def lora_mismatch(model, state_dict, path):
    """맞는 자리가 없을 때 **무엇이 어긋났는지 보여 주는** 오류를 만듭니다.

    「맞는 자리가 하나도 없습니다」 만으로는 고칠 길이 없습니다. 모델이 쓰는 이름과 파일이
    들고 온 이름을 한 줄씩 나란히 보여 주면, 다른 판(ComfyUI 단일파일용 · 다른 밑모델)을
    받아 왔다는 것이 바로 보입니다.

    **짐작으로 이어 붙이지 않는 까닭**: 이름이 비슷하다고 아무 데나 붙이면 100% 붙은 것처럼
    보이면서 엉뚱한 층에 얹힙니다. 그러면 「로라가 이상하게 먹는다」 가 되는데, 그건
    안 붙는 것보다 찾기 어렵습니다(2026-09-23 Anima 실측에서 그렇게 하지 않기로 했습니다).
    """
    mods = [name for name, _ in model.named_modules() if name and "." in name]
    theirs = sorted({key.split(".lora_")[0] for key in state_dict})[:2]
    return IOError(
        "«{}» 는 이 모델에 맞지 않습니다 — 맞는 자리가 하나도 없습니다.\n"
        "  이 모델이 쓰는 이름: {}\n"
        "  이 파일이 들고 온 이름: {}\n"
        "같은 그림이라도 ComfyUI 단일파일용으로 만든 로라는 이름이 달라 안 붙습니다.".format(
            os.path.basename(path),
            ", ".join(mods[:2]) if mods else "(못 읽음)",
            ", ".join(theirs) if theirs else "(못 읽음)",
        )
    )


def prepare_lora(model, path):
    """로라 한 개를 **올릴 수 있는 모양**으로 만들어 돌려줍니다 — `(state_dict, 맞는 자리 수)`.

    이름 규칙이 세 갈래입니다(앞머리만 다른 것 · DoRA · kohya). 엔진마다 적으면 한 곳만
    틀리고, 그 엔진에서만 로라가 조용히 안 먹습니다 — 이 저장소가 반복해 겪은 모양입니다.
    그래서 **여기 한 벌**만 둡니다.
    """
    from safetensors.torch import load_file

    raw = load_file(path, device="cpu")
    state_dict = fit_lora_keys(raw)
    hit = lora_fits(model, state_dict)
    if not hit:
        # 앞머리만 떼어서는 안 맞았습니다. kohya 식인지 모델에게 물어봅니다.
        kohya = fit_kohya_keys(model, raw)
        if kohya:
            state_dict, hit = kohya, lora_fits(model, kohya)
    return state_dict, hit


def lora_adapter_count(model):
    """이 모델에 **실제로 붙어 있는** 로라 어댑터 수.

    diffusers 는 키가 한 개도 안 맞아도 예외를 던지지 않고 경고만 찍고 넘어갑니다.
    그래서 «먹였습니다» 라고 적어 놓고 아무 일도 안 한 채 도는 일이 실제로 있었습니다 —
    로라를 켠 영상과 끈 영상이 **바이트까지 같았습니다.** 겉보기로는 성공이라 눈으로는
    「로라가 약한가 보다」 로 넘어갑니다.

    그래서 올린 뒤에 세어 봅니다. 세는 법은 모델마다 다를 수 있어 아는 길을 차례로 봅니다.
    """
    for attr in ("peft_config", "_hf_peft_config_loaded"):
        value = getattr(model, attr, None)
        if isinstance(value, dict) and value:
            return len(value)
    found = set()
    for module in getattr(model, "modules", lambda: [])():
        names = getattr(module, "lora_A", None)
        if hasattr(names, "keys"):
            found.update(names.keys())
    return len(found)


def guard_lora_family(path):
    """못 올리는 갈래면 **올리기 전에** 막습니다.

    모델을 다 올린 뒤에 실패하면 몇 분을 버리고, 나오는 말도 「맞는 자리가 없다」 뿐입니다.
    갈래 이름을 불러 주면 사람이 «같은 그림의 LoRA 판» 을 찾아 쓸 수 있습니다.
    """
    label, usable = lora_family(path)
    if usable:
        return
    raise IOError(
        "«{}» 은 {} 입니다 — 로라(LoRA)가 아니라 다른 갈래라 이 앱이 올리지 못합니다. "
        "같은 그림의 LoRA 판이 있으면 그것을 쓰세요.".format(os.path.basename(path), label)
    )


def check_loras(model, wanted, where=""):
    """올린 뒤 **한 개도 안 붙었으면 알립니다.** 붙은 수를 돌려줍니다."""
    if not wanted:
        return 0
    got = lora_adapter_count(model)
    if not got:
        raise IOError(
            "로라가 한 개도 붙지 않았습니다{} — 이 모델에 맞는 로라인지 확인해 주세요.".format(
                " ({})".format(where) if where else ""
            )
        )
    if got < len(wanted):
        log("로라 {}개 가운데 {}개만 붙었습니다.".format(len(wanted), got))
    return got


"""빠른 어텐션이 못 돌 때 내는 말들.

「sage」·「attention」 만 보고 있었더니 **「No available kernel. Aborting execution.」** 을
못 잡아 그림이 아예 안 나왔습니다(anima). 커널이 바뀌면 문구도 바뀌므로, 아는 말은 여기
한 곳에 모읍니다 — 엔진마다 따로 적으면 한 엔진만 조용히 못 잡습니다.
"""
_FAST_ATTENTION_SIGNS = (
    "sage",
    "attention",
    "no available kernel",
    "flash",
    "backend",
)


def run_attention_safe(pipe, run):
    """`run()` 을 돌리되, **빠른 어텐션 때문에 죽으면 기본으로 되돌려 한 번 더** 합니다.

    2026-09-18 실측: Krea 2 는 sage 를 잡고도 첫 생성에서 죽었습니다.

        ValueError: `attn_mask` is not supported for sage attention

    SageAttention 커널에는 어텐션 마스크 자리가 없습니다. 그런데 글자를 채워 넣는 모델은
    («여기까지가 진짜 글자» 를 알려 주려고) 마스크를 씁니다 — 커널이 이 GPU 에서 도는지
    미리 굴려 봐도 이건 못 잡습니다. **모델이 무엇을 넘기느냐** 의 문제라서요.

    그래서 여기서 받아 냅니다. 한 번 되돌리면 그 모델은 계속 기본 어텐션으로 돕니다 —
    다음 생성부터는 실패도 없습니다. 느려질 뿐 **그림은 나옵니다**, 이게 중요합니다.
    """
    try:
        return run()
    except Exception as error:
        text = str(error).lower()
        if not any(mark in text for mark in _FAST_ATTENTION_SIGNS):
            raise
        log("빠른 어텐션으로는 못 돌려 기본 어텐션으로 다시 합니다: {}".format(error))
        plain_attention(pipe)
        # 다음부터는 아예 시도하지 않도록 적어 둡니다.
        mark = _fast_attention_mark()
        if mark:
            try:
                with open(mark, "w", encoding="utf-8") as handle:
                    handle.write("{}\n{}\n".format(time.strftime("%Y-%m-%d %H:%M"), error))
            except Exception:
                pass
        return run()


def log(message):
    """stderr 로 한 줄. stdout 은 프로토콜 전용이라 절대 쓰면 안 됩니다."""
    sys.stderr.write("[{}] {}\n".format(time.strftime("%H:%M:%S"), message))
    sys.stderr.flush()


def torch_info():
    """기동 직후 화면에 보여 줄 값 — GPU 를 잡았는지."""
    import torch

    cuda = bool(torch.cuda.is_available())
    name = torch.cuda.get_device_name(0) if cuda else ""
    vram = 0
    if cuda:
        vram = round(torch.cuda.get_device_properties(0).total_mem / (1024 ** 3), 1) \
            if hasattr(torch.cuda.get_device_properties(0), "total_mem") \
            else round(torch.cuda.get_device_properties(0).total_memory / (1024 ** 3), 1)
    return {
        "cuda": cuda,
        "device": name,
        "torch": torch.__version__,
        "vram_gb": vram,
    }


def device_and_dtype():
    """GPU 가 있으면 bf16, 없으면 CPU·fp32.

    bf16 인 까닭: 요즘 DiT(Qwen-Image·FLUX·Wan)는 bf16 으로 학습돼 fp16 에서 검은 화면이
    나오는 일이 있습니다. 사용자의 GPU 는 넉넉하니 굳이 fp16 으로 내려갈 이유가 없습니다.
    """
    import torch

    if torch.cuda.is_available():
        return "cuda", torch.bfloat16
    return "cpu", torch.float32


def vram_gb():
    """이 기계의 VRAM(GB). GPU 가 없으면 0."""
    import torch

    if not torch.cuda.is_available():
        return 0.0
    props = torch.cuda.get_device_properties(0)
    total = getattr(props, "total_memory", None) or getattr(props, "total_mem", 0)
    return round(total / (1024 ** 3), 1)


#: 가중치 말고도 텍스트 인코더·VAE·중간값이 함께 올라갑니다. VRAM 을 이만큼 나눈 것이
#: «실제로 모델이 앉을 수 있는 자리» 입니다 — 그냥 VRAM 과 견주면 아슬아슬하게 들어간다고
#: 보고는 첫 생성의 최고점에서 터집니다.
PRECISION_HEADROOM = 1.25
#: int8 은 bf16 의 절반쯤을 씁니다. 그 절반이 들어가면 int8 로 내려갑니다.
INT8_FRACTION = 2.0
#: 정밀도 사다리 — 왼쪽이 원본, 오른쪽으로 갈수록 작고 거칩니다.
PRECISION_LADDER = ("bf16", "int8", "int4")
#: 정밀도 이름 → 양자화 비트(0 은 «줄이지 않음»).
PRECISION_BITS = {"bf16": 0, "int8": 8, "int4": 4}


def _nearest_precision(wanted, supported):
    """엔진이 실제로 할 수 있는 것 중 `wanted` 에 가장 가까운 것.

    **작은 쪽을 먼저** 봅니다 — 못 줄여서 안 도는 것보다, 더 줄여서라도 도는 편이 낫습니다.
    작은 쪽에 아무것도 없으면 그제야 큰 쪽으로 올라갑니다.
    """
    order = list(PRECISION_LADDER)
    start = order.index(wanted)
    for mode in order[start:] + list(reversed(order[:start])):
        if mode in supported:
            return mode
    return wanted


def plan_precision(bf16_gb, opts=None, loaded=None, supported=None):
    """이 GPU 에서 **어떤 정밀도로 올릴지**, 그리고 **다시 올려야 하는지** 정합니다.

    여태는 화면에 «줄이면 됩니다» 라고 적어만 두고 실제로는 늘 원본을 받아 CPU 오프로드로
    버텼습니다. 오프로드는 «안 죽게» 해 줄 뿐이라 24 GB 카드에서 26 GB 짜리를 돌리면
    블록이 계속 오가며 몇 배로 느려집니다. 여기서 진짜로 고릅니다.

    판단은 **워커 안에서** 합니다 — 앱이 nvidia-smi 로 읽은 값과 torch 가 보는 값이 다를 수
    있고(여러 장·MIG), 실제로 올리는 쪽이 torch 니까요. 화면 쪽에는 같은 공식을 옮긴
    `client/src/lib/localEngines.ts` 의 `planPrecision` 이 있고, **두 벌이 어긋나면
    `precisionPolicy.test.ts` 가 이 파일의 상수를 직접 읽어 잡습니다.**

      · 넉넉하면            bf16 그대로
      · 8비트로 들어가면    int8  (품질 손실이 거의 없습니다)
      · 그래도 모자라면     int4  (nf4 — 눈에 띄지만 도는 것이 안 도는 것보다 낫습니다)

    `opts.precision` 으로 사람이 못 박을 수 있습니다("bf16"·"int8"·"int4"·"auto").
    자동 판단이 틀릴 때(다른 프로그램이 VRAM 을 쥐고 있을 때 등) 손으로 내리라고 둔 길입니다.

    `supported` 는 **그 엔진이 실제로 올릴 수 있는 정밀도**입니다(모듈러 파이프라인처럼 아직
    양자화 길이 없는 엔진이 있습니다). 못 하는 것을 고르면 여기서 할 수 있는 것으로 내려
    잡습니다 — 그래야 결과에 적히는 값이 «정말로 올라간 것» 이 됩니다.

    `loaded` 에 **지금 올라가 있는 정밀도**(모드 문자열이나 지난번 plan)를 주면 `reload` 로
    «내리고 다시 올려야 하는가» 를 함께 돌려줍니다. 이 판단이 엔진마다 흩어져 있으면
    한 엔진만 빠뜨립니다 — 실제로 로라는 바뀌면 다시 걸면서 정밀도는 아무 엔진도 안 봐서,
    사람이 bf16 → int4 로 내려도 앞서 올린 것이 그대로 돌았습니다.
    """
    requested = str((opts or {}).get("precision") or "auto").lower()
    if requested not in PRECISION_LADDER:
        requested = "auto"
    have = vram_gb()

    if requested != "auto":
        wanted, why = requested, "사람이 고름"
    elif have <= 0:
        # CPU 뿐이면 양자화가 오히려 느립니다(bitsandbytes 는 CUDA 전용).
        wanted, why = "bf16", "GPU 없음"
    else:
        room = have / PRECISION_HEADROOM
        if room >= bf16_gb:
            wanted, why = "bf16", "넉넉함"
        elif room >= bf16_gb / INT8_FRACTION:
            wanted, why = "int8", "bf16 이 안 들어감"
        else:
            wanted, why = "int4", "int8 도 안 들어감"

    mode = wanted
    if supported and mode not in supported:
        mode = _nearest_precision(wanted, supported)
        why = "{} 로 가고 싶지만 이 엔진은 {} 까지입니다".format(wanted, "·".join(supported))

    if isinstance(loaded, dict):
        loaded = loaded.get("mode")
    changed = bool(loaded) and loaded != mode
    if changed:
        log("정밀도가 {} → {} 로 바뀌었습니다. 올라가 있는 것을 내리고 다시 올립니다.".format(loaded, mode))
    return {
        "mode": mode,
        "bits": PRECISION_BITS[mode],
        # 규칙이 고른 값. `mode` 와 다르면 엔진이 그것을 못 해서 내려 잡은 것입니다.
        "wanted": wanted,
        # 사람이 고른 값("auto" 면 맡긴 것). 화면이 «요청» 과 «실제» 를 구분해 보여 줍니다.
        "requested": requested,
        "vram": have,
        "bf16_gb": bf16_gb,
        "why": why,
        "reload": changed,
    }


def log_precision(what, plan):
    """«무엇을 어떤 정밀도로 올리는가» 한 줄. 엔진마다 적으면 한 곳만 모양이 달라집니다."""
    log("{} 를 {} 로 올립니다 (VRAM {} GB · {}).".format(what, plan["mode"], plan["vram"], plan["why"]))


def precision_fields(plan):
    """생성 결과에 실을 정밀도 값 — 화면이 «요청한 설정» 과 «실제로 올라간 설정» 을 구분해
    보여 줄 수 있게 합니다.

    「왜 이번엔 결이 다르지」 와 「int4 로 내렸는데 왜 안 빨라지지」 의 답이 여기 있습니다.
    이름을 엔진마다 적으면 한쪽만 고치는 날이 오므로 한 곳에서 만듭니다.
    """
    plan = plan or {}
    mode = plan.get("mode", "bf16")
    return {
        "precision": mode,
        "precision_requested": plan.get("requested", "auto"),
        "precision_planned": plan.get("wanted", mode),
        "precision_why": plan.get("why", ""),
        "vram_gb": plan.get("vram", 0),
    }


def quantized_transformers(repo, dtype, bits, extra=()):
    """줄여 올릴 **트랜스포머들**을 `from_pretrained` 에 끼울 꼴로 돌려줍니다.

    Wan 2.2 처럼 전문가가 둘인 모델(`transformer` + `transformer_2`)은 하나만 줄이면
    **절반이 bf16 으로 남아** 여전히 안 들어갑니다. 실제로 model_index.json 을 열어 보고
    알았습니다(2026-09-17) — 그전에는 `transformer` 하나만 줄이고 있었습니다.
    """
    out = {}
    for name in ("transformer",) + tuple(extra):
        out[name] = quantized_component(repo, dtype, bits, subfolder=name)
    return out


def quantized_component(repo, dtype, bits, subfolder="transformer"):
    """저장소의 **트랜스포머만** 줄여서 올립니다.

    파이프라인 통째로는 못 줄입니다(diffusers 는 모델 단위로 받습니다). 큰 것은 어차피
    DiT 한 덩어리라 그것만 줄이면 대부분의 VRAM 이 내려갑니다 — 텍스트 인코더와 VAE 는
    합쳐도 몇 GB 입니다.
    """
    from diffusers import AutoModel, BitsAndBytesConfig

    if bits == 8:
        config = BitsAndBytesConfig(load_in_8bit=True)
    else:
        # nf4 — 4비트 중 그림에서 가장 덜 상하는 방식입니다. 계산은 bf16 으로 되돌려 합니다.
        config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=dtype,
        )
    log("{} 의 {} 를 {}비트로 올립니다.".format(repo, subfolder, bits))
    return AutoModel.from_pretrained(
        repo,
        subfolder=subfolder,
        quantization_config=config,
        torch_dtype=dtype,
    )


def place(pipe, device, quantized):
    """올린 파이프라인을 장치에 놓습니다.

    양자화한 모델은 **옮길 수 없습니다** — bitsandbytes 가 이미 GPU 에 자리를 잡아 두었고
    `.to()` 를 부르면 오류가 납니다. 오프로드도 판에 따라 거부하므로, 되면 켜고 안 되면
    그냥 둡니다(그 상태로도 이미 VRAM 안에 들어가 있습니다).
    """
    if device != "cuda":
        return pipe.to(device)
    try:
        # VRAM 이 아무리 넉넉해도 오프로드를 씁니다 — 20B 급이 텍스트 인코더까지 한꺼번에
        # 올라가면 영상 엔진이나 업스케일이 끼어들 때 둘 다 죽습니다.
        pipe.enable_model_cpu_offload()
    except Exception as error:
        if not quantized:
            raise
        log("오프로드를 못 켰습니다(양자화판이라 그대로 둡니다): {}".format(error))
    return pipe


def resolve_seed(opts):
    """시드가 없으면 하나 뽑아 **돌려줍니다** — 마음에 든 결과를 다시 뽑으려면 시드가 필요합니다."""
    seed = opts.get("seed")
    if seed in (None, "", -1, "-1"):
        seed = random.randint(0, 2 ** 31 - 1)
    return int(seed)


def generator(seed):
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    return torch.Generator(device=device).manual_seed(int(seed))


def free_vram():
    """모델을 내린 뒤 실제로 VRAM 이 비도록."""
    import gc

    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception as error:  # torch 가 없을 수도 있습니다(설치 직후 검증 단계)
        log("VRAM 을 비우지 못했습니다: {}".format(error))
    gc.collect()


def memory_usage():
    """캐시 정리 뒤 전체 RAM과 현재 GPU의 사용률을 잽니다. 모르는 값은 0이 아니라 None입니다."""
    result = {"ram_used_percent": None, "vram_used_percent": None}
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD)] + [
                    (name, ctypes.c_ulonglong) for name in (
                        "total_phys", "avail_phys", "total_page", "avail_page",
                        "total_virtual", "avail_virtual", "avail_extended")
                ]

            status = MemoryStatus()
            status.length = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                result["ram_used_percent"] = float(status.load)
        elif sys.platform.startswith("linux"):
            with open("/proc/meminfo", encoding="ascii") as source:
                values = {line.split(":", 1)[0]: int(line.split()[1]) for line in source}
            total = values.get("MemTotal", 0)
            available = values.get("MemAvailable")
            if total > 0 and available is not None:
                result["ram_used_percent"] = round(100 * (1 - available / total), 2)
    except Exception as error:
        log("RAM 사용률을 확인하지 못했습니다: {}".format(error))
    try:
        import torch
        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            if total > 0:
                result["vram_used_percent"] = round(100 * (1 - free / total), 2)
            result["vram_allocated_bytes"] = int(torch.cuda.memory_allocated())
            result["vram_reserved_bytes"] = int(torch.cuda.memory_reserved())
    except Exception as error:
        log("VRAM 사용률을 확인하지 못했습니다: {}".format(error))
    return result


def step_reporter(report, total_steps, base=10, span=85):
    """디퓨전 스텝을 진행률로 바꿔 주는 콜백.

    diffusers 의 `callback_on_step_end` 규약에 맞춘 꼴로 돌려줍니다. 진행이 안 보이면
    수 분짜리 생성이 «멈춘 것» 으로 보여서, 사용자가 앱을 강제로 닫게 됩니다.
    """

    def callback(pipe, step, timestep, kwargs):
        if total_steps:
            percent = base + span * (step + 1) / float(total_steps)
            report(min(base + span, percent), "{}/{} 스텝".format(step + 1, total_steps))
        return kwargs

    return callback


def check_motion_mask(opts):
    """움직임 마스크를 **모델을 부르기 전에** 봅니다.

    예전에는 mp4 로 쓰기 직전에야 마스크를 열었습니다. 그래서 경로가 틀렸거나 PNG 가
    깨졌으면 **몇 분짜리 생성을 다 하고 나서** 터졌습니다 — 그림은 다 뽑아 놓고 파일로는
    한 장도 안 남습니다(2026-09-23 검토).

    여는 데 몇 ms 면 되는 일이니 앞에서 봅니다. 크기까지는 안 맞춰도 됩니다 —
    `freeze_by_mask` 가 늘려 맞춥니다.
    """
    path = (opts or {}).get("motion_mask")
    if not path:
        return
    if not os.path.isfile(path):
        raise IOError("움직임 구역 파일을 찾지 못했습니다: {}".format(path))
    try:
        from PIL import Image

        with Image.open(path) as image:
            image.verify()  # 통째로 읽지 않고 머리와 끝만 봅니다.
        with Image.open(path) as image:
            width, height = image.size
    except Exception as exc:
        raise IOError(
            "움직임 구역 그림을 읽지 못했습니다({}): {}".format(os.path.basename(path), exc)
        )
    if width < 2 or height < 2:
        raise IOError(
            "움직임 구역 그림이 너무 작습니다({}×{}): {}".format(
                width, height, os.path.basename(path)
            )
        )


def freeze_by_mask(frames, mask_path):
    """**«여기만 움직인다»** — 흰 곳은 그대로 두고, 검은 곳은 첫 장면으로 되돌립니다.

    화면에서 흑백 마스크를 그려 보내 놓고 워커가 그 칸을 안 보면, 그린 사람 눈에는
    「먹히긴 하는데 약하다」 로 보입니다(프롬프트 한 줄은 들어가니까요). 실제로는
    아무 일도 안 일어납니다 — 로라가 조용히 안 붙던 것과 같은 모양의 사고입니다.

    모델을 바꾸지 않고 **뽑은 뒤에** 섞는 까닭은, 엔진마다 안쪽이 전부 달라서
    한 벌로 둘 수 있는 자리가 여기뿐이기 때문입니다. 배경은 첫 장면에 붙들어 두고
    사람·차만 움직이게 하는, 실제로 쓰는 쓰임새에는 이것으로 충분합니다.

    마스크는 첫 장면과 크기가 달라도 됩니다 — 늘려서 맞춥니다. 회색은 그 비율만큼
    섞이므로 가장자리가 부드럽게 이어집니다.
    """
    if not mask_path or not os.path.isfile(mask_path):
        return frames
    if len(frames) == 0:
        # numpy 배열이 올 수도 있어 `if not frames:` 로 재면 예외가 됩니다(실측 2026-09-23).
        return frames
    try:
        import numpy as np
        from PIL import Image
    except Exception as exc:
        log("움직임 구역을 못 읽어 그냥 갑니다: {}".format(exc))
        return frames

    first = frames[0]
    # 엔진마다 PIL 을 주기도 하고 numpy 를 주기도 합니다. **PIL 인지 먼저** 봐야 합니다 —
    # numpy 에도 `.size` 가 있는데 그건 «원소 개수» 라, 그걸 크기로 읽으면 조용히 어긋납니다.
    pil = hasattr(first, "convert")
    base = np.asarray(first.convert("RGB") if pil else first, dtype="float32")
    if base.ndim != 3:
        log("움직임 구역 — 프레임 모양을 모르겠습니다({}). 그냥 갑니다.".format(base.shape))
        return frames

    size = (base.shape[1], base.shape[0])
    mask = Image.open(mask_path).convert("L")
    if mask.size != size:
        mask = mask.resize(size, Image.BILINEAR)
    # 흰(255) = 움직인다 = 새 프레임을 그대로. 검은(0) = 첫 장면으로.
    alpha = (np.asarray(mask).astype("float32") / 255.0)[:, :, None]
    if float(alpha.max()) <= 0.0:
        # 전부 검으면 영상이 정지 사진이 됩니다 — 그릴 때 실수한 쪽이 훨씬 잦아 그냥 둡니다.
        log("움직임 구역이 전부 검습니다 — 무시하고 그대로 내보냅니다.")
        return frames

    out = [first]
    for frame in frames[1:]:
        arr = np.asarray(frame.convert("RGB") if pil else frame, dtype="float32")
        mixed = arr * alpha + base * (1.0 - alpha)
        if pil:
            out.append(Image.fromarray(mixed.clip(0, 255).astype("uint8")))
        else:
            # **자료형도 눈금도 받은 그대로** 돌려줍니다. diffusers 의 `export_to_video` 는
            # numpy 프레임을 «0~1 실수» 로 보고 255 를 곱합니다 — uint8 로 바꿔 돌려줬더니
            # 거기에 또 곱해져 영상이 망가졌습니다(실측: 224KB 짜리가 72KB 로).
            out.append(mixed.astype(np.asarray(frame).dtype))
    log("움직임 구역 적용 — {}프레임을 첫 장면에 묶었습니다({:.0f}%가 움직임).".format(
        len(out) - 1, 100.0 * float(alpha.mean())))
    return out if pil else np.stack(out)


def save_video(frames, path, fps):
    """프레임 목록을 mp4 로. diffusers 의 export_to_video 를 그대로 씁니다."""
    from diffusers.utils import export_to_video

    export_to_video(frames, path, fps=int(fps))
    return path
