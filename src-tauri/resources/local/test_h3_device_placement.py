"""체크포인트 밖 RoPE 버퍼의 장치/정밀도 회귀. H3 환경에서 실제 모듈로 검증."""
import importlib.util
import types
import unittest
from unittest.mock import Mock

from engines.minimaxh3 import _place_resident_rotary_buffer

HAS_PACKAGES = all(importlib.util.find_spec(name) for name in ("torch", "diffusers"))


class ResidentPlacementContractTests(unittest.TestCase):
    def test_moves_only_rotary_module_without_casting_quantized_weights(self):
        rope = types.SimpleNamespace(to=Mock())
        quantized_weight = object()
        transformer = types.SimpleNamespace(
            rope=rope,
            weight=quantized_weight,
            to=Mock(side_effect=AssertionError("양자화한 전체 모델을 다시 옮기면 안 됩니다.")),
        )
        _place_resident_rotary_buffer(transformer, "cuda:0")
        rope.to.assert_called_once_with(device="cuda:0")
        transformer.to.assert_not_called()
        self.assertIs(transformer.weight, quantized_weight)


@unittest.skipUnless(HAS_PACKAGES, "실제 H3 엔진 Python 환경에서 실행합니다.")
class ResidentRotaryBufferTests(unittest.TestCase):
    def setUp(self):
        import torch
        from diffusers.models.transformers.transformer_minimax_h3 import MiniMaxH3RotaryPosEmbed
        self.torch = torch
        self.rope = MiniMaxH3RotaryPosEmbed(rope_freq_dim=4)
        self.transformer = types.SimpleNamespace(rope=self.rope)

    def test_float32_frequency_and_nonpersistent_contract_survive_placement(self):
        before = self.rope.inv_freq.clone()
        _place_resident_rotary_buffer(self.transformer, self.torch.device("cpu"))
        self.assertEqual(self.rope.inv_freq.dtype, self.torch.float32)
        self.assertTrue(self.torch.equal(before, self.rope.inv_freq))
        self.assertNotIn("inv_freq", self.rope.state_dict())

    def test_actual_cuda_positions_fail_before_placement_and_match_cpu_after(self):
        torch = self.torch
        if not torch.cuda.is_available():
            self.skipTest("CUDA가 있는 H3 엔진 환경에서 실행합니다.")
        positions = torch.arange(18).reshape(6, 3).float()
        expected = self.rope(positions)
        with self.assertRaisesRegex(RuntimeError, "same device"):
            self.rope(positions.cuda())
        _place_resident_rotary_buffer(self.transformer, torch.device("cuda"))
        actual = self.rope(positions.cuda())
        for cpu, gpu in zip(expected, actual):
            torch.testing.assert_close(cpu, gpu.cpu())
        self.assertEqual(self.rope.inv_freq.dtype, torch.float32)
        self.assertNotIn("inv_freq", self.rope.state_dict())


if __name__ == "__main__":
    unittest.main()
