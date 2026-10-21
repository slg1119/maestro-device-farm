"""Device-scoped sessions with bounded viewer queues and replayable GOPs."""

import asyncio
import inspect
import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from sqlalchemy import select

from farm.config import Settings
from farm.db.engine import Database
from farm.db.models import Device, Task
from farm.stream.events import ControlEvent
from farm.stream.protocol import (
    codec_from_sps,
    encode_config,
    encode_control,
    encode_frame,
    nal_units,
    validate_control,
)
from farm.stream.scrcpy import Packet, ScrcpySession
from farm.timeutil import now

log = logging.getLogger(__name__)
ControlHook = Callable[[ControlEvent], Awaitable[None] | None]


@dataclass(eq=False)
class Viewer:
    serial: str
    control: bool
    actor: str
    queue: asyncio.Queue
    waiting_keyframe: bool = True
    closed: bool = False

    async def recv(self) -> bytes | str:
        return await self.queue.get()


@dataclass
class _Stream:
    serial: str
    session: ScrcpySession
    viewers: set[Viewer] = field(default_factory=set)
    holds: set[str] = field(default_factory=set)
    parameters: dict[int, bytes] = field(default_factory=dict)
    config: bytes | None = None
    gop: list[bytes] = field(default_factory=list)
    gop_bytes: int = 0
    producer: asyncio.Task | None = None
    ticker: asyncio.Task | None = None
    linger: asyncio.Task | None = None
    actor: str | None = None
    actor_at: float = 0
    ready: bool = False
    closing: bool = False
    control_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def _clear(viewer: Viewer) -> None:
    while not viewer.queue.empty():
        viewer.queue.get_nowait()


def _failure_reason(exc: Exception) -> str:
    # Allow only transport facts and our fixed protocol messages, never arbitrary
    # exception output (which may include device text, argv, paths or secrets).
    if isinstance(exc, TimeoutError):
        return 'operation timed out'
    if isinstance(exc, asyncio.IncompleteReadError):
        return f'stream closed ({len(exc.partial)} of {exc.expected} bytes)'
    if isinstance(exc, OSError) and exc.errno is not None:
        return os.strerror(exc.errno)
    safe_messages = {
        'scrcpy adb command failed', 'scrcpy did not select H.264', 'scrcpy session metadata missing',
        'invalid scrcpy dummy byte', 'invalid scrcpy video size', 'invalid scrcpy packet size',
        'scrcpy control socket closed',
    }
    return str(exc) if str(exc) in safe_messages else 'details redacted'


