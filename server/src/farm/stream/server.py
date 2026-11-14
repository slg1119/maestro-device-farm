"""Local agent WebSocket endpoint; farm-api owns browser authentication."""

import asyncio
import json
from urllib.parse import parse_qs, unquote, urlsplit

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from farm.config import Settings
from farm.stream.manager import StreamManager


class StreamServer:
    def __init__(self, manager: StreamManager, settings: Settings):
        self.manager, self.settings = manager, settings
        self._server = None
        self.port = settings.agent_stream_port

    async def start(self) -> None:
        self._server = await serve(self._handle, self.settings.agent_stream_bind_host, self.settings.agent_stream_port,
                                   max_size=8192, max_queue=16, compression=None)
        self.port = self._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        # Tell viewers why first, before closing their sockets.
        await self.manager.stop()
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def _handle(self, websocket):
        viewer = None
        tasks = []
        try:
            url = urlsplit(websocket.request.path)
            parts = url.path.split('/')
            if len(parts) != 4 or parts[1] != 'devices' or parts[3] != 'stream' or not parts[2]:
                raise ValueError('device_unavailable')
            serial = unquote(parts[2])
            query = parse_qs(url.query)
            viewer = await self.manager.subscribe(serial, control=query.get('control') == ['1'],
                                                   actor=query.get('actor', [''])[0][:200])

            async def send():
                while True:
                    message = await viewer.recv()
                    await websocket.send(message)
                    if isinstance(message, str) and json.loads(message).get('type') == 'ended':
                        return

            async def receive():
                async for message in websocket:
                    if not viewer.control or not isinstance(message, str):
                        continue
                    try:
                        value = json.loads(message)
                    except (ValueError, RecursionError):
                        continue
                    await self.manager.handle_control(viewer, value)

            tasks = [asyncio.create_task(send()), asyncio.create_task(receive())]
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        except ValueError:
            await websocket.send(json.dumps({'type': 'ended', 'reason': 'device_unavailable',
                                             'message': '기기에 연결할 수 없습니다.'}))
        except ConnectionClosed:
            pass
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if viewer:
                await self.manager.unsubscribe(viewer)
            await websocket.close()
