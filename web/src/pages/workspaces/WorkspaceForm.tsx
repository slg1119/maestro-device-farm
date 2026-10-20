import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { apiJson } from "../../api/client";
import { keys } from "../../api/queries";
import type { Workspace } from "../../api/types";
import { Button, ErrorBox, Field, Input, Modal } from "../../components/ui";
import { useSettings } from "../../lib/settings";
import type { WorkspaceCreate, WorkspacePatch } from "./types";

export function WorkspaceForm({ workspace, onClose }: { workspace?: Workspace; onClose: () => void }) {
  const client = useQueryClient();
  const { token } = useSettings();
  const [draft, setDraft] = useState({
    name: workspace?.name ?? "",
    repo: workspace?.repo ?? "",
    branch: workspace?.branch ?? "main",
    path: workspace?.path ?? "",
    default_app_package: workspace?.default_app_package ?? "",
  });
  const mutation = useMutation({
    mutationFn: (body: WorkspaceCreate | WorkspacePatch) => apiJson<Workspace>(
      workspace ? `/workspaces/${encodeURIComponent(workspace.id)}` : "/workspaces",
      { method: workspace ? "PATCH" : "POST", json: body },
    ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.workspaces });
      if (workspace) {
        void client.invalidateQueries({ queryKey: ["workspace-tree", workspace.id] });
        void client.invalidateQueries({ queryKey: ["workspace-history", workspace.id] });
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!token || mutation.isPending) return;
    const values: WorkspaceCreate = {
      name: draft.name.trim(),
      repo: draft.repo.trim(),
      branch: draft.branch.trim(),
      path: draft.path.trim(),
      default_app_package: draft.default_app_package.trim() || null,
    };
    if (!workspace) {
      mutation.mutate(values, { onSuccess: onClose });
      return;
    }
    const changed: WorkspacePatch = {};
    if (values.branch !== workspace.branch) changed.branch = values.branch;
    if (values.path !== workspace.path) changed.path = values.path;
    if (values.default_app_package !== workspace.default_app_package) changed.default_app_package = values.default_app_package;
    if (Object.keys(changed).length === 0) {
      onClose();
      return;
    }
    mutation.mutate(changed, { onSuccess: onClose });
  };

  return (
    <Modal title={workspace ? "워크스페이스 수정" : "워크스페이스 등록"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {!workspace && <>
          <Field label="이름" hint="소문자 slug, 예: example-app">
            <Input required autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label="레포" hint="owner/name">
            <Input required placeholder="example-org/example-app" value={draft.repo} onChange={(event) => setDraft({ ...draft, repo: event.target.value })} />
          </Field>
        </>}
        <Field label="브랜치">
          <Input required autoFocus={Boolean(workspace)} value={draft.branch} onChange={(event) => setDraft({ ...draft, branch: event.target.value })} />
        </Field>
        <Field label="경로" hint="레포 루트 기준. 앱 레포라면 .maestro, 비우면 레포 루트">
          <Input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} />
        </Field>
        <Field label="기본 앱 패키지" hint="선택 사항">
          <Input placeholder="com.example.app" value={draft.default_app_package} onChange={(event) => setDraft({ ...draft, default_app_package: event.target.value })} />
        </Field>
        <ErrorBox error={mutation.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" variant="primary" disabled={!token || mutation.isPending}>
            {mutation.isPending ? (workspace ? "저장 중…" : "확인 중…") : workspace ? "저장" : "등록"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
