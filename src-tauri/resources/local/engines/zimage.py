# -*- coding: utf-8 -*-
"""Z-Image Turbo — 8 스텝짜리 6B 그림 엔진(Apache-2.0).



셋 중 **가장 가볍습니다.** 16 GB 카드에서도 돌고 한 장이 몇 초라, 컷 하나를 여러 장
굴려 보며 고르는 자리에 맞습니다. 대신 증류판이라 스텝을 올려도 좋아지지 않습니다 —
9 스텝(= DiT 8회) · guidance 0 이 모델 카드의 권장값입니다.
"""

from engines._image import ImageEngine

_engine = ImageEngine(
    repo="Tongyi-MAI/Z-Image-Turbo",
    pipeline_name="ZImagePipeline",
    # 모델 카드의 num_inference_steps=9 가 실제로는 DiT 8회입니다.
    default_steps=9,
    # diffusers 0.40.0 은 > 0 에서 CFG 가 켜집니다. 1 도 비활성 값이 아닙니다.
    default_guidance=0.0,
    negative_guidance_threshold=None,
    bf16_gb=16.0,
    notes="8 스텝 증류판. 스텝·guidance 를 올리지 마세요 — 증류 지점을 벗어나면 뭉갭니다.",
)

info = _engine.info
load = _engine.load
unload = _engine.unload
generate = _engine.generate
