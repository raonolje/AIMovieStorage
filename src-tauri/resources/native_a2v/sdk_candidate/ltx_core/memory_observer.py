"""Scoped, read-only diagnostics. Never imports torch or initializes CUDA."""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
import ctypes
from ctypes import wintypes
import inspect
import json
import os
import sys
import time

_sink = ContextVar("ltx_memory_observer", default=None)


@contextmanager
def observe_with(sink):
    token = _sink.set(sink)
    try:
        yield
    finally:
        _sink.reset(token)


def emit(event, **details):
    sink = _sink.get()
    if sink is not None:
        try:
            sink(event, details)
        except Exception:
            # Observation must never replace an inference/cleanup outcome.
            pass


@contextmanager
def memory_phase(name, **details):
    emit(name + ".begin", **details)
    try:
        yield
    except BaseException as error:
        emit(name + ".error", errorType=type(error).__name__, **details)
        raise
    finally:
        emit(name + ".end", **details)


def observe_phase(name):
    def decorate(fn):
        def info(args):
            owner = args[0] if args else None
            phase = getattr(owner, "_memory_phase", name)
            details = {"ownerType": type(owner).__name__}
            paths = getattr(owner, "_model_path", None)
            if paths is not None:
                details["checkpointPaths"] = paths
            return phase, details
        if inspect.isgeneratorfunction(fn):
            @wraps(fn)
            def generate(*args, **kwargs):
                phase, details = info(args)
                with memory_phase(phase, **details):
                    yield from fn(*args, **kwargs)
            return generate
        @wraps(fn)
        def call(*args, **kwargs):
            phase, details = info(args)
            with memory_phase(phase, **details):
                return fn(*args, **kwargs)
        return call
    return decorate


def host_snapshot():
    """Actual Windows counters, in bytes; no pagefile/settings writes."""
    if os.name != "nt":
        return {"hostCountersAvailable": False, "reason": "windows_counters_required"}
    size = ctypes.c_size_t
    class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [(n, size) for n in
            ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
             "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]
    class PERFORMANCE_INFORMATION(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD)] + [(n, size) for n in
            ("CommitTotal", "CommitLimit", "CommitPeak", "PhysicalTotal", "PhysicalAvailable", "SystemCache", "KernelTotal", "KernelPaged", "KernelNonpaged", "PageSize")] + [(n, wintypes.DWORD) for n in ("HandleCount", "ProcessCount", "ThreadCount")]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.GetProcessMemoryInfo.argtypes = (wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX), wintypes.DWORD)
    psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
    psapi.GetPerformanceInfo.argtypes = (ctypes.POINTER(PERFORMANCE_INFORMATION), wintypes.DWORD)
    psapi.GetPerformanceInfo.restype = wintypes.BOOL
    process, system = PROCESS_MEMORY_COUNTERS_EX(), PERFORMANCE_INFORMATION()
    process.cb, system.cb = ctypes.sizeof(process), ctypes.sizeof(system)
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(process), process.cb):
        raise ctypes.WinError(ctypes.get_last_error())
    if not psapi.GetPerformanceInfo(ctypes.byref(system), system.cb):
        raise ctypes.WinError(ctypes.get_last_error())
    page = system.PageSize
    return {"hostCountersAvailable": True, "privateCommitBytes": process.PrivateUsage,
            "peakPrivateCommitBytes": process.PeakPagefileUsage,
            "workingSetBytes": process.WorkingSetSize, "peakWorkingSetBytes": process.PeakWorkingSetSize,
            "systemCommitTotalBytes": system.CommitTotal * page, "systemCommitLimitBytes": system.CommitLimit * page,
            "systemCommitHeadroomBytes": (system.CommitLimit - system.CommitTotal) * page,
            "availablePhysicalBytes": system.PhysicalAvailable * page}


def cuda_snapshot():
    torch = sys.modules.get("torch")
    if torch is None or not torch.cuda.is_initialized():
        return {"cudaCountersAvailable": False, "cudaInitialized": False}
    return {"cudaCountersAvailable": True, "cudaInitialized": True,
            "cudaAllocatedBytes": torch.cuda.memory_allocated(), "cudaReservedBytes": torch.cuda.memory_reserved(),
            "cudaPeakAllocatedBytes": torch.cuda.max_memory_allocated(), "cudaPeakReservedBytes": torch.cuda.max_memory_reserved()}


class MemoryRecorder:
    def __init__(self, path, *, include_cuda=False, host_reader=host_snapshot, cuda_reader=cuda_snapshot):
        self._file = open(path, "x", encoding="utf8")
        self._host_reader, self._cuda_reader, self._include_cuda = host_reader, cuda_reader, include_cuda
        self._sequence = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._file.close()

    def __call__(self, event, details):
        self._sequence += 1
        row = {"sequence": self._sequence, "utc": datetime.now(timezone.utc).isoformat(),
               "monotonicNs": time.monotonic_ns(), "pid": os.getpid(), "event": event, "details": details}
        for name, reader in (("host", self._host_reader), ("cuda", self._cuda_reader if self._include_cuda else None)):
            if reader is not None:
                try:
                    row.update(reader())
                except Exception as error:
                    row[name + "ProbeErrorType"] = type(error).__name__
        self._file.write(json.dumps(row, ensure_ascii=False) + "\n")
        self._file.flush()
