import { getLanguage, getLocale, t } from "./i18n";
/** Server timestamps look like 2026-10-20T05:31:00.123456Z; Date parses the first three fraction digits. */
export function parseTs(ts: string): Date {
  return new Date(ts.replace(/(\.\d{3})\d+Z$/, "$1Z"));
}

export function formatTime(ts: string | null | undefined): string {
  if (!ts) return "-";
  return parseTs(ts).toLocaleString(getLocale(), { hour12: false });
}

export function formatClock(time: Date, options?: Intl.DateTimeFormatOptions): string {
  return time.toLocaleTimeString(getLocale(), options);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

export function formatSeconds(seconds: number): string {
  return formatNumber(seconds, { style: "unit", unit: "second", unitDisplay: "long", maximumFractionDigits: 1, useGrouping: getLocale() === "en-US" });
}

export function timeAgo(ts: string | null | undefined, now: Date = new Date()): string {
  if (!ts) return "-";
  const sec = Math.max(0, Math.round((now.getTime() - parseTs(ts).getTime()) / 1000));
  if (getLanguage() === "ko") {
    if (sec < 60) return t("m_d4decd2f8c", [sec]);
    if (sec < 3600) return t("m_8991774866", [Math.floor(sec / 60)]);
    if (sec < 86400) return t("m_672ec9854d", [Math.floor(sec / 3600)]);
    return t("m_d8c0836a7e", [Math.floor(sec / 86400)]);
  }
  const relative = new Intl.RelativeTimeFormat(getLocale(), { numeric: "always" });
  if (sec < 60) return relative.format(-sec, "second");
  if (sec < 3600) return relative.format(-Math.floor(sec / 60), "minute");
  if (sec < 86400) return relative.format(-Math.floor(sec / 3600), "hour");
  return relative.format(-Math.floor(sec / 86400), "day");
}

export function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  const digits = (value: number) => getLanguage() === "ko" ? String(value) : formatNumber(value);
  if (sec < 60) return `${digits(sec)}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${digits(min)}m ${digits(sec % 60)}s`;
  return `${digits(Math.floor(min / 60))}h ${digits(min % 60)}m`;
}

/** Formats whole seconds as localized hours, minutes and seconds, omitting zero parts. */
export function formatDurationKo(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  if (getLanguage() === "ko") return [hours ? t("m_5df5e40898", [hours]) : "", minutes ? t("m_af7fcb67e9", [minutes]) : "", sec ? t("m_ed2dcdb1c5", [sec]) : ""]
    .filter(Boolean).join(" ") || t("m_1713026f34");
  const unit = (value: number, name: Intl.NumberFormatOptions["unit"]) => formatNumber(value, { style: "unit", unit: name, unitDisplay: "long" });
  return [hours ? unit(hours, "hour") : "", minutes ? unit(minutes, "minute") : "", sec ? unit(sec, "second") : ""]
    .filter(Boolean).join(" ") || unit(0, "second");
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
  if (bytes < 1024) return `${getLanguage() === "ko" ? bytes : formatNumber(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = getLanguage() === "ko" ? value.toFixed(value < 10 ? 1 : 0)
    : formatNumber(value, { minimumFractionDigits: value < 10 ? 1 : 0, maximumFractionDigits: value < 10 ? 1 : 0 });
  return `${rounded} ${units[unit]}`;
}

export function githubCommitUrl(repo: string, sha: string): string {
  return `https://github.com/${repo}/commit/${sha}`;
}
