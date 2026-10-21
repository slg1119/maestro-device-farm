import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { formatTime } from "../../../lib/format";
import { saveSettings } from "../../../lib/settings";
import { apiErrorResponse, healthBody, jsonResponse, mockApi } from "../../../test/api";
import { device } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { DevicesPage } from "../DevicesPage";

afterEach(() => vi.restoreAllMocks());

function withToken() {
  saveSettings({ token: "t", authorName: "Kim", authorEmail: "kim@x.io" });
}

test("renders serial-sorted device cards with details, states and the current run link", async () => {
  mockApi({
    "GET /api/v1/devices": [
      device({ serial: "emulator-5556", model: "Pixel Tablet", state: "busy", current_run_id: "run9", state_reason: "테스트 실행 중", tags: ["tablet"] }),
      device(),
    ],
  });
  renderPage(<DevicesPage />);

  expect(await screen.findByText("Pixel Tablet")).toBeInTheDocument();
  const cards = screen.getAllByRole("article");
  expect(cards).toHaveLength(2);
  expect(within(cards[0]!).getByText("emulator-5554")).toBeInTheDocument();
  expect(within(cards[0]!).getByText("Pixel 7")).toBeInTheDocument();
  expect(within(cards[0]!).getByText("사용 가능")).toBeInTheDocument();
  expect(within(cards[0]!).getByText("태그 없음")).toBeInTheDocument();
  expect(within(cards[0]!).getByText("Android 14 · SDK 34")).toBeInTheDocument();
  expect(within(cards[0]!).getByText("🔋 87%")).toBeInTheDocument();
  expect(within(cards[0]!).getByText(/^마지막 확인 /)).toBeInTheDocument();
  expect(within(cards[1]!).getByText("emulator-5556")).toBeInTheDocument();
  expect(within(cards[1]!).getByText("실행 중")).toBeInTheDocument();
  expect(within(cards[1]!).getByText("테스트 실행 중")).toBeInTheDocument();
  expect(within(cards[1]!).getByText("tablet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "실행 중인 run" })).toHaveAttribute("href", "/runs/run9");
});

test("summarizes only non-zero states", async () => {
  mockApi({ "GET /api/v1/devices": [device(), device({ serial: "b", state: "busy" })] });
  renderPage(<DevicesPage />);
  expect(await screen.findByText("사용 가능 1 · 실행 중 1")).toBeInTheDocument();
});

test("summarizes all states in the specified order", async () => {
  mockApi({ "GET /api/v1/devices": [
    device({ serial: "f", state: "offline" }), device({ serial: "e", state: "disabled", disabled: true }),
    device({ serial: "d", state: "unhealthy" }), device({ serial: "c", state: "reserved" }),
    device({ serial: "b", state: "busy" }), device({ serial: "a" }),
  ] });
  renderPage(<DevicesPage />);
  expect(await screen.findByText("사용 가능 1 · 실행 중 1 · 예약됨 1 · 점검 필요 1 · 정비 모드 1 · 오프라인 1")).toBeInTheDocument();
});

test("saves trimmed, unique, non-empty, sorted tags with auth and refreshes the device", async () => {
  withToken();
  let current = device({ tags: ["phone", "regression"] });
  const { calls } = mockApi({
    "GET /api/v1/devices": () => [current],
    "PATCH /api/v1/devices/emulator-5554": () => {
      current = device({ tags: ["smoke", "tablet"] });
      return jsonResponse(200, current);
    },
  });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "태그 편집" }));
  const input = screen.getByRole("textbox", { name: /^태그/ });
  expect(input).toHaveValue("phone, regression");
  await userEvent.clear(input);
  await userEvent.type(input, " tablet, smoke, tablet ,smoke ,, ");
  await userEvent.click(screen.getByRole("button", { name: "저장" }));

  await waitFor(() => expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1));
  expect(calls.find((call) => call.method === "PATCH")).toMatchObject({
    path: "/api/v1/devices/emulator-5554", body: { tags: ["smoke", "tablet"] },
    headers: { Authorization: "Bearer t" },
  });
  expect(await screen.findByText("smoke")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(calls.filter((call) => call.method === "GET").length).toBeGreaterThan(1);
});

test("cancels tag edits without writing and restores the saved tags on reopen", async () => {
  withToken();
  const { calls } = mockApi({ "GET /api/v1/devices": [device({ tags: ["smoke"] })] });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "태그 편집" }));
  await userEvent.type(screen.getByRole("textbox", { name: /^태그/ }), ", draft");
  await userEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.getByText("smoke")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "태그 편집" }));
  expect(screen.getByRole("textbox", { name: /^태그/ })).toHaveValue("smoke");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("enables maintenance on an available device without confirmation and refreshes", async () => {
  withToken();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  let current = device();
  const { calls } = mockApi({
    "GET /api/v1/devices": () => [current],
    "PATCH /api/v1/devices/emulator-5554": () => {
      current = device({ disabled: true, state: "disabled" });
      return current;
    },
  });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "정비 모드 켜기" }));
  expect(await screen.findByRole("button", { name: "정비 모드 끄기" })).toBeEnabled();
  expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ disabled: true });
  expect(confirm).not.toHaveBeenCalled();
});

