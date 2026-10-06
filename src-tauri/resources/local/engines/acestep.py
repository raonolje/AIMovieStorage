# -*- coding: utf-8 -*-
"""ACE-Step — 이 컴퓨터에서 도는 음악(BGM) 엔진.



사용자가 지목한 **MiniMax-Music3** 가 기본입니다(`minimaxmusic.py`). 이 엔진은 그것이
무거운 기계를 위한 **가벼운 대안**입니다 — ACE-Step 은 3.5B 라 훨씬 가볍습니다.
태그로 장르·악기·분위기를 주고, 가사를 주면 노래로, `[inst]` 만 주면 연주곡으로 뽑습니다.
우리 쓰임(BGM)은 대개 연주곡입니다.

프롬프트 모양
    opts.prompt  "cinematic orchestral, strings, slow build, melancholic, 90 bpm"
    opts.lyrics  "[inst]"  ← 가사 없는 연주곡. 노래로 하려면 가사를 그대로 넣습니다.
"""

import time
import math

import common

_state = {"pipe": None, "plan": None}

"""
bf16 으로 통째로 올릴 때의 **모델 크기**(GB) — 가중치 7 + 텍스트 인코더.

필요한 VRAM 은 `common.plan_precision` 이 여유(1.25배)를 얹어 12.5 GB 로 봅니다. 여태
이 엔진만 `vram < 10` 을 손으로 들고 있었는데, 10 GB 짜리를 10 GB 카드에 통째로 올리면
중간값 자리가 없어 터집니다. 이제 다른 엔진과 같은 잣대를 씁니다.
"""
BF16_GB = 10.0

"""
**이 엔진이 올릴 수 있는 정밀도는 bf16 뿐입니다.**

bitsandbytes 로는 못 줄이는 파이프라인입니다(자체 `quantized` 는 따로 받은 체크포인트를
요구합니다). 그래서 규칙이 «줄여라» 라고 하면 이 엔진에서는 그것이 곧 «CPU 로 흘려라» 입니다.
"""
SUPPORTED = ("bf16",)


def info(root):
    return {
        "repo": "ACE-Step/ACE-Step-v1-3.5B",
        "notes": "BGM. 태그로 장르·악기·bpm 을 주고, [inst] 면 연주곡입니다.",
    }


def load(root, opts):
    # 정밀도 판단은 다른 엔진과 **같은 한 곳**입니다. 이 엔진만 사양을 안 보고 늘 bf16 으로
    # 통째로 올려서, 8 GB 카드에서는 그대로 터졌습니다.
    plan = common.plan_precision(BF16_GB, opts, loaded=_state["plan"], supported=SUPPORTED)
    # 정밀도 이름이 같아도 **흘리기 방식이 바뀌면 다시 올려야 합니다.**
    # 이 엔진은 `SUPPORTED=("bf16",)` 이라 `plan["mode"]` 가 늘 bf16 이고, 그래서
    # `plan["reload"]` 만 보면 «바뀐 게 없다» 가 됩니다. 그런데 실제로 갈리는 값은
    # `wanted`(규칙이 고른 값)이고, 그 값이 바뀌면 만들 때 넘기는 인자 자체가 달라집니다.
    # 그대로 두면 VRAM 이 빠듯해져 흘려야 하는데 통째로 올라간 것을 계속 쓰다 터집니다.
    was = (_state["plan"] or {}).get("wanted")
    if was and was != plan["wanted"]:
        common.log("흘리기 방식이 {} → {} 로 바뀝니다. 내리고 다시 올립니다.".format(was, plan["wanted"]))
        unload()
    if _state["pipe"] is not None and not plan["reload"]:
        return
    from acestep.pipeline_ace_step import ACEStepPipeline

    models = common.use_engine_cache(root)
    # 규칙이 «줄여라» 라고 했다는 것은 이 엔진에서는 «CPU 로 흘려라» 입니다(줄이는 길이 없습니다).
    tight = plan["wanted"] != "bf16"
    common.log_precision("ACE-Step", plan)
    if tight:
        common.log("VRAM 이 좁아 CPU 로 흘리며 돌립니다 — 느리지만 돕니다.")
    pipe = ACEStepPipeline(
        checkpoint_dir=models,
        dtype="bfloat16",
        torch_compile=False,
        cpu_offload=tight,
    )
    # 첫 호출에서 가중치를 받아 올립니다(없으면 여기서 내려받습니다).
    pipe.load_checkpoint(models)
    _state["pipe"] = pipe
    _state["plan"] = plan


