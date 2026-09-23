# -*- coding: utf-8 -*-
"""H3 참조 구간은 명시 선택하며, 앞부분 선택은 전체 디코딩 전에 멈춥니다."""
import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from control_policy import validate_control_options
from engines._h3_reference import load_video_reference


class ReferenceRangePolicyTests(unittest.TestCase):
    def test_video_reference_requires_explicit_choice_but_images_do_not(self):
        options = {"references": [{"kind": "video", "path": "not-opened.mp4"}]}
        for value in (None, "", "invalid", 5, False):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "앞 5초 또는 전체"):
                validate_control_options("minimaxh3", dict(options, reference_video_range=value))
        for value in ("first5s", "full"):
            validate_control_options("minimaxh3", dict(options, reference_video_range=value))
        validate_control_options("minimaxh3", {"references": [{"kind": "image", "path": "not-opened.png"}]})

    def test_range_cannot_be_silently_ignored_without_h3_video(self):
        for engine, references in (("wanvideo", []), ("minimaxh3", []), ("minimaxh3", [{"kind": "image"}])):
            with self.subTest(engine=engine), self.assertRaisesRegex(ValueError, "H3 영상 레퍼런스"):
                validate_control_options(engine, {"references": references, "reference_video_range": "first5s"})

    def test_prefix_decoder_stops_before_reading_the_rest(self):
        import numpy as np
        read = []
        stream = types.SimpleNamespace(duration=15, time_base=1, average_rate=10, guessed_rate=10)

        class Container:
            streams = types.SimpleNamespace(video=[stream], audio=[])
            duration = 15000000

            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def decode(self, _):
                for index in range(150):
                    # 처음 50장 이후까지 디코드한다면 실제로 시험이 실패합니다.
                    if index >= 50:
                        raise AssertionError("선택한 5초 뒤를 디코딩했습니다.")
                    read.append(index)
                    yield types.SimpleNamespace(time=index / 10, rotation=0,
                        to_ndarray=lambda **_: np.zeros((2, 4, 3), dtype=np.uint8))

        # 소리 없는 경우 torch 는 필요하지 않도록 가벼운 대역만 제공합니다.
        with patch.dict(sys.modules, {"av": types.SimpleNamespace(open=lambda _: Container()), "torch": types.SimpleNamespace()}):
            reference, meta = load_video_reference("not-opened.mp4", "first5s", types.SimpleNamespace, 345)
        self.assertEqual(len(read), 50)
        self.assertEqual(len(reference.frames), 50)
        self.assertEqual(meta["source_reported_seconds"], 15)
        self.assertEqual(meta["decoded_seconds"], 5)
        self.assertEqual(meta["conditioning_frames"], 120)


HAS_MEDIA_PACKAGES = all(importlib.util.find_spec(name) is not None for name in ("av", "numpy", "torch", "diffusers", "imageio_ffmpeg"))


@unittest.skipUnless(HAS_MEDIA_PACKAGES, "실제 영상 CPU 시험은 H3 엔진 Python 환경에서 실행합니다.")
class ActualReferenceMediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import imageio_ffmpeg
        cls.folder = tempfile.TemporaryDirectory(prefix="aimovie-h3-reference-test-")
        cls.paths = {}
        for seconds in (2, 6):
            path = str(pathlib.Path(cls.folder.name) / "{}.mkv".format(seconds))
            subprocess.run([
                imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-f", "lavfi", "-i",
                "color=c=red:s=16x16:r=10:d={}".format(seconds), "-f", "lavfi", "-i",
                "sine=frequency=440:sample_rate=48000:duration={}".format(seconds),
                "-t", str(seconds), "-c:v", "ffv1", "-c:a", "pcm_s16le", "-threads", "1", path,
            ], check=True, capture_output=True, timeout=20)
            cls.paths[seconds] = path

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def test_first_five_seconds_preserves_fps_crops_audio_and_keeps_source(self):
        import hashlib
        from diffusers.modular_pipelines.minimax_h3 import MiniMaxH3VideoReference
        path = self.paths[6]
        original = hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
        reference, meta = load_video_reference(path, "first5s", MiniMaxH3VideoReference, 345)
        self.assertEqual(reference.frames.shape, (50, 16, 16, 3))
        self.assertEqual(reference.fps, 10)
        self.assertEqual(reference.sample_rate, 48000)
        self.assertEqual(reference.audio.shape[-1], 240000)
        self.assertEqual(meta["decoded_seconds"], 5)
        self.assertEqual(meta["conditioning_seconds"], 5)
        self.assertEqual(meta["audio_seconds"], 5)
        self.assertEqual(hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest(), original)

    def test_short_clip_is_not_padded_or_extended(self):
        from diffusers.modular_pipelines.minimax_h3 import MiniMaxH3VideoReference
        reference, meta = load_video_reference(self.paths[2], "first5s", MiniMaxH3VideoReference, 345)
        self.assertEqual(len(reference.frames), 20)
        self.assertEqual(reference.audio.shape[-1], 96000)
        self.assertEqual(meta["conditioning_seconds"], 2)
        self.assertEqual(meta["decoded_seconds"], 2)

    def test_full_selection_uses_official_decode_but_reports_h3_output_duration_limit(self):
        import numpy as np
        import torch
        from diffusers.modular_pipelines.minimax_h3 import MiniMaxH3VideoReference
        original = MiniMaxH3VideoReference.from_file(self.paths[6])
        reference, meta = load_video_reference(self.paths[6], "full", MiniMaxH3VideoReference, 124)
        np.testing.assert_array_equal(reference.frames, original.frames)
        torch.testing.assert_close(reference.audio, original.audio, rtol=0, atol=0)
        self.assertEqual(meta["decoded_frames"], 60)
        self.assertEqual(meta["decoded_seconds"], 6)
        self.assertEqual(meta["conditioning_frames"], 124)
        self.assertAlmostEqual(meta["conditioning_seconds"], 124 / 24, places=5)


if __name__ == "__main__":
    unittest.main()
