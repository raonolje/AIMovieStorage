"""Isolated KIMODO SOMA worker. No remote text encoder, subprocess or SMPL-X dependency."""
import math
import os
import common

MODELS = ("Kimodo-SOMA-RP-v1.1", "Kimodo-SOMA-SEED-v1.1")
_state = {"model": None, "key": None}


def validate(opts):
    prompt = opts.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 4000:
        raise ValueError("동작 설명을 1~4000자로 입력하세요.")
    if opts.get("motion_model", MODELS[0]) not in MODELS:
        raise ValueError("지원하는 KIMODO SOMA v1.1 모델을 선택하세요.")
    if opts.get("text_encoder_device", "cuda") not in ("cpu", "cuda"):
        raise ValueError("텍스트 인코더 위치는 cpu 또는 cuda입니다.")
    for key, default, low, high, integer in (
        ("seconds", 5, 0.5, 30, False), ("steps", 100, 1, 200, True),
        ("seed", 0, 0, 2147483647, True),
    ):
        value = opts.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high or (integer and int(value) != value):
            raise ValueError("KIMODO {} 범위: {}~{}".format(key, low, high))


def info(root):
    return {"models": list(MODELS), "notes": "SOMA BVH · gated Llama access required · weights download on first generation"}


def load(root, opts):
    validate(opts)
    key = (opts.get("motion_model", MODELS[0]), opts.get("text_encoder_device", "cuda"))
    if _state["key"] == key and _state["model"] is not None:
        return
    unload()
    cache = common.use_engine_cache(root)
    os.environ["HUGGINGFACE_CACHE_DIR"] = os.path.join(cache, "hub")
    os.environ.pop("TEXT_ENCODERS_DIR", None)
    os.environ["TEXT_ENCODER_MODE"] = "local"
    os.environ["TEXT_ENCODER_DEVICE"] = key[1]
    os.environ["LOCAL_CACHE"] = "True"
    # A user's unrelated CHECKPOINT_DIR must not redirect this isolated engine.
    os.environ.pop("CHECKPOINT_DIR", None)
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("KIMODO 동작 생성에는 NVIDIA CUDA GPU가 필요합니다.")
    from kimodo import load_model
    _state["model"] = load_model(key[0], device="cuda:0")
    _state["key"] = key


def unload():
    _state["model"] = None
    _state["key"] = None
    common.free_vram()


def generate(output, opts, report):
    validate(opts)
    if not output.lower().endswith(".bvh"):
        raise ValueError("KIMODO 출력 확장자는 .bvh여야 합니다.")
    import torch
    from kimodo.tools import seed_everything
    from kimodo.exports.bvh import save_motion_bvh
    from kimodo.skeleton import SOMASkeleton30, global_rots_to_local_rots
    # Upstream's C++ motion correction is optional and needs a local CMake/C++
    # toolchain. The app installs the Python-only package on ordinary PCs.
    # Preserve correction for an environment where the extension is available.
    try:
        from motion_correction import motion_postprocess
        has_motion_correction = callable(getattr(motion_postprocess, "correct_motion", None))
    except (ImportError, OSError):
        has_motion_correction = False
    model = _state["model"]
    if model is None:
        raise RuntimeError("KIMODO 모델을 먼저 준비하세요.")
    seed_everything(int(opts.get("seed", 0)))
    frames = max(2, int(float(opts.get("seconds", 5)) * model.fps))
    report(10, "SOMA 동작 생성" + ("" if has_motion_correction else " · C++ 후처리 없음"))
    # One prompt describes one phrase. Periods do not silently multiply its duration.
    with torch.inference_mode():
        result = model([opts["prompt"].strip()], [frames], constraint_lst=[],
                       num_denoising_steps=int(opts.get("steps", 100)), num_samples=1,
                       multi_prompt=True, num_transition_frames=5,
                       post_processing=has_motion_correction, return_numpy=True)
        skeleton = model.skeleton
        if isinstance(skeleton, SOMASkeleton30):
            skeleton = skeleton.somaskel77.to("cuda:0")
        joints = torch.from_numpy(result["posed_joints"][0]).to("cuda:0")
        rotations = torch.from_numpy(result["global_rot_mats"][0]).to("cuda:0")
        local_rotations = global_rots_to_local_rots(rotations, skeleton)
        report(95, "표준 T포즈 BVH 저장")
        save_motion_bvh(output, local_rotations, joints[:, skeleton.root_idx, :],
                        skeleton=skeleton, fps=model.fps, standard_tpose=True)
    return {"motion_model": _state["key"][0], "fps": model.fps,
            "duration": frames / model.fps, "seed": int(opts.get("seed", 0)),
            "motion_correction": has_motion_correction}
