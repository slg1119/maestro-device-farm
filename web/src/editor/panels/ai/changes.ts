/** Count a shortest line edit sequence, ignoring an EOF newline as a separate line. */
export function lineChanges(original: string, modified: string): { added: number; removed: number } {
  const lines = (text: string) => text ? text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : [];
  const a = lines(original); const b = lines(modified);
  let start = 0; let endA = a.length; let endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start; const m = endB - start;
  if (!n || !m) return { added: m, removed: n };
  const existing = new Set(a.slice(start, endA));
  if (!b.slice(start, endB).some(line => existing.has(line))) return { added: m, removed: n };
  // Myers' frontier needs linear space and is fast for the small edits shown here.
  const frontier = new Map<number, number>([[1, 0]]);
  for (let distance = 0; distance <= n + m; distance++) {
    for (let k = -distance; k <= distance; k += 2) {
      let x = k === -distance || (k !== distance && (frontier.get(k - 1) ?? 0) < (frontier.get(k + 1) ?? 0))
        ? frontier.get(k + 1) ?? 0 : (frontier.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) { x++; y++; }
      if (x >= n && y >= m) return { added: (m - n + distance) / 2, removed: (n - m + distance) / 2 };
      frontier.set(k, x);
    }
  }
  return { added: m, removed: n };
}

export function suggestedPath(prompt: string): string {
  const slug = prompt.trim().normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/, "");
  return `flows/${slug || "new-flow"}.yaml`;
}
