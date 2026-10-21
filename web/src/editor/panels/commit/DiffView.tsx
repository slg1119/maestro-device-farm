import { DiffEditor } from "@monaco-editor/react";
import { useEffect, useState } from "react";
import { Badge, cx, Empty, ErrorBox, Loading } from "../../../components/ui";
import { useTheme } from "../../../lib/theme";
import { ensureMonaco } from "../../monacoSetup";
import { type FileDiff, lineCounts, statusLetter, statusTone } from "./data";

export function FileChoice({ file, selected, onClick, counts = false }: { file: FileDiff; selected: boolean; onClick(): void; counts?: boolean }) {
  const count = counts && !file.binary ? lineCounts(file.original, file.modified) : null;
  return <button type="button" aria-pressed={selected} onClick={onClick}
    className={cx("flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent", selected ? "border-accent/40 bg-accent-soft text-accent-soft-fg" : "border-transparent hover:bg-surface-2 text-fg")}>
    <Badge tone={statusTone[file.status]}>{statusLetter[file.status]}</Badge>
    <span className="min-w-0 flex-1 break-all font-mono">{file.fromPath ? `${file.fromPath} → ` : ""}{file.path}</span>
    {count && <span className="shrink-0 whitespace-nowrap font-mono"><span className="text-passed-fg">+{count.added}</span> <span className="text-failed-fg">−{count.removed}</span></span>}
    {file.binary && <span className="text-fg-subtle">미디어</span>}
  </button>;
}

export function DiffView({ file, fromLabel, toLabel }: { file: FileDiff; fromLabel: string; toLabel: string }) {
  const { resolved } = useTheme(); const [ready, setReady] = useState(false); const [error, setError] = useState<unknown>(null);
  useEffect(() => { let alive = true; ensureMonaco().then(() => { if (alive) setReady(true); }).catch(e => { if (alive) setError(e); }); return () => { alive = false; }; }, []);
  return <section aria-label={`${file.path} 변경 내용`} className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
    <div className="flex flex-wrap justify-between gap-1 border-b border-border bg-surface-2 px-3 py-2 font-mono text-[11px] text-fg-muted"><span className="break-all">{fromLabel}</span><span aria-hidden="true">→</span><span className="break-all">{toLabel}</span></div>
    {file.binary ? <Empty>미디어 파일은 텍스트 비교를 지원하지 않습니다.</Empty> : error ? <ErrorBox error={error} /> : !ready ? <Loading label="비교 편집기를 불러오는 중…" /> : <div className="h-80 min-w-0 md:h-[420px]">
      <DiffEditor key={`${file.path}:${fromLabel}:${toLabel}`} height="100%" original={file.original} modified={file.modified} keepCurrentOriginalModel keepCurrentModifiedModel
        onMount={editor => {
          // The wrapper disposes models before the widget; Monaco 0.57 requires the reverse order.
          const models = editor.getModel();
          editor.onDidDispose(() => queueMicrotask(() => { models?.original.dispose(); models?.modified.dispose(); }));
        }}
        language={/\.ya?ml$/i.test(file.path) ? "yaml" : /\.json$/i.test(file.path) ? "json" : /\.[cm]?js$/i.test(file.path) ? "javascript" : "plaintext"} theme={`farm-${resolved}`}
        options={{ readOnly: true, originalEditable: false, automaticLayout: true, renderSideBySide: false, minimap: { enabled: false }, fontFamily: "JetBrains Mono", fontSize: 12, scrollBeyondLastLine: false, wordWrap: "on", diffWordWrap: "on", ariaLabel: `${file.path} 읽기 전용 변경 비교` }} />
    </div>}
  </section>;
}
