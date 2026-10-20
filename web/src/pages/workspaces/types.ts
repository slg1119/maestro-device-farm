import type { Workspace } from "../../api/types";

export type WorkspaceCreate = Pick<Workspace, "name" | "repo" | "branch" | "path" | "default_app_package">;
export type WorkspacePatch = Partial<Pick<Workspace, "branch" | "path" | "default_app_package">>;
