import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { formatTime } from "../../../lib/format";
import { saveSettings } from "../../../lib/settings";
import { apiErrorResponse, healthBody, jsonResponse, mockApi } from "../../../test/api";
import { device, deviceCommand } from "../../../test/fixtures";
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
  expect(within(cards[0]!).getByText("87%")).toBeInTheDocument();
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
  await userEvent.click(await screen.findByRole("button", { name: "태그" }));
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
  expect(await within(screen.getByRole("article")).findByText("smoke")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(calls.filter((call) => call.method === "GET").length).toBeGreaterThan(1);
});

test("cancels tag edits without writing and restores the saved tags on reopen", async () => {
  withToken();
  const { calls } = mockApi({ "GET /api/v1/devices": [device({ tags: ["smoke"] })] });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "태그" }));
  await userEvent.type(screen.getByRole("textbox", { name: /^태그/ }), ", draft");
  await userEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(within(screen.getByRole("article")).getByText("smoke")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "태그" }));
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
  await openMaintenance("정비 모드 켜기");
  await userEvent.click(screen.getByRole("button", { name: "기기 메뉴" }));
  expect(screen.getByRole("menuitem", { name: "정비 모드 끄기" })).toBeEnabled();
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
  await openMaintenance("정비 모드 켜기");
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
  await openMaintenance("정비 모드 끄기");
  await waitFor(() => expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ disabled: false }));
  expect(confirm).not.toHaveBeenCalled();
});

test("disables all write controls without a token and shows the token notice", async () => {
  const { calls } = mockApi({ "GET /api/v1/devices": [device()], "GET /api/v1/healthz": healthBody({ auth_required: true }) });
  renderPage(<DevicesPage />);
  expect(await screen.findByText("쓰기 작업에는 API 토큰이 필요합니다.")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "태그" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "예약" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "스냅샷" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "기기 메뉴" }));
  expect(screen.getByRole("menuitem", { name: "정비 모드 켜기" })).toBeDisabled();
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("allows writes without a token when the farm does not require one", async () => {
  const { calls } = mockApi({
    "GET /api/v1/devices": [device()],
    "PATCH /api/v1/devices/emulator-5554": device({ disabled: true, state: "disabled" }),
  });
  renderPage(<DevicesPage />);
  await openMaintenance("정비 모드 켜기");
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
  await userEvent.click(within(first!).getByRole("button", { name: "태그" }));
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
  await openMaintenance("정비 모드 켜기");
  expect(await screen.findByRole("alert")).toHaveTextContent("토큰을 확인하세요. (unauthorized)");
  await userEvent.click(screen.getByRole("button", { name: "기기 메뉴" }));
  expect(screen.getByRole("menuitem", { name: "정비 모드 켜기" })).toBeEnabled();
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
    device({ serial: "zero", battery: 0, last_seen_at: null }),
  ] });
  renderPage(<DevicesPage />);
  expect(await screen.findByText(`예약: 운영자 · ${formatTime(future)}까지`)).toBeInTheDocument();
  expect(screen.getByText("예약: 운영자 · 만료됨")).toBeInTheDocument();
  expect(screen.getByText("19%")).toHaveClass("text-failed-fg");
  expect(screen.getByText("0%")).toHaveClass("text-failed-fg");
  expect(screen.getByText("배터리 정보 없음")).toBeInTheDocument();
  expect(screen.getByText("마지막 확인 -")).toBeInTheDocument();
});


async function openMaintenance(label: string) {
  await userEvent.click(await screen.findByRole("button", { name: "기기 메뉴" }));
  await userEvent.click(screen.getByRole("menuitem", { name: label }));
}

function reservation(holder_name = "Kim") {
  return {
    id: "res1", device_serial: "emulator-5554", holder_name, status: "active" as const,
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(), released_at: null,
  };
}

test("combines state and tag filters and preserves the full summary", async () => {
  mockApi({ "GET /api/v1/devices": [
    device({ model: "가능", tags: ["smoke"] }),
    device({ serial: "b", model: "실행", state: "busy", tags: ["smoke"] }),
    device({ serial: "c", model: "점검", state: "unhealthy", tags: ["tablet"] }),
    device({ serial: "d", model: "연결 끊김", state: "offline", tags: ["smoke"] }),
    device({ serial: "e", model: "정비", state: "disabled", disabled: true }),
  ] });
  renderPage(<DevicesPage />);
  await screen.findByText("가능");
  expect(screen.getAllByRole("article")).toHaveLength(5);
  await userEvent.click(screen.getByRole("radio", { name: "사용 가능" }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  await userEvent.click(screen.getByRole("radio", { name: "문제 있음" }));
  expect(screen.getAllByRole("article")).toHaveLength(3);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "태그 필터" }), "smoke");
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article")).toHaveAccessibleName("연결 끊김 (d)");
  await userEvent.click(screen.getByRole("radio", { name: "사용 가능" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "태그 필터" }), "tablet");
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(screen.getByText("조건에 맞는 기기가 없습니다.")).toBeInTheDocument();
  expect(screen.getByText("사용 가능 1 · 실행 중 1 · 점검 필요 1 · 정비 모드 1 · 오프라인 1")).toBeInTheDocument();
});

test.each(["Kim", "대시보드"])("reserves with author or fallback name %s then releases", async (holder) => {
  if (holder === "Kim") withToken();
  let current = device();
  const { calls } = mockApi({
    "GET /api/v1/devices": () => [current],
    "POST /api/v1/devices/emulator-5554/reservations": () => {
      current = device({ state: "reserved", reservation: reservation(holder) }); return reservation(holder);
    },
    "DELETE /api/v1/reservations/res1": () => { current = device(); return { ...reservation(holder), status: "released" }; },
  });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "예약" }));
  await userEvent.click(await screen.findByRole("button", { name: "예약 해제" }));
  expect(await screen.findByRole("button", { name: "예약" })).toBeEnabled();
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({ holder_name: holder });
  expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
});

