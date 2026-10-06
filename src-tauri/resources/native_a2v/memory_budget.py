"""프로세스 시작 전 RAM/commit 여유를 확인한다. OS 설정은 변경하지 않는다."""
import ctypes
import sys

GIB = 1024 ** 3
MIN_FREE_GIB = {"cpu": 98, "disk": 64}


def host_memory():
    if sys.platform != "win32":
        raise RuntimeError("host_memory_probe_unsupported: this verified native setup is Windows-only")
    class Memory(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
            (name, ctypes.c_ulonglong) for name in ("total", "available", "commitTotal",
                "commitAvailable", "virtualTotal", "virtualAvailable", "extendedAvailable")]
    value = Memory();value.length = ctypes.sizeof(value)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
        raise RuntimeError("host_memory_probe_failed")
    return {"available_physical_bytes": value.available,
            "available_commit_bytes": value.commitAvailable, "total_physical_bytes": value.total}


def validate_host_memory(mode, memory):
    if mode not in MIN_FREE_GIB:
        raise ValueError("unsupported_offload_mode")
    required = MIN_FREE_GIB[mode] * GIB
    if any(not isinstance(memory.get(key), int) or isinstance(memory.get(key), bool)
           or memory[key] < required for key in ("available_physical_bytes", "available_commit_bytes")):
        raise RuntimeError(f"insufficient_host_memory: {mode} requires {MIN_FREE_GIB[mode]} GiB available physical and commit")
    return {**memory, "offload_mode": mode, "required_free_host_bytes": required,
            "budget_nature": "conservative operational threshold, not measured disk inference peak",
            "os_settings_changed": False}
