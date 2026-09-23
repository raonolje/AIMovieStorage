# -*- coding: utf-8 -*-
"""Wan 2.2 — 이 컴퓨터에서 도는 영상 엔진. **멀티 로라**를 받습니다.



사용자가 지목한 **미니맥스 H3** 가 기본입니다(`minimaxh3.py`). 이 엔진은 그것을 못 돌리는
기계를 위한 **가벼운 대안**입니다 — H3 는 bf16 기준 125 GB 라 int8 로 줄여도 호스트 RAM 이
75 GB 쯤 있어야 합니다. Wan 은 그 몇 분의 일로 돌고, 로라 생태계도 큽니다.

# 첫 장면 그림이 있으면 그것으로 시작합니다(I2V)

컷 영상은 «이미 뽑아 둔 대표 그림이 움직이는 것» 이라야 앞뒤 컷과 인물이 같습니다.
`opts.image` 를 주면 그 그림을 첫 프레임으로 삼는 파이프라인으로 갈아탑니다.

# 가중치는 설치 때 T2V·I2V 두 판을 다 미리 받습니다(`prefetch`)

 그전에는 첫 생성 때 그때 필요한 판만 받아서, 사용자의
기계에는 T2V 판만 있었습니다 — 대표 그림을 주는 첫 컷에서 «생성 중» 안에 I2V 판 60 GB 를
말없이 받게 되는 구조였습니다. 설치 때(이미 깔린 엔진은 «가중치 미리 받기» 단추로) 둘 다 받아 둡니다.
"""

import os
import time

import common

_state = {"pipe": None, "mode": None, "loras": [], "plan": None}

"""이 모델을 bf16 그대로 올리는 데 필요한 VRAM(GB) — 정밀도를 고르는 잣대."""
"""
bf16 으로 올릴 때 **실제로 필요한 GB**. 2026-09-18 에 저장소를 재어 고쳤습니다.

여태 24.0 이었습니다. 그런데 Wan 2.2 A14B 는 전문가가 **둘**이라 transformer 57.2 GB +
transformer_2 57.2 GB + 텍스트 인코더 11.4 GB = **126 GB** 입니다. 24 로 적어 두면
`plan_precision` 이 32 GB 카드에서도 «넉넉함 → bf16» 을 고르고, 실제로는 126 GB 를 올리려
들어 기계가 멎습니다 — 96 GB 카드에서 돌려 보니 시스템 RAM 여유가 2.1 GB 까지 떨어졌습니다.

제대로 적어 두면 96 GB 카드에서도 int8 로 내려가 실제로 돕니다.
"""
BF16_GB = 126.0


def info(root):
    return {
        "repo": "Wan-AI/Wan2.2-T2V-A14B-Diffusers",
        "notes": "영상. opts.image 를 주면 그 그림에서 시작합니다(I2V). 멀티 로라를 받습니다.",
    }


def _repo(mode):
    return (
        "Wan-AI/Wan2.2-I2V-A14B-Diffusers"
        if mode == "i2v"
        else "Wan-AI/Wan2.2-T2V-A14B-Diffusers"
    )


def prefetch(root, report):
    """T2V·I2V **두 저장소를 다** 미리 받습니다(합쳐 약 120 GB). 이미 있는 파일은 건너뜁니다.

    막대는 둘을 이어 하나로 봅니다 — 첫 판이 0~50 %, 둘째 판이 50~100 %. 판마다 0 부터 다시
    차오르면 «되돌아갔다» 로 보입니다.
    """
    from engines import _hf  # 워커가 `engines.<id>` 로 불러오므로 helper 도 같은 꾸러미에서

    common.use_engine_cache(root)
    repos = [_repo("t2v"), _repo("i2v")]
    for index, repo in enumerate(repos):
        def joined(percent, message="", _index=index):
            scaled = None if percent is None else (_index * 100.0 + percent) / len(repos)
            report(scaled, "{}/{} · {}".format(_index + 1, len(repos), message))

        joined(None, "{} 파일 목록을 읽는 중".format(repo))
        _hf.snapshot(repo, joined)


def load(root, opts):
    mode = "i2v" if (opts.get("image") or "").strip() else "t2v"
    # 정밀도를 **먼저** 셈합니다 — 이미 올라가 있어도 사람이 정밀도를 바꿨으면 다시 올려야
    # 합니다(로라만 다시 걸고 정밀도는 안 보던 자리). 판단은 `common.plan_precision` 한 곳.
    plan = common.plan_precision(BF16_GB, opts, loaded=_state["plan"])
    if _state["pipe"] is not None and _state["mode"] == mode and not plan["reload"]:
        _apply_loras(opts)
        return
    import diffusers

    common.use_engine_cache(root)
    device, dtype = common.device_and_dtype()
    unload()
    pipeline_class = getattr(
        diffusers, "WanImageToVideoPipeline" if mode == "i2v" else "WanPipeline"
    )
    repo = _repo(mode)
    # 이 GPU 에 bf16 이 안 들어가면 **정말로 줄여서** 올립니다.
    common.log_precision(repo, plan)
    if plan["bits"]:
        # Wan 2.2 A14B 는 전문가가 **둘**입니다(`transformer` + `transformer_2`).
        # 하나만 줄이면 절반이 bf16 으로 남아 여전히 안 들어갑니다.
        parts = common.quantized_transformers(repo, dtype, plan["bits"], extra=("transformer_2",))
        pipe = pipeline_class.from_pretrained(repo, torch_dtype=dtype, **parts)
    else:
        pipe = pipeline_class.from_pretrained(repo, torch_dtype=dtype)
    # 영상 DiT 는 그림보다 훨씬 큽니다. 오프로드 없이는 VRAM 이 넉넉해도 최고점에서 터집니다.
    pipe = common.place(pipe, device, bool(plan["bits"]))
    try:
        pipe.set_progress_bar_config(disable=True)
    except Exception:
        pass
    common.use_fast_attention(
        getattr(pipe, "transformer", None), getattr(pipe, "transformer_2", None)
    )
    _state["pipe"] = pipe
    _state["mode"] = mode
    _state["plan"] = plan
    _state["loras"] = []
    _apply_loras(opts)


