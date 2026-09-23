# -*- coding: utf-8 -*-
"""큰 가중치/GPU 없이 두 단계의 시간축·조건 분리·실패 후 재사용을 검사합니다."""
import pathlib
import sys
import types
import unittest
import importlib.util
from unittest.mock import patch, Mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from engines._ltx_two_stage import quality_of, resolution_plan, run_two_stage, load_upsampler, UPSAMPLER_REVISION
from control_policy import validate_control_options
from engines import ltx25


class FakeScheduler:
    def __init__(self, config=None):
        self.config = config or {"use_dynamic_shifting": True, "shift": 3}

    @classmethod
    def from_config(cls, config, **kwargs):
        return cls(dict(config, **kwargs))


class FakePipe:
    def __init__(self, fail=False):
        self.scheduler = FakeScheduler()
        self.transformer = types.SimpleNamespace(peft_config={"pose": object(), "style": object()})
        self.enabled = True
        self.calls = []
        self.fail = fail

    def disable_lora(self):
        self.enabled = False

    def enable_lora(self):
        self.enabled = True

    def __call__(self, reference_conditions=None, reference_downscale_factor=None, **kwargs):
        if reference_conditions is not None:
            kwargs["reference_conditions"] = reference_conditions
        if reference_downscale_factor is not None:
            kwargs["reference_downscale_factor"] = reference_downscale_factor
        self.calls.append((kwargs, self.enabled, self.scheduler.config))
        if len(self.calls) == 1:
            return "generated-only-latents", "unaltered-audio-latents"
        if self.fail:
            raise RuntimeError("취소 또는 추론 오류")
        return types.SimpleNamespace(frames=[["정제 영상"]])


