# -*- coding: utf-8 -*-
"""알파 손실·잘못된 프리셋·스텝 오프바이원을 모델 다운로드 없이 검증합니다."""
import importlib.util
import os
import types
import unittest
from unittest.mock import patch

from engines._h3_lora_contract import (
    REF2VA_TURBO_PRESET, REF2VA_TURBO_SHA256, peft_metadata_from_header,
    nfe_to_grid_points, producer_preset, reference_match_size, require_reference_resize_support,
    generation_contract,
)


def state(rank=128, prefix="layer"):
    return {
        prefix + ".lora_A.weight": types.SimpleNamespace(shape=(rank, 3)),
        prefix + ".lora_B.weight": types.SimpleNamespace(shape=(2, rank)),
    }


class H3LoraContractTests(unittest.TestCase):
    def test_explicit_preset_rejects_conflicts_before_model_loading(self):
        from engines import minimaxh3
        base = {"references": [{"kind": "image", "path": "not-opened.png"}],
                "h3_lora_preset": REF2VA_TURBO_PRESET, "loras": [{"path": "not-opened.safetensors", "weight": 1}]}
        with patch.object(minimaxh3.common, "plan_precision", side_effect=AssertionError("모델 로딩 금지")):
            for changes in ({"steps": 30}, {"steps": True}, {"h3_reference_resize_mode": "diffusers"},
                            {"loras": []}, {"loras": [{"path": "x", "weight": 0.5}]}, {"references": []}):
                with self.subTest(changes=changes), self.assertRaises(ValueError):
                    minimaxh3.load("unused", {**base, **changes})
        plan = producer_preset(REF2VA_TURBO_PRESET, "ref2va", REF2VA_TURBO_SHA256)
        with patch("engines._h3_lora_contract.verified_producer_preset", return_value=plan) as verify:
            self.assertEqual(generation_contract(base, "ref2va"), plan)
            verify.assert_called_once_with("not-opened.safetensors", REF2VA_TURBO_PRESET, "ref2va")
        self.assertEqual(generation_contract({"h3_reference_resize_mode": "match"}, "ref2va"),
                         {"id": None, "reference_resize_mode": "match"})

    def test_alpha_is_preserved_per_file_not_applied_as_global_one_sixteenth(self):
        for alpha in (8, 128, 32):
            result = peft_metadata_from_header({"__metadata__": {"alpha": str(alpha)}}, state())
            self.assertEqual(result["r"], 128)
            self.assertEqual(result["lora_alpha"], alpha)
            self.assertFalse(result["use_rslora"])
        self.assertIsNone(peft_metadata_from_header({}, state()))

    def test_invalid_alpha_cannot_silently_become_rank(self):
        for alpha in ("nan", "inf", "oops", "0", "-8", True, None):
            with self.subTest(alpha=alpha), self.assertRaisesRegex(ValueError, "알파"):
                peft_metadata_from_header({"__metadata__": {"alpha": alpha}}, state())

    def test_mixed_rank_preserves_the_same_author_alpha_for_each_module(self):
        result = peft_metadata_from_header({"__metadata__": {"alpha": "8"}}, {**state(128, "layer"), **state(16, "nested.layer")})
        self.assertEqual(result["rank_pattern"], {r"^nested\.layer": 16})
        self.assertEqual(result["lora_alpha"], 8)

    def test_missing_pair_and_rank_mismatch_are_rejected(self):
        a = state()
        del a["layer.lora_B.weight"]
        b = state()
        b["layer.lora_B.weight"].shape = (2, 16)
        for item in (a, b):
            with self.assertRaisesRegex(ValueError, "짝 또는 랭크"):
                peft_metadata_from_header({"__metadata__": {"alpha": "8"}}, item)

    def test_only_verified_ref2va_artifact_gets_the_producer_preset(self):
        plan = producer_preset(REF2VA_TURBO_PRESET, "ref2va", REF2VA_TURBO_SHA256)
        self.assertEqual((plan["nfe"], plan["num_inference_steps"]), (4, 5))
        self.assertEqual((plan["video_shift"], plan["audio_shift"]), (12, 3))
        for args in (("unknown", "ref2va", REF2VA_TURBO_SHA256), (REF2VA_TURBO_PRESET, "fl2va", REF2VA_TURBO_SHA256), (REF2VA_TURBO_PRESET, "ref2va", "b5e25a")):
            with self.assertRaises(ValueError):
                producer_preset(*args)

    def test_fractional_and_boolean_nfe_are_rejected(self):
        self.assertEqual(nfe_to_grid_points(8), 9)
        for value in (False, 4.0, "4", 0, -1, 1001):
            with self.assertRaises(ValueError):
                nfe_to_grid_points(value)

    def test_resize_contract_cannot_be_silently_ignored(self):
        plan = producer_preset(REF2VA_TURBO_PRESET, "ref2va", REF2VA_TURBO_SHA256)
        with self.assertRaisesRegex(ValueError, "전처리 블록"):
            require_reference_resize_support(plan, ["references", "width", "height"])
        require_reference_resize_support(plan, ["references", "reference_resize_mode"])
        self.assertEqual(reference_match_size(320, 320, 960, 544), (320, 320))
        self.assertEqual(reference_match_size(1920, 1080, 960, 544), (544, 960))
        with self.assertRaises(ValueError):
            reference_match_size(2000, 100, 960, 544)