def unload():
    _state["pipe"] = None
    _state["mode"] = None
    _state["loras"] = []
    _state["plan"] = None
    common.free_vram()


def _apply_loras(opts):
    """`opts.loras = [{"path": …, "weight": 0.8}, …]` — 여러 개를 한꺼번에 먹입니다."""
    pipe = _state["pipe"]
    wanted = [item for item in (opts.get("loras") or []) if item.get("path")]
    signature = [(item["path"], float(item.get("weight", 1.0))) for item in wanted]
    if signature == _state["loras"]:
        return
    try:
        pipe.unload_lora_weights()
    except Exception as error:
        common.log("로라를 떼지 못했습니다(무시): {}".format(error))
    rel_name = os.path.basename(wanted[0]["path"]) if wanted else ""
    names, weights = [], []
    for index, item in enumerate(wanted):
        path = item["path"]
        if not os.path.isfile(path):
            raise IOError("로라 파일을 찾지 못했습니다: {}".format(path))
        common.guard_lora_family(path)
        folder, filename = os.path.split(path)
        name = "lora{}".format(index)
        pipe.load_lora_weights(folder, weight_name=filename, adapter_name=name)
        names.append(name)
        weights.append(float(item.get("weight", 1.0)))
    if names:
        pipe.set_adapters(names, adapter_weights=weights)
        # 붙었는지 **세어 보고** 적습니다 — 안 붙어도 diffusers 는 조용합니다(`common.check_loras`).
        got = common.check_loras(getattr(pipe, "transformer", pipe), wanted, rel_name)
        common.log("로라 {}개를 먹였습니다.".format(got))
    _state["loras"] = signature


def generate(output, opts, report):
    # 마스크는 **모델을 부르기 전에** 봅니다 — 까닭은 `common.check_motion_mask`.
    common.check_motion_mask(opts)
    started = time.time()
    pipe = _state["pipe"]
    fps = int(opts.get("fps") or 16)
    seconds = float(opts.get("seconds") or 5.0)
    """
    프레임 수는 **4의 배수 + 1** 이라야 합니다.

    Wan 의 VAE 는 시간축을 4배로 줄입니다. 4n+1 이 아니면 마지막 토막이 잘려 끝이
    뚝 끊긴 영상이 나옵니다. 길이를 사람이 초로 적게 두고 여기서 맞춥니다.
    """
    frames = int(round(seconds * fps))
    frames = max(5, ((frames - 1) // 4) * 4 + 1)
    steps = int(opts.get("steps") or 30)
    seed = common.resolve_seed(opts)

    kwargs = {
        "prompt": opts.get("prompt") or "",
        "num_frames": frames,
        "num_inference_steps": steps,
        "guidance_scale": float(opts.get("guidance") or 5.0),
        "generator": common.generator(seed),
        "callback_on_step_end": common.step_reporter(report, steps),
    }
    negative = (opts.get("negative") or "").strip()
    if negative:
        kwargs["negative_prompt"] = negative
    width = int(opts.get("width") or 1280)
    height = int(opts.get("height") or 720)
    # I2V도 크기를 명시해야 합니다. 입력 그림만 resize하면 파이프라인의
    # 기본 832×480으로 다시 줄어들어 요청·결과 메타데이터와 실제 파일이 달라집니다.
    kwargs["width"] = width
    kwargs["height"] = height

    image_path = (opts.get("image") or "").strip()
    if image_path:
        from PIL import Image

        if not os.path.isfile(image_path):
            raise IOError("첫 장면 그림을 찾지 못했습니다: {}".format(image_path))
        first = Image.open(image_path).convert("RGB").resize((width, height))
        kwargs["image"] = first
    result = common.run_attention_safe(pipe, lambda: pipe(**kwargs))
    report(95, "mp4 로 내보내는 중")
    # 「여기만 움직인다」 흑백 마스크가 왔으면 검은 곳을 첫 장면에 묶습니다(`common.freeze_by_mask`).
    frames_out = common.freeze_by_mask(result.frames[0], opts.get("motion_mask"))
    common.save_video(frames_out, output, fps)
    out = {
        "width": width,
        "height": height,
        "frames": frames,
        "fps": fps,
        "seconds_video": round(frames / float(fps), 2),
        "seed": seed,
        "generate_seconds": round(time.time() - started, 2),
    }
    # 요청한 정밀도와 실제로 올라간 정밀도 — 한 곳에서 만듭니다.
    out.update(common.precision_fields(_state["plan"]))
    return out
