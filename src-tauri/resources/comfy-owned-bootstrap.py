"""Run only the app's copied core; stdin stop requests a normal KeyboardInterrupt."""
import hashlib
import json
import os
import pathlib
import runpy
import sys
import threading
import _thread
import importlib.abc
import importlib.machinery
import importlib.util
import time

root = pathlib.Path(__file__).parent / "source"
record = json.loads((root.parent / "source-attestation.json").read_text(encoding="utf-8"))
if record.get("identityContractVersion") != 2 or not isinstance(record.get("managerPid"), int) or record["managerPid"] <= 0:
    raise RuntimeError("owned launch identity contract missing")
stop_requested = threading.Event()
server_ready = threading.Event()
owned_server = None
sys.path.insert(0, str(root))
sys.argv[0] = str(root / "main.py")

def unchanged():
    if hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest() != record["bootstrapSha256"]:
        raise RuntimeError("owned bootstrap changed")
    for name, expected in record["sourceFiles"].items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError("owned source changed: " + name)

unchanged()

# Let main.py parse its flags and initialize devices before it imports server.
# Eagerly importing server would freeze default flags and load torch too early.
class OwnedServerLoader(importlib.machinery.SourceFileLoader):
    def exec_module(self, module):
        super().exec_module(module)
        from aiohttp import web
        original_init = module.PromptServer.__init__
        original_start = module.PromptServer.start_multi_address

        def owned_init(self, *args, **kwargs):
            original_init(self, *args, **kwargs)
            async def attestation(request):
                unchanged()
                return web.json_response({"identityContractVersion": 2,
                                          "managerPid": record["managerPid"],
                                          "nonce": record["nonce"], "pid": os.getpid(),
                                          "parentPid": os.getppid(),
                                          "coreCommit": record["coreCommit"],
                                          "sourceFingerprint": record["sourceFingerprint"],
                                          "bootstrapSha256": record["bootstrapSha256"],
                                          "registrySha256": record["registrySha256"],
                                          "reviewedPresetIds": record["reviewedPresetIds"]})
            self.routes.get("/aimoviestorage/source_attestation")(attestation)
            async def stop(request):
                if request.content_length is None or request.content_length > 1024:
                    return web.json_response({"error": "invalid-stop-request"}, status=400)
                payload = await request.json()
                if payload != {"nonce": record["nonce"]}:
                    return web.json_response({"error": "owned-identity-mismatch"}, status=403)
                running, queued = self.prompt_queue.get_current_queue_volatile()
                if running or queued:
                    return web.json_response({"error": "owned-queue-busy"}, status=409)
                stop_requested.set()
                return web.json_response({"state": "normal-stop-requested"})
            self.routes.post("/aimoviestorage/stop")(stop)

        async def owned_start(self, *args, **kwargs):
            global owned_server
            await original_start(self, *args, **kwargs)
            owned_server = self
            server_ready.set()
            # Do not block on stdin while Windows initializes Torch's C++
            # extension/stdio. Pending stop bytes and EOF remain in the pipe.
            threading.Thread(target=control, name="owned-stdin-control", daemon=True).start()
            threading.Thread(target=normal_stop, name="owned-normal-stop", daemon=True).start()

        module.PromptServer.__init__ = owned_init
        module.PromptServer.start_multi_address = owned_start

class OwnedServerFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "server":
            return importlib.util.spec_from_file_location(
                fullname, root / "server.py", loader=OwnedServerLoader(fullname, str(root / "server.py")))
        return None

sys.meta_path.insert(0, OwnedServerFinder())

def control():
    if os.name == "nt" and hasattr(sys.stdin, "fileno"):
        # Peek our own inherited pipe before reading. A blocking TextIO stdin
        # reader can hold a CRT stdio lock needed by later C++ DLL imports.
        import ctypes
        from ctypes import wintypes
        import msvcrt
        peek = ctypes.WinDLL("kernel32", use_last_error=True).PeekNamedPipe
        peek.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                         wintypes.LPDWORD, wintypes.LPDWORD, wintypes.LPDWORD]
        peek.restype = wintypes.BOOL
        fd = sys.stdin.fileno()
        handle = msvcrt.get_osfhandle(fd)
        pending = b""
        while not stop_requested.is_set():
            available = wintypes.DWORD()
            if not peek(handle, None, 0, None, ctypes.byref(available), None):
                # Broken/closed original stdin is EOF; never inspect a process
                # or an unrelated handle to recover it.
                stop_requested.set()
                return
            if available.value:
                data = os.read(fd, min(available.value, 65536))
                if not data:
                    stop_requested.set()
                    return
                pending += data
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    if line.strip() == b"stop":
                        stop_requested.set()
                        return
                if len(pending) > 1024:
                    stop_requested.set()
                    return
            else:
                stop_requested.wait(0.05)
        return
    for line in sys.stdin:
        if line.strip() == "stop":
            stop_requested.set()
            return
    stop_requested.set()

def normal_stop():
    stop_requested.wait()
    # EOF during imports must not be swallowed by an optional-node import.
    server_ready.wait()
    while True:
        running, queued = owned_server.prompt_queue.get_current_queue_volatile()
        if not running and not queued:
            owned_server.loop.call_soon_threadsafe(_thread.interrupt_main)
            return
        time.sleep(0.5)

runpy.run_path(str(root / "main.py"), run_name="__main__")
