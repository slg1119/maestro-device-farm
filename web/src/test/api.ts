import { vi } from "vitest";

export interface MockRequest {
  method: string;
  path: string;
  search: URLSearchParams;
  headers: Record<string, string>;
  /** Parsed JSON for JSON bodies, the FormData for multipart, otherwise undefined. */
  body: unknown;
}

type Handler = unknown | ((req: MockRequest) => unknown);

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function apiErrorResponse(status: number, code: string, message = code, extra: Record<string, unknown> = {}) {
  return jsonResponse(status, { error: { code, message, ...extra } });
}

export const HEALTH_KEY = "GET /api/v1/healthz";

/** Default /healthz body: an internal farm that does not require tokens. */
export function healthBody(overrides: Record<string, unknown> = {}) {
  return { status: "ok", agent: null, auth_required: false, workspace_sync_errors: [], disk_free_bytes: 1, ...overrides };
}

/**
 * Stubs global fetch. Keys are "METHOD /api/v1/path" (query string ignored). A handler is a value
 * (sent as 200 JSON), a Response, or a function of the request returning either.
 * `GET /api/v1/healthz` answers healthBody() unless overridden, and is never recorded in `calls`
 * (it is a background query, e.g. for whether writes need a token).
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: MockRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://farm.test");
    const method = (init.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else if (init.body instanceof FormData) {
      body = init.body;
    }
    const req: MockRequest = {
      method,
      path: url.pathname,
      search: url.searchParams,
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    };
    const key = `${method} ${url.pathname}`;
    if (key === HEALTH_KEY) {
      const handler = routes[key] ?? healthBody();
      const result = typeof handler === "function" ? await (handler as (r: MockRequest) => unknown)(req) : handler;
      return result instanceof Response ? result : jsonResponse(200, result);
    }
    calls.push(req);
    if (!(key in routes)) return apiErrorResponse(404, "not_mocked", key);
    const handler = routes[key];
    const result = typeof handler === "function" ? await (handler as (r: MockRequest) => unknown)(req) : handler;
    return result instanceof Response ? result : jsonResponse(200, result);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