test.each([false, true])("asks before enabling maintenance on a busy device (confirmed: %s)", async (confirmed) => {
  withToken();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(confirmed);
  const { calls } = mockApi({
    "GET /api/v1/devices": [device({ state: "busy" })],
    "PATCH /api/v1/devices/emulator-5554": device({ state: "busy", disabled: true }),
  });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "정비 모드 켜기" }));
  expect(confirm).toHaveBeenCalledExactlyOnceWith("실행 중인 task는 끝까지 돌고 이후 배정이 멈춥니다. 정비 모드를 켤까요?");
  await waitFor(() => expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(confirmed ? 1 : 0));
  if (confirmed) expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ disabled: true });
});

test("disables maintenance without confirming even while the current task is busy", async () => {
  withToken();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { calls } = mockApi({
    "GET /api/v1/devices": [device({ state: "busy", disabled: true })],
    "PATCH /api/v1/devices/emulator-5554": device({ state: "busy" }),
  });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "정비 모드 끄기" }));
  await waitFor(() => expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ disabled: false }));
  expect(confirm).not.toHaveBeenCalled();
});

test("disables both write controls without a token and shows the token notice", async () => {
  const { calls } = mockApi({ "GET /api/v1/devices": [device()], "GET /api/v1/healthz": healthBody({ auth_required: true }) });
  renderPage(<DevicesPage />);
  expect(await screen.findByText("쓰기 작업에는 API 토큰이 필요합니다.")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "태그 편집" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "정비 모드 켜기" })).toBeDisabled();
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("allows writes without a token when the farm does not require one", async () => {
  const { calls } = mockApi({
    "GET /api/v1/devices": [device()],
    "PATCH /api/v1/devices/emulator-5554": device({ disabled: true, state: "disabled" }),
  });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "정비 모드 켜기" }));
  expect(screen.queryByText("쓰기 작업에는 API 토큰이 필요합니다.")).not.toBeInTheDocument();
  expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ disabled: true });
});

test("shows tag mutation errors on the affected card and keeps the draft for retry", async () => {
  withToken();
  mockApi({
    "GET /api/v1/devices": [device(), device({ serial: "other", model: "다른 기기" })],
    "PATCH /api/v1/devices/emulator-5554": apiErrorResponse(503, "unavailable", "태그를 저장할 수 없습니다."),
  });
  renderPage(<DevicesPage />);
  await screen.findByText("Pixel 7");
  const [first, second] = screen.getAllByRole("article");
  await userEvent.click(within(first!).getByRole("button", { name: "태그 편집" }));
  await userEvent.type(within(first!).getByRole("textbox", { name: /^태그/ }), "smoke");
  await userEvent.click(within(first!).getByRole("button", { name: "저장" }));
  expect(await within(first!).findByRole("alert")).toHaveTextContent("태그를 저장할 수 없습니다. (unavailable)");
  expect(within(first!).getByRole("textbox", { name: /^태그/ })).toHaveValue("smoke");
  expect(within(second!).queryByRole("alert")).not.toBeInTheDocument();
});

test("shows maintenance mutation errors on the card", async () => {
  withToken();
  mockApi({
    "GET /api/v1/devices": [device()],
    "PATCH /api/v1/devices/emulator-5554": apiErrorResponse(401, "unauthorized", "토큰을 확인하세요."),
  });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "정비 모드 켜기" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("토큰을 확인하세요. (unauthorized)");
  expect(screen.getByRole("button", { name: "정비 모드 켜기" })).toBeEnabled();
});

test("shows loading while the devices request is pending", () => {
  mockApi({ "GET /api/v1/devices": () => new Promise(() => {}) });
  renderPage(<DevicesPage />);
  expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
});

test("shows query errors", async () => {
  mockApi({ "GET /api/v1/devices": apiErrorResponse(503, "unavailable", "기기를 불러올 수 없습니다.") });
  renderPage(<DevicesPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("기기를 불러올 수 없습니다. (unavailable)");
});

test("shows the empty-device message", async () => {
  mockApi({ "GET /api/v1/devices": [] });
  renderPage(<DevicesPage />);
  expect(await screen.findByText("연결된 기기가 없습니다. farm-agent가 실행 중인지 확인하세요.")).toBeInTheDocument();
});

test("shows reservation expiry, low and unknown battery, and missing last-seen values", async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const reservation = {
    id: "res1", device_serial: "emulator-5554", holder_name: "운영자", status: "active" as const,
    created_at: past, expires_at: future, released_at: null,
  };
  mockApi({ "GET /api/v1/devices": [
    device({ state: "reserved", reservation, battery: 19 }),
    device({ serial: "other", reservation: { ...reservation, id: "res2", device_serial: "other", expires_at: past }, battery: null, last_seen_at: null }),
    device({ serial: "zero", battery: 0 }),
  ] });
  renderPage(<DevicesPage />);
  expect(await screen.findByText(`예약: 운영자 · ${formatTime(future)}까지`)).toBeInTheDocument();
  expect(screen.getByText("예약: 운영자 · 만료됨")).toBeInTheDocument();
  expect(screen.getByText("🔋 19%")).toHaveClass("text-red-600");
  expect(screen.getByText("🔋 0%")).toHaveClass("text-red-600");
  expect(screen.getByText("🔋 -")).toBeInTheDocument();
  expect(screen.getByText("마지막 확인 -")).toBeInTheDocument();
});
