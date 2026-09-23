"""GPU·가중치 다운로드 없이 연결된 모델 폴더의 캐시 경로를 검증합니다."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import common


class CachePathTests(unittest.TestCase):
    def test_directory_link_uses_canonical_cache_and_keeps_weights(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            actual = base / "실제 모델"
            actual.mkdir()
            linked = base / "linked"
            try:
                linked.symlink_to(actual, target_is_directory=True)
            except OSError as error:
                self.skipTest(f"directory symlink unavailable: {error}")
            weight = actual / "models" / "hub" / "weight.bin"
            weight.parent.mkdir(parents=True)
            weight.write_bytes(b"existing model")
            with patch.dict(os.environ), patch.object(common, "_avoid_symlinks"):
                returned = common.use_engine_cache(str(linked))
                self.assertEqual(returned, str(actual / "models"))
                self.assertEqual(common._engine_root["path"], str(actual))
                for key in ("HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE"):
                    self.assertEqual(os.environ[key], str(actual / "models" / "hub"))
                self.assertEqual(weight.read_bytes(), b"existing model")

    def test_relative_root_has_same_cache_as_absolute_root(self):
        with tempfile.TemporaryDirectory(dir=".") as temp:
            with patch.dict(os.environ), patch.object(common, "_avoid_symlinks"):
                result = common.use_engine_cache(os.path.relpath(temp))
                self.assertEqual(result, str(Path(temp).resolve() / "models"))


if __name__ == "__main__":
    unittest.main()
