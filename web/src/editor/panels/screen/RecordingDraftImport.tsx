import { t } from "../../../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useRecording } from "../../../api/queries";
import { recordingPath } from "../../../components/live/recordingYaml";
import { Button } from "../../../components/ui";
import { useEditor, useEditorRuntime } from "../../store";

/** URLs carry an opaque recording id; YAML stays in the API and editor drafts. */
export function RecordingDraftImport({ onImported }: { onImported?: () => void }) {
  const api = useEditor(); const { treeLoading } = useEditorRuntime(); const latest = useRef(api); latest.current = api;
  const [params, setParams] = useSearchParams(); const id = params.get("draft"); const recording = useRecording(id);
  const [notice, setNotice] = useState(""); const consumed = useRef<string | null>(null);
  const imported = useRef(onImported); imported.current = onImported;
  useEffect(() => {
    if (!id || consumed.current === id || treeLoading || recording.isPending || recording.isFetching) return;
    consumed.current = id;
    const value = recording.data;
    if (recording.error || !value || value.status !== "done" || value.yaml === null) setNotice(t("m_f137c767fa"));
    else if (value.workspace_id && value.workspace_id !== latest.current.workspace.id) setNotice(t("m_45f9c05fc1"));
    else {
      try { latest.current.importDraft(recordingPath(), value.yaml); setNotice(t("m_c9023c543f")); imported.current?.(); }
      catch { setNotice(t("m_0de28c53fd")); }
    }
    setParams(previous => { const next = new URLSearchParams(previous); if (next.get("draft") === id) next.delete("draft"); return next; }, { replace: true });
  }, [id, treeLoading, recording.data, recording.error, recording.isPending, recording.isFetching, setParams]);
  return notice ? <div role="status" className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2 text-xs text-fg-muted"><span>{notice}</span><Button size="sm" variant="ghost" onClick={() => setNotice("")}>{t("m_94b7dba159")}</Button></div> : null;
}
