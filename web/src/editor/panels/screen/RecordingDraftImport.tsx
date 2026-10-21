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
    if (recording.error || !value || value.status !== "done" || value.yaml === null) setNotice("완료된 녹화를 불러오지 못했습니다. 녹화 상태를 확인하세요.");
    else if (value.workspace_id && value.workspace_id !== latest.current.workspace.id) setNotice("다른 워크스페이스의 녹화입니다. 해당 워크스페이스에서 열어 주세요.");
    else {
      try { latest.current.importDraft(recordingPath(), value.yaml); setNotice("녹화 YAML을 새 파일로 가져왔습니다."); imported.current?.(); }
      catch { setNotice("녹화 YAML을 가져오지 못했습니다. 다시 시도하세요."); }
    }
    setParams(previous => { const next = new URLSearchParams(previous); if (next.get("draft") === id) next.delete("draft"); return next; }, { replace: true });
  }, [id, treeLoading, recording.data, recording.error, recording.isPending, recording.isFetching, setParams]);
  return notice ? <div role="status" className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2 text-xs text-fg-muted"><span>{notice}</span><Button size="sm" variant="ghost" onClick={() => setNotice("")}>닫기</Button></div> : null;
}
