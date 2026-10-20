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

/**
 * Stubs global fetch. Keys are "METHOD /api/v1/path" (query string ignored). A handler is a value
 * (sent as 200 JSON), a Response, or a function of the request returning either.
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
    calls.push(req);
    const key = `${method} ${url.pathname}`;
    if (!(key in routes)) return apiErrorResponse(404, "not_mocked", key);
    const handler = routes[key];
    const result = typeof handler === "function" ? await (handler as (r: MockRequest) => unknown)(req) : handler;
    return result instanceof Response ? result : jsonResponse(200, result);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
