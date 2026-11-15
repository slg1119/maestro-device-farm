import { t, tp } from "../../lib/i18n";
import { ChevronDown, ChevronRight, FileCode2, FilePlus2, Folder, FolderPlus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, ErrorBox, Field, IconButton, Input, Menu, Modal, cx } from "../../components/ui";
import { useEditor, useEditorRuntime } from "../store";
interface Node { name: string; path: string; children: Node[]; file: boolean }
function nodes(paths: string[]): Node[] {
  const root: Node[] = [];
  for (const path of paths) { let siblings = root; const parts = path.split("/"); parts.forEach((name, i) => { const currentPath = parts.slice(0, i + 1).join("/"); let found = siblings.find(n => n.path === currentPath); if (!found) { found = { name, path: currentPath, children: [], file: i === parts.length - 1 }; siblings.push(found); } siblings = found.children; }); }
  const sort = (list: Node[]) => { list.sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name)); list.forEach(n => sort(n.children)); }; sort(root); return root;
}
export function FileTree({ onOpen }: { onOpen?: () => void }) {
  const api = useEditor(); const runtime = useEditorRuntime();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ kind: "new" | "folder" | "rename"; from?: string } | null>(null);
  const [path, setPath] = useState(""); const [folder, setFolder] = useState(""); const [error, setError] = useState<unknown>(null);
  const upload = useRef<HTMLInputElement>(null);
  const show = (kind: "new" | "folder" | "rename", from?: string) => { setError(null); setPath(from ?? (folder ? `${folder}/` : "")); setDialog({ kind, from }); };
  const run = (action: () => void) => { try { action(); setError(null); } catch (e) { setError(e); } };
  const render = (entries: Node[], depth = 0) => entries.map(node => {
    if (!node.file) return <li key={node.path} role="treeitem" aria-label={node.name} aria-expanded={!collapsed.has(node.path)}><button className="flex min-h-8 w-full items-center gap-1.5 pr-2 text-left text-xs text-fg-muted hover:bg-surface-2 max-md:min-h-11" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => { setFolder(node.path); setCollapsed(previous => { const next = new Set(previous); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next; }); }}>{collapsed.has(node.path) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}<Folder className="size-4" /><span className="truncate">{node.name}</span></button>{!collapsed.has(node.path) && <ul role="group">{render(node.children, depth + 1)}</ul>}</li>;
    const status = api.drafts[node.path]?.status;
    return <li role="treeitem" aria-label={node.path} aria-selected={api.activePath === node.path} key={node.path}>
      <div className={cx("group flex min-w-0 items-center gap-1 pr-1 hover:bg-surface-2", api.activePath === node.path && "bg-accent-soft")} style={{ paddingLeft: 12 + depth * 14 }}>
        <button className={cx("flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left text-xs focus-visible:outline-accent max-md:min-h-11", status === "deleted" ? "text-fg-subtle line-through" : "text-fg")} onClick={() => { api.openFile(node.path); onOpen?.(); }}><FileCode2 className="size-4 shrink-0 text-fg-subtle" /><span className="truncate">{node.name}</span></button>
        {status && <Badge tone={status === "modified" ? "warning" : status === "added" ? "passed" : "failed"} className="px-1 font-mono" >{status === "modified" ? "M" : status === "added" ? "A" : "D"}</Badge>}
        <div className={cx("shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [&>div>button]:size-6 [&>div>button]:min-h-6 [&>div>button]:gap-0 [&>div>button]:border-transparent [&>div>button]:bg-transparent [&>div>button]:px-0 [&>div>button]:text-[0px] [&>div>button]:text-fg-muted [&>div>button:hover]:bg-neutral-bg [&>div>button>span]:text-sm", api.activePath === node.path && "opacity-100")}><Menu label={t("m_7e3e5b066b", [node.name])} items={[
          { label: t("m_73e5a894f7"), onClick: () => show("rename", node.path), disabled: status === "deleted" },
          { label: t("m_fc81e222b9"), onClick: () => run(() => api.deleteFile(node.path)), disabled: status === "deleted" },
          { label: t("m_6c1582e2c5"), onClick: () => { void navigator.clipboard?.writeText(node.path).catch(setError); } },
          { label: t("m_57a0618d44"), onClick: () => api.discard(node.path), disabled: !status },
        ]} icon={<span aria-hidden="true">···</span>} /></div>
      </div>
    </li>;
  });
  return <div className="flex h-full min-w-0 flex-col bg-surface">
    <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2"><span className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle">{t("m_d90c18245f")}</span><div className="flex"><IconButton aria-label={t("m_109392667d")} onClick={() => show("new")}><FilePlus2 /></IconButton><IconButton aria-label={t("m_754afbd639")} onClick={() => show("folder")}><FolderPlus /></IconButton><IconButton aria-label={t("m_c07d2317b0")} onClick={() => upload.current?.click()}><Upload /></IconButton></div></div>
    <input ref={upload} type="file" className="hidden" accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.mp3,.wav" onChange={event => { const file = event.target.files?.[0]; if (file) void api.uploadMedia(`${folder ? `${folder}/` : ""}${file.name}`, file).catch(setError); event.target.value = ""; }} />
    <div className="min-h-0 flex-1 overflow-auto py-2"><ErrorBox error={error} />{runtime.treeLoading ? <p className="p-3 text-xs text-fg-muted">{t("m_fe9557a8d4")}</p> : <ul role="tree" aria-label={t("m_68b8eecb19")}>{render(nodes(api.files.map(f => f.path)))}</ul>}</div>
    <div className="border-t border-border p-3 text-xs text-fg-subtle">{tp("editor.savedFiles", api.files.length)}</div>
    {dialog && <Modal title={dialog.kind === "rename" ? t("m_73e5a894f7") : dialog.kind === "folder" ? t("m_754afbd639") : t("m_109392667d")} onClose={() => setDialog(null)}><form onSubmit={event => { event.preventDefault(); run(() => { const target = path.trim(); if (dialog.kind === "rename") api.renameFile(dialog.from!, target); else api.createFile(target); setDialog(null); onOpen?.(); }); }} className="space-y-4"><Field label={t("m_e4b4b5eacf")} hint={dialog.kind === "folder" ? t("m_82cb9d6c0c") : t("m_68f3ec22d2")}><Input aria-label={t("m_e4b4b5eacf")} autoFocus value={path} onChange={event => setPath(event.target.value)} required /></Field><ErrorBox error={error} /><div className="flex justify-end gap-2"><Button onClick={() => setDialog(null)}>{t("m_19b2d19bc1")}</Button><Button type="submit" variant="primary" icon={<FilePlus2 />}>{dialog.kind === "rename" ? t("m_73e5a894f7") : t("m_f839ef88bd")}</Button></div></form></Modal>}
  </div>;
}
