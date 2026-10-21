import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

// Monaco 0.57 exposes its local worker through package exports (no /esm/vs prefix).
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

let ready: Promise<typeof monaco> | undefined;

/** Kept inside the lazy editor route: no CDN loader or editor code in the app shell. */
export function ensureMonaco(): Promise<typeof monaco> {
  ready ??= Promise.resolve().then(() => {
    monaco.editor.defineTheme("farm-light", {
      base: "vs", inherit: true,
      rules: [
        { token: "type", foreground: "2440B8" }, { token: "tag", foreground: "2440B8" },
        { token: "key", foreground: "2440B8" }, { token: "string", foreground: "15803D" },
        { token: "number", foreground: "A15C07" }, { token: "keyword", foreground: "A15C07" },
        { token: "variable", foreground: "A15C07" }, { token: "comment", foreground: "6B7280", fontStyle: "italic" },
      ],
      colors: {
        "editor.background": "#FFFFFF", "editor.foreground": "#111827", "editorLineNumber.foreground": "#6B7280",
        "editorLineNumber.activeForeground": "#111827", "editor.selectionBackground": "#EEF1FD", "editor.lineHighlightBackground": "#FAFBFC",
        "editorCursor.foreground": "#3352E1", "editorIndentGuide.background1": "#E4E7EC", "editorWidget.border": "#E4E7EC",
      },
    });
    monaco.editor.defineTheme("farm-dark", {
      base: "vs-dark", inherit: true,
      rules: [
        { token: "type", foreground: "8AB4FF" }, { token: "tag", foreground: "8AB4FF" },
        { token: "key", foreground: "8AB4FF" }, { token: "operators", foreground: "7C8798" },
        { token: "delimiter", foreground: "7C8798" }, { token: "string", foreground: "7FD1A0" },
        { token: "number", foreground: "F2B37C" }, { token: "keyword", foreground: "F2B37C" },
        { token: "variable", foreground: "F2B37C" }, { token: "comment", foreground: "6B7686", fontStyle: "italic" },
      ],
      colors: {
        "editor.background": "#12161C", "editor.foreground": "#E6E9EF", "editorLineNumber.foreground": "#8792A2",
        "editorLineNumber.activeForeground": "#E6E9EF", "editor.selectionBackground": "#1E2A52", "editor.lineHighlightBackground": "#171C24",
        "editorCursor.foreground": "#5B7BFF", "editorIndentGuide.background1": "#1F252E", "editorWidget.border": "#1F252E",
      },
    });
    return monaco;
  });
  return ready;
}
