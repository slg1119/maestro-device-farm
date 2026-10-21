export interface StreamConfig { type: "config"; width: number; height: number; codec: string }
export interface StreamFrame { type: "frame"; keyframe: boolean; timestamp: number; data: Uint8Array<ArrayBuffer> }
export interface StreamStatus { type: "status"; viewers: number; controller: string | null; running_task_id: string | null; recording: boolean; control: boolean }
export interface StreamEnded { type: "ended"; reason: string; message?: string }
export type StreamMessage = StreamConfig | StreamFrame | StreamStatus | StreamEnded;

export function parseStreamMessage(data: string | ArrayBuffer): StreamMessage | null {
  if (typeof data === "string") {
    try {
      const value = JSON.parse(data);
      if (!value || typeof value !== "object") return null;
      if (value.type === "ended" && typeof value.reason === "string" && (value.message === undefined || typeof value.message === "string")) return value;
      if (value.type === "status" && Number.isInteger(value.viewers) && value.viewers >= 0
        && (value.controller === null || typeof value.controller === "string")
        && (value.running_task_id === null || typeof value.running_task_id === "string")
        && typeof value.recording === "boolean" && typeof value.control === "boolean") return value;
    } catch { /* Ignore malformed wire data. */ }
    return null;
  }
  if (!(data instanceof ArrayBuffer) || data.byteLength < 1) return null;
  const bytes = new Uint8Array(data); const view = new DataView(data);
  if (bytes[0] === 1 && bytes.length >= 6 && bytes.length === 6 + bytes[5]!) {
    const width = view.getUint16(1); const height = view.getUint16(3);
    const codec = String.fromCharCode(...bytes.subarray(6));
    if (width && height && /^avc1\.[0-9a-f]{6}$/i.test(codec)) return { type: "config", width, height, codec };
  }
  if (bytes[0] === 2 && bytes.length > 10) {
    const timestamp = Number(view.getBigUint64(2));
    if (Number.isSafeInteger(timestamp)) return { type: "frame", keyframe: Boolean(bytes[1]! & 1), timestamp, data: bytes.subarray(10) };
  }
  return null;
}

/** Video frames never enter React state. Keep only the newest output until paint. */
export class StreamDecoder {
  private decoder: VideoDecoder | null = null;
  private pending: VideoFrame | null = null;
  private paint: number | null = null;
  private needsKey = true;
  private generation = 0;
  constructor(private canvas: HTMLCanvasElement, private onError: () => void) {}

  configure(config: StreamConfig) {
    this.close(); this.needsKey = true;
    this.canvas.width = config.width; this.canvas.height = config.height;
    const generation = this.generation;
    this.decoder = new VideoDecoder({
      output: frame => {
        if (generation !== this.generation) { frame.close(); return; }
        this.pending?.close(); this.pending = frame;
        if (this.paint !== null) return;
        this.paint = requestAnimationFrame(() => {
          this.paint = null;
          const next = this.pending; this.pending = null;
          if (!next) return;
          try { this.canvas.getContext("2d")?.drawImage(next, 0, 0, this.canvas.width, this.canvas.height); }
          finally { next.close(); }
        });
      },
      error: () => { if (generation === this.generation) this.onError(); },
    });
    // No description means Annex B; SPS/PPS arrive prepended to every keyframe.
    this.decoder.configure({ codec: config.codec, optimizeForLatency: true });
  }

  decode(frame: StreamFrame) {
    if (!this.decoder || this.decoder.state !== "configured") return;
    if (this.decoder.decodeQueueSize > 4) { this.needsKey = true; return; }
    if (this.needsKey && !frame.keyframe) return;
    this.needsKey = false;
    this.decoder.decode(new EncodedVideoChunk({ type: frame.keyframe ? "key" : "delta", timestamp: frame.timestamp, data: frame.data }));
  }

  close() {
    this.generation += 1;
    if (this.paint !== null) cancelAnimationFrame(this.paint);
    this.paint = null; this.pending?.close(); this.pending = null;
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
  }
}
