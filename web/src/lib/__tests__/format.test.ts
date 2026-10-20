import { elapsed, formatBytes, formatDuration, parseTs, shortSha, timeAgo } from "../format";

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
