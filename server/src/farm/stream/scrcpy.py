"""One scrcpy v4.1 video/control transport, owned entirely by the agent."""

import asyncio
import contextlib
import secrets
import struct
from dataclasses import dataclass

from farm.config import Settings
from farm.devices.adb import Adb
from farm.runner.procs import run_capture, terminate_group

REMOTE_JAR = '/data/local/tmp/scrcpy-server.jar'
SESSION_FLAG = 1 << 63
CONFIG_FLAG = 1 << 62
KEYFRAME_FLAG = 1 << 61
PTS_MASK = (1 << 61) - 1
MAX_PACKET_SIZE = 16 * 1024 * 1024


@dataclass(frozen=True)
class Packet:
    data: bytes
    pts_us: int = 0
    config: bool = False
    keyframe: bool = False
    video_size: tuple[int, int] | None = None


class ScrcpySession:
    def __init__(self, adb: Adb, serial: str, settings: Settings, *, connector=None,
                 command_runner=None, process_factory=None, connect_timeout: float = 2.0):
        self.adb, self.serial, self.settings = adb, serial, settings
        self.connector = connector or asyncio.open_connection
        self.command_runner = command_runner or run_capture
        self.process_factory = process_factory or asyncio.create_subprocess_exec
        self.connect_timeout = connect_timeout
        self.video_size = (0, 0)
        self.device_name = ''
        self.process = None
        self.forward_port = None
        self._video = self._control = None
        self._writers = []
        self._control_reader_task = None
        self._write_lock = asyncio.Lock()

    async def _command(self, *args):
        # adb may allocate the forward just as shutdown cancels us. Reap the bounded command,
        # remember its port, and let start()'s cleanup remove that forward before propagating cancellation.
        command = asyncio.create_task(self.command_runner(self.adb._argv(self.serial, *args), timeout=15))
        try:
            result = await asyncio.shield(command)
        except asyncio.CancelledError:
            result = await command
            if args[:2] == ('forward', 'tcp:0') and result.returncode == 0:
                self.forward_port = int(result.text.strip())
            raise
        if result.returncode != 0:
            raise OSError('scrcpy adb command failed')
        return result.text.strip()

    async def start(self) -> None:
        try:
            size = self.settings.scrcpy_server_path.stat().st_size
            try:
                remote_size = await self._command('shell', 'stat', '-c', '%s', REMOTE_JAR)
            except OSError:
                remote_size = ''
            if remote_size != str(size):
                await self._command('push', str(self.settings.scrcpy_server_path), REMOTE_JAR)
            scid = f'{secrets.randbits(31):08x}'
            port = await self._command('forward', 'tcp:0', f'localabstract:scrcpy_{scid}')
            self.forward_port = int(port)
            spawn = asyncio.create_task(self.process_factory(
                *self.adb._argv(self.serial, 'shell', f'CLASSPATH={REMOTE_JAR}', 'app_process', '/',
                    'com.genymobile.scrcpy.Server', self.settings.scrcpy_version, f'scid={scid}',
                    'log_level=info', 'tunnel_forward=true', 'audio=false', 'control=true', 'video_codec=h264',
                    f'max_size={self.settings.stream_max_size}', f'max_fps={self.settings.stream_max_fps}',
                    'video_codec_options=i-frame-interval=2', 'cleanup=true'),
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL, start_new_session=True))
            try:
                self.process = await asyncio.shield(spawn)
            except asyncio.CancelledError:
                self.process = await spawn
                raise
            async with asyncio.timeout(self.connect_timeout):
                self._video = await self._connect_video()
                # v4.1 device/DesktopConnection.java: video then control; dummy only on video.
                self._control, writer = await self._connect()
                self._writers.append(writer)
                self.control_writer = writer
                # v4.1 DesktopConnection.sendDeviceMeta: exactly 64 bytes, UTF-8 + zero padding.
                self.device_name = (await self._video.readexactly(64)).split(b'\0', 1)[0].decode('utf-8', 'replace')
                # v4.1 device/Streamer.java writeVideoHeader: codec only, NOT the old codec+size header.
                if await self._video.readexactly(4) != b'h264':
                    raise ValueError('scrcpy did not select H.264')
                packet = await self._read_packet()
                if packet.video_size is None:
                    raise ValueError('scrcpy session metadata missing')
            # Drain clipboard/device replies without retaining or logging their contents.
            self._control_reader_task = asyncio.create_task(self._drain_control())
        except BaseException:
            await self.stop()
            raise

    async def _connect(self):
        while True:
            try:
                return await self.connector('127.0.0.1', self.forward_port)
            except OSError:
                await asyncio.sleep(.05)

    async def _connect_video(self):
        while True:
            reader, writer = await self._connect()
            try:
                # DesktopConnection.open sends zero immediately on the first accepted forward socket.
                if await reader.readexactly(1) != b'\0':
                    raise ValueError('invalid scrcpy dummy byte')
            except (OSError, asyncio.IncompleteReadError):
                writer.close()
                with contextlib.suppress(OSError):
                    await writer.wait_closed()
                await asyncio.sleep(.05)
            except BaseException:
                writer.close()
                with contextlib.suppress(OSError):
                    await writer.wait_closed()
                raise
            else:
                self._writers.append(writer)
                return reader

    async def _read_packet(self) -> Packet:
        # v4.1 device/Streamer.java writeSessionMeta/writeFrameMeta; doc/develop.md "Video and audio".
        # MSB=1 is a 12-byte SESSION (flags:u32,width:u32,height:u32); media config/key bits are 62/61.
        header = await self._video.readexactly(12)
        flags, size = struct.unpack('>QI', header)
        if flags & SESSION_FLAG:
            _, width, height = struct.unpack('>III', header)
            if not (0 < width <= 65535 and 0 < height <= 65535):
                raise ValueError('invalid scrcpy video size')
            self.video_size = (width, height)
            return Packet(b'', video_size=self.video_size)
        if not 0 < size <= MAX_PACKET_SIZE:
            raise ValueError('invalid scrcpy packet size')
        data = await self._video.readexactly(size)
        return Packet(data, flags & PTS_MASK, bool(flags & CONFIG_FLAG), bool(flags & KEYFRAME_FLAG))

    async def packets(self):
        while True:
            yield await self._read_packet()

    async def write_control(self, data: bytes) -> None:
        async with self._write_lock:
            if not self._control or self.control_writer.is_closing():
                raise ConnectionError('scrcpy control socket closed')
            self.control_writer.write(data)
            await self.control_writer.drain()

    async def _drain_control(self):
        with contextlib.suppress(OSError):
            while await self._control.read(4096):
                pass

    async def stop(self) -> None:
        if self._control_reader_task:
            self._control_reader_task.cancel()
            await asyncio.gather(self._control_reader_task, return_exceptions=True)
            self._control_reader_task = None
        writers, self._writers = self._writers, []
        for writer in writers:
            writer.close()
        for writer in writers:
            with contextlib.suppress(OSError):
                await writer.wait_closed()
        self._video = self._control = None
        try:
            if self.process is not None:
                await terminate_group(self.process, grace=2)
                self.process = None
        finally:
            if self.forward_port is not None:
                port, self.forward_port = self.forward_port, None
                with contextlib.suppress(OSError):
                    await self._command('forward', '--remove', f'tcp:{port}')
