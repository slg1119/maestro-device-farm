import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createStreamTicket } from "../../api/queries";
import { parseStreamMessage, StreamDecoder, type StreamConfig, type StreamStatus } from "./decoder";

type Phase = "connecting" | "connected" | "reconnecting" | "ended" | "unsupported";
interface Options { serial: string; control: "auto" | "never"; canWrite: boolean; canvas: RefObject<HTMLCanvasElement | null> }
const GONE = new Set(["device_disconnected", "device_unavailable"]);

export function useLiveStream({ serial, control, canWrite, canvas }: Options) {
  const supported = typeof VideoDecoder !== "undefined" && typeof EncodedVideoChunk !== "undefined";
  const wanted = control === "auto" && canWrite;
  const [phase, setPhase] = useState<Phase>(supported ? "connecting" : "unsupported");
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [size, setSize] = useState<StreamConfig | null>(null);
  const [message, setMessage] = useState("");
  const connection = useRef<{ ws: WebSocket | null; allowed: boolean }>({ ws: null, allowed: false });

  useEffect(() => {
    if (!supported || !canvas.current) { setPhase("unsupported"); return; }
    let active = true; let terminal = false; let delay = 1000;
    let retry: ReturnType<typeof setTimeout> | undefined; let stable: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null; let decoder: StreamDecoder | null = null;
    const abort = new AbortController();
    const reset = () => {
      connection.current.allowed = false; setStatus(null); setSize(null);
      clearTimeout(stable); decoder?.close(); decoder = null;
    };
    const reconnect = () => {
      if (!active || terminal || retry !== undefined) return;
      reset(); setPhase("reconnecting");
      retry = setTimeout(() => { retry = undefined; void connect(); }, delay);
      delay = Math.min(delay * 2, 30000);
    };
    const connect = async () => {
      if (!active) return;
      try {
        const ticket = wanted ? await createStreamTicket(serial, abort.signal) : null;
        if (!active) return;
        const url = new URL(`/api/v1/devices/${encodeURIComponent(serial)}/stream`, window.location.href);
        url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        if (ticket) url.searchParams.set("ticket", ticket.ticket);
        const socket = new WebSocket(url.toString()); ws = socket;
        connection.current = { ws: socket, allowed: false }; socket.binaryType = "arraybuffer";
        const failDecode = () => {
          if (!active || ws !== socket) return;
          setMessage("화면을 해독하지 못했습니다. 다시 연결합니다.");
          socket.close(); reconnect();
        };
        decoder = new StreamDecoder(canvas.current!, failDecode);
        socket.onopen = () => {
          if (!active || ws !== socket) return;
          setPhase("connected"); setMessage("");
          stable = setTimeout(() => { delay = 1000; }, 30000);
        };
        socket.onmessage = event => {
          if (!active || ws !== socket || terminal || retry !== undefined) return;
          const parsed = parseStreamMessage(event.data);
          if (!parsed) return;
          try {
            if (parsed.type === "config") { decoder?.configure(parsed); setSize(parsed); }
            else if (parsed.type === "frame") decoder?.decode(parsed);
            else if (parsed.type === "status") { connection.current.allowed = wanted && parsed.control; setStatus(parsed); }
            else {
              terminal = GONE.has(parsed.reason); setMessage(parsed.message || "실시간 화면 연결이 종료됐습니다.");
              reset(); setPhase(terminal ? "ended" : "reconnecting"); socket.close(); if (!terminal) reconnect();
            }
          } catch { failDecode(); }
        };
        socket.onclose = () => { if (active && ws === socket && !terminal) reconnect(); };
        socket.onerror = () => { if (active && ws === socket) { socket.close(); reconnect(); } };
      } catch { if (active) { setMessage("실시간 화면에 연결하지 못했습니다. 다시 연결합니다."); reconnect(); } }
    };
    setPhase("connecting"); setMessage(""); reset(); void connect();
    return () => {
      active = false; abort.abort(); clearTimeout(retry); clearTimeout(stable);
      connection.current = { ws: null, allowed: false };
      if (ws) { ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.close(); }
      decoder?.close();
    };
  }, [serial, wanted, supported, canvas]);

  const send = useCallback((payload: object) => {
    const { ws, allowed } = connection.current;
    if (!wanted || !allowed || ws?.readyState !== 1) return false;
    try { ws.send(JSON.stringify(payload)); return true; } catch { return false; }
  }, [wanted]);
  return { phase, status, size, message, send, canControl: wanted && phase === "connected" && Boolean(status?.control) };
}
