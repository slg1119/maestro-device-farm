import type { QueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, query } from "../../../api/client";
import { keys } from "../../../api/queries";
import type { Change } from "../../../api/types";
import { encodedPath, type EditorApi } from "../../store";

export interface FileDiff { path: string; status: "added" | "modified" | "deleted" | "moved"; original: string; modified: string; binary?: boolean; fromPath?: string }
export const statusLetter = { added: "A", modified: "M", deleted: "D", moved: "R" };
export const statusTone = { added: "passed", modified: "warning", deleted: "failed", moved: "neutral" } as const;
export const binaryPath = (path: string) => /\.(png|jpe?g|gif|webp|mp4|mov|mp3|wav|zip|pdf|apk)$/i.test(path);
export function authorDetails(name: string, email: string) {
  const author = { name: name.trim(), email: email.trim() };
  return author.name && author.name.length <= 100 && !/[<>\r\n]/.test(author.name) && /^[^@\s<>]+@[^@\s<>]+$/.test(author.email) ? author : null;
}

export async function fileAt(client: QueryClient, id: string, sha: string, path: string, allowMissing = false): Promise<string> {
  try {
    return await client.fetchQuery({ queryKey: keys.workspaceFile(id, sha, path), staleTime: Infinity,
      queryFn: async () => (await apiFetch(`/workspaces/${encodeURIComponent(id)}/files/${encodedPath(path)}${query({ ref: sha })}`)).text() });
  } catch (error) {
    if (allowMissing && error instanceof ApiError && error.status === 404 && error.code === "file_not_found") return "";
    throw error;
  }
}

export async function draftDiffs(client: QueryClient, api: EditorApi, changes: Change[]): Promise<FileDiff[]> {
  return Promise.all(changes.map(async change => {
    const path = change.op === "move" ? change.to! : change.path;
    const draft = api.drafts[path];
    let status: FileDiff["status"] = change.op === "move" ? "moved" : change.op === "delete" ? "deleted" : draft?.status === "added" ? "added" : "modified";
    const binary = change.encoding === "base64" || binaryPath(path);
    let original = "";
    if (!binary && status !== "added") {
      try {
        original = await fileAt(client, api.workspace.id, api.baseSha, change.path);
      } catch (error) {
        // A rebase keeps drafts even when the remote deleted their original file.
        if (change.op === "put" && error instanceof ApiError && error.status === 404 && error.code === "file_not_found") status = "added";
        else throw error;
      }
    }
    const modified = binary || status === "deleted" ? "" : change.op === "move" ? original : change.content ?? "";
    return { path, status, original, modified, binary, fromPath: change.op === "move" ? change.path : undefined };
  }));
}

/** Line additions/removals from the longest common subsequence; cap work for huge media-like text. */
export function lineCounts(original: string, modified: string) {
  const lines = (text: string) => text ? text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : [];
  const a = lines(original); const b = lines(modified);
  let prefix = 0; while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0; while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const left = a.slice(prefix, a.length - suffix); const right = b.slice(prefix, b.length - suffix);
  let common = prefix + suffix;
  if (left.length * right.length <= 2_000_000) {
    let row = new Uint32Array(right.length + 1);
    for (const line of left) {
      const next = new Uint32Array(right.length + 1);
      for (let j = 0; j < right.length; j++) next[j + 1] = line === right[j] ? row[j]! + 1 : Math.max(next[j]!, row[j + 1]!);
      row = next;
    }
    common += row[right.length]!;
  }
  return { added: b.length - common, removed: a.length - common };
}
