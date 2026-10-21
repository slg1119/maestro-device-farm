import { afterEach, expect, test, vi } from "vitest";
import { parseStreamMessage, StreamDecoder } from "./decoder";

afterEach(() => vi.restoreAllMocks());

test("parses the server's big-endian config and Annex B frame", () => {
  const bytes = new Uint8Array([1, 4, 56, 9, 96, 11, ...new TextEncoder().encode("avc1.64001f")]);
  expect(parseStreamMessage(bytes.buffer)).toEqual({ type: "config", width: 1080, height: 2400, codec: "avc1.64001f" });
  const frame = new Uint8Array(15); frame.set([2, 1]); new DataView(frame.buffer).setBigUint64(2, 123456789n); frame.set([0, 0, 0, 1, 101], 10);
  expect(parseStreamMessage(frame.buffer)).toEqual({ type: "frame", keyframe: true, timestamp: 123456789, data: frame.subarray(10) });
});

test("parses status and ended and rejects malformed messages", () => {
  const status = { type: "status", viewers: 2, controller: "운영자", running_task_id: "t1", recording: true, control: true };
  expect(parseStreamMessage(JSON.stringify(status))).toEqual(status);
  expect(parseStreamMessage('{"type":"ended","reason":"device_disconnected","message":"연결 종료"}')).toEqual({ type: "ended", reason: "device_disconnected", message: "연결 종료" });
  for (const bad of ["{", '{"type":"status","control":"true"}', new Uint8Array([1, 0]).buffer, new Uint8Array([2]).buffer]) expect(parseStreamMessage(bad)).toBeNull();
});

test("configures Annex B without description, waits for keyframes and closes replaced frames", () => {
  let output!: (frame: VideoFrame) => void;
  const decode = vi.fn(); const close = vi.fn(); const configure = vi.fn();
  vi.stubGlobal("VideoDecoder", class { state = "configured"; decodeQueueSize = 0; constructor(init: VideoDecoderInit) { output = init.output; } configure = configure; decode = decode; close = close; });
  vi.stubGlobal("EncodedVideoChunk", class { constructor(init: EncodedVideoChunkInit) { Object.assign(this, init); } });
  const drawImage = vi.fn(); const canvas = document.createElement("canvas"); vi.spyOn(canvas, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const decoder = new StreamDecoder(canvas, vi.fn());
  decoder.configure({ type: "config", width: 1080, height: 2400, codec: "avc1.64001f" });
  expect(configure).toHaveBeenCalledWith({ codec: "avc1.64001f", optimizeForLatency: true });
  const frame = { type: "frame" as const, keyframe: false, timestamp: 1, data: new Uint8Array([0, 0, 1]) };
  decoder.decode(frame); expect(decode).not.toHaveBeenCalled(); decoder.decode({ ...frame, keyframe: true }); expect(decode).toHaveBeenCalledOnce();
  const first = { close: vi.fn() } as unknown as VideoFrame; const last = { close: vi.fn() } as unknown as VideoFrame;
  output(first); output(last); expect(first.close).toHaveBeenCalledOnce();
  decoder.close(); expect(last.close).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});

test("paints only the newest output per animation frame and releases it", () => {
  vi.useFakeTimers();
  try {
    let output!: (frame: VideoFrame) => void;
    vi.stubGlobal("VideoDecoder", class { state = "configured"; constructor(init: VideoDecoderInit) { output = init.output; } configure() {} close() {} });
    const drawImage = vi.fn(); const canvas = document.createElement("canvas"); vi.spyOn(canvas, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const decoder = new StreamDecoder(canvas, vi.fn()); decoder.configure({ type: "config", width: 100, height: 200, codec: "avc1.64001f" });
    const first = { close: vi.fn() } as unknown as VideoFrame; const last = { close: vi.fn() } as unknown as VideoFrame;
    output(first); output(last); expect(drawImage).not.toHaveBeenCalled(); vi.advanceTimersByTime(20);
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(last, 0, 0, 100, 200); expect(first.close).toHaveBeenCalledOnce(); expect(last.close).toHaveBeenCalledOnce(); decoder.close();
  } finally { vi.useRealTimers(); }
});
