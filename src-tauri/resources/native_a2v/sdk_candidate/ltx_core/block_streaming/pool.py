"""Raw buffer pool for block streaming."""

from __future__ import annotations

from ltx_core.memory_observer import emit, memory_phase, observe_phase

from collections import deque
from typing import Callable

import torch

from ltx_core.block_streaming import utils
from ltx_core.block_streaming.stream_sync import StreamEvent


class BufferPool:
    """Fixed pool of pre-allocated raw buffer slots with event-based reuse.
    Slots are carved from a single contiguous ``uint8`` buffer; each is
    ``slot_nbytes`` long and handed out as a raw 1-D ``uint8`` tensor.
    Args:
        slot_nbytes: Byte size of each slot.
        capacity: Number of slots to pre-allocate.
        device: Device for allocation.
        reuse_barrier: Called with the pending event before a slot is reused.
        pin_memory: Pin buffers (for async H2D copies from CPU).
    """

    def __init__(
        self,
        slot_nbytes: int,
        capacity: int,
        device: torch.device,
        reuse_barrier: Callable[[StreamEvent], None],
        pin_memory: bool = False,
    ) -> None:
        self._slot_nbytes = slot_nbytes
        self._capacity = capacity
        self._free: deque[torch.Tensor] = deque()
        self._events: dict[int, StreamEvent] = {}
        self._reuse_barrier = reuse_barrier
        self._leased: set[int] = set()
        self._disposed = False
        emit("pool.allocate", slotBytes=slot_nbytes, capacity=capacity, requestedBytes=max(slot_nbytes * capacity, 1), pinned=pin_memory, device=str(device))
        buffer = utils.alloc_buffer(max(slot_nbytes * capacity, 1), device, pin_memory)
        for slot in range(capacity):
            self._free.append(buffer[slot * slot_nbytes : (slot + 1) * slot_nbytes])

    @property
    def capacity(self) -> int:
        return self._capacity

    @property
    def slot_nbytes(self) -> int:
        return self._slot_nbytes

    def acquire(self) -> torch.Tensor:
        """Take a free raw slot, waiting any pending event before returning.
        Raises :class:`RuntimeError` if every slot is currently in use.
        """
        if self._disposed:
            raise RuntimeError("BufferPool is disposed")
        if not self._free:
            raise RuntimeError(f"BufferPool exhausted: all {self._capacity} buffers are in use")
        buffer = self._free.popleft()
        event = self._events.get(id(buffer))
        if event is not None:
            try:
                self._reuse_barrier(event)
            except BaseException:
                self._free.appendleft(buffer)
                raise
            self._events.pop(id(buffer))
        self._leased.add(id(buffer))
        return buffer

    def release(self, buffer: torch.Tensor, event: StreamEvent | None = None) -> None:
        """Return a raw slot to the free list.
        The *buffer* must be the exact tensor object returned by :meth:`acquire`
        (reuse is keyed on its identity). If *event* is given it is waited on the
        next :meth:`acquire` of this slot, ensuring the prior operation finished.
        """
        if self._disposed or id(buffer) not in self._leased:
            raise RuntimeError("BufferPool release requires an owned outstanding slot")
        self._leased.remove(id(buffer))
        if event is not None:
            self._events[id(buffer)] = event
        self._free.append(buffer)

    def dispose(self) -> None:
        """Drop owned storage only after every lease and reuse event is drained.

        External tensor views remain valid and retain their own storage. Callers
        must still synchronize I/O and compute before returning leased slots.
        """
        if self._disposed:
            return
        if self._leased:
            raise RuntimeError("Cannot dispose BufferPool with outstanding slots")
        for event in self._events.values():
            self._reuse_barrier(event)
        emit("pool.dispose", freeSlots=len(self._free), waitedEvents=len(self._events))
        self._events.clear()
        self._free.clear()
        self._disposed = True
