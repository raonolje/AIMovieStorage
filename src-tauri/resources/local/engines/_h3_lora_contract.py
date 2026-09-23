# -*- coding: utf-8 -*-
"""H3 로라의 학습 알파와 제작자 실행 규약을 GPU 로딩 전에 확인합니다."""
import hashlib
import json
from pathlib import Path
import math
import re

import common


_PRESET = json.loads((Path(__file__).resolve().parents[1] / "h3-ref2va-preset.json").read_text(encoding="utf-8"))
REF2VA_TURBO_PRESET = _PRESET["id"]
REF2VA_TURBO_SHA256 = _PRESET["sha256"]


def _positive_number(value, label):
    if isinstance(value, bool):
        raise ValueError("{}는 양수여야 합니다.".format(label))
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError("{}는 양수여야 합니다.".format(label)) from None
    if not math.isfinite(number) or number <= 0:
        raise ValueError("{}는 유한한 양수여야 합니다.".format(label))
    return number


def peft_metadata_from_header(header, prepared_state):
    """공통 키 변환 후의 텐서와 파일 알파로 Diffusers의 ``metadata``를 만듭니다.

    ``prefix=None``일 때 ``network_alphas``는 거절되지만 PEFT 설정을 받는
    ``metadata``는 지원됩니다. 따라서 사용자 세기를 1/16로 몰래 바꾸지 않습니다.
    알파가 없는 로라는 기존 로더의 추론을 유지하며 제작자나 용도를 추측하지 않습니다.
    """
    metadata = header.get("__metadata__", {}) if isinstance(header, dict) else {}
    if not isinstance(metadata, dict):
        raise ValueError("H3 로라 메타데이터가 올바른 객체가 아닙니다.")
    if "alpha" not in metadata:
        return None
    alpha = _positive_number(metadata["alpha"], "로라 알파")
    # 이 파일 형식의 알파는 보통 LoRA의 alpha/rank입니다. 다른 공식을 추측하지 않습니다.
    if str(metadata.get("use_rslora", "false")).lower() not in ("false", "0"):
        raise ValueError("H3 알파 보존 경로는 rsLoRA를 지원하지 않습니다.")
    pairs = {}
    for key, tensor in prepared_state.items():
        match = re.fullmatch(r"(.+)\.lora_([AB])\.weight", key)
        if match is None:
            raise ValueError("H3 알파를 보존할 수 없는 로라 키입니다: {}".format(key))
        shape = tuple(getattr(tensor, "shape", ()))
        if len(shape) != 2 or any(isinstance(n, bool) or not isinstance(n, int) or n <= 0 for n in shape):
            raise ValueError("H3 로라 A/B는 크기가 양수인 행렬이어야 합니다: {}".format(key))
        pairs.setdefault(match[1], {})[match[2]] = shape
    if not pairs:
        raise ValueError("H3 로라에 A/B 행렬이 없습니다.")
    ranks = {}
    for module, pair in pairs.items():
        if set(pair) != {"A", "B"} or pair["A"][0] != pair["B"][1]:
            raise ValueError("H3 로라 A/B 짝 또는 랭크가 맞지 않습니다: {}".format(module))
        ranks[module] = pair["A"][0]
    default_rank = max(ranks.values())
    return {
        "r": default_rank,
        "lora_alpha": alpha,
        # 전체 모듈 이름만 대상으로 삼아 같은 접미사를 가진 다른 층에 새 로라를 만들지 않습니다.
        "target_modules": "^(?:{})$".format("|".join(re.escape(name) for name in sorted(ranks))),
        "rank_pattern": {"^" + re.escape(name): rank for name, rank in ranks.items() if rank != default_rank},
        "alpha_pattern": {},
        "use_rslora": False,
        "use_dora": False,
        "bias": "none",
        "init_lora_weights": False,
    }


def lora_load_kwargs(path, prepared_state):
    """``load_lora_adapter(..., prefix=None, **결과)``에 넣는 인자입니다."""
    metadata = peft_metadata_from_header(common.lora_head(path), prepared_state)
    return {} if metadata is None else {"metadata": metadata}


def nfe_to_grid_points(nfe):
    """H3는 마지막 sigma=0도 스텝 수에 포함하므로 평가 N회에는 N+1칸이 필요합니다."""
    if isinstance(nfe, bool) or not isinstance(nfe, int) or not 1 <= nfe <= 1000:
        raise ValueError("H3 모델 평가 횟수는 1~1000의 정수여야 합니다.")
    return nfe + 1


