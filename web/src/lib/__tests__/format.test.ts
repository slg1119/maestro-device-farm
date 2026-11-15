import { elapsed, formatBytes, formatClock, formatDuration, formatDurationKo, formatNumber, formatSeconds, formatTime, parseTs, shortSha, timeAgo } from "../format";
import { setLanguage } from "../i18n";

test.each([
  [1800, "30분"],
  [3600, "1시간"],
  [5400, "1시간 30분"],
  [90, "1분 30초"],
  [45, "45초"],
  [3605, "1시간 5초"],
  [0, "0초"],
])("formats %i seconds in Korean without zero parts", (seconds, expected) => {
  expect(formatDurationKo(seconds)).toBe(expected);
});

test("parses server timestamps with microseconds", () => {
  expect(parseTs("2026-10-20T05:31:00.123456Z").toISOString()).toBe("2026-10-20T05:31:00.123Z");
});

test("formats durations, ages, sizes and SHAs", () => {
  expect(formatDuration(5_000)).toBe("5s");
  expect(formatDuration(125_000)).toBe("2m 5s");
  expect(formatDuration(3_900_000)).toBe("1h 5m");
  const now = new Date("2026-10-20T06:00:00.000Z");
  expect(timeAgo("2026-10-20T05:59:30.000000Z", now)).toBe("30초 전");
  expect(timeAgo("2026-10-20T04:00:00.000000Z", now)).toBe("2시간 전");
  expect(elapsed("2026-10-20T05:59:00.000000Z", null, now)).toBe("1m 0s");
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(12_345_678)).toBe("12 MB");
  expect(shortSha("abcdef1234")).toBe("abcdef1");
  expect(shortSha(null)).toBe("-");
});

test("formats dates, clocks, relative time, durations and numbers in English", () => {
  setLanguage("en");
  const date = new Date(2026, 10, 15, 8, 53, 50);
  expect(formatTime(date.toISOString())).toBe(date.toLocaleString("en-US", { hour12: false }));
  expect(formatClock(date)).toBe(date.toLocaleTimeString("en-US"));
  expect(timeAgo("2026-10-20T05:59:59Z", new Date("2026-10-20T06:00:00Z"))).toBe("1 second ago");
  expect(timeAgo("2026-10-20T05:59:00Z", new Date("2026-10-20T06:00:00Z"))).toBe("1 minute ago");
  expect(formatDurationKo(3601)).toBe("1 hour 1 second");
  expect(formatDurationKo(1800)).toBe("30 minutes");
  expect(formatSeconds(1)).toBe("1 second");
  expect(formatSeconds(1.2)).toBe("1.2 seconds");
  expect(formatSeconds(1800)).toBe("1,800 seconds");
  expect(formatNumber(12345.6, { maximumFractionDigits: 1 })).toBe("12,345.6");
});

test("preserves Korean date, relative time and duration formatting", () => {
  setLanguage("ko");
  const date = new Date(2026, 10, 15, 8, 53, 50);
  expect(formatTime(date.toISOString())).toBe(date.toLocaleString("ko-KR", { hour12: false }));
  expect(formatClock(date)).toBe(date.toLocaleTimeString("ko-KR"));
  expect(timeAgo("2026-10-20T05:59:59Z", new Date("2026-10-20T06:00:00Z"))).toBe("1초 전");
  expect(formatDurationKo(3601)).toBe("1시간 1초");
  expect(formatDurationKo(3_600_000)).toBe("1000시간");
  expect(formatSeconds(1.2)).toBe("1.2초");
  expect(formatSeconds(1800)).toBe("1800초");
  expect(formatNumber(12345.6, { maximumFractionDigits: 1 })).toBe("12,345.6");
  expect(formatBytes(1000)).toBe("1000 B");
});
