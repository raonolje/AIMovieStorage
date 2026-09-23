# -*- coding: utf-8 -*-
"""Krea 텍스트 결합 층의 4차원 입력은 양자화에서 제외해야 합니다.

기본 시험은 GPU·모델 없이 실행됩니다. Krea 엔진 환경에서 실행하면 설치된 diffusers 의
실제 소형 TextFusion 과 bnb 층 교체도 CPU 에서 확인합니다. 가중치는 받지 않습니다.
"""

import importlib.util
import sys
import types
import unittest
from unittest.mock import patch

import common
from engines import krea2, qwenimage, zimage


class QuantizationConfigurationTests(unittest.TestCase):
    def configuration(self, bits, skip_modules=()):
        calls = []
        diffusers = types.SimpleNamespace(
            BitsAndBytesConfig=lambda **kw: types.SimpleNamespace(**kw),
            AutoModel=types.SimpleNamespace(from_pretrained=lambda repo, **kw: calls.append((repo, kw))),
        )
        with patch.dict(sys.modules, {"diffusers": diffusers}), patch.object(common, "log"):
            common.quantized_component("test/repo", "bf16", bits, skip_modules=skip_modules)
        return calls[0][1]

    def test_only_exact_projector_is_excluded_and_caller_list_is_not_shared(self):
        original = ["text_fusion.projector"]
        for bits in (8, 4):
            with self.subTest(bits=bits):
                options = self.configuration(bits, original)
                config = options["quantization_config"]
                self.assertEqual(config.llm_int8_skip_modules, ["text_fusion.projector"])
                self.assertIsNot(config.llm_int8_skip_modules, original)
                config.llm_int8_skip_modules.append("another")
                self.assertEqual(original, ["text_fusion.projector"])
                self.assertEqual(options["torch_dtype"], "bf16")
                self.assertEqual(options["subfolder"], "transformer")
                self.assertTrue(config.load_in_8bit if bits == 8 else config.load_in_4bit)
                if bits == 4:
                    self.assertEqual(config.bnb_4bit_quant_type, "nf4")
                    self.assertEqual(config.bnb_4bit_compute_dtype, "bf16")

    def test_other_models_keep_the_existing_quantization_defaults(self):
        for bits in (8, 4):
            with self.subTest(bits=bits):
                config = self.configuration(bits)["quantization_config"]
                self.assertFalse(hasattr(config, "llm_int8_skip_modules"))

    def load_engine(self, module, bits):
        pipe = types.SimpleNamespace()
        calls = []
        pipeline = types.SimpleNamespace(from_pretrained=lambda *a, **kw: calls.append(kw) or pipe)
        fake_diffusers = types.SimpleNamespace(**{module._engine.pipeline_name: pipeline})
        engine = module._engine
        # 실제 load 경로에서 설정 전달을 확인하되 모델·장치·캐시는 모두 막습니다.
        with patch.dict(sys.modules, {"diffusers": fake_diffusers, "torch": types.SimpleNamespace()}), \
             patch.object(engine, "pipe", None), patch.object(engine, "plan", None), \
             patch.object(engine, "loaded_loras", []), patch.object(engine, "_apply_loras"), \
             patch.object(common, "plan_precision", return_value={"bits": bits, "reload": True}), \
             patch.object(common, "use_engine_cache"), \
             patch.object(common, "device_and_dtype", return_value=("cpu", "bf16")), \
             patch.object(common, "log_precision"), patch.object(common, "use_fast_attention"), \
             patch.object(common, "place", side_effect=lambda value, *_: value), \
             patch.object(common, "quantized_component", return_value=object()) as load:
            engine.load("not-created", {})
        return load, calls

    def test_krea_loader_passes_projector_exclusion_in_both_quantized_modes(self):
        for bits in (8, 4):
            with self.subTest(bits=bits):
                load, calls = self.load_engine(krea2, bits)
                load.assert_called_once_with(
                    krea2._engine.repo, "bf16", bits, skip_modules=("text_fusion.projector",)
                )
                self.assertIn("transformer", calls[0])

    def test_bf16_krea_does_not_enter_quantization(self):
        load, calls = self.load_engine(krea2, None)
        load.assert_not_called()
        self.assertNotIn("transformer", calls[0])

    def test_other_image_engine_loaders_do_not_inherit_krea_exclusion(self):
        for module in (qwenimage, zimage):
            with self.subTest(engine=module.__name__):
                load, _ = self.load_engine(module, 8)
                load.assert_called_once_with(module._engine.repo, "bf16", 8)


