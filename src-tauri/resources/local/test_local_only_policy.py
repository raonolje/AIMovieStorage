"""모델을 올리지 않고 작업자 경계와 실패 폐쇄를 검사합니다."""
import ast
import io
import json
import os
from pathlib import Path
import socket
import sys
import types
import tempfile
import unittest
from unittest.mock import patch
import local_only_policy as policy

ROOT = Path(__file__).parent


class LocalOnlyTests(unittest.TestCase):
    def test_default_and_explicit_policy(self):
        policy.require_policy({})
        policy.require_policy({"network_policy": "local-only"})
        for request in [{"network_policy": "online"}, {"opts": {"local_files_only": False}}]:
            with self.assertRaises(policy.LocalOnlyError): policy.require_policy(request)

    def test_environment_and_imported_hub_restore(self):
        constants = types.ModuleType("huggingface_hub.constants")
        constants.HF_HUB_OFFLINE = False
        with patch.dict(sys.modules, {"huggingface_hub.constants": constants}), patch.dict(os.environ, {"HF_HUB_OFFLINE": "0"}):
            with policy.generation_scope({}):
                self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
                self.assertEqual(os.environ["TRANSFORMERS_OFFLINE"], "1")
                self.assertTrue(constants.HF_HUB_OFFLINE)
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "0")
            self.assertFalse(constants.HF_HUB_OFFLINE)

    def test_socket_calls_fail_before_transport(self):
        # 실제 주소에 연결하지 않습니다. 가짜 목적지까지 정책 함수가 먼저 거절해야 합니다.
        with policy.generation_scope({}), socket.socket() as sock:
            for callback in [lambda: sock.connect(("invalid.example", 443)),
                             lambda: sock.connect_ex(("invalid.example", 443)),
                             lambda: socket.create_connection(("invalid.example", 443)),
                             lambda: sock.sendto(b"x", ("invalid.example", 443)),
                             lambda: sock.send(b"x"), lambda: sock.sendall(b"x"),
                             lambda: socket.getaddrinfo("invalid.example", 443),
                             lambda: socket.gethostbyname("invalid.example")]:
                with self.assertRaisesRegex(policy.LocalOnlyError, "차단"): callback()

    def test_exception_restores_socket(self):
        original = socket.socket.connect
        with self.assertRaises(ValueError):
            with policy.generation_scope({}): raise ValueError("fake inference failure")
        self.assertIs(socket.socket.connect, original)

    def test_missing_file_error_does_not_fetch(self):
        class LocalEntryNotFoundError(Exception): pass
        with self.assertRaisesRegex(policy.LocalOnlyError, "다운로드하지 않았습니다"):
            with policy.generation_scope({}): raise LocalEntryNotFoundError("missing shard")

    def test_missing_diffusers_component_error_is_explicit(self):
        with self.assertRaisesRegex(policy.LocalOnlyError, "다운로드하지 않았습니다"):
            with policy.generation_scope({}):
                raise OSError("Error no file named diffusion_pytorch_model.safetensors found in directory")

    def test_loader_contracts(self):
        for file in ["engines/ltx25.py", "engines/wanvideo.py"]:
            tree = ast.parse((ROOT / file).read_text(encoding="utf8"))
            loaders = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "from_pretrained"]
            self.assertTrue(loaders)
            for call in loaders:
                self.assertTrue(any(k.arg is None and isinstance(k.value, ast.Call) and isinstance(k.value.func, ast.Name) and k.value.func.id == "local_load_kwargs" for k in call.keywords))
        self.assertEqual(policy.local_load_kwargs(), {"local_files_only": True})

    def test_real_hub_missing_cache_fails_without_network(self):
        from huggingface_hub import snapshot_download
        with tempfile.TemporaryDirectory() as cache:
            with self.assertRaisesRegex(policy.LocalOnlyError, "다운로드하지 않았습니다"):
                with policy.generation_scope({}):
                    snapshot_download("offline-contract/missing-model", cache_dir=cache, **policy.local_load_kwargs())

    def test_real_hub_present_cache_resolves_without_network(self):
        from huggingface_hub import snapshot_download
        with tempfile.TemporaryDirectory() as cache:
            root = Path(cache) / "models--offline-contract--present-model"
            revision = "a" * 40
            (root / "refs").mkdir(parents=True)
            (root / "refs" / "main").write_text(revision, encoding="utf8")
            (root / "snapshots" / revision).mkdir(parents=True)
            (root / "snapshots" / revision / "config.json").write_text("{}", encoding="utf8")
            with policy.generation_scope({}):
                resolved = snapshot_download("offline-contract/present-model", cache_dir=cache, **policy.local_load_kwargs())
            self.assertEqual(Path(resolved), root / "snapshots" / revision)

    def test_rust_request_is_immutable_local_only(self):
        rust = (ROOT.parents[1] / "src" / "upscale.rs").read_text(encoding="utf8")
        self.assertIn('"network_policy": "local-only"', rust)

    def test_worker_errors_and_prefetch_separation(self):
        # 실제 common/torch/엔진을 import하지 않고 동일 main과 JSON 응답 경로를 실행합니다.
        common = types.ModuleType("common")
        common.use_engine_cache = lambda root: None
        common.log = lambda *args: None
        common.torch_info = lambda: {"cuda": False}
        common.free_vram = lambda: None
        common.memory_usage = lambda: {}
        controls = types.ModuleType("control_policy")
        controls.validate_control_options = lambda *args, **kwargs: None
        class FakeEngine:
            def load(self, root, opts):
                self.saw_offline = os.environ.get("HF_HUB_OFFLINE") == "1"
                socket.create_connection(("invalid.example", 443))
            def prefetch(self, root, report): self.prefetch_called = True
        engine = FakeEngine()
        output = io.StringIO()
        namespace = {"__name__": "worker_contract", "__file__": str(ROOT / "worker.py")}
        with patch.dict(sys.modules, {"common": common, "control_policy": controls}), patch.object(sys, "stdout", output):
            exec(compile((ROOT / "worker.py").read_text(encoding="utf8"), str(ROOT / "worker.py"), "exec"), namespace)
            namespace["load_engine"] = lambda name: engine
            namespace["_take_stdin"] = lambda: iter([])
            namespace["_requests"] = lambda _: iter([
                {"id": "load", "op": "load", "network_policy": "local-only"},
                {"id": "weaken", "op": "load", "network_policy": "online"},
                {"id": "prefetch", "op": "prefetch"},
            ])
            with patch.object(sys, "argv", ["worker.py", "--engine", "fake", "--root", "."]): namespace["main"]()
        replies = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertTrue(engine.saw_offline)
        self.assertTrue(engine.prefetch_called)
        self.assertEqual(next(r for r in replies if r["id"] == "load")["event"], "error")
        self.assertIn("차단", next(r for r in replies if r["id"] == "load")["message"])
        self.assertEqual(next(r for r in replies if r["id"] == "weaken")["event"], "error")
        self.assertTrue(next(r for r in replies if r["id"] == "prefetch")["prefetched"])


if __name__ == "__main__": unittest.main()
