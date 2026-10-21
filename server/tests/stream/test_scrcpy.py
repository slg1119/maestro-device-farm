import asyncio
import os
import struct
from contextlib import suppress

import pytest

from farm.config import Settings
from farm.devices.adb import Adb
from farm.runner.procs import Captured
from farm.stream.protocol import encode_control
from farm.stream.scrcpy import ScrcpySession

CONFIG = bytes.fromhex('000000016764001facd9400000000168ee3c80')
KEY = bytes.fromhex('00000001658884')


@pytest.fixture
async def fake_scrcpy():
    writers = []
    handlers = set()
    controls = asyncio.Queue()
    video = asyncio.Queue()

    async def handle(reader, writer):
        handlers.add(asyncio.current_task())
        writers.append(writer)
        try:
            if len(writers) == 1:
                # Real v4.1: dummy + 64-byte name + u32 codec + session meta, then media packets.
                writer.write(b'\0' + b'Fake Pixel'.ljust(64, b'\0') + b'h264'
                             + struct.pack('>III', 1 << 31, 720, 1280))
                writer.write(struct.pack('>QI', 1 << 62, len(CONFIG)) + CONFIG)
                writer.write(struct.pack('>QI', (1 << 61) | 123, len(KEY)) + KEY)
                await writer.drain()
                while True:
                    data = await video.get()
                    if data is None:
                        break
                    writer.write(data)
                    await writer.drain()
            else:
                while data := await reader.read(4096):
                    await controls.put(data)
        finally:
            writer.close()
            with suppress(OSError):
                await writer.wait_closed()
            handlers.discard(asyncio.current_task())

    listener = await asyncio.start_server(handle, '127.0.0.1', 0)
    port = listener.sockets[0].getsockname()[1]
    yield port, controls, video
    listener.close()
    for task in list(handlers):
        task.cancel()
    await asyncio.gather(*handlers, return_exceptions=True)
    await listener.wait_closed()


@pytest.mark.parametrize('same_size', [False, True])
async def test_v41_transport_lifecycle_and_wire(fake_scrcpy, settings, tmp_path, same_size):
    port, controls, video = fake_scrcpy
    jar = tmp_path / 'server.jar'
    jar.write_bytes(b'jar')
    settings.scrcpy_server_path = jar
    calls = []
    process_args = []
    proc = None

    async def command(argv, **kwargs):
        calls.append(argv)
        if 'stat' in argv:
            return Captured(0, b'3' if same_size else b'0')
        if 'tcp:0' in argv:
            return Captured(0, str(port).encode())
        return Captured(0, b'')

    async def spawn(*args, **kwargs):
        nonlocal proc
        process_args.append((args, kwargs))
        proc = await asyncio.create_subprocess_exec('sleep', '60', start_new_session=True)
        return proc

    attempts = [0]

    async def connector(host, allocated):
        assert host == '127.0.0.1' and allocated == port
        attempts[0] += 1
        if attempts[0] == 1:
            raise ConnectionRefusedError
        return await asyncio.open_connection(host, allocated)

    session = ScrcpySession(Adb(), 'fake', settings, connector=connector,
                            command_runner=command, process_factory=spawn)
    try:
        await session.start()
        assert session.video_size == (720, 1280)
        assert session.device_name == 'Fake Pixel'
        stream = session.packets()
        config = await anext(stream)
        key = await anext(stream)
        assert config.config and config.data == CONFIG
        assert key.keyframe and key.pts_us == 123 and key.data == KEY
        await video.put(struct.pack('>III', (1 << 31) | 1, 1280, 720))
        rotation = await anext(stream)
        assert rotation.video_size == (1280, 720) and session.video_size == (1280, 720)
        payload = b''.join(encode_control({'type': 'key', 'key': 'HOME'}, session.video_size))
        await session.write_control(payload)
        assert await asyncio.wait_for(controls.get(), 1) == payload
        assert any('push' in call for call in calls) is not same_size
        forward = next(call for call in calls if 'tcp:0' in call)
        scid = forward[-1].split('_')[-1]
        assert len(scid) == 8 and 0 <= int(scid, 16) < 2**31
        argv, kwargs = process_args[0]
        assert kwargs['start_new_session'] is True
        assert argv == ('adb', '-s', 'fake', 'shell',
            'CLASSPATH=/data/local/tmp/scrcpy-server.jar', 'app_process', '/',
            'com.genymobile.scrcpy.Server', '4.1', f'scid={scid}', 'log_level=info',
            'tunnel_forward=true', 'audio=false', 'control=true', 'video_codec=h264',
            'max_size=1280', 'max_fps=30', 'video_codec_options=i-frame-interval=2', 'cleanup=true')
    finally:
        await session.stop()
        await session.stop()
    assert proc.returncode is not None
    assert sum('--remove' in call for call in calls) == 1
    assert calls[-1][-2:] == ['--remove', f'tcp:{port}']