HAS_KREA_PACKAGES = all(importlib.util.find_spec(name) is not None for name in ("torch", "diffusers", "bitsandbytes"))


@unittest.skipUnless(HAS_KREA_PACKAGES, "실제 CPU 교체 시험은 Krea 엔진의 Python 환경에서 실행합니다.")
class InstalledKreaCpuTests(unittest.TestCase):
    def test_logged_outlier_expression_fails_on_krea_four_dimensional_layout(self):
        import torch

        # 실측 스택: Krea2TextFusion 의 permute → MatMul8bitLt(3차원만 reshape)
        # → cuda/ops.py 의 아래 열 추출식. GPU 커널 이전에 같은 오류가 CPU 에서 납니다.
        states = torch.full((2, 3, 5, 8), 7.0, dtype=torch.float16, device="cpu").permute(0, 1, 3, 2)
        outliers = states.abs() >= 6.0
        indices = torch.argwhere(outliers.any(dim=0))
        self.assertEqual(indices.shape[1], 3)
        with self.assertRaisesRegex(RuntimeError, "view size is not compatible"):
            indices.view(-1)
        # reshape 로 오류만 없애면 토큰·특징 좌표까지 '열'로 섞여 의미가 달라집니다.
        proper_columns = torch.argwhere(outliers.reshape(-1, states.shape[-1]).any(dim=0)).view(-1)
        self.assertNotEqual(indices.reshape(-1).numel(), proper_columns.numel())

    def test_real_bnb_replacement_keeps_krea_projector_and_quantizes_other_linear(self):
        import torch
        import bitsandbytes as bnb
        from diffusers import BitsAndBytesConfig
        from diffusers.models.transformers.transformer_krea2 import Krea2TextFusion
        from diffusers.quantizers.bitsandbytes.utils import replace_with_bnb_linear

        # 작은 실제 구조만 구성합니다. 모델 파일·GPU·양자화 추론은 사용하지 않습니다.
        for bits in (8, 4):
            with self.subTest(bits=bits):
                model = torch.nn.Module()
                model.text_fusion = Krea2TextFusion(5, 8, 2, 2, 16, 0, 0, 1e-6).to("cpu", dtype=torch.bfloat16)
                model.other = torch.nn.Linear(8, 8, device="cpu", dtype=torch.bfloat16)
                projector = model.text_fusion.projector
                states = torch.arange(2 * 3 * 5 * 8, dtype=torch.bfloat16, device="cpu").reshape(2, 3, 5, 8)
                with torch.no_grad():
                    expected = model.text_fusion(states)
                config = BitsAndBytesConfig(
                    load_in_8bit=bits == 8, load_in_4bit=bits == 4,
                    llm_int8_skip_modules=list(krea2._engine.quantization_skip_modules),
                )
                converted = replace_with_bnb_linear(
                    model, modules_to_not_convert=config.llm_int8_skip_modules, quantization_config=config,
                )
                self.assertIs(converted.text_fusion.projector, projector)
                self.assertEqual(projector.weight.device.type, "cpu")
                self.assertEqual(projector.weight.dtype, torch.bfloat16)
                self.assertIsInstance(converted.other, bnb.nn.Linear8bitLt if bits == 8 else bnb.nn.Linear4bit)
                with torch.no_grad():
                    actual = converted.text_fusion(states)
                torch.testing.assert_close(actual, expected, rtol=0, atol=0)
                self.assertEqual(tuple(actual.shape), (2, 3, 8))


if __name__ == "__main__":
    unittest.main()