test("hides reservation actions offline and in maintenance and prevents inspecting another holder's device", async () => {
  withToken();
  mockApi({ "GET /api/v1/devices": [
    device({ state: "offline" }), device({ serial: "b", state: "busy", disabled: true }),
    device({ serial: "c", state: "reserved", reservation: reservation("다른 운영자") }),
  ] });
  renderPage(<DevicesPage />);
  await screen.findAllByRole("article");
  for (const card of [screen.getByRole("article", { name: "Pixel 7 (emulator-5554)" }), screen.getByRole("article", { name: "Pixel 7 (b)" })]) {
    expect(within(card).queryByRole("button", { name: /^예약/ })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "스냅샷" })).toBeDisabled();
  }
  expect(within(screen.getByRole("article", { name: "Pixel 7 (c)" })).getByRole("button", { name: "스냅샷" })).toBeDisabled();
});

test("snapshot reserves, polls inspect, displays image and hierarchy count, then releases and keeps thumbnail", async () => {
  withToken();
  let polls = 0;
  const { calls } = mockApi({
    "GET /api/v1/devices": [device()],
    "POST /api/v1/devices/emulator-5554/reservations": reservation(),
    "POST /api/v1/reservations/res1/inspect": { id: "cmd1" },
    "GET /api/v1/device-commands/cmd1": () => ++polls === 1 ? deviceCommand() : deviceCommand({ status: "done", files: {
      "screen.png": "/api/v1/device-commands/cmd1/files/screen.png", "hierarchy.json": "/api/v1/device-commands/cmd1/files/hierarchy.json",
    } }),
    "GET /api/v1/device-commands/cmd1/files/hierarchy.json": { attributes: {}, children: [{ attributes: { text: "로그인" } }, { attributes: {}, children: [{ attributes: {} }] }] },
    "DELETE /api/v1/reservations/res1": { ...reservation(), status: "released" },
  });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "스냅샷" }));
  const dialog = await screen.findByRole("dialog", { name: "Pixel 7 스냅샷" }, { timeout: 3000 });
  expect(within(dialog).getByRole("img", { name: "Pixel 7 화면" })).toHaveAttribute("src", "/api/v1/device-commands/cmd1/files/screen.png");
  expect(within(dialog).getByText("계층 요소 4개")).toBeInTheDocument();
  await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
  expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/api/v1/devices/emulator-5554/reservations", "/api/v1/reservations/res1/inspect"]);
  expect(polls).toBe(2);
  await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
  expect(screen.getByRole("img", { name: "Pixel 7 최근 스냅샷" })).toHaveAttribute("src", "/api/v1/device-commands/cmd1/files/screen.png");
});

test("reuses an existing matching reservation without releasing it", async () => {
  withToken();
  const { calls } = mockApi({
    "GET /api/v1/devices": [device({ state: "reserved", reservation: reservation() })],
    "POST /api/v1/reservations/res1/inspect": { id: "cmd1" },
    "GET /api/v1/device-commands/cmd1": deviceCommand({ status: "done", files: { "screen.png": "/screen.png" } }),
  });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "스냅샷" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("계층 정보 없음")).toBeInTheDocument();
  expect(calls.filter((c) => c.method !== "GET").map((c) => c.path)).toEqual(["/api/v1/reservations/res1/inspect"]);
});

test.each(["inspect", "command", "poll", "hierarchy"])("shows %s failure on the card and releases a temporary reservation", async (stage) => {
  const { calls } = mockApi({
    "GET /api/v1/devices": [device()],
    "POST /api/v1/devices/emulator-5554/reservations": reservation("대시보드"),
    "POST /api/v1/reservations/res1/inspect": stage === "inspect" ? apiErrorResponse(409, "inspect_failed", "검사 실패") : { id: "cmd1" },
    "GET /api/v1/device-commands/cmd1": stage === "poll" ? apiErrorResponse(503, "poll_failed", "검사 실패") : deviceCommand({ status: stage === "command" ? "error" : "done", error_message: "검사 실패", files: { "screen.png": "/screen.png", "hierarchy.json": "/api/v1/device-commands/cmd1/files/hierarchy.json" } }),
    "GET /api/v1/device-commands/cmd1/files/hierarchy.json": apiErrorResponse(503, "hierarchy_failed", "검사 실패"),
    "DELETE /api/v1/reservations/res1": reservation(),
  });
  renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "스냅샷" }));
  expect(await within(screen.getByRole("article")).findByRole("alert")).toHaveTextContent("검사 실패");
  await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
  expect(screen.getByRole("button", { name: "스냅샷" })).toBeEnabled();
});

test("releases a temporary snapshot reservation on unmount", async () => {
  const { calls } = mockApi({
    "GET /api/v1/devices": [device()],
    "POST /api/v1/devices/emulator-5554/reservations": reservation(),
    "POST /api/v1/reservations/res1/inspect": { id: "cmd1" },
    "GET /api/v1/device-commands/cmd1": deviceCommand(),
    "DELETE /api/v1/reservations/res1": reservation(),
  });
  const { unmount } = renderPage(<DevicesPage />);
  await userEvent.click(await screen.findByRole("button", { name: "스냅샷" }));
  await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/device-commands/cmd1")).toBe(true));
  unmount();
  await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
});
