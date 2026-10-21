export interface VideoSize { width: number; height: number }

/** object-fit: contain, including the empty bars around a rotated video. */
export function videoPoint(clientX: number, clientY: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">, size: VideoSize, clamp = false) {
  if (rect.width <= 0 || rect.height <= 0 || size.width <= 0 || size.height <= 0) return null;
  const scale = Math.min(rect.width / size.width, rect.height / size.height);
  const x = (clientX - rect.left - (rect.width - size.width * scale) / 2) / scale;
  const y = (clientY - rect.top - (rect.height - size.height * scale) / 2) / scale;
  if (!Number.isFinite(x) || !Number.isFinite(y) || (!clamp && (x < 0 || y < 0 || x > size.width || y > size.height))) return null;
  return { x: Math.max(0, Math.min(size.width - 1, Math.floor(x))), y: Math.max(0, Math.min(size.height - 1, Math.floor(y))) };
}
