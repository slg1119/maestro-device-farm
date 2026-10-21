import asyncio
import json

import pytest

from farm.stream.manager import StreamManager
from farm.stream.protocol import encode_config, encode_frame
from farm.stream.scrcpy import Packet

SPS = bytes.fromhex('000000016764001facd940')
PPS = bytes.fromhex('0000000168ee3c80')
CONFIG = SPS + PPS
KEY = bytes.fromhex('00000001658884')
DELTA = bytes.fromhex('00000001419a')


async def settle():
    for _ in range(12):
        await asyncio.sleep(0)


class Session:
    def __init__(self, *args):
        self.video_size = (720, 1280)
        self.input = asyncio.Queue()
        self.writes = []
        self.started = self.stopped = 0

    async def start(self):
        self.started += 1

    async def packets(self):
        while True:
            packet = await self.input.get()
            if packet is None:
                return
            yield packet

    async def write_control(self, data):
        self.writes.append(data)

    async def stop(self):
        self.stopped += 1


@pytest.fixture
async def streams(settings):
    sessions = []

    def factory(*args):
        result = Session()
        sessions.append(result)
        return result

    manager = StreamManager(None, settings, session_factory=factory)
    yield manager, sessions
    await manager.stop()


def drain(viewer):
    result = []
    while not viewer.queue.empty():
        result.append(viewer.queue.get_nowait())
    return result


def binaries(viewer):
    return [m for m in drain(viewer) if isinstance(m, bytes)]


async def emit(session, *packets):
    for packet in packets:
        await session.input.put(packet)
    await settle()


async def test_one_session_late_viewer_gets_config_then_latest_gop(streams):
    manager, sessions = streams
    a = await manager.subscribe('d1')
    await settle()
    session = sessions[0]
    await emit(session, Packet(CONFIG, config=True), Packet(KEY, 100, keyframe=True), Packet(DELTA, 110),
               Packet(KEY, 200, keyframe=True), Packet(DELTA, 210))
    b = await manager.subscribe('d1')
    assert len(sessions) == 1
    assert binaries(b) == [encode_config(720, 1280, 'avc1.64001f'),
                           encode_frame(CONFIG + KEY, 200, True), encode_frame(DELTA, 210, False)]
    await emit(session, Packet(DELTA, 220))
    assert binaries(b) == [encode_frame(DELTA, 220, False)]
    await manager.unsubscribe(a)


async def test_view_only_cannot_control_hooks_after_write_and_errors_isolated(streams, caplog):
    manager, sessions = streams
    events = []

    def broken(event):
        raise RuntimeError('private control must not appear in logs')

    async def hook(event):
        assert len(sessions[0].writes) == 2
        events.append(event)

    manager.control_hooks = [broken, hook]
    view = await manager.subscribe('d1')
    control = await manager.subscribe('d1', control=True, actor='tester')
    await settle()
    message = {'type': 'key', 'key': 'HOME'}
    assert not await manager.handle_control(view, message)
    assert sessions[0].writes == []
    assert await manager.handle_control(control, message)
    assert len(events) == 1
    assert events[0].serial == 'd1' and events[0].actor == 'tester'
    assert events[0].message == message and events[0].video_size == (720, 1280)
    assert events[0].ts.endswith('Z')
    assert 'private control' not in caplog.text
    statuses = [json.loads(m) for m in drain(control) if isinstance(m, str)]
    assert statuses[-1]['controller'] == 'tester'
    assert statuses[-1]['control'] is True
    assert statuses[-1]['viewers'] == 2


async def test_controller_expires_and_status_changes(streams):
    manager, _ = streams
    clock = [0.0]
    manager.clock = lambda: clock[0]
    viewer = await manager.subscribe('d1', control=True, actor='a')
    await settle()
    await manager.handle_control(viewer, {'type': 'key', 'key': 'BACK'})
    drain(viewer)
    clock[0] = 10.1
    await manager.broadcast_status('d1')
    assert json.loads(drain(viewer)[-1])['controller'] is None


async def test_slow_viewer_recovers_only_on_keyframe_with_config(streams):
    manager, sessions = streams
    manager.queue_size = 4
    slow = await manager.subscribe('d1')
    fast = await manager.subscribe('d1')
    await settle()
    s = sessions[0]
    await emit(s, Packet(CONFIG, config=True), Packet(KEY, 1, keyframe=True))
    binaries(fast)
    for pts in range(2, 12):
        await emit(s, Packet(DELTA, pts))
        assert binaries(fast) == [encode_frame(DELTA, pts, False)]
        assert slow.queue.qsize() <= 4
    assert not any(m[0] == 2 for m in binaries(slow))
    await emit(s, Packet(DELTA, 12))
    assert not any(m[0] == 2 for m in binaries(slow))
    await emit(s, Packet(KEY, 20, keyframe=True))
    assert binaries(slow) == [encode_config(720, 1280, 'avc1.64001f'), encode_frame(CONFIG + KEY, 20, True)]


