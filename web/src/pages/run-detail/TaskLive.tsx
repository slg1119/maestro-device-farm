import { t } from "../../lib/i18n";
import { useState } from "react";
import type { Task } from "../../api/types";
import { LiveView } from "../../components/live/LiveView";
import { LIVE_DRAWER_STORAGE_KEY } from "../../components/live/useResizableSize";
import { Badge, Button, Drawer, StatusDot } from "../../components/ui";

export function TaskLive({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  return <div className="mt-2 flex flex-wrap items-center gap-2" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}>
    {task.interfered && <Badge tone="warning"><StatusDot tone="warning" />{t("m_ba973bb9b3")}</Badge>}
    {task.status === "running" && task.device_serial && <Button size="sm" onClick={() => setOpen(true)}>{t("m_02598e5f08")}</Button>}
    {open && task.status === "running" && task.device_serial && <Drawer title={t("m_bdd0003871", [task.device_serial])} onClose={() => setOpen(false)} resizable storageKey={LIVE_DRAWER_STORAGE_KEY}><LiveView serial={task.device_serial} /></Drawer>}
  </div>;
}
