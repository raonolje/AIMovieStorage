"""CPU lifecycle regression: fake core only; no torch, server, model or GPU."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import uuid

BOOTSTRAP = Path(__file__).parents[1] / "src-tauri/resources/comfy-owned-bootstrap.py"
FAKE_SERVER = '''import asyncio
from pathlib import Path
class Routes:
    def __init__(self): self.handlers = {}
    def get(self, path): return lambda fn: self.handlers.setdefault(("GET", path), fn)
    def post(self, path): return lambda fn: self.handlers.setdefault(("POST", path), fn)
class Queue:
    busy = False
    def get_current_queue_volatile(self): return ([1], []) if self.busy else ([], [])
class PromptServer:
    def __init__(self):
        self.routes = Routes(); self.prompt_queue = Queue()
        self.loop = asyncio.get_running_loop()
    async def start_multi_address(self, *args, **kwargs):
        Path("ready-observed").write_text("ready")
'''
FAKE_WEB = '''class Response:
    def __init__(self, value, status): self.value=value; self.status=status
class Web:
    @staticmethod
    def json_response(value, status=200): return Response(value,status)
web = Web()
'''
FAKE_MAIN = '''import asyncio, _thread, os, sys, time
import threading
from pathlib import Path
assert not any(thread.name == "owned-stdin-control" for thread in threading.enumerate()), "stdin reader started before core import"
_thread.interrupt_main = lambda: Path("stop-observed").write_text("normal-interrupt")
if os.environ.get("CPU_HTTP_CASE"):
    class HeldInput:
        def __iter__(self):
            while True: time.sleep(0.01)
            yield "never"
    sys.stdin = HeldInput()
import server
async def run():
    s=server.PromptServer()
    await s.start_multi_address([])
    identity=await s.routes.handlers[("GET","/aimoviestorage/source_attestation")](None)
    assert identity.value["identityContractVersion"] == 2
    assert identity.value["pid"] == os.getpid()
    assert identity.value["parentPid"] == os.getppid()
    assert identity.value["managerPid"] > 0
    if os.environ.get("CPU_HTTP_CASE"):
        handler=s.routes.handlers[("POST","/aimoviestorage/stop")]
        class Request:
            content_length=40
            def __init__(self, nonce): self.nonce=nonce
            async def json(self): return {"nonce":self.nonce}
        statuses=[(await handler(Request("wrong"))).status]
        s.prompt_queue.busy=True
        statuses.append((await handler(Request("synthetic-only"))).status)
        assert not Path("stop-observed").exists()
        s.prompt_queue.busy=False
        statuses.append((await handler(Request("synthetic-only"))).status)
        Path("http-statuses.json").write_text(str(statuses))
    for _ in range(500):
        if Path("stop-observed").exists(): return
        await asyncio.sleep(0.01)
    raise RuntimeError("CPU normal-stop observer missing")
asyncio.run(run())
'''

class Lifecycle(unittest.TestCase):
    def fixture(self, stdin="", http=False, tamper=False):
        base=Path(os.environ["AIMS_BOOTSTRAP_CPU_ROOT"])
        self.assertTrue(base.is_absolute())
        root=base / str(uuid.uuid4())
        source=root / "source"
        (source / "aiohttp").mkdir(parents=True)
        files={"server.py":FAKE_SERVER,"main.py":FAKE_MAIN,"aiohttp/__init__.py":FAKE_WEB}
        for name,text in files.items(): (source / name).write_text(text,encoding="utf-8")
        bootstrap=BOOTSTRAP.read_bytes()
        (root / "bootstrap.py").write_bytes(bootstrap)
        record={"identityContractVersion":2,"managerPid":os.getpid(),"nonce":"synthetic-only","coreCommit":"0"*40,"sourceFingerprint":"0"*64,
                "bootstrapSha256":"0"*64 if tamper else hashlib.sha256(bootstrap).hexdigest(),
                "sourceFiles":{name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in files}}
        (root / "source-attestation.json").write_text(json.dumps(record),encoding="utf-8")
        env=dict(os.environ,PYTHONDONTWRITEBYTECODE="1",CPU_HTTP_CASE="1" if http else "")
        result=subprocess.run([sys.executable,"-B",str(root / "bootstrap.py")],input=stdin,text=True,
                              cwd=source,env=env,capture_output=True,timeout=15)
        (root / "cpu-result.json").write_text(json.dumps({"exitCode":result.returncode,"stdout":result.stdout,"stderr":result.stderr}),encoding="utf-8")
        return source,result
    def test_eof_during_startup_waits_for_ready(self):
        source,result=self.fixture()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue((source / "ready-observed").exists())
        self.assertEqual((source / "stop-observed").read_text(),"normal-interrupt")
    def test_stop_line_during_startup_waits_for_ready(self):
        source,result=self.fixture("stop\n")
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue((source / "stop-observed").exists())
    def test_http_checks_owned_identity_and_idle_queue(self):
        source,result=self.fixture(http=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((source / "http-statuses.json").read_text(),"[403, 409, 200]")
    def test_wrapper_change_blocks_before_core_import(self):
        source,result=self.fixture(tamper=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn("owned bootstrap changed",result.stderr)
        self.assertFalse((source / "ready-observed").exists())

if __name__ == "__main__": unittest.main()
