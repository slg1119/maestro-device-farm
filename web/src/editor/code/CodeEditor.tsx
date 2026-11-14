import { t } from "../../lib/i18n";
import MonacoEditor, { type OnMount } from "@monaco-editor/react";
// Monaco 0.57's default export includes suggestions/hover but omits code-action UI.
import "monaco-editor/editor/contrib/codeAction/browser/codeActionContributions";
import type * as Monaco from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { API, query } from "../../api/client";
import { Empty, ErrorBox, Loading } from "../../components/ui";
import { useTheme } from "../../lib/theme";
import { ensureMonaco } from "../monacoSetup";
import { closestCommand, completionsFor, maestroCommands } from "../maestroCommands";
import { encodedPath, useEditor, useEditorRuntime } from "../store";
import { commandLocation, editorAdapter, isImage, issueMarkers, languageFor } from "./adapter";

export function CodeEditor() {
  const api = useEditor(); const runtime = useEditorRuntime(); const { resolved } = useTheme();
  const [monaco, setMonaco] = useState<typeof Monaco | null>(null); const [content, setContent] = useState<{ path: string; text: string; sha: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const instance = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Set<Monaco.editor.ITextModel>());
  const latest = useRef({ api, runtime }); latest.current = { api, runtime };
  const path = api.activePath;
  const draft = path ? api.drafts[path] : undefined;
  const binary = Boolean(path && /\.(png|jpe?g|gif|webp|mp4|mov|mp3|wav)$/i.test(path));
  useEffect(() => { let alive = true; ensureMonaco().then(value => { if (alive) setMonaco(value); }).catch(e => { if (alive) setError(e); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    let alive = true; setError(null);
    if (path && !binary && draft?.status !== "deleted") api.readFile(path).then(text => { if (alive) setContent({ path, text, sha: api.baseSha }); }).catch(e => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [path, api.baseSha, draft?.content, draft?.status, binary]);
  useEffect(() => {
    if (!monaco) return;
    const completion = monaco.languages.registerCompletionItemProvider("yaml", {
      triggerCharacters: ["-", " ", ":", '"'],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const selectorValue = line.match(/(?:id|text|accessibilityText):\s*(["']?)[^"']*$/);
        const startColumn = selectorValue ? line.lastIndexOf(":") + 2 : word.startColumn;
        const suffix = model.getLineContent(position.lineNumber).slice(position.column - 1);
        const closingQuote = selectorValue?.[1] ? suffix.indexOf(selectorValue[1]) : -1;
        const endColumn = closingQuote >= 0 ? position.column + closingQuote + 1 : word.endColumn;
        const range = new monaco.Range(position.lineNumber, startColumn, position.lineNumber, endColumn);
        return { suggestions: completionsFor(line, latest.current.api.snapshotSelectors).map(c => ({ label: c.name, detail: c.description, kind: monaco.languages.CompletionItemKind.Snippet, insertText: selectorValue ? ` ${c.snippet}` : c.snippet, insertTextRules: selectorValue ? undefined : monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range })) };
      },
    });
    const hover = monaco.languages.registerHoverProvider("yaml", { provideHover(model, position) {
      const word = model.getWordAtPosition(position); const command = maestroCommands.find(c => c.name === word?.word);
      return command ? { contents: [{ value: `**${command.name}**\n\n${command.description}` }] } : null;
    } });
    const quickFix = monaco.languages.registerCodeActionProvider("yaml", { provideCodeActions(model, _range, context) {
      return { actions: context.markers.flatMap(marker => {
        const invalid = marker.message.match(/Invalid Command:\s*["']?([\w]+)/)?.[1]; const replacement = invalid ? closestCommand(invalid) : null;
        if (!invalid || !replacement) return [];
        const location = commandLocation(model.getLinesContent(), invalid, marker.startLineNumber);
        if (!location) return [];
        return [{ title: t("m_6f0e945798", [replacement]), kind: "quickfix", diagnostics: [marker], edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: new monaco.Range(location.line, location.column, location.line, location.column + invalid.length), text: replacement } }] } }];
      }), dispose() {} };
    } });
    return () => { completion.dispose(); hover.dispose(); quickFix.dispose(); };
  }, [monaco]);
  useEffect(() => {
    const model = instance.current?.getModel(); if (monaco && model) monaco.editor.setModelMarkers(model, "farm-validation", issueMarkers(path ? api.issues[path] ?? [] : []));
  }, [monaco, path, content, api.issues]);
  useEffect(() => () => { latest.current.runtime.attachEditor(null); instance.current = null; }, []);
  useEffect(() => {
    const open = new Set(api.openPaths.map(p => `inmemory://ws/${encodedPath(p)}`));
    for (const model of models.current) if (!open.has(model.uri.toString())) { model.dispose(); models.current.delete(model); }
  }, [api.openPaths]);
  useEffect(() => () => { for (const model of models.current) model.dispose(); models.current.clear(); }, []);
  const onMount: OnMount = (editor, library) => {
    instance.current = editor; runtime.attachEditor(editorAdapter(editor));
    if (editor.getModel()) models.current.add(editor.getModel()!);
    const positionListener = editor.onDidChangeCursorPosition(event => latest.current.runtime.setCursor({ line: event.position.lineNumber, column: event.position.column }));
    editor.onDidDispose(() => { positionListener.dispose(); if (instance.current === editor) { instance.current = null; latest.current.runtime.attachEditor(null); } });
    editor.addCommand(library.KeyMod.CtrlCmd | library.KeyCode.KeyS, () => {});
    library.editor.setModelMarkers(editor.getModel()!, "farm-validation", issueMarkers(path ? api.issues[path] ?? [] : []));
  };
  if (!path) return <Empty>{t("m_b866e4bc01")}</Empty>;
  if (draft?.status === "deleted") return <Empty>{t("m_ad40f6bb18")}</Empty>;
  if (error) return <ErrorBox error={error} />;
  if (binary) {
    const mime = /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.png$/i.test(path) ? "image/png" : /\.gif$/i.test(path) ? "image/gif" : "image/webp";
    const src = draft?.encoding === "base64" ? `data:${mime};base64,${draft.content}` : `${API}/workspaces/${encodeURIComponent(api.workspace.id)}/files/${encodedPath(path)}${query({ ref: api.baseSha })}`;
    return <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">{isImage(path) ? <img src={src} alt={path} className="max-h-full max-w-full object-contain" /> : <Empty>{t("m_02d20bb969")} {path}</Empty>}</div>;
  }
  if (!monaco || content?.path !== path || content.sha !== api.baseSha) return <Loading label={t("m_8934fcf01e")} />;
  return <MonacoEditor height="100%" keepCurrentModel path={`inmemory://ws/${encodedPath(path)}`} language={languageFor(path)} theme={`farm-${resolved}`}
    beforeMount={library => library.editor.setTheme(`farm-${resolved}`)} loading={<Loading label={t("m_8934fcf01e")} />}
    value={draft?.content ?? content.text} onMount={onMount} onChange={value => { if (value !== undefined) latest.current.api.setContent(path, value); }}
    options={{ ariaLabel: t("m_aa44501c41"), automaticLayout: true, minimap: { enabled: false }, fontFamily: "JetBrains Mono", fontSize: 13, tabSize: 2, insertSpaces: true, scrollBeyondLastLine: false, wordWrap: "on", padding: { top: 16 }, fixedOverflowWidgets: true }} />;
}
