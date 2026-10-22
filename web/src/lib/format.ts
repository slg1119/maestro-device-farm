/** Server timestamps look like 2026-10-20T05:31:00.123456Z; Date parses the first three fraction digits. */
export function parseTs(ts: string): Date {
  return new Date(ts.replace(/(\.\d{3})\d+Z$/, "$1Z"));
}

export function formatTime(ts: string | null | undefined): string {
  if (!ts) return "-";
  return parseTs(ts).toLocaleString("ko-KR", { hour12: false });
}

export function timeAgo(ts: string | null | undefined, now: Date = new Date()): string {
  if (!ts) return "-";
  const sec = Math.max(0, Math.round((now.getTime() - parseTs(ts).getTime()) / 1000));
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

export function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** Formats whole seconds as Korean hours, minutes and seconds, omitting zero parts. */
export function formatDurationKo(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  return [hours ? `${hours}시간` : "", minutes ? `${minutes}분` : "", sec ? `${sec}초` : ""]
    .filter(Boolean).join(" ") || "0초";
}

/** Wall-clock time between two timestamps; `end` defaults to now for running items. */
export function elapsed(start: string | null, end: string | null, now: Date = new Date()): string {
  if (!start) return "-";
  const stop = end ? parseTs(end) : now;
  return formatDuration(stop.getTime() - parseTs(start).getTime());
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "-";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function githubCommitUrl(repo: string, sha: string): string {
  return `https://github.com/${repo}/commit/${sha}`;
}
