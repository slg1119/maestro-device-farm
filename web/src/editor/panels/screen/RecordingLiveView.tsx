import { useState } from "react";
import { useSearchParams } from "react-router";
import { useApps } from "../../../api/queries";
import type { Recording } from "../../../api/types";
import { LiveView } from "../../../components/live/LiveView";
import { recordingPath } from "../../../components/live/recordingYaml";
import { ErrorBox } from "../../../components/ui";
import { useEditor } from "../../store";

export function RecordingLiveView({ serial, onImported }: { serial: string; onImported?: () => void }) {
  const api = useEditor(); const [, setParams] = useSearchParams(); const apps = useApps();
  const [error, setError] = useState<unknown>(null);
  const packageName = api.appChoice.app?.split("@")[0] || apps.data?.find(app => app.id === api.appChoice.app_build_id)?.package_name || api.workspace.default_app_package;
  const complete = (recording: Recording) => {
    if (recording.ai_job_id) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set("aiJob", recording.ai_job_id!); return next; }, { replace: true });
    } else if (recording.status === "done" && recording.yaml !== null) {
      try { api.importDraft(recordingPath(), recording.yaml); setError(null); onImported?.(); }
      catch (failure) { setError(failure); }
    }
  };
  return <><LiveView serial={serial} compact workspace={api.workspace} appPackage={packageName} onRecordingComplete={complete} /><ErrorBox error={error} /></>;
}
