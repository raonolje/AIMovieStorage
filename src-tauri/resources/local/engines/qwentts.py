# -*- coding: utf-8 -*-
"""Qwen3-TTS local character voice. Keep model downloads in this engine's HF cache."""

import os
import time

import common

MODELS = {
    "design": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    "custom-1.7b": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "custom-0.6b": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
}
SPEAKERS = ("Sohee", "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna")
LANGUAGES = ("Auto", "Korean", "English", "Japanese", "Chinese", "German", "French", "Russian", "Portuguese", "Spanish", "Italian")
BF16_GB = 4.0
SUPPORTED = ("bf16",)
_state = {"model": None, "variant": None}


def info(root):
    return {"repo": "QwenLM/Qwen3-TTS", "notes": "한국어 포함 10개 언어; 자유 음색 설계와 고정 화자."}


def validate(opts):
    text = opts.get("prompt")
    variant = opts.get("voice_model", "design")
    speaker = opts.get("voice_speaker", "Sohee")
    language = opts.get("language", "Korean")
    instruct = opts.get("voice_instruct", "")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1000:
        raise ValueError("목소리 대사는 1~1000자로 입력하세요.")
    if variant not in MODELS:
        raise ValueError("지원하지 않는 목소리 모델입니다.")
    if language not in LANGUAGES:
        raise ValueError("지원하지 않는 대사 언어입니다.")
    if not isinstance(instruct, str) or len(instruct) > 1000 or not instruct.strip():
        raise ValueError("목소리 특징과 연기 톤을 적어 주세요.")
    if variant != "design" and speaker not in SPEAKERS:
        raise ValueError("고정 화자를 선택해 주세요.")
    return text.strip(), variant, speaker, language, instruct.strip()


def load(root, opts):
    _, variant, _, _, _ = validate(opts)
    plan = common.plan_precision(BF16_GB, opts, supported=SUPPORTED)
    common.log_precision(MODELS[variant], plan)
    if _state["model"] is not None and _state["variant"] == variant:
        return
    unload()
    common.use_engine_cache(root)
    import torch
    from qwen_tts import Qwen3TTSModel
    # FlashAttention 2 is optional and not uniformly available on Windows.
    kwargs = {"device_map": "cuda:0" if torch.cuda.is_available() else "cpu",
              "dtype": torch.bfloat16 if torch.cuda.is_available() else torch.float32}
    _state["model"] = Qwen3TTSModel.from_pretrained(MODELS[variant], **kwargs)
    _state["variant"] = variant


def unload():
    _state["model"] = None
    _state["variant"] = None
    common.free_vram()


def generate(output, opts, report):
    import numpy as np
    import soundfile as sf

    text, variant, speaker, language, instruct = validate(opts)
    model = _state["model"]
    if model is None or _state["variant"] != variant:
        raise RuntimeError("목소리 모델을 먼저 올려야 합니다.")
    started = time.time()
    report(20, "대사의 말투와 감정으로 음성 생성 중")
    if variant == "design":
        wavs, sr = model.generate_voice_design(text=text, language=language, instruct=instruct)
    else:
        wavs, sr = model.generate_custom_voice(text=text, language=language, speaker=speaker, instruct=instruct)
    audio = np.asarray(wavs[0], dtype=np.float32)
    if audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
        raise ValueError("모델이 유효한 음성을 만들지 못했습니다.")
    report(95, "캐릭터 목소리 WAV 저장 중")
    sf.write(output, audio, sr, subtype="PCM_16")
    return {"voice_model": variant, "voice_speaker": speaker if variant != "design" else None,
            "language": language, "sample_rate": int(sr), "seconds_audio": round(len(audio) / sr, 2),
            "generate_seconds": round(time.time() - started, 2)}
