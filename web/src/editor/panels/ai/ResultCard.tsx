import { Check, FileCode2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { AiJob } from "../../../api/types";
import { Button, Card, Checkbox, ErrorBox, Loading, Modal, Tabs } from "../../../components/ui";
import { useEditor, useEditorRuntime } from "../../store";
import { lineChanges } from "./changes";
import { ProposalEditor } from "./ProposalEditor";

type Comparison = { text: string; error?: never } | { error: unknown; text?: never };
export function ResultCard({ job, canWrite, onDismiss }: { job: AiJob; canWrite: boolean; onDismiss: (applied?: boolean) => void }) {
  const api = useEditor(); const { treeLoading } = useEditorRuntime();
  const files = job.result!.files;
  const [selected, setSelected] = useState(() => new Set(files.map(f => f.path)));
  const [preview, setPreview] = useState(files.find(f => f.path === job.options.target_path)?.path ?? files[0]?.path ?? "");
  const [diff, setDiff] = useState<string | null>(null);
  const [comparisons, setComparisons] = useState<Record<string, Comparison>>({});
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(api); latest.current = api;
  const paths = api.files.map(f => f.path).join("\n");
  useEffect(() => {
    let alive = true; setComparisons({});
    if (treeLoading) return;
    for (const file of files) {
      const editor = latest.current;
      const exists = editor.files.some(f => f.path === file.path) && editor.drafts[file.path]?.status !== "deleted";
      const read = exists ? editor.readFile(file.path) : Promise.resolve("");
      void read.then(text => { if (alive) setComparisons(all => ({ ...all, [file.path]: { text } })); })
        .catch(error => { if (alive) setComparisons(all => ({ ...all, [file.path]: { error } })); });
    }
    return () => { alive = false; };
  }, [files, api.drafts, api.baseSha, paths, treeLoading]);
  const toggle = (path: string) => setSelected(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const apply = () => {
    if (!canWrite || !selected.size) return;
    try {
      const chosen = files.filter(f => selected.has(f.path));
      api.applyChanges(chosen.map(file => ({ op: "put", ...file })));
      if (chosen[0]) api.openFile(chosen[0].path);
      onDismiss(true);
    } catch (e) { setError(e); }
  };
  const previewFile = files.find(f => f.path === preview);
  const diffFile = files.find(f => f.path === diff);
  const original = diff ? comparisons[diff] : undefined;
  return <div className="min-w-0 space-y-4">
    <Card className="space-y-4 border-ai/25 p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ai-fg"><FileCode2 aria-hidden="true" className="size-4" />변경안</h3>
      <p className="whitespace-pre-wrap break-words text-sm text-fg">{job.result!.summary}</p>
      {job.result!.assumptions.length > 0 && <div><h4 className="mb-1 text-xs font-semibold text-fg-muted">가정</h4><ul className="list-disc space-y-1 pl-4 text-xs text-fg-muted">{job.result!.assumptions.map((item, i) => <li key={i} className="break-words">{item}</li>)}</ul></div>}
      <fieldset className="min-w-0 space-y-2"><legend className="mb-2 text-xs font-semibold text-fg-muted">반영할 파일</legend>
        {files.map(file => {
          const comparison = comparisons[file.path]; const counts = comparison?.text !== undefined ? lineChanges(comparison.text, file.content) : null;
          return <div key={file.path} className="flex min-w-0 flex-wrap items-center gap-x-2 rounded-lg border border-border px-2 py-1">
            <label className="flex min-h-9 min-w-0 flex-1 items-center gap-2 max-md:min-h-11"><Checkbox aria-label={`${file.path} 반영`} checked={selected.has(file.path)} onChange={() => toggle(file.path)} /><span className="min-w-0 break-all font-mono text-xs">{file.path}</span></label>
            {counts ? <span aria-label={`${file.path} 추가 ${counts.added}줄 삭제 ${counts.removed}줄`} className="shrink-0 font-mono text-[11px]"><span className="text-passed-fg">+{counts.added}</span> <span className="text-failed-fg">−{counts.removed}</span></span> : <span className="text-[11px] text-fg-subtle">{comparison?.error ? "비교 불가" : "계산 중…"}</span>}
            <Button size="sm" aria-label={`${file.path} diff`} onClick={() => setDiff(file.path)}>diff</Button>
          </div>;
        })}
      </fieldset>
      {job.result!.passed_run_id && <Link to={`/runs/${encodeURIComponent(job.result!.passed_run_id)}`} className="inline-flex min-h-8 items-center gap-1 text-xs text-passed-fg underline max-md:min-h-11"><Check aria-hidden="true" className="size-3.5" />통과한 실행 보기</Link>}
      {Boolean(error) && <ErrorBox error={error} />}
      <div className="flex flex-col gap-2"><Button variant="ai" disabled={!canWrite || !selected.size} onClick={apply}>선택한 파일을 에디터에 반영</Button><Button variant="ghost" onClick={() => onDismiss()}>버리기</Button></div>
    </Card>
    {previewFile && <section aria-label="AI 제안 미리보기" className="min-w-0 overflow-hidden rounded-lg border border-border">
      <Tabs label="AI 제안 파일" value={preview} onChange={setPreview} options={files.map(f => ({ value: f.path, label: <span title={f.path} className="block max-w-52 truncate text-xs">{f.path.split("/").at(-1)} · AI 제안 · 반영 전</span> }))} />
      <p className="break-all border-b border-border bg-ai-bg px-3 py-2 text-[11px] text-ai-fg">{previewFile.path} · 읽기 전용</p>
      <ProposalEditor path={previewFile.path} content={previewFile.content} />
    </section>}
    {diffFile && <Modal title={`${diffFile.path} diff`} size="xl" onClose={() => setDiff(null)}>
      <p className="mb-3 text-xs text-fg-muted">현재 에디터 내용 → AI 제안 · 읽기 전용</p>
      {original?.error ? <ErrorBox error={original.error} /> : original?.text !== undefined ? <ProposalEditor path={diffFile.path} content={diffFile.content} original={original.text} /> : <Loading label="현재 파일을 읽는 중…" />}
    </Modal>}
  </div>;
}
