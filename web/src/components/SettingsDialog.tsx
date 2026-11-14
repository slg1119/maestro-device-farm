import { t } from "../lib/i18n";
import { type FormEvent, useState } from "react";

import { saveSettings, useSettings } from "../lib/settings";
import { Button, Field, Input, Modal } from "./ui";

/** Token and commit author, stored in this browser only (shared settings). */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const [draft, setDraft] = useState(settings);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveSettings({ token: draft.token.trim(), authorName: draft.authorName.trim(), authorEmail: draft.authorEmail.trim() });
    onClose();
  };

  return (
    <Modal title={t("m_c14a567ea9")} onClose={onClose} size="md">
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("m_1a5563f0e1")} hint={t("m_2657dcb72b")}>
          <Input
            type="password"
            autoComplete="off"
            value={draft.token}
            onChange={(e) => setDraft({ ...draft, token: e.target.value })}
            placeholder={t("e_82ed8cf5a3")}
          />
        </Field>
        <Field label={t("m_50330401d1")} hint={t("m_e87fe22aa8")}>
          <Input value={draft.authorName} onChange={(e) => setDraft({ ...draft, authorName: e.target.value })} />
        </Field>
        <Field label={t("m_3c9efd9f29")}>
          <Input type="email" value={draft.authorEmail} onChange={(e) => setDraft({ ...draft, authorEmail: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("m_19b2d19bc1")}</Button>
          <Button type="submit" variant="primary">
            {t("m_1f1712acff")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
