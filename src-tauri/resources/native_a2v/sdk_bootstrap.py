"""Verify app-bundled SDK source and activate only this child process's path."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys

ROOT_ENV = "AISTORAGE_NATIVE_SDK_ROOT"
HASH_ENV = "AISTORAGE_NATIVE_SDK_MANIFEST_SHA256"


def verify_sdk(root, expected_hash):
    root = Path(root).resolve(strict=True)
    manifest_file = root / "manifest.json"
    payload = manifest_file.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != expected_hash:
        raise ValueError("bundled_sdk_manifest_hash_mismatch")
    manifest = json.loads(payload)
    if manifest.get("schema") != "aistorage-bundled-native-sdk-v1" or not isinstance(manifest.get("files"), list):
        raise ValueError("bundled_sdk_manifest_invalid")
    listed = set()
    for item in manifest["files"]:
        relative = item.get("file", "")
        parts = PurePosixPath(relative).parts
        if not parts or parts[0] not in ("ltx_core", "ltx_pipelines") or ".." in parts or "\\" in relative or not relative.endswith(".py"):
            raise ValueError("bundled_sdk_path_invalid")
        if relative in listed:
            raise ValueError("bundled_sdk_duplicate_file")
        listed.add(relative)
        target = (root / relative).resolve(strict=True)
        if not target.is_relative_to(root) or not target.is_file():
            raise ValueError("bundled_sdk_path_escape")
        if hashlib.sha256(target.read_bytes()).hexdigest() != item.get("sha256"):
            raise ValueError("bundled_sdk_file_hash_mismatch:" + relative)
    actual = {p.relative_to(root).as_posix() for p in root.rglob("*.py")}
    if actual != listed or not {"ltx_core/__init__.py", "ltx_pipelines/__init__.py", "ltx_core/memory_observer.py"}.issubset(listed):
        raise ValueError("bundled_sdk_file_set_mismatch")
    return {"sdkRoot": str(root), "manifestSha256": digest, "sourceCommit": manifest.get("sourceCommit"),
            "candidateId": manifest.get("candidateId"), "sourceFilesVerified": len(listed), "processLocalOnly": True}


def activate_if_configured():
    root, digest = os.environ.get(ROOT_ENV), os.environ.get(HASH_ENV)
    if root is None and digest is None:
        return None
    if not root or not digest:
        raise ValueError("bundled_sdk_binding_incomplete")
    if any(name == "torch" or name == "ltx_core" or name.startswith("ltx_core.") or name == "ltx_pipelines" or name.startswith("ltx_pipelines.") for name in sys.modules):
        raise ValueError("bundled_sdk_must_activate_before_imports")
    binding = verify_sdk(root, digest)
    sys.dont_write_bytecode = True
    sys.path.insert(0, binding["sdkRoot"])
    return binding
