import { CircleAlert } from "lucide-react";
import { Empty } from "../../components/ui";
import { useEditor, useEditorRuntime } from "../store";
export function ProblemsPanel() {
  const { issues } = useEditor(); const { revealIssue } = useEditorRuntime(); const all = Object.values(issues).flat();
  if (!all.length) return <Empty>발견된 문제가 없습니다.</Empty>;
  return <ul className="divide-y divide-border">{all.map((issue, i) => <li key={`${issue.path}-${i}`}><button className="flex w-full gap-2 p-4 text-left hover:bg-surface-2 focus-visible:outline-accent" onClick={() => revealIssue(issue)}><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-failed-fg" /><span className="min-w-0 break-words"><span className="block text-sm text-fg">{issue.message}</span><span className="font-mono text-xs text-fg-muted">{issue.path}:{issue.line ?? 1}:{issue.column ?? 1}</span></span></button></li>)}</ul>;
}
