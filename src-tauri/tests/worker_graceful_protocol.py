"""실제 배포 worker.py의 유휴 종료 분기를 모델 없는 소유 CPU 자식으로 검사합니다."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import types


def child(worker, root):
    calls = []
    common = types.ModuleType("common")
    common.log = lambda *args: None
    common.use_engine_cache = lambda *args: None
    common.torch_info = lambda: {"cuda": False, "device": "CPU fixture", "torch": "not-imported", "vram_gb": 0}
    sys.modules["common"] = common
    policy = types.ModuleType("control_policy")
    policy.validate_control_options = lambda *args, **kwargs: calls.append("generation-policy")
    sys.modules["control_policy"] = policy
    local_only = types.ModuleType("local_only_policy")
    local_only.generation_scope = lambda *args: calls.append("generation-scope")
    sys.modules["local_only_policy"] = local_only
    package = types.ModuleType("engines")
    package.__path__ = []
    engine = types.ModuleType("engines.cpu_fixture")
    engine.abort = lambda: calls.append("abort")
    engine.unload = lambda: calls.append("unload")
    sys.modules["engines"] = package
    sys.modules["engines.cpu_fixture"] = engine
    sys.argv = [worker, "--engine", "cpu_fixture", "--root", root]
    scope = {"__name__": "cpu_owned_protocol", "__file__": worker}
    exec(compile(pathlib.Path(worker).read_text(encoding="utf-8"), worker, "exec"), scope)
    code = scope["main"]()
    assert code == 0
    assert calls == [], "유휴 종료가 abort/unload/생성 경로를 호출했습니다: " + repr(calls)
    assert "torch" not in sys.modules
    return 0


def parent():
    source = pathlib.Path(__file__).resolve().parents[1]
    results = []
    for family in ("local", "upscale"):
        for eof_only in (False, True):
            worker = source / "resources" / family / "worker.py"
            with tempfile.TemporaryDirectory(prefix="aimovie-grace-cpu-") as root:
                # 격리 표준 라이브러리만 씁니다. 기존 토큰·키·Torch·모델은 읽지 않습니다.
                env = {key: value for key, value in os.environ.items() if key not in {"HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "CIVITAI_API_KEY"}}
                process = subprocess.Popen([sys.executable, "-I", "-S", __file__, "--owned-child", str(worker), root], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", env=env)
                if not eof_only:
                    process.stdin.write(json.dumps({"id": "cpu-quit", "op": "quit_idle"}) + "\n")
                    process.stdin.flush()
                process.stdin.close()
                try:
                    exit_code = process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    raise RuntimeError("CPU 소유 자식 종료 미확인; 강제 종료하지 않았습니다. PID=" + str(process.pid))
                output = process.stdout.read()
                stderr = process.stderr.read()
                assert exit_code == 0, stderr
                messages = [json.loads(line) for line in output.splitlines() if line.strip()]
                assert messages[0]["event"] == "ready" and messages[0]["cuda"] is False
                if not eof_only:
                    assert any(item.get("event") == "done" and item.get("graceful_only") is True for item in messages)
                results.append({"family": family, "eofOnly": eof_only, "exitCode": exit_code, "modelLoaded": False, "torchImported": False, "forcedTermination": False})
    print(json.dumps({"passed": len(results), "failed": 0, "results": results}))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--owned-child":
        sys.exit(child(sys.argv[2], sys.argv[3]))
    parent()
