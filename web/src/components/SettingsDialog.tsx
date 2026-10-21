import { type FormEvent, useState } from "react";

import { saveSettings, useSettings } from "../lib/settings";
import { Button, Field, Input, Modal } from "./ui";

/** Token and commit author, stored in this browser only (spec §13.5 공통). */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const [draft, setDraft] = useState(settings);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveSettings({ token: draft.token.trim(), authorName: draft.authorName.trim(), authorEmail: draft.authorEmail.trim() });
    onClose();
  };

  return (
    <Modal title="설정" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="API 토큰 (선택)" hint="서버가 FARM_REQUIRE_TOKEN=true로 실행될 때만 필요합니다. `farm token create <이름>`으로 발급합니다.">
          <Input
            type="password"
            autoComplete="off"
            value={draft.token}
            onChange={(e) => setDraft({ ...draft, token: e.target.value })}
            placeholder="farm_..."
          />
        </Field>
        <Field label="작성자 이름" hint="실행과 업로드의 생성자, 워크스페이스 커밋의 Co-authored-by로 기록됩니다.">
          <Input value={draft.authorName} onChange={(e) => setDraft({ ...draft, authorName: e.target.value })} />
        </Field>
        <Field label="작성자 이메일">
          <Input type="email" value={draft.authorEmail} onChange={(e) => setDraft({ ...draft, authorEmail: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" variant="primary">
            저장
          </Button>
        </div>
      </form>
    </Modal>
  );
}
