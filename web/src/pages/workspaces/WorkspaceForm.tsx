import { t } from "../../lib/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { useCanWrite } from "../../components/Layout";
import { apiJson } from "../../api/client";
import { keys } from "../../api/queries";
import type { Workspace } from "../../api/types";
import { Button, ErrorBox, Field, Input, Modal } from "../../components/ui";
import type { WorkspaceCreate, WorkspacePatch } from "./types";

export function WorkspaceForm({ workspace, onClose }: { workspace?: Workspace; onClose: () => void }) {
  const client = useQueryClient();
  const canWrite = useCanWrite();
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
    if (!canWrite || mutation.isPending) return;
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
    <Modal title={workspace ? t("m_4ff3c40bbd") : t("m_4a2c1eb5cc")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {!workspace && <>
          <Field label={t("m_9aa18e5071")} hint={t("m_a34dac9fe7")}>
            <Input required autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label={t("m_a6543aefbe")} hint={t("e_d05842b62b")}>
            <Input required placeholder={t("e_907a8e1392")} value={draft.repo} onChange={(event) => setDraft({ ...draft, repo: event.target.value })} />
          </Field>
        </>}
        <Field label={t("m_8544c1c90e")}>
          <Input required autoFocus={Boolean(workspace)} value={draft.branch} onChange={(event) => setDraft({ ...draft, branch: event.target.value })} />
        </Field>
        <Field label={t("m_bae4002d8d")} hint={t("m_7a003468aa")}>
          <Input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} />
        </Field>
        <Field label={t("m_e345556086")} hint={t("m_5a932863b5")}>
          <Input placeholder={t("e_a003f1da17")} value={draft.default_app_package} onChange={(event) => setDraft({ ...draft, default_app_package: event.target.value })} />
        </Field>
        <ErrorBox error={mutation.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("m_19b2d19bc1")}</Button>
          <Button type="submit" variant="primary" disabled={!canWrite || mutation.isPending}>
            {mutation.isPending ? (workspace ? t("m_9f678504e8") : t("m_33c1f78f44")) : workspace ? t("m_1f1712acff") : t("m_1ac11e9b41")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