async def test_rotation_resets_gop_and_sends_new_size(streams):
    manager, sessions = streams
    viewer = await manager.subscribe('d1')
    await settle()
    s = sessions[0]
    await emit(s, Packet(CONFIG, config=True), Packet(KEY, 1, keyframe=True))
    drain(viewer)
    s.video_size = (1280, 720)
    await emit(s, Packet(b'', video_size=(1280, 720)), Packet(CONFIG, config=True),
               Packet(KEY, 20, keyframe=True))
    binary = binaries(viewer)
    assert binary[0] == encode_config(1280, 720, 'avc1.64001f')
    assert binary[-1] == encode_frame(CONFIG + KEY, 20, True)


async def test_disconnect_and_crash_send_ended_and_stop(streams):
    manager, sessions = streams
    viewer = await manager.subscribe('d1')
    await settle()
    await manager.device_disconnected('d1')
    assert json.loads(drain(viewer)[-1])['reason'] == 'device_disconnected'
    assert sessions[0].stopped == 1
    viewer = await manager.subscribe('d1')
    await settle()
    await sessions[1].input.put(None)
    await settle()
    assert json.loads(drain(viewer)[-1])['reason'] == 'error'
    assert sessions[1].stopped == 1


async def test_linger_30_seconds_reconnect_and_recording_hold(streams):
    manager, sessions = streams
    sleepers = []

    async def fake_sleep(delay):
        event = asyncio.Event()
        sleepers.append((delay, event))
        await event.wait()

    manager.sleep = fake_sleep
    viewer = await manager.subscribe('d1')
    await settle()
    await manager.unsubscribe(viewer)
    await settle()
    linger = next(event for delay, event in sleepers if delay == 30)
    assert sessions[0].stopped == 0
    viewer = await manager.subscribe('d1')
    linger.set()
    await settle()
    assert len(sessions) == 1 and sessions[0].stopped == 0
    await manager.hold('d1', 'recording:r1')
    await manager.unsubscribe(viewer)
    await settle()
    assert sessions[0].stopped == 0
    await manager.release('d1', 'recording:r1')
    await settle()
    sleepers[-1][1].set()
    await settle()
    assert sessions[0].stopped == 1


async def test_hold_starts_without_viewer_and_shutdown_sends_ended(streams):
    manager, sessions = streams
    await manager.hold('d1', 'recording:r1')
    await settle()
    viewer = await manager.subscribe('d1')
    assert len(sessions) == 1
    assert json.loads(drain(viewer)[-1])['recording'] is True
    await manager.stop()
    assert json.loads(drain(viewer)[-1])['reason'] == 'agent_stopping'


async def test_shared_cache_is_bounded_without_sending_partial_gop(streams):
    manager, sessions = streams
    manager.max_gop_frames = 2
    await manager.subscribe('d1')
    await settle()
    s = sessions[0]
    await emit(s, Packet(CONFIG, config=True), Packet(KEY, 1, keyframe=True),
               Packet(DELTA, 2), Packet(DELTA, 3))
    late = await manager.subscribe('d1')
    assert binaries(late) == [encode_config(720, 1280, 'avc1.64001f')]
    await emit(s, Packet(DELTA, 4), Packet(KEY, 5, keyframe=True))
    assert binaries(late) == [encode_config(720, 1280, 'avc1.64001f'),
                              encode_frame(CONFIG + KEY, 5, True)]


async def test_status_every_five_seconds_with_fake_time(streams):
    manager, _ = streams
    ticks = asyncio.Queue()
    entered = asyncio.Event()

    async def fake_sleep(delay):
        assert delay == 5
        entered.set()
        await ticks.get()

    manager.sleep = fake_sleep
    viewer = await manager.subscribe('d1')
    await entered.wait()
    drain(viewer)
    await ticks.put(True)
    status = json.loads(await asyncio.wait_for(viewer.recv(), 1))
    assert status == {'type': 'status', 'viewers': 1, 'controller': None,
                      'running_task_id': None, 'recording': False, 'control': False}


async def test_failed_device_write_does_not_fire_hooks(streams):
    manager, sessions = streams
    events = []
    manager.control_hooks = [events.append]
    viewer = await manager.subscribe('d1', control=True, actor='a')
    await settle()

    async def fail(data):
        raise ConnectionError('closed')

    sessions[0].write_control = fail
    assert not await manager.handle_control(viewer, {'type': 'key', 'key': 'HOME'})
    assert events == []
    assert json.loads(drain(viewer)[-1])['reason'] == 'error'


@pytest.mark.parametrize("error,reason", [
    (TimeoutError("private screen text and token"), "operation timed out"),
    (asyncio.IncompleteReadError(b"private screen text", 12), "stream closed (19 of 12 bytes)"),
    (ConnectionResetError(54, "private token"), "Connection reset by peer"),
    (ValueError("invalid scrcpy packet size"), "invalid scrcpy packet size"),
    (RuntimeError("private screen text and token"), "details redacted"),
])
async def test_session_failure_logs_class_and_safe_reason(settings, caplog, error, reason):
    class BrokenSession(Session):
        async def start(self):
            raise error

    manager = StreamManager(None, settings, session_factory=BrokenSession)
    try:
        viewer = await manager.subscribe('d1')
        await settle()
        assert json.loads(drain(viewer)[-1])['reason'] == 'error'
        assert type(error).__name__ in caplog.text and reason in caplog.text
        assert 'private' not in caplog.text and 'token' not in caplog.text
    finally:
        await manager.stop()
