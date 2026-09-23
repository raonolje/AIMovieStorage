"""체크포인트 밖 RoPE 버퍼의 장치/정밀도 회귀. H3 환경에서 실제 모듈로 검증."""
import importlib.util
import types
import unittest
from unittest.mock import Mock

from engines.minimaxh3 import _place_resident_rotary_buffer, _active_transformer, _transformer_name, _configure_reference_processor

HAS_PACKAGES = all(importlib.util.find_spec(name) for name in ("torch", "diffusers"))


class ResidentPlacementContractTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("transformers"), "실제 H3 엔진 환경에서 전처리기를 확인합니다.")
    def test_reference_processor_caps_short_video_without_touching_other_workflows(self):
        from transformers import Qwen3VLVideoProcessor
        # H3 체크포인트의 video_preprocessor_config.json과 같은 설정입니다.
        # 클래스 기본 크기는 더 작아 토큰 상한의 효과를 재현하지 못합니다.
        processor = Qwen3VLVideoProcessor(
            size={"longest_edge": 25165824, "shortest_edge": 4096},
            patch_size=16, merge_size=2,
        )
        before = processor.get_num_of_video_patches(12, 768, 1344)
        pipe = types.SimpleNamespace(processor=types.SimpleNamespace(video_processor=processor))
        _configure_reference_processor(pipe, "ref2va")
        after = processor.get_num_of_video_patches(12, 768, 1344)
        self.assertLess(after, before)
        self.assertLessEqual(after / processor.merge_size**2, 6 * processor.max_video_tokens)
        _configure_reference_processor(types.SimpleNamespace(), "fl2va")

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

    def test_reference_workflow_selects_the_component_used_by_real_denoiser(self):
        from diffusers.modular_pipelines.minimax_h3.denoise import MiniMaxH3LoopDenoiser, MiniMaxH3Ref2VALoopDenoiser
        pipe = types.SimpleNamespace(transformer=object(), transformer_ref=object())
        for workflow, denoiser in (("t2va", MiniMaxH3LoopDenoiser()),
                                   ("fl2va", MiniMaxH3LoopDenoiser()),
                                   ("ref2va", MiniMaxH3Ref2VALoopDenoiser())):
            with self.subTest(workflow=workflow):
                self.assertEqual(_transformer_name(workflow), denoiser.transformer_name)
                self.assertIs(_active_transformer(pipe, workflow), getattr(pipe, denoiser.transformer_name))

    def test_cuda_reference_rotary_is_placed_without_touching_other_partition(self):
        torch = self.torch
        if not torch.cuda.is_available():
            self.skipTest("CUDA가 있는 H3 엔진 환경에서 실행합니다.")
        from diffusers.models.transformers.transformer_minimax_h3 import MiniMaxH3RotaryPosEmbed
        plain = types.SimpleNamespace(rope=MiniMaxH3RotaryPosEmbed(rope_freq_dim=4))
        pipe = types.SimpleNamespace(transformer=plain, transformer_ref=self.transformer)
        positions = torch.arange(18).reshape(6, 3).float()
        expected = self.rope(positions)
        _place_resident_rotary_buffer(_active_transformer(pipe, "ref2va"), torch.device("cuda"))
        actual = pipe.transformer_ref.rope(positions.cuda())
        for cpu, gpu in zip(expected, actual):
            torch.testing.assert_close(cpu, gpu.cpu())
        self.assertEqual(plain.rope.inv_freq.device.type, "cpu")


if __name__ == "__main__":
    unittest.main()
