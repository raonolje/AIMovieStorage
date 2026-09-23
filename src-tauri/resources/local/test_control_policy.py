# -*- coding: utf-8 -*-
"""다운로드·GPU 없이 동작 제어 검증, 시간축, 포즈 로라 수명을 확인합니다."""
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from control_policy import validate_control_options
from engines import ltx25


class FakePipe:
    def __init__(self):
        self.loaded = []
        self.active = []
        self.received = None

    def unload_lora_weights(self):
        self.active = []

    def load_lora_weights(self, *args, **kwargs):
        self.loaded.append(kwargs["adapter_name"])

    def set_adapters(self, names, adapter_weights):
        self.active = list(zip(names, adapter_weights))

    def __call__(self, reference_conditions=None, conditions=None, reference_downscale_factor=1, **kwargs):
        self.received = reference_conditions
        self.kwargs = dict(kwargs, reference_downscale_factor=reference_downscale_factor, conditions=conditions)
        return types.SimpleNamespace(frames=[["완료 프레임"]])


class ControlPolicyTests(unittest.TestCase):
    def setUp(self):
        self.previous = dict(ltx25._state)
        ltx25._state.update(pipe=None, mode=None, loras=[], plan=None, pose=False, repo=None)

    def tearDown(self):
        ltx25._state.update(self.previous)

    def test_unsupported_engines_do_not_silently_ignore_pose(self):
        for engine in ("wanvideo", "minimaxh3", "qwenimage"):
            with self.subTest(engine=engine), self.assertRaisesRegex(ValueError, "모캡 뼈 프레임"):
                validate_control_options(engine, {"control": {"kind": "pose", "frames": ["one.png"]}})

    def test_invalid_control_is_rejected_and_zero_weight_is_valid(self):
        valid = {"kind": "pose", "frames": ["one.png"], "weight": 0, "fps": 24}
        validate_control_options("ltx25", {"control": valid})
        for control in ({}, [], dict(valid, frames=[]), dict(valid, weight=True), dict(valid, fps=0), dict(valid, weight=float("nan"))):
            with self.subTest(control=control), self.assertRaises(ValueError):
                validate_control_options("ltx25", {"control": control})

    def test_missing_pose_file_is_reported_before_model_load(self):
        with self.assertRaisesRegex(IOError, "뼈 그림"):
            validate_control_options("ltx25", {"control": {"kind": "pose", "frames": [str(HERE / "does-not-exist.png")]}}, check_files=True)

    def test_reference_video_is_not_pose_control(self):
        reference = {"references": [{"kind": "video", "path": "dance.mp4"}], "reference_video_range": "full"}
        validate_control_options("minimaxh3", reference)
        with self.assertRaisesRegex(ValueError, "레퍼런스 목록"):
            validate_control_options("ltx25", reference)

    def test_pose_frames_keep_motion_time_when_fps_differs(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as folder:
            paths = []
            for index in range(24):
                name = str(pathlib.Path(folder) / "{}.png".format(index))
                Image.new("RGB", (2, 2), (index, 0, 0)).save(name)
                paths.append(name)
            opts = {"control": {"kind": "pose", "frames": paths, "fps": 24}}
            frames = ltx25._pose_frames(opts, 2, 2, 18, 16)
            self.assertEqual([frame.getpixel((0, 0))[0] for frame in frames],
                             [0, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 21, 23, 23, 23])
            del opts["control"]["fps"]
            self.assertEqual([frame.getpixel((0, 0))[0] for frame in ltx25._pose_frames(opts, 2, 2, 3, 16)], [0, 1, 2])

    def test_style_change_reloads_pose_and_keeps_both_adapters_active(self):
        pipe = FakePipe()
        ltx25._state.update(pipe=pipe, pose=True)
        with tempfile.TemporaryDirectory() as folder:
            style = pathlib.Path(folder) / "style.safetensors"
            style.write_bytes("검증용 파일".encode("utf-8"))
            with patch.object(ltx25.common, "guard_lora_family"), patch.object(ltx25.common, "check_loras", return_value=1):
                ltx25._apply_loras({"loras": [{"path": str(style), "weight": 0.6}]})
            self.assertFalse(ltx25._state["pose"])
            ltx25._attach_pose(pipe, {})
            self.assertEqual(pipe.loaded, ["lora0", "pose"])
            self.assertEqual(pipe.active, [("lora0", 0.6), ("pose", 1.0)])
            self.assertTrue(ltx25._state["pose"])

    def test_zero_control_weight_reaches_reference_condition(self):
        pipe = FakePipe()
        ltx25._state["pipe"] = pipe
        condition_module = types.ModuleType("diffusers.pipelines.ltx2")
        condition_module.LTX2ReferenceCondition = lambda **kwargs: types.SimpleNamespace(**kwargs)
        utils_module = types.ModuleType("diffusers.pipelines.ltx2.utils")
        utils_module.DISTILLED_SIGMA_VALUES = [1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875]
        ltx25._state["repo"] = ltx25.REPO
        with patch.dict(sys.modules, {"diffusers.pipelines.ltx2": condition_module, "diffusers.pipelines.ltx2.utils": utils_module}), \
                patch.object(ltx25, "_pose_frames", return_value=["뼈 그림"]), \
                patch.multiple(ltx25.common, check_motion_mask=lambda _: None, resolve_seed=lambda _: 1,
                               generator=lambda _: None, step_reporter=lambda *_: None,
                               run_attention_safe=lambda _, call: call(), freeze_by_mask=lambda frames, _: frames,
                               save_video=lambda *_: None, precision_fields=lambda _: {}):
            result = ltx25.generate("unused.mp4", {"control": {"weight": 0}, "seconds": 1, "fps": 16, "steps": 30, "guidance": 3}, lambda *_: None)
        self.assertEqual(pipe.received[0].strength, 0)
        self.assertEqual(pipe.kwargs["reference_downscale_factor"], 2)
        self.assertEqual(pipe.kwargs["sigmas"], utils_module.DISTILLED_SIGMA_VALUES)
        self.assertNotIn("num_inference_steps", pipe.kwargs)
        self.assertEqual([pipe.kwargs[key] for key in ("guidance_scale", "audio_guidance_scale", "modality_scale", "audio_modality_scale")], [1, 1, 1, 1])
        self.assertEqual([pipe.kwargs[key] for key in ("stg_scale", "audio_stg_scale")], [0, 0])
        self.assertEqual(result["inference_steps"], 8)
        self.assertEqual(result["guidance_scale"], 1)

    def test_union_adapter_is_the_official_22b_half_reference_model(self):
        pipe = FakePipe()
        with patch.object(pipe, "load_lora_weights") as load:
            ltx25._attach_pose(pipe, {})
        load.assert_called_once_with("Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control",
                                     weight_name="ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors", adapter_name="pose")

    def test_missing_pyav_fails_before_precision_or_model_load(self):
        with patch("importlib.util.find_spec", return_value=None), patch.object(ltx25.common, "plan_precision") as plan:
            with self.assertRaisesRegex(RuntimeError, "PyAV"):
                ltx25.load("unused", {"image": "first.png"})
            plan.assert_not_called()
            ltx25._require_image_codec({})

    def test_pyav_present_allows_image_preflight(self):
        with patch("importlib.util.find_spec", return_value=object()):
            ltx25._require_image_codec({"image": "first.png"})

    def test_development_repo_keeps_non_distilled_parameters(self):
        ltx25._state["repo"] = "diffusers/LTX-2.3-Diffusers"
        self.assertEqual(ltx25._sampling_options({"steps": 12, "guidance": 0}),
                         {"num_inference_steps": 12, "guidance_scale": 0})

    def test_union_half_size_remains_vae_aligned(self):
        opts = {"width": 960, "height": 544}
        self.assertEqual(ltx25._output_size(opts), (960, 544))
        self.assertEqual(ltx25._output_size(dict(opts, control={"frames": ["pose.png"]})), (960, 512))

    def test_pipeline_without_half_reference_support_is_rejected(self):
        class OldPipe:
            def __call__(self, reference_conditions=None): pass
        self.assertIsNone(ltx25._pose_kwarg(OldPipe))
        self.assertEqual(ltx25._pose_kwarg(FakePipe), "reference_conditions")

    def test_worker_rejects_control_before_calling_engine_load(self):
        bootstrap = r'''
import importlib.util, pathlib, sys
worker_path, root = sys.argv[1:]
sys.path.insert(0, str(pathlib.Path(worker_path).parent))
spec = importlib.util.spec_from_file_location("control_test_worker", worker_path)
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
worker.common.torch_info = lambda: {"cuda":False}
worker.common.free_vram = lambda: None
worker.common.memory_usage = lambda: {}
class Engine:
    loads = 0
    def load(self, root, opts): self.loads += 1
    def generate(self, output, opts, report):
        pathlib.Path(output).write_bytes(b"ok")
        return {"loads": self.loads}
    def unload(self): pass
worker.load_engine = lambda _: Engine()
sys.argv = [worker_path,"--engine","wanvideo","--root",root]
raise SystemExit(worker.main())
'''
        with tempfile.TemporaryDirectory() as folder:
            output = str(pathlib.Path(folder) / "output.mp4")
            messages = [{"id": "bad", "op": "generate", "output": output, "opts": {"control": {"kind": "pose", "frames": ["ignored.png"]}}},
                        {"id": "good", "op": "generate", "output": output, "opts": {}}, {"id": "q", "op": "quit"}]
            done = subprocess.run([sys.executable, "-X", "utf8", "-u", "-c", bootstrap, str(HERE / "worker.py"), folder],
                                  input="".join(json.dumps(m) + "\n" for m in messages), text=True, capture_output=True, encoding="utf-8", timeout=15)
            self.assertEqual(done.returncode, 0, done.stderr)
            replies = {m["id"]: m for m in map(json.loads, done.stdout.splitlines()) if m["event"] in ("done", "error")}
            self.assertEqual(replies["bad"]["event"], "error")
            self.assertEqual(replies["good"]["loads"], 1)


if __name__ == "__main__":
    unittest.main()
