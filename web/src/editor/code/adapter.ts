import type { Issue } from "../../api/types";
import type { EditorAdapter } from "../store";
import type { editor } from "monaco-editor";
export function issueMarkers(issues: Issue[]): editor.IMarkerData[] {
  return issues.map(issue => ({ severity: 8, message: issue.message, startLineNumber: Math.max(1, issue.line ?? 1), endLineNumber: Math.max(1, issue.line ?? 1), startColumn: Math.max(1, issue.column ?? 1), endColumn: Math.max(2, (issue.column ?? 1) + 1), source: issue.message.startsWith("YAML") ? "YAML" : "check-syntax" }));
}
export function commandLocation(lines: string[], command: string, preferredLine: number): { line: number; column: number } | null {
  const matchAt = (line: number) => {
    const match = lines[line - 1]?.match(/^(\s*-\s*)(\w+)(?=\s*:|\s*$)/);
    return match?.[2] === command ? { line, column: match[1]!.length + 1 } : null;
  };
  return matchAt(preferredLine) ?? lines.map((_, index) => matchAt(index + 1)).find(Boolean) ?? null;
}
export function editorAdapter(instance: editor.IStandaloneCodeEditor): EditorAdapter {
  return {
    insert(text) { const selection = instance.getSelection(); if (!selection) return; instance.pushUndoStop(); instance.executeEdits("farm-insert", [{ range: selection, text, forceMoveMarkers: true }]); instance.pushUndoStop(); instance.focus(); },
    reveal(line, column) { instance.setPosition({ lineNumber: line, column }); instance.revealLineInCenter(line); instance.focus(); },
  };
}
export const languageFor = (path: string) => /\.ya?ml$/i.test(path) ? "yaml" : /\.[cm]?js$/i.test(path) ? "javascript" : /\.json$/i.test(path) ? "json" : "plaintext";
export const isImage = (path: string) => /\.(png|jpe?g|gif|webp)$/i.test(path);
