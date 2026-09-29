"""TTS options are checked before GPU/model loading and never silently ignored."""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from control_policy import validate_control_options


class QwenTtsContractTests(unittest.TestCase):
    def test_valid_korean_voice_design_and_custom_voice(self):
        base = {"prompt": "다시 만났네요.", "voice_instruct": "차분하고 따뜻한 목소리", "language": "Korean"}
        validate_control_options("qwentts", {**base, "voice_model": "design"})
        validate_control_options("qwentts", {**base, "voice_model": "custom-0.6b", "voice_speaker": "Sohee"})

    def test_invalid_model_speaker_and_empty_dialogue_are_rejected(self):
        base = {"prompt": "다시 만났네요.", "voice_instruct": "차분하고 따뜻한 목소리", "language": "Korean"}
        for opts in ({**base, "prompt": ""}, {**base, "voice_model": "unknown"},
                     {**base, "voice_model": "custom-1.7b", "voice_speaker": "Invented"}):
            with self.subTest(opts=opts), self.assertRaises(ValueError):
                validate_control_options("qwentts", opts)

    def test_other_engines_reject_voice_options(self):
        with self.assertRaisesRegex(ValueError, "Qwen3-TTS"):
            validate_control_options("qwenimage", {"prompt": "그림", "voice_model": "design"})


if __name__ == "__main__":
    unittest.main()
