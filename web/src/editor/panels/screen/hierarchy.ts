import type { SelectorCandidate } from "../../store";

export interface Bounds { x: number; y: number; width: number; height: number }
export interface ScreenElement { key: string; attributes: Record<string, string>; bounds: Bounds | null }
export type SelectorCommand = "tapOn" | "assertVisible";
const selectorKeys = [{ kind: "id", attribute: "resource-id" }, { kind: "text", attribute: "text" }, { kind: "accessibilityText", attribute: "accessibilityText" }] as const;

export function parseBounds(value: string | undefined): Bounds | null {
  const match = value?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  if (!match) return null;
  const [x, y, right, bottom] = match.slice(1).map(Number) as [number, number, number, number];
  if (![x, y, right, bottom].every(Number.isSafeInteger) || right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Maestro adds wrapper nodes without attributes; they still contain real children. */
export function flattenHierarchy(root: unknown): ScreenElement[] {
  const nodes: ScreenElement[] = [];
  const pending = [{ value: root, key: "0" }];
  while (pending.length) {
    const { value, key } = pending.pop()!;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as { attributes?: unknown; children?: unknown };
    if (node.attributes && typeof node.attributes === "object" && !Array.isArray(node.attributes)) {
      const attributes = Object.fromEntries(Object.entries(node.attributes).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      nodes.push({ key, attributes, bounds: parseBounds(attributes.bounds) });
    }
    if (Array.isArray(node.children)) for (let i = node.children.length - 1; i >= 0; i--) pending.push({ value: node.children[i], key: `${key}.${i}` });
  }
  return nodes;
}

export function hitTest(nodes: ScreenElement[], x: number, y: number): ScreenElement | null {
  let selected: ScreenElement | null = null;
  let area = Infinity;
  for (const node of nodes) {
    const b = node.bounds;
    // Prefer the deeper (later) node when a parent and child have identical bounds.
    if (b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height && b.width * b.height <= area) {
      selected = node; area = b.width * b.height;
    }
  }
  return selected;
}

export function candidatesFor(node: ScreenElement, nodes: ScreenElement[]): SelectorCandidate[] {
  return selectorKeys.flatMap(({ kind, attribute }) => {
    const value = node.attributes[attribute];
    if (!value?.trim()) return [];
    const count = nodes.filter(n => n.attributes[attribute] === value).length;
    return [{ kind, value, note: count === 1 ? kind === "id" ? "권장 · 고유" : "고유" : `같은 ${kind} ${count}개` }];
  });
}

/** Distinct kind/value pairs, including ambiguous values with their count note. */
export function snapshotCandidates(nodes: ScreenElement[]): SelectorCandidate[] {
  const seen = new Set<string>();
  return nodes.flatMap(node => candidatesFor(node, nodes)).filter(candidate => {
    const key = JSON.stringify([candidate.kind, candidate.value]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function selectorText(candidate: SelectorCandidate): string { return `${candidate.kind}: ${JSON.stringify(candidate.value)}`; }

/** Only the text after the cursor is inserted: existing indentation / a typed '- ' is reused. */
export function selectorInsertion(command: SelectorCommand, candidate: SelectorCandidate, content: string, cursor: { line: number; column: number }): string {
  const lines = content.split(/\r?\n/);
  const line = lines[cursor.line - 1] ?? "";
  const prefix = line.slice(0, Math.max(0, cursor.column - 1));
  const suffix = line.slice(Math.max(0, cursor.column - 1));
  if (prefix.trim() && suffix.trim()) throw new Error("명령을 삽입할 빈 줄이나 줄 끝에 커서를 놓아주세요.");
  const indentation = line.match(/^ */)?.[0] ?? "";
  const typedDash = /^ *- +$/.test(prefix);
  const blankPrefix = /^ *$/.test(prefix);
  if (blankPrefix && suffix.trim()) {
    // Keep the untouched command at its original indentation after the new block.
    return `${indentation.slice(prefix.length)}- ${command}:\n${indentation}    ${selectorText(candidate)}\n${prefix}`;
  }
  let indent = blankPrefix ? prefix : indentation;
  if (!blankPrefix && !typedDash) {
    for (let i = cursor.line - 1; i >= 0; i--) {
      const commandLine = lines[i]?.match(/^( *)-\s/);
      if (commandLine && commandLine[1]!.length <= indentation.length) { indent = commandLine[1]!; break; }
    }
  }
  const start = typedDash ? "" : blankPrefix ? "- " : `\n${indent}- `;
  return `${start}${command}:\n${indent}    ${selectorText(candidate)}\n`;
}
