"""Browser wire contract and the pinned scrcpy v4.1 control protocol."""

import math
import re
import struct

KEYCODES = {'BACK': 4, 'HOME': 3, 'APP_SWITCH': 187, 'ENTER': 66, 'DEL': 67,
            'VOLUME_UP': 24, 'VOLUME_DOWN': 25, 'POWER': 26}
ACTIONS = {'down': 0, 'up': 1, 'move': 2}


def nal_units(data: bytes) -> list[bytes]:
    return [nal for nal in re.split(b'\x00\x00\x00?\x01', data) if nal]


def codec_from_sps(data: bytes) -> str:
    for nal in nal_units(data):
        if nal[0] & 31 == 7 and len(nal) >= 4:
            return 'avc1.' + nal[1:4].hex()
    raise ValueError('H.264 SPS missing or truncated')


def encode_config(width: int, height: int, codec: str) -> bytes:
    # Farm/browser contract: type/u16 width/u16 height/u8 codec length/ASCII codec (big-endian).
    if not (0 < width <= 65535 and 0 < height <= 65535):
        raise ValueError('invalid video size')
    value = codec.encode('ascii')
    if len(value) > 255:
        raise ValueError('codec too long')
    return struct.pack('>BHHB', 1, width, height, len(value)) + value


def encode_frame(data: bytes, pts_us: int, keyframe: bool) -> bytes:
    # Farm/browser contract: type/flags/u64 microsecond PTS/Annex B bytes (big-endian).
    return struct.pack('>BBQ', 2, int(keyframe), pts_us) + data


def _integer(value) -> int:
    if type(value) is not int:
        raise ValueError('expected integer')
    return value


def _scroll(value) -> float:
    if type(value) not in (int, float):
        raise ValueError('expected finite number')
    try:
        value = float(value)
    except OverflowError:
        raise ValueError('expected finite number') from None
    if not math.isfinite(value):
        raise ValueError('expected finite number')
    return max(-16.0, min(16.0, value))


def validate_control(message, video_size: tuple[int, int]) -> dict:
    if not isinstance(message, dict):
        raise ValueError('expected object')  # noqa: TRY004 -- malformed client JSON uses one validation error type
    kind = message.get('type')
    if kind in ('touch', 'scroll'):
        width, height = video_size
        if not (0 < width <= 65535 and 0 < height <= 65535):
            raise ValueError('video not ready')
        result = {'type': kind, 'x': max(0, min(width - 1, _integer(message.get('x')))),
                  'y': max(0, min(height - 1, _integer(message.get('y'))))}
        if kind == 'touch':
            action = message.get('action')
            if not isinstance(action, str) or action not in ACTIONS:
                raise ValueError('invalid touch action')
            result['action'] = action
        else:
            result.update(dx=_scroll(message.get('dx')), dy=_scroll(message.get('dy')))
        return result
    if kind == 'key':
        key = message.get('key')
        if not isinstance(key, str) or key not in KEYCODES:
            raise ValueError('invalid key')
        return {'type': kind, 'key': key}
    if kind == 'text':
        value = message.get('text')
        if not isinstance(value, str) or len(value) > 300:
            raise ValueError('text exceeds 300 characters')
        try:
            value.encode('utf-8')
        except UnicodeEncodeError:
            raise ValueError('invalid UTF-8 text') from None
        return {'type': kind, 'text': value}
    raise ValueError('unknown control type')


def encode_control(message: dict, video_size: tuple[int, int]) -> list[bytes]:
    message = validate_control(message, video_size)
    kind = message['type']
    # Sources below are pinned to https://github.com/Genymobile/scrcpy/tree/v4.1/.
    if kind == 'key':
        # server/.../control/ControlMessageReader.java parseInjectKeycode; app/src/control_msg.c.
        return [struct.pack('>BBIII', 0, action, KEYCODES[message['key']], 0, 0) for action in (0, 1)]
    if kind == 'text':
        # server/.../control/ControlMessageReader.java parseInjectText (u32 byte length + UTF-8).
        # app/src/control_msg.h caps each inject-text at 300 BYTES; preserve our 300-character contract.
        chunks, chunk = [], b''
        for char in message['text']:
            encoded = char.encode('utf-8')
            if len(chunk) + len(encoded) > 300:
                chunks.append(chunk)
                chunk = b''
            chunk += encoded
        chunks.append(chunk)
        return [struct.pack('>BI', 1, len(value)) + value for value in chunks]
    width, height = video_size
    x, y = message['x'], message['y']
    if kind == 'touch':
        # server/.../control/ControlMessageReader.java parseInjectTouchEvent/parsePosition;
        # app/src/control_msg.h: SC_POINTER_ID_MOUSE=-1; util/Binary.java: pressure 1 -> 0xffff.
        # Controller.java treats this primary-button-free pointer as a finger.
        pressure = 0 if message['action'] == 'up' else 65535
        return [struct.pack('>BBqiiHHHII', 2, ACTIONS[message['action']], -1,
                            x, y, width, height, pressure, 0, 0)]
    # server/.../control/ControlMessageReader.java parseInjectScrollEvent + util/Binary.java;
    # app/src/control_msg.c divides axes by 16, then util/binary.h multiplies by 32768.
    # Wheel-positive means content up; Android AXIS_VSCROLL is positive in the opposite direction.
    def axis(value):
        return max(-32768, min(32767, int(-value * 2048)))
    return [struct.pack('>BiiHHhhI', 3, x, y, width, height,
                        axis(message['dx']), axis(message['dy']), 0)]
