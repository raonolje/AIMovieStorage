# -*- coding: utf-8 -*-
"""GPU 없이 실제 워커 요청 루프의 성공/실패 뒤 캐시 정리를 검사합니다."""
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
spec = importlib.util.spec_from_file_location("memory_test_common", HERE / "common.py")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)


class MemoryCleanupTests(unittest.TestCase):
    def test_gpu_usage_is_total_usage_not_only_this_allocator(self):
        cuda = types.SimpleNamespace(is_available=lambda: True, mem_get_info=lambda: (25, 100),
                                     memory_allocated=lambda: 10, memory_reserved=lambda: 20)
        with patch.dict(sys.modules, {"torch": types.SimpleNamespace(cuda=cuda)}):
            measured = common.memory_usage()
        self.assertEqual(measured["vram_used_percent"], 75)
        self.assertEqual(measured["vram_allocated_bytes"], 10)
        self.assertEqual(measured["vram_reserved_bytes"], 20)
        if measured["ram_used_percent"] is not None:
            self.assertGreaterEqual(measured["ram_used_percent"], 0)
            self.assertLessEqual(measured["ram_used_percent"], 100)

    def test_unknown_gpu_usage_is_not_reported_as_zero(self):
        cuda = types.SimpleNamespace(is_available=lambda: False)
        with patch.dict(sys.modules, {"torch": types.SimpleNamespace(cuda=cuda)}):
            self.assertIsNone(common.memory_usage()["vram_used_percent"])

    def test_real_worker_cleans_after_success_load_failure_and_generate_failure(self):
        bootstrap = r'''
import importlib.util, pathlib, sys
worker_path, root = sys.argv[1:]
sys.path.insert(0, str(pathlib.Path(worker_path).parent))
spec = importlib.util.spec_from_file_location("cleanup_test_worker", worker_path)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
cleanups = []
worker.common.torch_info = lambda: {"cuda":False}
worker.common.free_vram = lambda: cleanups.append("cleaned")
worker.common.memory_usage = lambda: {"ram_used_percent":70,"vram_used_percent":40,"cleanup_count":len(cleanups)}
class Engine:
    def load(self, root, opts):
        if opts.get("fail") == "load": raise RuntimeError("load failed")
    def generate(self, output, opts, report):
        if opts.get("fail") == "generate": raise RuntimeError("generate failed")
        pathlib.Path(output).write_bytes(b"completed output")
        return {}
    def unload(self): pass
worker.load_engine = lambda _: Engine()
sys.argv = [worker_path,"--engine","test","--root",root]
raise SystemExit(worker.main())
'''
        with tempfile.TemporaryDirectory() as folder:
            output = str(pathlib.Path(folder) / "result.png")
            requests = [
                {"id": "1", "op": "generate", "output": output, "opts": {}},
                {"id": "2", "op": "generate", "output": output, "opts": {"fail": "load"}},
                {"id": "3", "op": "generate", "output": output, "opts": {"fail": "generate"}},
                {"id": "4", "op": "generate", "output": output, "opts": {}},
                {"id": "q", "op": "quit"},
            ]
            done = subprocess.run([sys.executable, "-X", "utf8", "-u", "-c", bootstrap, str(HERE / "worker.py"), folder],
                                  input="".join(json.dumps(item) + "\n" for item in requests),
                                  text=True, capture_output=True, encoding="utf-8", timeout=15)
            self.assertEqual(done.returncode, 0, done.stderr)
            results = {item["id"]: item for item in map(json.loads, done.stdout.splitlines()) if item["event"] in ("done", "error")}
            self.assertEqual(results["1"]["memory"]["cleanup_count"], 1)
            self.assertEqual(results["2"]["event"], "error")
            self.assertEqual(results["3"]["event"], "error")
            self.assertEqual(results["4"]["memory"]["cleanup_count"], 4)
            self.assertEqual(pathlib.Path(output).read_bytes(), b"completed output")


if __name__ == "__main__":
    unittest.main()
