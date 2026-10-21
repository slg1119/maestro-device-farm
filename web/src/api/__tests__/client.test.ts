import { ApiError, apiJson, query } from "../client";
import { saveSettings } from "../../lib/settings";
import { apiErrorResponse, mockApi } from "../../test/api";

test("adds the bearer token and encodes JSON bodies", async () => {
  saveSettings({ token: "farm_x", authorName: "", authorEmail: "" });
  const { calls } = mockApi({ "POST /api/v1/things": { ok: true } });
  await expect(apiJson("/things", { method: "POST", json: { a: 1 } })).resolves.toEqual({ ok: true });
  expect(calls[0]!.headers).toMatchObject({ Authorization: "Bearer farm_x", "Content-Type": "application/json" });
  expect(calls[0]!.body).toEqual({ a: 1 });
});

test("turns error bodies into ApiError with extra fields", async () => {
  mockApi({ "POST /api/v1/x": apiErrorResponse(409, "conflict", "files changed", { paths: ["a.yaml"] }) });
  const error = await apiJson("/x", { method: "POST", json: {} }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 409, code: "conflict", message: "files changed", extra: { paths: ["a.yaml"] } });
});

test("query skips empty values", () => {
  expect(query({ a: "1", b: undefined, c: "", d: 0 })).toBe("?a=1&d=0");
  expect(query({})).toBe("");
});

test("sends the author name percent-encoded so non-ASCII names fit in a header", async () => {
  saveSettings({ token: "", authorName: "홍길동", authorEmail: "" });
  const { calls } = mockApi({ "GET /api/v1/x": {} });
  await apiJson("/x");
  expect(calls[0]!.headers).toEqual({ "X-Farm-User": "%ED%99%8D%EA%B8%B8%EB%8F%99" });
});
