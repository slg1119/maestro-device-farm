export interface DiffLine { kind: "same" | "removed" | "added"; text: string }

/** Line LCS, with a bounded allocation for unusually large generated files. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const split = (text: string) => text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n");
  const oldLines = split(before);
  const newLines = split(after);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;
  const a = oldLines.slice(prefix, oldLines.length - suffix);
  const b = newLines.slice(prefix, newLines.length - suffix);
  const lines: DiffLine[] = oldLines.slice(0, prefix).map((text) => ({ kind: "same", text }));
  if ((a.length + 1) * (b.length + 1) > 1_000_000) {
    for (const text of a) lines.push({ kind: "removed", text });
    for (const text of b) lines.push({ kind: "added", text });
  } else {
    const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lengths[i]![j] = a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
      }
    }
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        lines.push({ kind: "same", text: a[i++]! });
        j++;
      }
      else if (i < a.length && (j >= b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)) lines.push({ kind: "removed", text: a[i++]! });
      else lines.push({ kind: "added", text: b[j++]! });
    }
  }
  for (const text of oldLines.slice(oldLines.length - suffix)) lines.push({ kind: "same", text });
  return lines;
}
