# -*- coding: utf-8 -*-
"""실제 H3 입력 블록을 CPU에서 실행합니다. 모델 가중치/네트워크/GPU 불필요."""
import importlib.util
import os
import types
import unittest
from unittest.mock import patch

HAS_RUNTIME = all(importlib.util.find_spec(name) is not None for name in ("torch", "diffusers", "transformers"))


@unittest.skipUnless(HAS_RUNTIME, "실제 H3 엔진 환경에서 입력 블록을 확인합니다.")
class ReferenceResizeTests(unittest.TestCase):
    def setUp(self):
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
        from diffusers.image_processor import VaeImageProcessor
        from engines._h3_reference_resize import H3ReferenceResizeSetup
        self.block = H3ReferenceResizeSetup()
        self.pipe = types.SimpleNamespace(
            image_processor=VaeImageProcessor(vae_scale_factor=16),
            config=types.SimpleNamespace(canvas_short_edge=768, canvas_max_pixels=768 * 1344,
                                         reference_image_short_edge=2048),
            canvas_multiple=32, vae_frames_per_chunk=17, vae_latents_per_chunk=5,
            fps=24, min_duration=5, max_duration=15, audio_sampling_rate=32000,
        )

    def run_block(self, references, mode="match", **kwargs):
        from diffusers.modular_pipelines.modular_pipeline import PipelineState
        state = PipelineState()
        for name, value in {"references": references, "num_frames": 124, "height": 544,
                            "width": 960, "reference_resize_mode": mode, **kwargs}.items():
            state.set(name, value)
        result_pipe, result_state = self.block(self.pipe, state)
        self.assertIs(result_pipe, self.pipe)
        self.assertIs(result_state, state)
        self.assertIs(state.get("references"), references)
        return state

    def test_match_never_encodes_stock_2048_upscale_and_keeps_original_inputs(self):
        from PIL import Image
        from diffusers.modular_pipelines.minimax_h3 import MiniMaxH3ImageReference
        images = [Image.new("RGB", size) for size in ((320, 320), (1920, 1080), (2048, 2048))]
        refs = [MiniMaxH3ImageReference(image=image) for image in images]
        with patch.object(self.pipe.image_processor, "resize", wraps=self.pipe.image_processor.resize) as resize:
            state = self.run_block(refs)
        self.assertEqual([entry.image.size for entry in state.get("normalized_references")],
                         [(320, 320), (960, 544), (736, 736)])
        self.assertEqual([image.size for image in images], [(320, 320), (1920, 1080), (2048, 2048)])
        self.assertTrue(all(call.kwargs["height"] < 2048 for call in resize.call_args_list))
        self.assertEqual(self.pipe.config.reference_image_short_edge, 2048)

    def test_diffusers_default_still_uses_the_original_policy(self):
        from PIL import Image
        from diffusers.modular_pipelines.minimax_h3 import MiniMaxH3ImageReference
        result = self.run_block([MiniMaxH3ImageReference(image=Image.new("RGB", (320, 320)))], mode="diffusers")
        self.assertEqual(result.get("normalized_references")[0].image.size, (2048, 2048))

    def test_tensor_numpy_and_pil_receive_the_same_match_size(self):
        import numpy as np
        import torch
        from diffusers.modular_pipelines.minimax_h3 import MiniMaxH3ImageReference
        refs = [MiniMaxH3ImageReference(image=value) for value in (
            np.zeros((1080, 1920, 3), dtype=np.uint8), torch.zeros((3, 1080, 1920), dtype=torch.uint8))]
        result = self.run_block(refs)
        self.assertEqual([entry.image.size for entry in result.get("normalized_references")], [(960, 544)] * 2)
        self.assertFalse(torch.cuda.is_initialized())

    def test_mixed_media_order_video_timing_and_audio_are_unchanged(self):
        import numpy as np
        import torch
        from PIL import Image
        from diffusers.modular_pipelines.minimax_h3 import MiniMaxH3ImageReference, MiniMaxH3VideoReference, MiniMaxH3AudioReference
        frames = np.zeros((2, 768, 1344, 3), dtype=np.uint8)
        frames[1] = 200
        audio = torch.arange(3200).float().reshape(1, -1)
        refs = [MiniMaxH3VideoReference(frames=frames, fps=12),
                MiniMaxH3ImageReference(image=Image.new("RGB", (320, 320))),
                MiniMaxH3AudioReference(audio=audio, sample_rate=32000)]
        result = self.run_block(refs).get("normalized_references")
        self.assertEqual([entry.kind for entry in result], ["video", "image", "audio"])
        self.assertEqual(result[0].fps, 24)
        np.testing.assert_array_equal(result[0].frames, np.repeat(frames, 2, axis=0))
        torch.testing.assert_close(result[2].audio, audio.expand(2, -1))
        self.assertEqual(result[2].sample_rate, 32000)

    def test_official_validation_is_preserved_and_failure_does_not_mutate_shared_processor(self):
        from PIL import Image
        from diffusers.modular_pipelines.minimax_h3 import MiniMaxH3ImageReference
        image = MiniMaxH3ImageReference(image=Image.new("RGB", (320, 320)))
        original = self.pipe.image_processor
        for refs, args in (([image] * 10, {}), ([image], {"width": 961}), ([image], {"num_frames": 1}),
                           ([], {}), ([object()], {}), ([image], {"mode": "unknown"})):
            with self.subTest(args=args), self.assertRaises((ValueError, TypeError)):
                self.run_block(refs, **args)
            self.assertIs(self.pipe.image_processor, original)
            self.assertEqual(self.pipe.config.reference_image_short_edge, 2048)

    def test_custom_block_is_advertised_without_changing_other_workflow_classes(self):
        from diffusers.modular_pipelines.minimax_h3.modular_blocks_minimax_h3 import MiniMaxH3AutoBeforeEncodeStep
        from engines._h3_reference_resize import H3ReferenceResizeBlocks, H3ReferenceResizeBeforeEncode
        blocks = H3ReferenceResizeBlocks()
        self.assertIn("reference_resize_mode", [item.name for item in blocks.inputs])
        self.assertEqual(H3ReferenceResizeBeforeEncode.block_classes[1:], MiniMaxH3AutoBeforeEncodeStep.block_classes[1:])
        self.assertIsNot(H3ReferenceResizeBeforeEncode.block_classes[0], MiniMaxH3AutoBeforeEncodeStep.block_classes[0])

    def test_real_pipeline_constructor_advertises_match_without_loading_weights(self):
        import torch
        from diffusers import ComponentsManager
        from engines._h3_reference_resize import reference_pipeline
        pipeline = reference_pipeline(None, ComponentsManager())
        self.assertIn("reference_resize_mode", [item.name for item in pipeline.blocks.inputs])
        self.assertIsNone(pipeline.transformer_ref)
        self.assertFalse(torch.cuda.is_initialized())


if __name__ == "__main__":
    unittest.main()
