# -*- coding: utf-8 -*-
"""Qwen-Image — 글자를 또렷하게 쓰는 20B MMDiT(Apache-2.0).

세 그림 엔진 중 **말을 가장 곧이곧대로 듣습니다.** 컷 안에 간판·표지판 글자가 들어가야
하거나 「왼쪽에 둘, 오른쪽에 하나」 같은 세는 지시가 있으면 이쪽입니다.
"""

from engines._image import ImageEngine

_engine = ImageEngine(
    repo="Qwen/Qwen-Image",
    pipeline_name="QwenImagePipeline",
    default_steps=30,
    default_guidance=4.0,
    guidance_parameter="true_cfg_scale",
    negative_guidance_threshold=1.0,
    bf16_gb=24.0,
    notes="글자·세는 지시에 강함. 20B라 처음 올릴 때 오래 걸립니다.",
)

info = _engine.info
load = _engine.load
unload = _engine.unload
generate = _engine.generate
