# -*- coding: utf-8 -*-
"""실제 그림 워커의 옵션 전달을 검사합니다. GPU·모델·diffusers 설치는 필요 없습니다.

모의 파이프라인의 기본값과 CFG 조건은 각 requirements 에 고정한 공식 구현에서 가져왔습니다.
https://github.com/huggingface/diffusers/blob/v0.40.0/src/diffusers/pipelines/krea2/pipeline_krea2.py
https://github.com/huggingface/diffusers/blob/v0.40.0/src/diffusers/pipelines/z_image/pipeline_z_image.py
https://github.com/huggingface/diffusers/blob/v0.36.0/src/diffusers/pipelines/qwenimage/pipeline_qwenimage.py
이미지 품질을 재는 시험이 아닙니다. 0 을 생략해 상류 기본값으로 돌아가는 실패를 고정합니다.
"""

import types
import unittest
from unittest.mock import patch

import common
from engines import krea2, qwenimage, zimage


class ResultImage:
    width, height = 640, 480

    def save(self, output):
        self.saved_to = output


class KreaPipeline:
    def __call__(self, guidance_scale=4.5, negative_prompt=None, max_sequence_length=512, **kwargs):
        self.guidance = guidance_scale
        self.negative = negative_prompt
        self.cfg = guidance_scale > 0
        self.kwargs = kwargs
        return types.SimpleNamespace(images=[ResultImage()])


class ZImagePipeline(KreaPipeline):
    def __call__(self, guidance_scale=5.0, negative_prompt=None, max_sequence_length=512, **kwargs):
        return super().__call__(guidance_scale, negative_prompt, max_sequence_length, **kwargs)


class QwenPipeline:
    def __call__(self, true_cfg_scale=4.0, negative_prompt=None, guidance_scale=None, max_sequence_length=512, **kwargs):
        self.guidance = true_cfg_scale
        self.distilled_guidance = guidance_scale
        self.negative = negative_prompt
        self.cfg = true_cfg_scale > 1 and negative_prompt is not None
        self.kwargs = kwargs
        return types.SimpleNamespace(images=[ResultImage()])


class ImageGuidanceTests(unittest.TestCase):
    def run_engine(self, module, pipeline_type, opts):
        pipe = pipeline_type()
        # 실제 엔진 정의와 generate 를 쓰되 텐서 생성과 파일 출력만 모의 객체로 막습니다.
        with patch.object(module._engine, "pipe", pipe), \
             patch.object(common, "generator", return_value=object()), \
             patch.object(common, "run_attention_safe", side_effect=lambda _pipe, generate: generate()):
            result = module.generate("test-output-not-written.png", {"seed": 7, **opts}, lambda *_: None)
        self.assertEqual(result["seed"], 7)
        return pipe

    def test_turbo_defaults_disable_cfg_even_when_negative_arrives_from_mcp(self):
        for module, pipeline in ((krea2, KreaPipeline), (zimage, ZImagePipeline)):
            for opts in ({}, {"negative": "pink face"}, {"guidance": None, "negative": "pink face"}):
                with self.subTest(engine=module.__name__, opts=opts):
                    pipe = self.run_engine(module, pipeline, opts)
                    self.assertEqual(pipe.guidance, 0.0)
                    self.assertFalse(pipe.cfg)
                    self.assertIsNone(pipe.negative)

    def test_explicit_zero_is_not_replaced_by_engine_or_pipeline_defaults(self):
        for module, pipeline in ((krea2, KreaPipeline), (zimage, ZImagePipeline), (qwenimage, QwenPipeline)):
            with self.subTest(engine=module.__name__):
                pipe = self.run_engine(module, pipeline, {"guidance": 0, "negative": "blurry"})
                self.assertEqual(pipe.guidance, 0)
                self.assertFalse(pipe.cfg)
                self.assertIsNone(pipe.negative)

    def test_turbo_negative_capability_does_not_depend_on_user_guidance(self):
        for module, pipeline in ((krea2, KreaPipeline), (zimage, ZImagePipeline)):
            with self.subTest(engine=module.__name__):
                pipe = self.run_engine(module, pipeline, {"guidance": 2, "negative": "blurry"})
                self.assertEqual(pipe.guidance, 2)
                self.assertIsNone(pipe.negative)

    def test_qwen_preserves_negative_and_uses_true_cfg_argument(self):
        for opts, expected in (({"negative": "  blurry  "}, 4), ({"guidance": 6, "negative": "blurry"}, 6)):
            with self.subTest(opts=opts):
                pipe = self.run_engine(qwenimage, QwenPipeline, opts)
                self.assertEqual(pipe.guidance, expected)
                self.assertIsNone(pipe.distilled_guidance)
                self.assertTrue(pipe.cfg)
                self.assertEqual(pipe.negative, "blurry")

    def test_qwen_without_negative_still_honors_requested_cfg(self):
        pipe = self.run_engine(qwenimage, QwenPipeline, {})
        self.assertEqual(pipe.guidance, 4)
        self.assertEqual(pipe.negative, "")
        self.assertTrue(pipe.cfg)

    def test_qwen_cfg_boundary_is_one_not_zero(self):
        for guidance in (0.5, 1.0, 1.01):
            with self.subTest(guidance=guidance):
                pipe = self.run_engine(qwenimage, QwenPipeline, {"guidance": guidance, "negative": "blurry"})
                self.assertEqual(pipe.guidance, guidance)
                self.assertEqual(pipe.cfg, guidance > 1)
                self.assertEqual(pipe.negative, "blurry" if guidance > 1 else None)


if __name__ == "__main__":
    unittest.main()
