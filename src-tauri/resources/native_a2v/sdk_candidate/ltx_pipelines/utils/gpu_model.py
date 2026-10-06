from collections.abc import Iterator
from contextlib import contextmanager
from typing import TypeVar

from ltx_core.allocator_trim_strategy import AllocatorTrimStrategy
from ltx_core.memory_observer import memory_phase
from ltx_core.devices import synchronize_device
from ltx_core.model.disposable import DisposableProtocol
from ltx_pipelines.utils.helpers import cleanup_memory

_M = TypeVar("_M", bound=DisposableProtocol)


@contextmanager
def gpu_model(model: _M, alloc_trim_strategy: AllocatorTrimStrategy = AllocatorTrimStrategy.TRIM) -> Iterator[_M]:
    """Context manager that yields a model and releases its memory on exit.
    Always calls ``model.dispose()`` so parameter / persistent-buffer storage
    moves to meta (shell-safe; fused LoRA weights do not linger on a cached
    module). ``TRIM`` (default) also synchronizes and ``cleanup_memory()`` to
    return cached blocks to the OS. ``DEFER`` skips sync / ``empty_cache`` so
    the CUDA caching allocator stays warm for the next build.
    Usage::
        with gpu_model(build_encoder()) as encoder:
            ...  # use encoder -- typed as the concrete class
        # parameter storage released; TRIM also returns cached blocks to the OS
    """
    try:
        yield model
    finally:
        if alloc_trim_strategy == AllocatorTrimStrategy.TRIM:
            with memory_phase("resident.sync", ownerType=type(model).__name__):
                synchronize_device()
            with memory_phase("resident.dispose", ownerType=type(model).__name__):
                model.dispose()
            with memory_phase("resident.trim", ownerType=type(model).__name__):
                cleanup_memory()
        else:
            with memory_phase("resident.dispose", ownerType=type(model).__name__):
                model.dispose()