class StreamManager:
    def __init__(self, adb, settings: Settings, db: Database | None = None, *,
                 control_hooks: list[ControlHook] | None = None, session_factory=None,
                 queue_size: int = 128, linger_sec: float = 30, status_interval: float = 5,
                 clock=None, sleep=None):
        if queue_size < 3:
            raise ValueError('viewer queue requires room for config, keyframe and status')
        self.adb, self.settings, self.db = adb, settings, db
        self.control_hooks = list(control_hooks or [])
        self.session_factory = session_factory or ScrcpySession
        self.queue_size, self.linger_sec, self.status_interval = queue_size, linger_sec, status_interval
        self.clock, self.sleep = clock or time.monotonic, sleep or asyncio.sleep
        self._streams: dict[str, _Stream] = {}
        self._stopped = False
        # Bound the shared replay cache as well as each viewer queue; never retain a partial GOP.
        self.max_gop_frames = 120
        self.max_gop_bytes = 16 * 1024 * 1024

    def _device_status(self, serial: str) -> tuple[bool, str | None]:
        if self.db is None:
            return True, None
        with self.db.session() as session:
            device = session.get(Device, serial)
            if device is None or device.state in ('offline', 'unauthorized'):
                return False, None
            task_id = session.scalar(select(Task.id).where(Task.device_serial == serial,
                                                           Task.status == 'running').limit(1))
            return True, task_id

    async def available(self, serial: str) -> bool:
        available, _ = await asyncio.to_thread(self._device_status, serial)
        return available and not self._stopped

    def _get_or_start(self, serial: str) -> _Stream:
        state = self._streams.get(serial)
        if state is None:
            state = _Stream(serial, self.session_factory(self.adb, serial, self.settings))
            self._streams[serial] = state
            state.producer = asyncio.create_task(self._produce(state))
            state.ticker = asyncio.create_task(self._status_loop(state))
        if state.linger:
            state.linger.cancel()
            state.linger = None
        return state

    async def subscribe(self, serial: str, *, control: bool = False, actor: str = '') -> Viewer:
        if not await self.available(serial):
            raise ValueError('device_unavailable')
        state = self._get_or_start(serial)
        viewer = Viewer(serial, control, actor, asyncio.Queue(maxsize=self.queue_size))
        state.viewers.add(viewer)
        if state.config:
            viewer.queue.put_nowait(state.config)
            # If replay doesn't fit, wait for a fresh keyframe rather than sending a partial GOP.
            if state.gop and len(state.gop) + 2 <= self.queue_size:
                for frame in state.gop:
                    viewer.queue.put_nowait(frame)
                viewer.waiting_keyframe = False
        await self.broadcast_status(serial)
        return viewer

    async def unsubscribe(self, viewer: Viewer) -> None:
        viewer.closed = True
        state = self._streams.get(viewer.serial)
        if state and viewer in state.viewers:
            state.viewers.discard(viewer)
            self._schedule_linger(state)
            await self.broadcast_status(viewer.serial)

    async def hold(self, serial: str, reason: str) -> None:
        if not await self.available(serial):
            raise ValueError('device_unavailable')
        state = self._get_or_start(serial)
        state.holds.add(reason)
        await self.broadcast_status(serial)

    async def release(self, serial: str, reason: str) -> None:
        state = self._streams.get(serial)
        if state:
            state.holds.discard(reason)
            self._schedule_linger(state)
            await self.broadcast_status(serial)

    def _schedule_linger(self, state: _Stream) -> None:
        if not state.viewers and not state.holds and state.linger is None and not state.closing:
            state.linger = asyncio.create_task(self._linger(state))

    async def _linger(self, state: _Stream):
        await self.sleep(self.linger_sec)
        if not state.viewers and not state.holds:
            await self._end(state, 'agent_stopping')

    async def _produce(self, state: _Stream):
        try:
            await state.session.start()
            state.ready = True
            async for packet in state.session.packets():
                self._publish(state, packet)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 -- session failures must end viewers without leaking payloads to logs
            log.warning('scrcpy session failed for %s: %s: %s',
                        state.serial, type(exc).__name__, _failure_reason(exc))
        finally:
            try:
                await state.session.stop()
            finally:
                if not state.closing:
                    await self._end(state, 'error')

    def _reset_viewer(self, viewer: Viewer, config: bytes | None):
        _clear(viewer)
        viewer.waiting_keyframe = True
        if config:
            viewer.queue.put_nowait(config)

    def _update_config(self, state: _Stream, *, force: bool = False):
        sps = state.parameters.get(7)
        pps = state.parameters.get(8)
        if not sps or not pps:
            return
        config = encode_config(*state.session.video_size, codec_from_sps(sps))
        if force or config != state.config:
            state.config = config
            state.gop.clear()
            state.gop_bytes = 0
            for viewer in state.viewers:
                self._reset_viewer(viewer, config)

    def _publish(self, state: _Stream, packet: Packet):
        if packet.video_size:
            # v4.1 session metadata carries rotation/resize even before its new SPS arrives.
            self._update_config(state, force=True)
            return
        if packet.config:
            changed = False
            for nal in nal_units(packet.data):
                kind = nal[0] & 31
                if kind in (7, 8):
                    value = b'\0\0\0\1' + nal
                    changed |= state.parameters.get(kind) != value
                    state.parameters[kind] = value
            self._update_config(state, force=changed)
            return
        if state.config is None:
            return
        prefix = b''.join(state.parameters[kind] for kind in (7, 8)) if packet.keyframe else b''
        frame = encode_frame(prefix + packet.data, packet.pts_us, packet.keyframe)
        if packet.keyframe:
            state.gop = []
            state.gop_bytes = 0
        if packet.keyframe or state.gop:
            state.gop.append(frame)
            state.gop_bytes += len(frame)
            if len(state.gop) > self.max_gop_frames or state.gop_bytes > self.max_gop_bytes:
                state.gop.clear()
                state.gop_bytes = 0
        for viewer in state.viewers:
            if viewer.waiting_keyframe:
                if not packet.keyframe:
                    continue
                self._reset_viewer(viewer, state.config)
                viewer.waiting_keyframe = False
            if viewer.queue.full():
                self._reset_viewer(viewer, state.config)
                if not packet.keyframe:
                    continue
                viewer.waiting_keyframe = False
            viewer.queue.put_nowait(frame)

    async def handle_control(self, viewer: Viewer, message) -> bool:
        state = self._streams.get(viewer.serial)
        if not viewer.control or viewer.closed or not state or viewer not in state.viewers:
            return False
        async with state.control_lock:
            if not state.ready or state.closing:
                return False
            try:
                size = state.session.video_size
                validated = validate_control(message, size)
                messages = encode_control(validated, size)
            except ValueError:
                return False
            try:
                for payload in messages:
                    await state.session.write_control(payload)
            except (OSError, RuntimeError):
                await self._end(state, 'error')
                return False
            state.actor, state.actor_at = viewer.actor, self.clock()
            event = ControlEvent(viewer.serial, viewer.actor, validated, size, now())
            for hook in self.control_hooks:
                try:
                    result = hook(event)
                    if inspect.isawaitable(result):
                        await result
                except Exception:  # noqa: BLE001 -- extension hooks must never break control delivery
                    log.warning('stream control hook failed for %s', viewer.serial)
            await self.broadcast_status(viewer.serial)
            return True

    async def broadcast_status(self, serial: str) -> None:
        state = self._streams.get(serial)
        if state is None or state.closing:
            return
        available, task_id = await asyncio.to_thread(self._device_status, serial)
        if not available:
            await self.device_disconnected(serial)
            return
        if state.closing:
            return
        controller = state.actor if self.clock() - state.actor_at < 10 else None
        for viewer in state.viewers:
            value = json.dumps({'type': 'status', 'viewers': len(state.viewers), 'controller': controller,
                                'running_task_id': task_id, 'recording': bool(state.holds),
                                'control': viewer.control}, ensure_ascii=False)
            # Coalesce status messages so control activity cannot fill the video queue.
            queued = []
            while not viewer.queue.empty():
                item = viewer.queue.get_nowait()
                if isinstance(item, bytes):
                    queued.append(item)
            for item in queued:
                viewer.queue.put_nowait(item)
            if not viewer.queue.full():
                viewer.queue.put_nowait(value)

    async def _status_loop(self, state: _Stream):
        while True:
            await self.sleep(self.status_interval)
            try:
                await self.broadcast_status(state.serial)
            except Exception:  # noqa: BLE001 -- a temporary DB failure must not kill the periodic broadcaster
                log.warning('stream status lookup failed for %s', state.serial)

    async def device_disconnected(self, serial: str) -> None:
        state = self._streams.get(serial)
        if state:
            await self._end(state, 'device_disconnected')

    async def _end(self, state: _Stream, reason: str):
        if state.closing:
            return
        state.closing = True
        self._streams.pop(state.serial, None)
        for viewer in state.viewers:
            _clear(viewer)
            viewer.closed = True
            viewer.queue.put_nowait(json.dumps({'type': 'ended', 'reason': reason,
                                                'message': '기기 화면 연결이 종료되었습니다.'}))
        current = asyncio.current_task()
        tasks = [task for task in (state.producer, state.ticker, state.linger)
                 if task is not None and task is not current]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def stop(self) -> None:
        self._stopped = True
        await asyncio.gather(*(self._end(state, 'agent_stopping') for state in list(self._streams.values())))