def producer_preset(preset_id, workflow, artifact_sha256):
    """이름만 같은 파일이나 다른 workflow에 제작자 규약을 적용하지 않습니다.

    https://github.com/ModelTC/Minimax-H3-Turbo 의 Ref2VA v0.1 실행표 기준입니다.
    일반/미확인 로라에는 프리셋이 없으며 파일명이나 alpha 값으로 추측하지 않습니다.
    """
    if preset_id != REF2VA_TURBO_PRESET:
        raise ValueError("검증한 H3 로라 프리셋이 아닙니다.")
    if workflow != "ref2va":
        raise ValueError("이 H3 터보 로라는 Ref2VA 전용입니다.")
    if artifact_sha256 != REF2VA_TURBO_SHA256:
        raise ValueError("제작자와 대조한 H3 Ref2VA 로라 해시가 아닙니다.")
    return {
        "id": preset_id,
        "workflow": workflow,
        "sha256": artifact_sha256,
        "nfe": 4,
        "num_inference_steps": nfe_to_grid_points(4),
        "video_shift": 12.0,
        "audio_shift": 3.0,
        "reference_resize_mode": "match",
        "training_short_edge": 544,
        "rank": 128,
        "alpha": 8.0,
    }


def verified_producer_preset(path, preset_id, workflow):
    """명시적으로 고른 제작자 프리셋에만 파일 해시 비용을 지불합니다."""
    with open(path, "rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    return producer_preset(preset_id, workflow, digest)


def generation_contract(opts, workflow):
    """명시 옵션만 적용합니다. 제작자 프리셋은 정확한 단일 파일/기본 세기에 한정합니다."""
    mode = opts.get("h3_reference_resize_mode", "diffusers")
    if mode not in ("diffusers", "match"):
        raise ValueError("H3 참조 그림 크기 방식은 diffusers 또는 match여야 합니다.")
    preset_id = opts.get("h3_lora_preset")
    if workflow != "ref2va" and (preset_id is not None or "h3_reference_resize_mode" in opts):
        raise ValueError("H3 참조 전처리/터보 프리셋은 Ref2VA 전용입니다.")
    if preset_id is None:
        return {"id": None, "reference_resize_mode": mode}
    if preset_id != REF2VA_TURBO_PRESET:
        raise ValueError("검증한 H3 로라 프리셋이 아닙니다.")
    loras = opts.get("loras") or []
    if len(loras) != 1 or not loras[0].get("path"):
        raise ValueError("H3 제작자 프리셋은 해당 Ref2VA 로라 한 개를 지정해야 합니다.")
    if _positive_number(loras[0].get("weight", 1.0), "로라 세기") != 1.0:
        raise ValueError("H3 제작자 프리셋의 로라 세기는 1이어야 합니다.")
    if "steps" in opts and (type(opts["steps"]) is not int or opts["steps"] != 4):
        raise ValueError("H3 4단계 프리셋은 steps를 생략하거나 4로 지정해야 합니다(실제 grid 5칸).")
    if "h3_reference_resize_mode" in opts and mode != "match":
        raise ValueError("H3 제작자 프리셋은 참조 그림 match 전처리가 필요합니다.")
    return verified_producer_preset(loras[0]["path"], preset_id, workflow)


def require_reference_resize_support(plan, input_names):
    """기본 Diffusers는 2048로 다시 키우므로 외부에서 미리 줄이기만 해서는 안 됩니다."""
    if plan["reference_resize_mode"] != "diffusers" and "reference_resize_mode" not in set(input_names):
        raise ValueError("이 H3 파이프라인은 제작자의 reference resize=match를 지원하지 않습니다. 전용 전처리 블록을 먼저 연결하세요.")


def reference_match_size(width, height, target_width, target_height, multiple=32):
    """제작자 match 방식의 결과 (높이, 너비). 계산만 하며 실제 블록 적용은 별도입니다."""
    values = (width, height, target_width, target_height, multiple)
    if any(isinstance(v, bool) or not isinstance(v, int) or v <= 0 for v in values):
        raise ValueError("참조 그림과 목표 크기는 양의 정수여야 합니다.")
    if width > 4 * height or height > 4 * width:
        raise ValueError("H3 참조 그림 비율은 1:4~4:1이어야 합니다.")
    ratio = min(1.0, math.sqrt((target_width * target_height) / (width * height)))
    return tuple(max(multiple, round(side * ratio / multiple) * multiple) for side in (height, width))
