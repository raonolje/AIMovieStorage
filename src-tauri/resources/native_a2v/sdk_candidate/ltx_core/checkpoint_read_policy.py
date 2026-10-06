"""Immutable per-worker payload policy; metadata readers keep explicit pread."""
from threading import Lock
_lock=Lock()
_configured=None
LEGACY_BACKEND='pread'
def configure_payload_backend(backend):
    global _configured
    if not isinstance(backend,str) or backend not in ('mmap','pread'):
        raise ValueError('unsupported_checkpoint_read_backend')
    with _lock:
        if _configured is not None and _configured!=backend:
            raise RuntimeError('checkpoint_read_policy_already_frozen')
        _configured=backend
    return backend
def payload_read_backend():
    return _configured if _configured is not None else LEGACY_BACKEND
