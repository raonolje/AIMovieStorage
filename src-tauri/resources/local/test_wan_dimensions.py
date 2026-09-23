"""I2V가 입력 이미지 크기와 무관하게 요청 해상도를 파이프라인에 전달하는지 검증합니다."""
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import common
from engines import wanvideo


class WanDimensionTests(unittest.TestCase):
    def check_request(self, image):
        captured = {}

        # 설치된 diffusers 파이프라인과 같은 기본값입니다. 크기를 안 보내면 실패합니다.
        def pipe(width=832, height=480, **kwargs):
            captured.update(width=width, height=height, **kwargs)
            return types.SimpleNamespace(frames=[["frame"]])

        opts = {"width": 1280, "height": 720, "seconds": 5, "fps": 24, "seed": 17}
        if image:
            opts["image"] = str(image)
        with patch.dict(wanvideo._state, {"pipe": pipe, "plan": {}}), \
             patch.object(common, "check_motion_mask"), \
             patch.object(common, "generator", return_value=None), \
             patch.object(common, "step_reporter", return_value=None), \
             patch.object(common, "run_attention_safe", side_effect=lambda _, run: run()), \
             patch.object(common, "freeze_by_mask", side_effect=lambda frames, _: frames), \
             patch.object(common, "save_video"), \
             patch.object(common, "precision_fields", return_value={}):
            result = wanvideo.generate("unused.mp4", opts, lambda *_: None)
        self.assertEqual((captured["width"], captured["height"]), (1280, 720))
        self.assertEqual((result["width"], result["height"]), (captured["width"], captured["height"]))
        return captured

    def test_text_to_video(self):
        self.assertNotIn("image", self.check_request(None))

    def test_image_to_video(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow not installed")
        with tempfile.TemporaryDirectory() as folder:
            image = Path(folder) / "첫 장면.png"
            Image.new("RGB", (320, 180)).save(image)
            self.assertEqual(self.check_request(image)["image"].size, (1280, 720))


if __name__ == "__main__":
    unittest.main()
