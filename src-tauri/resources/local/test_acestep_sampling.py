"""CPU 계약 검사: 모델 로드·torch·다운로드 없이 실제 작업자 호출을 검증합니다."""
import pathlib
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from engines import acestep
from control_policy import validate_control_options


class SamplingTests(unittest.TestCase):
    def generate(self, opts):
        pipe = Mock()
        with patch.dict(acestep._state, {"pipe": pipe, "plan": None}), \
                patch.object(acestep, "_save_with_soundfile"), \
                patch.object(acestep.common.random, "randint", return_value=987):
            result = acestep.generate("qa.wav", opts, Mock())
        return pipe.call_args.kwargs, result

    def test_default_and_random_seed(self):
        for opts in ({}, {"seed": -1}):
            call, result = self.generate(opts)
            self.assertEqual(call["infer_step"], 60)
            self.assertEqual(call["guidance_scale"], 15)
            self.assertEqual(call["manual_seeds"], "987")
            self.assertEqual(call["lyrics"], "[inst]")
            self.assertEqual((result["seed"], result["steps"], result["guidance"]), (987, 60, 15))

    def test_explicit_values_and_zero(self):
        for opts in ({"seed": 0, "steps": 1, "guidance": 0},
                     {"seed": 2147483647, "steps": 200, "guidance": 30}):
            opts.update(prompt="piano", lyrics="[verse]\n그대로", seconds=20)
            call, result = self.generate(opts)
            self.assertEqual(call["manual_seeds"], str(opts["seed"]))
            self.assertEqual(call["infer_step"], opts["steps"])
            self.assertEqual(call["guidance_scale"], opts["guidance"])
            self.assertEqual(call["lyrics"], opts["lyrics"])
            self.assertEqual(call["audio_duration"], 20)
            for key in ("seed", "steps", "guidance"):
                self.assertEqual(result[key], opts[key])

    def test_bad_values_rejected_before_model_load(self):
        for key, bad_values in {
            "seed": [-2, 2147483648, 0.5, True, "1", None],
            "steps": [0, 201, 1.5, True, "60", None],
            "guidance": [-1, 31, float("inf"), float("nan"), True, "15", None],
        }.items():
            for value in bad_values:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    validate_control_options("acestep", {key: value})


if __name__ == "__main__":
    unittest.main()