HAS_RUNTIME = all(importlib.util.find_spec(package) is not None for package in ("torch", "diffusers", "peft"))


@unittest.skipUnless(HAS_RUNTIME, "실제 Diffusers CPU 로더 검증은 H3 엔진 환경에서 실행합니다.")
class ActualDiffusersCpuTests(unittest.TestCase):
    def test_engine_loads_file_alpha_into_active_reference_transformer(self):
        import tempfile
        import torch
        from diffusers import ModelMixin, ConfigMixin
        from diffusers.loaders import PeftAdapterMixin
        from engines import minimaxh3

        class Tiny(ModelMixin, ConfigMixin, PeftAdapterMixin):
            def __init__(self):
                super().__init__()
                self.layer = torch.nn.Linear(3, 2, bias=False)
                self.layer.weight.data.zero_()

        model = Tiny()
        tensors = {"layer.lora_A.weight": torch.ones(128, 3), "layer.lora_B.weight": torch.ones(2, 128)}
        with tempfile.NamedTemporaryFile(suffix=".safetensors") as file:
            wanted = [{"path": file.name, "weight": 0.5}]
            with patch.dict(minimaxh3._state, {"pipe": types.SimpleNamespace(transformer_ref=model), "workflow": "ref2va", "loras": []}), \
                    patch.object(minimaxh3.common, "guard_lora_family"), \
                    patch.object(minimaxh3.common, "prepare_lora", return_value=(tensors, 1)), \
                    patch.object(minimaxh3.common, "lora_head", return_value={"__metadata__": {"alpha": "8"}}), \
                    patch.object(minimaxh3.common, "check_loras", return_value=1), \
                    patch.object(minimaxh3.common, "log"):
                minimaxh3._apply_loras({"loras": wanted})
                torch.testing.assert_close(model.layer(torch.ones(1, 3)), torch.full((1, 2), 12.0))
                self.assertEqual(model.peft_config["lora0"].lora_alpha, 8)
        self.assertFalse(torch.cuda.is_initialized())

    def test_cached_pipeline_restores_scheduler_after_explicit_preset(self):
        from diffusers import MiniMaxH3Scheduler
        from engines import minimaxh3
        pipe = types.SimpleNamespace(scheduler=MiniMaxH3Scheduler(shift=7),
            audio_scheduler=MiniMaxH3Scheduler(shift=2),
            blocks=types.SimpleNamespace(inputs=[types.SimpleNamespace(name="reference_resize_mode")]))
        plan = producer_preset(REF2VA_TURBO_PRESET, "ref2va", REF2VA_TURBO_SHA256)
        with patch.dict(minimaxh3._state, {"workflow": "ref2va", "scheduler_shifts": (7, 2)}):
            self.assertEqual(minimaxh3._configure_generation(pipe, plan, 4), 5)
            self.assertEqual((pipe.scheduler.shift, pipe.audio_scheduler.shift), (12, 3))
            self.assertEqual(minimaxh3._configure_generation(pipe, generation_contract({}, "ref2va"), 30), 30)
            self.assertEqual((pipe.scheduler.shift, pipe.audio_scheduler.shift), (7, 2))

    def test_prefix_none_metadata_preserves_actual_adapter_delta(self):
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
        import torch
        from diffusers import ModelMixin, ConfigMixin
        from diffusers.loaders import PeftAdapterMixin

        class Tiny(ModelMixin, ConfigMixin, PeftAdapterMixin):
            def __init__(self):
                super().__init__()
                self.layer = torch.nn.Linear(3, 2, bias=False)
                self.layer.weight.data.zero_()

            def forward(self, x):
                return self.layer(x)

        for alpha in (8, 128):
            model = Tiny()
            tensors = {"layer.lora_A.weight": torch.ones(128, 3), "layer.lora_B.weight": torch.ones(2, 128)}
            metadata = peft_metadata_from_header({"__metadata__": {"alpha": str(alpha)}}, tensors)
            model.load_lora_adapter(tensors, prefix=None, adapter_name="test", metadata=metadata)
            model.set_adapters(["test"], [0.5])
            actual = model(torch.ones(1, 3))
            torch.testing.assert_close(actual, torch.full((1, 2), 3 * alpha * 0.5))
            self.assertEqual(model.peft_config["test"].lora_alpha, alpha)
        self.assertFalse(torch.cuda.is_initialized())

    def test_actual_h3_scheduler_uses_four_evaluations_for_five_grid_points(self):
        from diffusers import MiniMaxH3Scheduler
        plan = producer_preset(REF2VA_TURBO_PRESET, "ref2va", REF2VA_TURBO_SHA256)
        for shift in (plan["video_shift"], plan["audio_shift"]):
            scheduler = MiniMaxH3Scheduler()
            scheduler.set_shift(shift)
            scheduler.set_timesteps(plan["num_inference_steps"], device="cpu")
            self.assertEqual(len(scheduler.timesteps), 4)
            self.assertEqual(len(scheduler.sigmas), 5)
            self.assertEqual(float(scheduler.sigmas[-1]), 0)

    def test_actual_loader_preserves_mixed_ranks_and_exact_target_names(self):
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
        import torch
        from diffusers import ModelMixin, ConfigMixin
        from diffusers.loaders import PeftAdapterMixin

        class Tiny(ModelMixin, ConfigMixin, PeftAdapterMixin):
            def __init__(self):
                super().__init__()
                self.layer = torch.nn.Linear(3, 2, bias=False)
                self.nested = torch.nn.Module()
                self.nested.layer = torch.nn.Linear(3, 2, bias=False)
                self.other = torch.nn.Module()
                self.other.layer = torch.nn.Linear(3, 2, bias=False)
                for item in (self.layer, self.nested.layer, self.other.layer):
                    item.weight.data.zero_()

        model = Tiny()
        tensors = {}
        for name, rank in (("layer", 4), ("nested.layer", 2)):
            tensors[name + ".lora_A.weight"] = torch.ones(rank, 3)
            tensors[name + ".lora_B.weight"] = torch.ones(2, rank)
        metadata = peft_metadata_from_header({"__metadata__": {"alpha": "8"}}, tensors)
        model.load_lora_adapter(tensors, prefix=None, adapter_name="test", metadata=metadata)
        model.set_adapters(["test"], [0.5])
        for layer in (model.layer, model.nested.layer):
            torch.testing.assert_close(layer(torch.ones(1, 3)), torch.full((1, 2), 12.0))
        self.assertFalse(hasattr(model.other.layer, "lora_A"))
        self.assertFalse(torch.cuda.is_initialized())


if __name__ == "__main__":
    unittest.main()
