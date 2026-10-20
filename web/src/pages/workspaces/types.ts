import type { Workspace } from "../../api/types";

export type WorkspaceCreate = Pick<Workspace, "name" | "repo" | "branch" | "path" | "default_app_package">;
export type WorkspacePatch = Partial<Pick<Workspace, "branch" | "path" | "default_app_package">>;

// Page-local until these missing history types are lifted into api/types.ts at integration.
export interface WorkspaceCommit {
  sha: string;
  author_name: string;
  author_email: string;
  authored_at: string;
  message: string;
  co_authors: { name: string; email: string }[];
  files_changed: number;
}

export interface WorkspaceHistory {
  sha: string;
  commits: WorkspaceCommit[];
}
