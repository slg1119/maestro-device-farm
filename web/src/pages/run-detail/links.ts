import { API, query } from "../../api/client";

export const LINK = "text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2";
export const ACTION_LINK = "inline-flex max-w-full min-h-9 break-all items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11";
export function artifactPath(taskId: string, path: string): string {
  return `/tasks/${encodeURIComponent(taskId)}/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;
}
export const artifactUrl = (taskId: string, path: string) => `${API}${artifactPath(taskId, path)}`;
export function editorUrl(workspace: string, base: string, params: { file?: string; aiJob?: string } = {}) {
  return `/editor/${encodeURIComponent(workspace)}${query({ base, ...params })}`;
}
