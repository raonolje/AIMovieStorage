"""Contract tests without downloading weights. GPU inference remains a separate check."""
import contextlib
import os
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from engines import kimodo
from control_policy import validate_control_options


class KimodoContract(unittest.TestCase):
    def setUp(self):
        kimodo._state.update(model=None, key=None)

    def tearDown(self):
        kimodo._state.update(model=None, key=None)

    def test_invalid_options_fail_before_importing_torch(self):
        for extra in ({"seconds": float("nan")}, {"seconds": 31}, {"steps": 1.2},
                      {"seed": True}, {"motion_model": "Kimodo-SMPLX-RP-v1"},
                      {"text_encoder_device": "api"}, {"prompt": ""}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                validate_control_options("kimodo", {"prompt": "Dance.", **extra})
        with self.assertRaises(ValueError):
            validate_control_options("wanvideo", {"motion_model": kimodo.MODELS[0]})

    def test_model_or_encoder_change_reloads_and_cache_is_isolated(self):
        load = Mock(return_value=object())
        modules = {"torch": types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True)),
                   "kimodo": types.SimpleNamespace(load_model=load)}
        with tempfile.TemporaryDirectory() as root, patch.dict(sys.modules, modules), \
                patch.dict(os.environ, {"CHECKPOINT_DIR": "wrong", "TEXT_ENCODERS_DIR": "wrong"}), \
                patch.object(kimodo.common, "free_vram"):
            opts = {"prompt": "Dance."}
            kimodo.load(root, opts)
            kimodo.load(root, opts)
            self.assertEqual(load.call_count, 1)
            kimodo.load(root, {**opts, "text_encoder_device": "cpu"})
            kimodo.load(root, {**opts, "motion_model": kimodo.MODELS[1]})
            self.assertEqual(load.call_count, 3)
            self.assertEqual(load.call_args.args[0], kimodo.MODELS[1])
            self.assertEqual(os.environ["TEXT_ENCODER_MODE"], "local")
            self.assertTrue(os.environ["HF_HOME"].startswith(os.path.realpath(root)))
            self.assertNotIn("CHECKPOINT_DIR", os.environ)
            self.assertNotIn("TEXT_ENCODERS_DIR", os.environ)

    def test_prompt_periods_do_not_multiply_duration_and_export_is_standard_bvh(self):
        class FakeTensor:
            def to(self, *_): return self
            def __getitem__(self, _): return self
        class Skeleton30: pass
        skeleton = types.SimpleNamespace(root_idx=0)
        model = Mock(return_value={"posed_joints": [object()], "global_rot_mats": [object()]})
        model.fps, model.skeleton = 30, skeleton
        export = Mock()
        seed = Mock()
        modules = {
            "torch": types.SimpleNamespace(inference_mode=contextlib.nullcontext, from_numpy=lambda _: FakeTensor()),
            "kimodo": types.ModuleType("kimodo"),
            "kimodo.tools": types.SimpleNamespace(seed_everything=seed),
            "kimodo.exports": types.ModuleType("kimodo.exports"),
            "kimodo.exports.bvh": types.SimpleNamespace(save_motion_bvh=export),
            "kimodo.skeleton": types.SimpleNamespace(SOMASkeleton30=Skeleton30, global_rots_to_local_rots=lambda *_: FakeTensor()),
            "motion_correction": None,
        }
        kimodo._state.update(model=model, key=(kimodo.MODELS[0], "cuda"))
        with patch.dict(sys.modules, modules):
            meta = kimodo.generate("dance.bvh", {"prompt": "Dance. Turn. Smile.", "seconds": 5, "seed": 42}, Mock())
        self.assertEqual(model.call_args.args, (["Dance. Turn. Smile."], [150]))
        self.assertFalse(model.call_args.kwargs["post_processing"])
        self.assertFalse(meta["motion_correction"])
        self.assertEqual(meta["duration"], 5)
        self.assertEqual(export.call_args.kwargs["standard_tpose"], True)
        seed.assert_called_once_with(42)


if __name__ == "__main__":
    unittest.main()