def unload():
    _state["pipe"] = None
    _state["plan"] = None
    common.free_vram()


def validate(opts):
    # 모델을 올리기 전에 타입과 공식 UI 범위를 검사해 잘못된 입력으로 GPU를 점유하지 않습니다.
    for key, low, high, integer in (("seed", -1, 2147483647, True),
                                   ("steps", 1, 200, True), ("guidance", 0, 30, False)):
        if key not in opts:
            continue
        value = opts[key]
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or not low <= value <= high
                or (integer and value != int(value))):
            raise ValueError("ACE-Step {} 값을 확인해 주세요.".format(key))


def generate(output, opts, report):
    validate(opts)
    started = time.time()
    pipe = _state["pipe"]
    seconds = float(opts.get("seconds") or 60.0)
    seed = common.resolve_seed(opts)
    steps = int(opts.get("steps", 60))
    guidance = float(opts.get("guidance", 15.0))
    # 가사를 안 주면 연주곡입니다 — BGM 은 대개 이쪽입니다.
    lyrics = opts.get("lyrics")
    if lyrics is None or not str(lyrics).strip():
        lyrics = "[inst]"

    _save_with_soundfile()
    report(15, "{}초짜리 음악을 만드는 중".format(int(seconds)))
    pipe(
        prompt=opts.get("prompt") or "",
        lyrics=str(lyrics),
        audio_duration=seconds,
        infer_step=steps,
        guidance_scale=guidance,
        manual_seeds=str(seed),
        save_path=output,
        format=output.rsplit(".", 1)[-1].lower(),
    )
    out = {
        "seed": seed,
        "steps": steps,
        "guidance": guidance,
        "seconds_audio": seconds,
        "generate_seconds": round(time.time() - started, 2),
    }
    # 요청한 정밀도와 실제로 올라간 정밀도 — 한 곳에서 만듭니다.
    out.update(common.precision_fields(_state["plan"]))
    return out


def _save_with_soundfile():
    """**소리를 `soundfile` 로 씁니다.**

    2026-09-18 실측: 음악을 다 만들어 놓고 마지막 저장에서 죽었습니다.

        TorchCodec is required for save_with_torchcodec.
        → torchcodec 을 깔았더니: Could not load libtorchcodec.
          FFmpeg is not properly installed in your environment.

    ACE-Step 은 `torchaudio.save(..., backend="soundfile")` 라고 **soundfile 을 콕 집어**
    부르는데, torchaudio 2.11 이 그 부탁을 무시하고 전부 torchcodec 으로 보냅니다.
    torchcodec 은 FFmpeg 공유 라이브러리를 요구하고, 그것을 깔자고 엔진마다 FFmpeg 를
    끌고 들어올 수는 없습니다 — 우리에겐 이미 `soundfile` 이 있습니다.

    그래서 저장 함수만 갈아 끼웁니다. 파이프라인 안에서 부르는 것이라 여기서 바꿔야
    닿습니다. 한 번만 바꾸고, 이미 바꿔 두었으면 지나갑니다.
    """
    import torchaudio

    if getattr(torchaudio.save, "_우리것", False):
        return

    def save(path, tensor, sample_rate, **kwargs):
        import soundfile

        data = tensor.detach().cpu().numpy()
        # torchaudio 는 (채널, 표본), soundfile 은 (표본, 채널) 입니다.
        if data.ndim == 2:
            data = data.T
        soundfile.write(str(path), data, int(sample_rate))

    save._우리것 = True
    torchaudio.save = save
