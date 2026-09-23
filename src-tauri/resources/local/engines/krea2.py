# -*- coding: utf-8 -*-
"""Krea 2 Turbo — 8 스텝짜리 12B 그림 엔진(Krea 2 Community License).



그림 엔진 넷의 쓰임이 갈립니다.

  · Qwen-Image  — 말을 곧이곧대로. 간판 글자·세는 지시가 있는 컷.
  · Z-Image     — 가장 가볍고 빠름. 여러 장 굴려 보며 고를 때.
  · Anima       — 애니메·일러스트 전용.
  · Krea 2      — 사진 결 + **화풍 로라**. 프로젝트의 그림체를 로라로 고정할 때.

Krea 2 는 로라 생태계가 활발한 쪽입니다(같은 조직이 레트로애니메·빈티지타로 같은 화풍
로라를 함께 올려 두었습니다). 설정의 로라 목록에서 **엔진을 이것으로** 골라 두면 켜 둔
것이 전부 함께 들어갑니다 — 다만 화풍 로라는 한 번에 하나입니다(앱이 경고합니다).

증류판이라 스텝을 올려도 좋아지지 않습니다 — 8 스텝 · guidance 0 이 제작진이 정한 지점입니다.
"""

from engines._image import ImageEngine

_engine = ImageEngine(
    repo="krea/Krea-2-Turbo",
    pipeline_name="Krea2Pipeline",
    default_steps=8,
    default_guidance=0.0,
    negative_guidance_threshold=None,
    bf16_gb=32.0,
    notes="8 스텝 증류판. 화풍 로라를 겹쳐 쓰는 자리. 스텝·guidance 를 올리지 마세요.",
)

info = _engine.info
load = _engine.load
unload = _engine.unload
generate = _engine.generate
