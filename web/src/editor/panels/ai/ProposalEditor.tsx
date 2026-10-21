import MonacoEditor, { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { useEffect, useState } from "react";
import { ErrorBox, Loading } from "../../../components/ui";
import { useTheme } from "../../../lib/theme";
import { ensureMonaco } from "../../monacoSetup";

const releaseDiffModels: DiffOnMount = editor => {
  const models = editor.getModel();
  if (!models) return;
  // The React wrapper disposes models before the widget. Monaco 0.57 needs
  // the widget disposed first; retain its models only until disposal finishes.
  editor.onDidDispose(() => queueMicrotask(() => { models.original.dispose(); models.modified.dispose(); }));
};

export function ProposalEditor({ path, content, original }: { path: string; content: string; original?: string }) {
  const { resolved } = useTheme();
  const [ready, setReady] = useState(false); const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    ensureMonaco().then(() => { if (alive) setReady(true); }).catch(e => { if (alive) setError(e); });
    return () => { alive = false; };
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!ready) return <Loading label="미리보기를 불러오는 중…" />;
  const language = /\.json$/i.test(path) ? "json" : /\.js$/i.test(path) ? "javascript" : "yaml";
  const options = { readOnly: true, domReadOnly: true, readOnlyMessage: { value: "AI 제안은 읽기 전용입니다. 반영 후 에디터에서 수정하세요." }, automaticLayout: true, minimap: { enabled: false }, fontFamily: "JetBrains Mono", fontSize: 12, tabSize: 2, wordWrap: "on" as const, scrollBeyondLastLine: false };
  return original === undefined
    ? <MonacoEditor height="260px" language={language} theme={`farm-${resolved}`} value={content} options={{ ...options, ariaLabel: "AI 제안 코드" }} />
    : <DiffEditor height="min(55vh, 500px)" language={language} theme={`farm-${resolved}`} original={original} modified={content} keepCurrentOriginalModel keepCurrentModifiedModel onMount={releaseDiffModels} options={{ ...options, originalEditable: false, renderSideBySide: false, ariaLabel: `${path} 변경 비교` }} />;
}
