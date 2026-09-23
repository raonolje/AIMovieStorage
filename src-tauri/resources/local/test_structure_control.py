# -*- coding: utf-8 -*-
"""모델/GPU 없이 실제 영상의 구간·FPS·윤곽과 Union 전달 계약을 검증합니다."""
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import av
import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from control_policy import validate_control_options
from structure_control import canny_reference_frames, probe_structure_video, _sample_at_times
from engines import ltx25
from test_control_policy import FakePipe


class StructureControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.path = str(pathlib.Path(cls.folder.name) / "camera-and-performers.mp4")
        # 움직이는 사각형과 고정 배경이 모두 있어 윤곽/시각의 잘못된 처리도 드러납니다.
        with av.open(cls.path, "w") as container:
            stream = container.add_stream("mpeg4", rate=24)
            stream.width, stream.height, stream.pix_fmt = 128, 64, "yuv420p"
            stream.codec_context.gop_size = 12
            for index in range(240):
                pixels = np.zeros((64, 128, 3), dtype=np.uint8)
                x = 8 + index % 80
                pixels[12:48, x:x+12] = 255
                pixels[52:56, 8:120] = 255
                for packet in stream.encode(av.VideoFrame.from_ndarray(pixels, format="rgb24")):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def control(self, **kwargs):
        return dict(kind="canny", path=self.path, sourceStartSeconds=6, durationSeconds=1, weight=1, **kwargs)

    def test_policy_rejects_unsupported_joint_and_invalid_inputs(self):
        control = self.control()
        for engine in ("wanvideo", "minimaxh3", "qwenimage"):
            with self.subTest(engine=engine), self.assertRaisesRegex(ValueError, "LTX 2.5"):
                validate_control_options(engine, {"structure_control": control, "seconds": 1})
        with self.assertRaisesRegex(ValueError, "함께"):
            validate_control_options("ltx25", {"structure_control": control, "control": {"frames": ["pose.png"]}, "seconds": 1})
        for extra in ({"weight": 1.1}, {"weight": True}, {"durationSeconds": 0}, {"sourceStartSeconds": -1},
                      {"thresholds": {"low": 200, "high": 92}}, {"thresholds": {"low": 1.1}}, {"arbitrary": "value"}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                validate_control_options("ltx25", {"structure_control": dict(control, **extra), "seconds": 1})
        validate_control_options("ltx25", {"structure_control": dict(control, weight=0), "seconds": 1})

    def test_range_fails_before_loading_model(self):
        with patch.object(ltx25.common, "plan_precision") as plan:
            with self.assertRaisesRegex(ValueError, "원본 영상 길이"):
                ltx25.load("unused", {"structure_control": dict(self.control(), sourceStartSeconds=9.5), "seconds": 1})
            plan.assert_not_called()
        with self.assertRaisesRegex(ValueError, "생성 길이"):
            probe_structure_video(self.control(), {"seconds": 2})

    def test_real_video_seeks_resamples_and_returns_half_size_gray_edges(self):
        frames, meta = canny_reference_frames(self.control(), {"seconds": 1}, 128, 64, 16, 16)
        self.assertEqual(len(frames), 16)
        self.assertEqual(frames[0].size, (64, 32))
        self.assertEqual(meta["source_fps"], 24)
        self.assertEqual(meta["source_start_seconds"], 6)
        self.assertEqual(meta["conditioning_seconds"], 1)
        self.assertAlmostEqual(meta["first_sample_seconds"], 6)
        self.assertLessEqual(abs(meta["last_sample_seconds"] - (6 + 15/16)), 1/48 + 1e-6)
        self.assertLess(meta["decoded_frames"], 40)
        self.assertEqual([meta["low_threshold"], meta["high_threshold"]], [92, 200])
        first, last = np.asarray(frames[0]), np.asarray(frames[-1])
        self.assertTrue(np.array_equal(first[:, :, 0], first[:, :, 1]))
        self.assertTrue(np.array_equal(first[:, :, 1], first[:, :, 2]))
        self.assertGreater(np.count_nonzero(first), 0)
        self.assertFalse(np.array_equal(first, last))

    def test_pts_sampling_preserves_absolute_time_and_does_not_pad_missing_tail(self):
        decoded = [(n/24, object()) for n in range(24)]
        chosen = list(_sample_at_times(iter(decoded), [n/16 for n in range(16)], 0, 1, 1/24))
        self.assertEqual(len(chosen), 16)
        for index, (timestamp, _) in enumerate(chosen):
            self.assertLessEqual(abs(timestamp-index/16), 1/48 + 1e-6)
        with self.assertRaisesRegex(ValueError, "읽지"):
            list(_sample_at_times(iter(decoded[:10]), [n/16 for n in range(16)], 0, 1, 1/24))

    def test_equal_brightness_color_boundaries_survive_official_rgb_canny(self):
        path = str(pathlib.Path(self.folder.name) / "color-boundary.mp4")
        with av.open(path, "w") as container:
            stream = container.add_stream("mpeg4", rate=24)
            stream.width, stream.height, stream.pix_fmt = 128, 64, "yuv420p"
            pixels = np.zeros((64, 128, 3), dtype=np.uint8)
            pixels[:, :64] = (255, 0, 0)
            pixels[:, 64:] = (0, 130, 0)
            for _ in range(24):
                for packet in stream.encode(av.VideoFrame.from_ndarray(pixels, format="rgb24")):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        frames, _ = canny_reference_frames(dict(self.control(), path=path, sourceStartSeconds=0), {"seconds": 1}, 128, 64, 17, 24)
        self.assertGreater(np.count_nonzero(np.asarray(frames[0])[:, 30:34]), 0)

    def test_reference_condition_first_image_zero_strength_and_actual_length(self):
        previous = dict(ltx25._state)
        pipe = FakePipe()
        ltx25._state.update(pipe=pipe, repo=ltx25.REPO, pose=False, loras=[])
        module = types.ModuleType("diffusers.pipelines.ltx2")
        module.LTX2ReferenceCondition = lambda **kw: types.SimpleNamespace(**kw)
        module.LTX2VideoCondition = lambda **kw: types.SimpleNamespace(**kw)
        utils = types.ModuleType("diffusers.pipelines.ltx2.utils")
        utils.DISTILLED_SIGMA_VALUES = [1, .9]
        image = str(pathlib.Path(self.folder.name) / "first.png")
        Image.new("RGB", (128, 64)).save(image)
        try:
            with patch.dict(sys.modules, {"diffusers.pipelines.ltx2": module, "diffusers.pipelines.ltx2.utils": utils}), \
                    patch.multiple(ltx25.common, check_motion_mask=lambda _: None, resolve_seed=lambda _: 1,
                        generator=lambda _: None, step_reporter=lambda *_: None, run_attention_safe=lambda _, call: call(),
                        freeze_by_mask=lambda frames, _: frames, save_video=lambda *_: None, precision_fields=lambda _: {}):
                result = ltx25.generate("unused.mp4", {"structure_control": dict(self.control(), durationSeconds=5, sourceStartSeconds=0, weight=0),
                    "seconds": 5, "fps": 24, "width": 128, "height": 64, "image": image}, lambda *_: None)
            self.assertEqual(len(pipe.received[0].frames), 113)
            self.assertEqual(pipe.received[0].strength, 0)
            self.assertEqual(pipe.kwargs["reference_downscale_factor"], 2)
            self.assertEqual(pipe.kwargs["conditions"][0].index, 0)
            self.assertEqual(pipe.kwargs["conditions"][0].frames.size, (128, 64))
            self.assertEqual(result["structure_control"]["conditioning_frames"], result["frames"])
            self.assertAlmostEqual(result["structure_control"]["conditioning_seconds"], 113/24)
            self.assertEqual(pipe.active, [("pose", 1.0)])
        finally:
            ltx25._state.update(previous)


if __name__ == "__main__":
    unittest.main()
