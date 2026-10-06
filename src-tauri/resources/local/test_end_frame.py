"""Endpoint forwarding tests; no model weights or GPU required."""
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from control_policy import validate_control_options
from engines import ltx25
from engines import wanvideo


class ImageValue:
    def __init__(self, path, size=None):
        self.path, self.size = path, size
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass
    def convert(self, mode):
        return self
    def resize(self, size):
        return ImageValue(self.path, size)


class Condition:
    def __init__(self, frames, index):
        self.frames, self.index = frames, index


class EndFrameTests(unittest.TestCase):
    def setUp(self):
        # 기존 프레임/조건 테스트는 저장 경계를 모형화한다. 실제 음원 검증은 test_generated_audio.
        from unittest.mock import patch
        saver = patch('generated_audio.save_generated_video',
            side_effect=lambda frames, audio, rate, output, fps, save: (save(frames, output, fps), {'source':'unit-test-stub'})[1])
        saver.start()
        self.addCleanup(saver.stop)

    def test_policy_and_mode(self):
        opts = {"image": "start.png", "end_image": "end.png"}
        validate_control_options("ltx25", opts)
        self.assertEqual(ltx25._mode_of(opts), "conditions")
        for engine in ("minimaxh3", "qwenimage"):
            with self.assertRaisesRegex(ValueError, "model_unsupported"):
                validate_control_options(engine, opts)
        for bad in ({"end_image": "end.png"}, dict(opts, motion_mask="mask.png")):
            with self.assertRaises(ValueError):
                validate_control_options("ltx25", bad)

    def test_wan_passes_end_image_and_rejects_expanded_timestep_models(self):
        from contextlib import ExitStack
        calls = []
        class Pipe:
            config = types.SimpleNamespace(expand_timesteps=False)
            def __call__(self, **kwargs):
                calls.append(kwargs)
                return types.SimpleNamespace(frames=[list(range(kwargs["num_frames"]))])
        pipe = Pipe()
        pil = types.ModuleType("PIL")
        pil.Image = types.SimpleNamespace(open=ImageValue)
        opts = {"image": "start.png", "end_image": "end.png", "width": 384,
                "height": 256, "fps": 24, "seconds": 2, "steps": 12}
        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, {"PIL": pil}))
            stack.enter_context(patch.dict(wanvideo._state, {"pipe": pipe, "plan": None}))
            stack.enter_context(patch("os.path.isfile", return_value=True))
            for method, kwargs in {
                "check_motion_mask": {}, "resolve_seed": {"return_value": 42},
                "generator": {"return_value": "rng"}, "step_reporter": {"return_value": None},
                "run_attention_safe": {"side_effect": lambda p, call: call()},
                "freeze_by_mask": {"side_effect": lambda frames, mask: frames},
                "save_video": {}, "precision_fields": {"return_value": {}}
            }.items():
                stack.enter_context(patch.object(wanvideo.common, method, **kwargs))
            meta = wanvideo.generate("unused.mp4", opts, lambda *args: None)
            self.assertEqual(calls[0]["image"].path, "start.png")
            self.assertEqual(calls[0]["last_image"].path, "end.png")
            self.assertEqual(meta["frame_conditions"]["method"], "vae-first-last-conditioning")
            self.assertTrue(meta["duration_contract"]["end_condition_in_trimmed_tail"])
            pipe.config.expand_timesteps = True
            with self.assertRaisesRegex(ValueError, "model_unsupported"):
                wanvideo.generate("unused.mp4", opts, lambda *args: None)
            self.assertEqual(len(calls), 1)

    def test_conditions_are_sent_to_inference_without_pasting_output(self):
        calls = []
        result = types.SimpleNamespace(frames=[["generated-video-frames"]])
        def pipe(**kwargs):
            calls.append(kwargs)
            return types.SimpleNamespace(frames=[list(range(kwargs["num_frames"]))])
        pil = types.ModuleType("PIL")
        pil.Image = types.SimpleNamespace(open=ImageValue)
        module = types.ModuleType("diffusers.pipelines.ltx2")
        module.LTX2VideoCondition = Condition
        with patch.dict(sys.modules, {"PIL": pil, "diffusers.pipelines.ltx2": module}), \
             patch.dict(ltx25._state, {"pipe": pipe, "plan": None}), \
             patch("os.path.isfile", return_value=True), \
             patch.object(ltx25, "_require_image_codec"), \
             patch.object(ltx25, "_sampling_options", return_value={"num_inference_steps": 2, "guidance_scale": 1}), \
             patch.object(ltx25.common, "check_motion_mask"), \
             patch.object(ltx25.common, "resolve_seed", return_value=42), \
             patch.object(ltx25.common, "generator", return_value="rng"), \
             patch.object(ltx25.common, "step_reporter", return_value=None), \
             patch.object(ltx25.common, "run_attention_safe", side_effect=lambda p, call: call()), \
             patch.object(ltx25.common, "freeze_by_mask", side_effect=lambda frames, mask: frames), \
             patch.object(ltx25.common, "save_video") as save, \
             patch.object(ltx25.common, "precision_fields", return_value={}):
            meta = ltx25.generate("qa.mp4", {"image": "start.png", "end_image": "end.png",
                "width": 320, "height": 192, "fps": 24, "seconds": 1}, lambda *args: None)
        self.assertNotIn("image", calls[0])
        self.assertEqual([(c.index, c.frames.path) for c in calls[0]["conditions"]], [(0, "start.png"), (-1, "end.png")])
        self.assertEqual(meta["frames"], 24)
        self.assertFalse(meta["duration_contract"]["end_condition_in_trimmed_tail"])
        self.assertEqual(meta["end_condition_contract"]["condition_pixel_frame"], 17)
        self.assertFalse(meta["end_condition_contract"]["placement_exact"])
        self.assertEqual(meta["frame_conditions"]["method"], "latent-conditioning")
        save.assert_called_once_with(list(range(24)), "qa.mp4", 24)


if __name__ == "__main__":
    unittest.main()