async def test_failed_start_removes_forward_and_process(settings, tmp_path):
    jar = tmp_path / 'jar'
    jar.write_bytes(b'jar')
    settings.scrcpy_server_path = jar
    calls = []
    processes = []

    async def command(argv, **kwargs):
        calls.append(argv)
        return Captured(0, b'12345' if 'tcp:0' in argv else b'0')

    async def spawn(*args, **kwargs):
        p = await asyncio.create_subprocess_exec('sleep', '60', start_new_session=True)
        processes.append(p)
        return p

    async def fail(*args):
        raise ConnectionRefusedError

    session = ScrcpySession(Adb(), 'fake', settings, connector=fail, command_runner=command,
                            process_factory=spawn, connect_timeout=.02)
    with pytest.raises((OSError, TimeoutError)):
        await session.start()
    assert processes[0].returncode is not None
    assert '--remove' in calls[-1]


async def test_cancelled_forward_allocation_still_removes_forward(settings, tmp_path):
    settings.scrcpy_server_path = tmp_path / 'jar'
    settings.scrcpy_server_path.write_bytes(b'jar')
    allocating = asyncio.Event()
    finish_allocation = asyncio.Event()
    calls = []

    async def command(argv, **kwargs):
        calls.append(argv)
        if 'tcp:0' in argv:
            allocating.set()
            await finish_allocation.wait()
            return Captured(0, b'12345')
        return Captured(0, b'3')

    session = ScrcpySession(Adb(), 'fake', settings, command_runner=command)
    start = asyncio.create_task(session.start())
    await allocating.wait()
    start.cancel()
    finish_allocation.set()
    with pytest.raises(asyncio.CancelledError):
        await start
    assert any(call[-2:] == ['--remove', 'tcp:12345'] for call in calls)


async def test_cancelled_process_spawn_still_reaps_child(settings, tmp_path):
    settings.scrcpy_server_path = tmp_path / 'jar'
    settings.scrcpy_server_path.write_bytes(b'jar')
    spawning, finish_spawn = asyncio.Event(), asyncio.Event()
    processes = []
    calls = []

    async def command(argv, **kwargs):
        calls.append(argv)
        return Captured(0, b'12345' if 'tcp:0' in argv else b'3')

    async def spawn(*args, **kwargs):
        processes.append(await asyncio.create_subprocess_exec('sleep', '60', start_new_session=True))
        spawning.set()
        await finish_spawn.wait()
        return processes[0]

    session = ScrcpySession(Adb(), 'fake', settings, command_runner=command, process_factory=spawn)
    start = asyncio.create_task(session.start())
    await spawning.wait()
    start.cancel()
    finish_spawn.set()
    with pytest.raises(asyncio.CancelledError):
        await start
    assert processes[0].returncode is not None
    assert any(call[-2:] == ['--remove', 'tcp:12345'] for call in calls)


@pytest.mark.skipif(os.environ.get('FARM_TEST_DEVICE') != 'emulator-5556',
                    reason='opt in with FARM_TEST_DEVICE=emulator-5556')
async def test_real_emulator_stream_and_home():
    # No reservation, reset, reboot or farm process changes; this session owns only its random forward.
    session = ScrcpySession(Adb(), 'emulator-5556', Settings())
    try:
        async with asyncio.timeout(15):
            await session.start()
            assert all(100 <= dimension <= 1280 for dimension in session.video_size)
            saw_config = saw_keyframe = False
            async for packet in session.packets():
                saw_config |= packet.config and b'\x67' in packet.data
                saw_keyframe |= packet.keyframe
                if saw_config and saw_keyframe:
                    break
            assert saw_config and saw_keyframe
            for data in encode_control({'type': 'key', 'key': 'HOME'}, session.video_size):
                await session.write_control(data)
    finally:
        await session.stop()
    assert session.process is None and session.forward_port is None
