import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from sdk_bootstrap import verify_sdk

ROOT = Path(__file__).parent / "sdk_candidate"
DIGEST = hashlib.sha256((ROOT / "manifest.json").read_bytes()).hexdigest()


class BootstrapTests(unittest.TestCase):
    def test_actual_bundle_verified_without_importing_models(self):
        result = verify_sdk(ROOT, DIGEST)
        self.assertEqual(result["sourceFilesVerified"], 248)
        self.assertTrue(result["processLocalOnly"])

    def test_manifest_or_file_tamper_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "manifest_hash"):
            verify_sdk(ROOT, "bad")
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "ltx_core").mkdir()
            f = root / "ltx_core/__init__.py"
            f.write_text("different")
            payload = json.dumps({"schema": "aistorage-bundled-native-sdk-v1", "files": [{"file": "ltx_core/__init__.py", "sha256": "bad"}]}).encode()
            (root / "manifest.json").write_bytes(payload)
            with self.assertRaisesRegex(ValueError, "file_hash"):
                verify_sdk(root, hashlib.sha256(payload).hexdigest())

    def test_escape_and_unlisted_source_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            payload = json.dumps({"schema": "aistorage-bundled-native-sdk-v1", "files": [{"file": "ltx_core/../outside.py", "sha256": "bad"}]}).encode()
            (root / "manifest.json").write_bytes(payload)
            with self.assertRaisesRegex(ValueError, "path_invalid"):
                verify_sdk(root, hashlib.sha256(payload).hexdigest())

    def test_fresh_worker_binds_before_import_without_cuda(self):
        script = "from sdk_bootstrap import activate_if_configured; b=activate_if_configured(); import ltx_core.memory_observer as m; import sys,json; print(json.dumps({'binding':b,'observer':m.__file__,'torchImported':'torch' in sys.modules}))"
        env = os.environ.copy()
        env["AISTORAGE_NATIVE_SDK_ROOT"], env["AISTORAGE_NATIVE_SDK_MANIFEST_SHA256"] = str(ROOT.resolve()), DIGEST
        result = subprocess.run([sys.executable, "-c", script], cwd=ROOT.parent, env=env, text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertFalse(value["torchImported"])
        self.assertTrue(Path(value["observer"]).is_relative_to(ROOT.resolve()))

    def test_execute_without_binding_rejected_before_request_or_grant_read(self):
        import a2v_worker
        from unittest.mock import patch
        with patch.object(a2v_worker, "SDK_BINDING", None), patch.object(sys, "argv", ["worker", "--execute", "--request", "missing", "--environment", "missing", "--output-directory", "missing"]):
            with self.assertRaisesRegex(RuntimeError, "bundled_sdk_binding_required"):
                a2v_worker.main()
