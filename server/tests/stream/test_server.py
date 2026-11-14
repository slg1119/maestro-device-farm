import asyncio
import json

from websockets.asyncio.client import connect

from farm.cli.farm import build_agent
from farm.db.models import Device, Task
from farm.stream.manager import StreamManager
from farm.stream.server import StreamServer
from tests.factories import add_app, add_device, submit, write_flows
from tests.stream.test_manager import Session


async def test_unknown_device_and_view_only_control(db, settings):
    settings.agent_stream_port = 0
    sessions = []

    def factory(*args):
        s = Session()
        sessions.append(s)
        return s

    manager = StreamManager(None, settings, db=db, session_factory=factory)
    server = StreamServer(manager, settings)
    with db.session() as s:
        add_device(s)
    await server.start()
    try:
        assert server.port > 0
        async with connect(f'ws://127.0.0.1:{server.port}/devices/unknown/stream') as ws:
            assert json.loads(await ws.recv())['reason'] == 'device_unavailable'
        async with connect(f'ws://127.0.0.1:{server.port}/devices/d1/stream?control=0&actor=viewer') as ws:
            assert json.loads(await ws.recv())['control'] is False
            await ws.send(json.dumps({'type': 'key', 'key': 'HOME'}))
            await asyncio.sleep(.02)
            assert sessions[0].writes == []
        async with connect(f'ws://127.0.0.1:{server.port}/devices/d1/stream?control=1&actor=Zo%C3%AB%20Tester') as ws:
            assert json.loads(await ws.recv())['control'] is True
            await ws.send('invalid json')
            await ws.send(json.dumps({'type': 'key', 'key': 'HOME'}))
            async with asyncio.timeout(1):
                while True:
                    status = json.loads(await ws.recv())
                    if status.get('controller'):
                        assert status['controller'] == 'Zoë Tester'
                        break
            assert len(sessions[0].writes) == 2
            await manager.device_disconnected('d1')
            assert json.loads(await ws.recv())['reason'] == 'device_disconnected'
    finally:
        await server.stop()


async def test_port_in_use_agent_keeps_running_and_shutdown_cleans(db, settings, caplog):
    listener = await asyncio.start_server(lambda r, w: w.close(), '127.0.0.1', 0)
    settings.agent_stream_port = listener.sockets[0].getsockname()[1]
    agent = build_agent(settings, db=db, fake_devices=1)
    task = asyncio.create_task(agent.run())
    try:
        async with asyncio.timeout(3):
            while 'stream' not in caplog.text:
                await asyncio.sleep(.01)
        assert not task.done()
        assert agent.stream_manager is not None
    finally:
        agent.request_stop()
        await task
        listener.close()
        await listener.wait_closed()


async def test_settings_default_jar_exists(settings):
    assert settings.agent_stream_port == 8701
    assert settings.stream_max_size == 1280 and settings.stream_max_fps == 30
    assert settings.scrcpy_version == '4.1'
    assert settings.scrcpy_server_path.is_file()


async def test_running_task_read_and_offline_ended(db, settings, tmp_path):
    with db.session() as s:
        device = add_device(s)
        run = submit(s, app=add_app(s), flows_dir=write_flows(tmp_path / 'flows',
                     {'test.yaml': 'appId: com.example\n---\n- launchApp\n'}))
        task = s.query(Task).filter_by(run_id=run.id).one()
        task.device_serial, task.status = 'd1', 'running'
        device.current_task_id = task.id
        task_id = task.id
    manager = StreamManager(None, settings, db=db, session_factory=Session)
    try:
        viewer = await manager.subscribe('d1')
        assert json.loads(await viewer.recv())['running_task_id'] == task_id
        with db.session() as s:
            s.get(Device, 'd1').state = 'offline'
        await manager.broadcast_status('d1')
        assert json.loads(await viewer.recv())['reason'] == 'device_disconnected'
    finally:
        await manager.stop()


async def test_agent_stream_server_normal_start_and_shutdown(db, settings):
    settings.agent_stream_port = 0
    agent = build_agent(settings, db=db, fake_devices=1)
    task = asyncio.create_task(agent.run())
    try:
        async with asyncio.timeout(3):
            while not agent.stream_server.port:
                await asyncio.sleep(.01)
        async with connect(f'ws://127.0.0.1:{agent.stream_server.port}/devices/no-such-device/stream') as ws:
            assert json.loads(await ws.recv())['reason'] == 'device_unavailable'
    finally:
        agent.request_stop()
        await task
    assert agent.stream_server._server is None
