import { getSettings } from "../lib/settings";

export const API = "/api/v1";

/** farm-api error body: {"error": {"code", "message", ...extra}}. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function authHeaders(): Record<string, string> {
  const { token, authorName } = getSettings();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    // Without a token the server records this name as the creator (header values must be ASCII-safe).
    ...(authorName ? { "X-Farm-User": encodeURIComponent(authorName) } : {}),
  };
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } & Record<string, unknown> };
    const { code = `http_${res.status}`, message = res.statusText, ...extra } = body.error ?? {};
    return new ApiError(res.status, code, message, extra);
  } catch {
    return new ApiError(res.status, `http_${res.status}`, res.statusText || "request failed");
  }
}

/** Fetches `${API}${path}`; JSON bodies are encoded for you, FormData is sent as-is. */
export async function apiFetch(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      ...authHeaders(),
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) throw await toError(res);
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await apiFetch(path, init);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Builds "?a=1&b=2" from defined, non-empty values. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
