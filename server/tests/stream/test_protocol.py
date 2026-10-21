import struct

import pytest

from farm.stream.protocol import codec_from_sps, encode_config, encode_control, encode_frame, validate_control

SPS = bytes.fromhex('000000016764001facd940')
PPS = bytes.fromhex('00000168ee3c80')


def test_browser_binary_contract():
    assert codec_from_sps(PPS + SPS) == 'avc1.64001f'
    assert encode_config(720, 1280, 'avc1.64001f') == bytes.fromhex(
        '0102d005000b') + b'avc1.64001f'
    assert encode_frame(b'NAL', 123456, True) == bytes.fromhex('0201000000000001e240') + b'NAL'
    assert encode_frame(b'NAL', 0, False) == b'\x02\x00' + bytes(8) + b'NAL'


@pytest.mark.parametrize('action,code,pressure', [('down', 0, 65535), ('move', 2, 65535), ('up', 1, 0)])
def test_touch_exact_v41(action, code, pressure):
    # v4.1 ControlMessageReader: type/action/u64 pointer/position/u16 pressure/u32 actionButton/buttons.
    message = {'type': 'touch', 'action': action, 'x': 20, 'y': 30}
    assert encode_control(message, (720, 1280)) == [struct.pack(
        '>BBqiiHHHII', 2, code, -1, 20, 30, 720, 1280, pressure, 0, 0)]


def test_scroll_exact_v41_fixed_point_and_direction():
    message = {'type': 'scroll', 'x': 10, 'y': 20, 'dx': .5, 'dy': 1}
    # scrcpy scroll is [-16,16] encoded as i16 / 2048; Android's vertical axis opposes wheel dy.
    assert encode_control(message, (720, 1280)) == [struct.pack(
        '>BiiHHhhI', 3, 10, 20, 720, 1280, -1024, -2048, 0)]


@pytest.mark.parametrize('key,code', [('BACK', 4), ('HOME', 3), ('APP_SWITCH', 187), ('ENTER', 66),
                                      ('DEL', 67), ('VOLUME_UP', 24), ('VOLUME_DOWN', 25), ('POWER', 26)])
def test_key_exact_down_and_up(key, code):
    assert encode_control({'type': 'key', 'key': key}, (720, 1280)) == [
        struct.pack('>BBIII', 0, action, code, 0, 0) for action in (0, 1)]


def test_utf8_text_preserves_300_characters_by_chunking_at_scrcpy_300_byte_limit():
    text = '가' * 300
    chunks = encode_control({'type': 'text', 'text': text}, (720, 1280))
    assert len(chunks) == 3
    assert b''.join(chunk[5:] for chunk in chunks).decode() == text
    assert all(chunk[:5] == b'\x01\x00\x00\x01\x2c' for chunk in chunks)


def test_validation_clamps_and_strips_untrusted_fields():
    message = validate_control({'type': 'touch', 'action': 'down', 'x': -10, 'y': 9999, 'extra': 1},
                               (720, 1280))
    assert message == {'type': 'touch', 'action': 'down', 'x': 0, 'y': 1279}
    assert validate_control({'type': 'scroll', 'x': 0, 'y': 0, 'dx': 1000, 'dy': -1000},
                            (720, 1280))['dy'] == -16


@pytest.mark.parametrize('message', [None, [], {}, {'type': 'wat'}, {'type': 'key', 'key': 'SHELL'},
    {'type': 'touch', 'action': 'cancel', 'x': 0, 'y': 0},
    {'type': 'touch', 'action': 'down', 'x': True, 'y': 0},
    {'type': 'touch', 'action': 'down', 'x': 1.2, 'y': 0},
    {'type': 'scroll', 'x': 0, 'y': 0, 'dx': float('nan'), 'dy': 0},
    {'type': 'text', 'text': 'a' * 301}, {'type': 'text', 'text': '\ud800'}])
def test_invalid_controls_are_rejected(message):
    with pytest.raises(ValueError):
        validate_control(message, (720, 1280))


def test_bad_sps_rejected():
    with pytest.raises(ValueError):
        codec_from_sps(PPS)
