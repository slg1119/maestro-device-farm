import { t } from "../../../lib/i18n";
import type { DiffOnMount } from "@monaco-editor/react";
import { useEffect, useState } from "react";
import { ErrorBox, Loading } from "../../../components/ui";
import { useTheme } from "../../../lib/theme";

const releaseDiffModels: DiffOnMount = editor => {
  const models = editor.getModel();
  if (!models) return;
  // The React wrapper disposes models before the widget. Monaco 0.57 needs
  // the widget disposed first; retain its models only until disposal finishes.
  editor.onDidDispose(() => queueMicrotask(() => { models.original.dispose(); models.modified.dispose(); }));
};

export function ProposalEditor({ path, content, original }: { path: string; content: string; original?: string }) {
  const { resolved } = useTheme();
  const [editors, setEditors] = useState<typeof import("@monaco-editor/react") | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    // Importing the AI panel must not load Monaco before a proposal is mounted.
    Promise.all([import("@monaco-editor/react"), import("../../monacoSetup")])
      .then(async ([module, { ensureMonaco }]) => {
        await ensureMonaco();
        if (alive) setEditors(module);
      }).catch(e => { if (alive) setError(e); });
    return () => { alive = false; };
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!editors) return <Loading label={t("m_2c2dcc6654")} />;
  const { default: MonacoEditor, DiffEditor } = editors;
  const language = /\.json$/i.test(path) ? "json" : /\.js$/i.test(path) ? "javascript" : "yaml";
  const options = { readOnly: true, domReadOnly: true, readOnlyMessage: { value: t("m_f1955b0be1") }, automaticLayout: true, minimap: { enabled: false }, fontFamily: "JetBrains Mono", fontSize: 12, tabSize: 2, wordWrap: "on" as const, scrollBeyondLastLine: false };
  return original === undefined
    ? <MonacoEditor height="260px" language={language} theme={`farm-${resolved}`} value={content} options={{ ...options, ariaLabel: t("m_cde1dcf3bd") }} />
    : <DiffEditor height="min(55vh, 500px)" language={language} theme={`farm-${resolved}`} original={original} modified={content} keepCurrentOriginalModel keepCurrentModifiedModel onMount={releaseDiffModels} options={{ ...options, originalEditable: false, renderSideBySide: false, ariaLabel: t("m_7ecb8c52ee", [path]) }} />;
}
