import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useLiveStream } from "./useLiveStream";

const ticket = vi.hoisted(() => vi.fn());
vi.mock("../../api/queries", () => ({ createStreamTicket: ticket }));
class Socket {
  static instances: Socket[] = [];
  readyState = 0; binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; });
  constructor(readonly url: string) { Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(data: unknown) { this.onmessage?.({ data: typeof data === "string" || data instanceof ArrayBuffer ? data : JSON.stringify(data) }); }
  disconnect() { this.readyState = 3; this.onclose?.(); }
}
const status = { type: "status", viewers: 2, controller: "Kim", running_task_id: "task1", recording: true, control: true };
beforeEach(() => {
  vi.useFakeTimers(); Socket.instances = []; ticket.mockReset().mockImplementation(async () => ({ ticket: `ticket-${ticket.mock.calls.length}` }));
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("VideoDecoder", class { state = "configured"; decodeQueueSize = 0; configure = vi.fn(); decode = vi.fn(); close = vi.fn(); });
  vi.stubGlobal("EncodedVideoChunk", class {});
});
afterEach(() => { vi.useRealTimers(); });
async function start(control: "auto" | "never" = "auto", canWrite = true) {
  const canvas = { current: document.createElement("canvas") };
  const hook = renderHook(() => useLiveStream({ serial: "device /1", control, canWrite, canvas }));
  await act(async () => {});
  return hook;
}

test("binary config and frames reach WebCodecs, rotation replaces the decoder and unmount closes it", async () => {
  const configure = vi.fn(); const decode = vi.fn(); const close = vi.fn();
  vi.stubGlobal("VideoDecoder", class { state = "configured"; decodeQueueSize = 0; configure = configure; decode = decode; close = close; });
  vi.stubGlobal("EncodedVideoChunk", class { constructor(init: EncodedVideoChunkInit) { Object.assign(this, init); } });
  const hook = await start("never"); const ws = Socket.instances[0]!;
  const config = (width: number, height: number) => { const bytes = new Uint8Array([1, 0, 0, 0, 0, 11, ...new TextEncoder().encode("avc1.64001f")]); const view = new DataView(bytes.buffer); view.setUint16(1, width); view.setUint16(3, height); return bytes.buffer; };
  const frame = new Uint8Array([2, 1, 0, 0, 0, 0, 0, 0, 0, 42, 0, 0, 0, 1, 101]);
  act(() => { ws.open(); ws.message(config(1080, 2400)); ws.message(frame.buffer); });
  expect(configure).toHaveBeenCalledWith({ codec: "avc1.64001f", optimizeForLatency: true });
  expect(decode).toHaveBeenCalledWith(expect.objectContaining({ type: "key", timestamp: 42, data: frame.subarray(10) }));
  act(() => ws.message(config(2400, 1080))); expect(hook.result.current.size).toEqual(expect.objectContaining({ width: 2400, height: 1080 })); expect(close).toHaveBeenCalledOnce();
  hook.unmount(); expect(close).toHaveBeenCalledTimes(2);
});

test("uses a fresh ticket each connection, parses status, gates control and closes on unmount", async () => {
  const hook = await start(); const ws = Socket.instances[0]!;
  expect(ws.url).toContain("/api/v1/devices/device%20%2F1/stream?ticket=ticket-1");
  act(() => ws.open()); expect(hook.result.current.send({ type: "key", key: "HOME" })).toBe(false);
  act(() => ws.message(status));
  expect(hook.result.current.status).toEqual(status); expect(hook.result.current.canControl).toBe(true);
  act(() => { hook.result.current.send({ type: "key", key: "HOME" }); });
  expect(ws.send).toHaveBeenCalledWith('{"type":"key","key":"HOME"}');
  act(() => ws.disconnect()); expect(hook.result.current.canControl).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(ticket).toHaveBeenCalledTimes(2); expect(Socket.instances[1]!.url).toContain("ticket-2");
  hook.unmount(); expect(Socket.instances[1]!.close).toHaveBeenCalledOnce();
});

test.each([["never", true], ["auto", false]] as const)("%s / write=%s remains view only even if a status claims control", async (control, canWrite) => {
  const hook = await start(control, canWrite); const ws = Socket.instances[0]!;
  expect(ticket).not.toHaveBeenCalled(); expect(ws.url).not.toContain("ticket=");
  act(() => { ws.open(); ws.message(status); });
  expect(hook.result.current.canControl).toBe(false);
  for (const message of [{ type: "key", key: "HOME" }, { type: "touch", action: "down", x: 1, y: 1 }, { type: "scroll", x: 1, y: 1, dx: 0, dy: 1 }, { type: "text", text: "안녕" }]) expect(hook.result.current.send(message)).toBe(false);
  expect(ws.send).not.toHaveBeenCalled(); hook.unmount();
});

test("backs off 1 to 30 seconds, resets only after 30 seconds connected and stops on device gone", async () => {
  const hook = await start("never");
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const count = Socket.instances.length; act(() => Socket.instances.at(-1)!.disconnect());
    await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1); }); expect(Socket.instances).toHaveLength(count);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(Socket.instances).toHaveLength(count + 1);
  }
  act(() => Socket.instances.at(-1)!.open()); await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  const count = Socket.instances.length; act(() => Socket.instances.at(-1)!.disconnect()); await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(Socket.instances).toHaveLength(count + 1);
  act(() => { Socket.instances.at(-1)!.open(); Socket.instances.at(-1)!.message({ type: "ended", reason: "device_disconnected", message: "연결 종료" }); Socket.instances.at(-1)!.disconnect(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(Socket.instances).toHaveLength(count + 1); expect(hook.result.current.phase).toBe("ended"); hook.unmount();
});

test("unmount during ticket request never opens a late socket", async () => {
  let resolve!: (value: unknown) => void; ticket.mockImplementation(() => new Promise(r => { resolve = r; }));
  const hook = await start(); hook.unmount(); await act(async () => resolve({ ticket: "late" })); expect(Socket.instances).toHaveLength(0);
});

test("ticket failures retry without an unhandled rejection or reusing a ticket", async () => {
  ticket.mockRejectedValueOnce(new Error("unavailable")); const hook = await start();
  expect(hook.result.current.phase).toBe("reconnecting"); expect(Socket.instances).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(ticket).toHaveBeenCalledTimes(2); expect(Socket.instances).toHaveLength(1); hook.unmount();
});

test("temporary agent failure reconnects and revocation immediately blocks control", async () => {
  const hook = await start(); const ws = Socket.instances[0]!;
  act(() => { ws.open(); ws.message(status); ws.message({ ...status, control: false }); });
  expect(hook.result.current.send({ type: "key", key: "HOME" })).toBe(false);
  act(() => ws.message({ type: "ended", reason: "agent_unavailable", message: "에이전트에 연결할 수 없습니다" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(Socket.instances).toHaveLength(2); hook.unmount();
});