class TwoStageTests(unittest.TestCase):
    def invoke(self, pipe):
        diffusers = types.ModuleType("diffusers")
        diffusers.FlowMatchEulerDiscreteScheduler = FakeScheduler
        utils = types.ModuleType("diffusers.pipelines.ltx2.utils")
        utils.STAGE_2_DISTILLED_SIGMA_VALUES = [.909375, .725, .421875]
        def upscale(latents):
            self.assertEqual(latents, "generated-only-latents")
            return "upscaled-latents"
        with patch.dict(sys.modules, {"diffusers": diffusers, "diffusers.pipelines.ltx2.utils": utils}):
            return run_two_stage(pipe, {"width": 640, "height": 384, "sigmas": [1] * 8,
                "num_frames": 113, "frame_rate": 24, "guidance_scale": 1, "generator": "same-rng",
                "reference_conditions": ["edges"], "reference_downscale_factor": 2,
                "conditions": ["half-image"], "prompt": "same-prompt"}, resolution_plan(1280, 768, True),
                upscale, lambda *args: args, lambda call: call(), ["full-image"])

    def test_final_size_is_not_doubled_and_halved_inputs_remain_vae_aligned(self):
        plan = resolution_plan(1920, 1080, True)
        self.assertEqual((plan["width"], plan["height"]), (1920, 1024))
        self.assertEqual((plan["stage1_width"], plan["stage1_height"]), (960, 512))
        self.assertEqual(plan["stage1_width"] // 2 % 32, 0)
        self.assertEqual(plan["stage1_height"] // 2 % 32, 0)
        self.assertEqual(resolution_plan(1920, 1080)["height"], 1088)

    def test_refinement_keeps_timing_audio_and_first_image_without_reference_or_adapters(self):
        pipe = FakePipe()
        before = pipe.scheduler
        self.invoke(pipe)
        first, second = pipe.calls
        self.assertTrue(first[1])
        self.assertEqual(first[0]["output_type"], "latent")
        self.assertEqual(first[0]["reference_conditions"], ["edges"])
        self.assertFalse(second[1])
        self.assertNotIn("reference_conditions", second[0])
        self.assertNotIn("reference_downscale_factor", second[0])
        self.assertEqual(second[0]["conditions"], ["full-image"])
        self.assertEqual(second[0]["latents"], "upscaled-latents")
        self.assertEqual(second[0]["audio_latents"], "unaltered-audio-latents")
        self.assertEqual((second[0]["width"], second[0]["height"]), (1280, 768))
        self.assertEqual((second[0]["num_frames"], second[0]["frame_rate"]), (113, 24))
        self.assertEqual(second[0]["generator"], "same-rng")
        self.assertEqual(second[0]["sigmas"], [.909375, .725, .421875])
        self.assertEqual(second[0]["noise_scale"], .909375)
        self.assertEqual(second[2], {"use_dynamic_shifting": False, "shift": 1.0, "shift_terminal": None})
        self.assertIs(pipe.scheduler, before)
        self.assertTrue(pipe.enabled)

    def test_cancel_or_error_restores_adapter_and_scheduler_for_retained_worker(self):
        pipe = FakePipe(fail=True)
        before = pipe.scheduler
        with self.assertRaisesRegex(RuntimeError, "취소"):
            self.invoke(pipe)
        self.assertIs(pipe.scheduler, before)
        self.assertTrue(pipe.enabled)

    def test_invalid_quality_is_not_silently_ignored(self):
        self.assertEqual(quality_of({}), "single")
        for value in (None, True, "fast"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                quality_of({"ltx_quality": value})
        with self.assertRaisesRegex(ValueError, "LTX 2.5"):
            validate_control_options("wanvideo", {"ltx_quality": "two-stage"})

    def test_upsampler_uses_pinned_same_generation_component(self):
        module = types.ModuleType("diffusers.pipelines.ltx2.latent_upsampler")
        module.LTX2LatentUpsamplerModel = Mock()
        with patch.dict(sys.modules, {"diffusers.pipelines.ltx2.latent_upsampler": module}):
            load_upsampler("bf16")
        module.LTX2LatentUpsamplerModel.from_pretrained.assert_called_once_with(
            "Lightricks/LTX-2.5-Diffusers", subfolder="latent_upsampler", revision=UPSAMPLER_REVISION, dtype="bf16")

    def test_engine_reports_final_size_but_sends_half_size_to_structure_and_stage_one(self):
        from PIL import Image
        import tempfile
        previous = dict(ltx25._state)
        pipe = FakePipe()
        pipe.vae = types.SimpleNamespace(enable_tiling=lambda: None)
        ltx25._state.update(pipe=pipe, mode="pose", repo=ltx25.REPO, quality="two-stage", upsampler=object())
        module = types.ModuleType("diffusers.pipelines.ltx2")
        module.LTX2ReferenceCondition = lambda **kw: types.SimpleNamespace(**kw)
        module.LTX2VideoCondition = lambda **kw: types.SimpleNamespace(**kw)
        utils = types.ModuleType("diffusers.pipelines.ltx2.utils")
        utils.DISTILLED_SIGMA_VALUES = [1.0, .99375, .9875, .98125, .975, .909375, .725, .421875]
        utils.STAGE_2_DISTILLED_SIGMA_VALUES = [.909375, .725, .421875]
        diffusers = types.ModuleType("diffusers")
        diffusers.FlowMatchEulerDiscreteScheduler = FakeScheduler
        try:
            with tempfile.TemporaryDirectory() as folder:
                image = str(pathlib.Path(folder) / "first.png")
                Image.new("RGB", (1280, 768)).save(image)
                with patch.dict(sys.modules, {"diffusers": diffusers, "diffusers.pipelines.ltx2": module,
                        "diffusers.pipelines.ltx2.utils": utils}), \
                        patch.object(ltx25, "_pose_frames", return_value=[Image.new("RGB", (640, 384))]) as pose, \
                        patch.object(ltx25, "_attach_pose"), patch.object(ltx25, "_require_image_codec"), \
                        patch.object(ltx25, "upscale_latents", return_value="upscaled-latents"), \
                        patch.multiple(ltx25.common, check_motion_mask=lambda _: None, resolve_seed=lambda _: 1,
                            generator=lambda _: None, step_reporter=lambda *args: args,
                            run_attention_safe=lambda _, call: call(), freeze_by_mask=lambda frames, _: frames,
                            save_video=lambda *_: None, precision_fields=lambda _: {}):
                    result = ltx25.generate("unused.mp4", {"ltx_quality": "two-stage", "width": 1280,
                        "height": 768, "image": image, "seconds": 5, "fps": 24,
                        "control": {"frames": ["mock.png"], "weight": 0.6}}, lambda *_: None)
                self.assertEqual(pose.call_args.args[1:3], (640, 384))
                self.assertEqual(pipe.calls[0][0]["conditions"][0].frames.size, (640, 384))
                self.assertEqual(pipe.calls[1][0]["conditions"][0].frames.size, (1280, 768))
                self.assertEqual((result["width"], result["height"], result["frames"], result["fps"]), (1280, 768, 113, 24))
                self.assertEqual(result["inference_steps"], 11)
                self.assertEqual(result["two_stage"]["adapters"], "stage1-only")
        finally:
            ltx25._state.clear()
            ltx25._state.update(previous)

    @unittest.skipUnless(importlib.util.find_spec("diffusers"), "설치된 Diffusers CPU 런타임에서 추가 확인")
    def test_actual_scheduler_preserves_three_refinement_sigmas_without_dynamic_shift(self):
        from diffusers import FlowMatchEulerDiscreteScheduler
        scheduler = FlowMatchEulerDiscreteScheduler(use_dynamic_shifting=True, shift=3)
        scheduler = FlowMatchEulerDiscreteScheduler.from_config(scheduler.config,
            use_dynamic_shifting=False, shift_terminal=None, shift=1.0)
        scheduler.set_timesteps(sigmas=[.909375, .725, .421875], device="cpu")
        self.assertEqual(len(scheduler.timesteps), 3)
        self.assertEqual(scheduler.sigmas.tolist(), [.909375011920929, .7250000238418579, .421875, 0.0])


if __name__ == "__main__":
    unittest.main()
