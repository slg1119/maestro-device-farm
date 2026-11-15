import { t, tp } from "../../lib/i18n";
import type { Device } from "../../api/types";
import { DeviceStateBadge } from "../../components/StatusBadge";
import { Button, Empty, Field, Input, Segmented, StatusDot, cx } from "../../components/ui";
import { matchingDevices, splitList, type RunForm } from "./options";

export type DeviceMode = "all" | "manual" | "conditions";

function DeviceRow({ device, selected, unavailable = false, onChange }: {
  device: Device; selected: boolean; unavailable?: boolean; onChange: () => void;
}) {
  return <label className={cx("flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm max-md:min-h-11",
    unavailable ? "cursor-not-allowed text-fg-subtle opacity-60" : "cursor-pointer hover:bg-surface-2")}>
    <input type="checkbox" aria-label={`${device.serial} (${device.model})`} checked={selected} disabled={unavailable}
      onChange={onChange} className="shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-accent" />
    <span className="min-w-0 flex-1 truncate" title={`${device.serial} · ${device.model}`}>
      <span className="font-mono text-xs">{device.serial}</span>{" "}
      <span className="text-xs text-fg-subtle">{device.model}</span>
    </span>
    {unavailable ? <span className="shrink-0"><DeviceStateBadge state={device.disabled ? "disabled" : device.reservation ? "reserved" : device.state} /></span>
      : <span className="shrink-0" role="img" aria-label={device.state === "busy" ? t("m_0d01d3e76a") : t("m_d4bbb3d8e2")}>
        <StatusDot tone={device.state === "busy" ? "running" : "passed"} />
      </span>}
  </label>;
}

export function DeviceConditions({ devices, form, mode, onModeChange, update, matches, sdkExcluded }: {
  devices: Device[];
  form: RunForm;
  mode: DeviceMode;
  onModeChange: (mode: DeviceMode) => void;
  update: (patch: Partial<RunForm>) => void;
  matches: Device[];
  appMinSdk: number | undefined;
  sdkExcluded: number;
}) {
  const available = matchingDevices(devices, {});
  const availableSerials = new Set(available.map(device => device.serial));
  const unavailable = devices.filter(device => !availableSerials.has(device.serial));
  const tags = [...new Set(devices.flatMap(device => device.tags))].sort();
  const selectedTags = splitList(form.tags);

  return <>
    <Segmented<DeviceMode> label={t("m_0508483902")} value={mode} onChange={onModeChange}
      className="w-full items-stretch [&>button]:min-w-0 [&>button]:flex-1 [&>button]:break-keep [&>button]:px-2"
      options={[
        { value: "all", label: t("m_7a876c6e37") },
        { value: "manual", label: t("m_39e025b0ea") },
        { value: "conditions", label: t("m_73adadd296") },
      ]} />
    {mode === "manual" && <div className="space-y-2">
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => update({ serials: available.map(device => device.serial) })}>{t("m_c764a797f2")}</Button>
        <Button variant="ghost" size="sm" onClick={() => update({ serials: [] })}>{t("m_bf3e2aa4ca")}</Button>
      </div>
      {available.length ? <div className="grid min-w-0 grid-cols-1 gap-x-3 sm:grid-cols-2">
        {available.map(device => <DeviceRow key={device.serial} device={device} selected={form.serials.includes(device.serial)}
          onChange={() => update({ serials: form.serials.includes(device.serial)
            ? form.serials.filter(serial => serial !== device.serial) : [...form.serials, device.serial] })} />)}
      </div> : <Empty>{t("m_4f3f72e98a")}</Empty>}
      {!!unavailable.length && <details>
        <summary className="w-fit cursor-pointer py-2 text-xs text-fg-subtle focus-visible:outline-2 focus-visible:outline-accent">
          {tp("device.unavailableCount", unavailable.length)}
        </summary>
        <div className="grid min-w-0 grid-cols-1 gap-x-3 sm:grid-cols-2">
          {unavailable.map(device => <DeviceRow key={device.serial} device={device} selected={false} unavailable onChange={() => {}} />)}
        </div>
      </details>}
    </div>}
    {mode === "conditions" && <div className="space-y-3">
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-1 text-xs font-medium text-fg-muted">{t("m_3e75bcb911")}</legend>
        <p className="text-xs text-fg-subtle">{t("m_30f635e152")}</p>
        {tags.length ? <div className="flex flex-wrap gap-2">
          {tags.map(tag => <Button key={tag} size="sm" aria-pressed={selectedTags.includes(tag)}
            className="max-w-full rounded-full! break-all aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-fg aria-pressed:hover:bg-accent-soft"
            onClick={() => update({ tags: (selectedTags.includes(tag)
              ? selectedTags.filter(value => value !== tag) : [...selectedTags, tag]).join(",") })}>{tag}</Button>)}
        </div> : <p className="text-xs text-fg-subtle">{t("m_3f77db6070")}</p>}
      </fieldset>
      <details>
        <summary className="w-fit cursor-pointer py-2 text-xs text-fg-muted focus-visible:outline-2 focus-visible:outline-accent">{t("m_20aa251b1a")}</summary>
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t("m_3317f8c6d7")} hint={t("m_073153ae73")}>
              <Input aria-label={t("m_3317f8c6d7")} value={form.models} onChange={event => update({ models: event.target.value })} placeholder={t("e_a17044b8f1")} />
            </Field>
          </div>
          <Field label={t("m_42a0dce703")} hint={t("m_4c4032f35c")}>
            <Input aria-label={t("m_42a0dce703")} type="number" min={0} step={1} value={form.minSdk} onChange={event => update({ minSdk: event.target.value })} />
          </Field>
          <Field label={t("m_c42f4ba9fc")} hint={t("m_4c4032f35c")}>
            <Input aria-label={t("m_c42f4ba9fc")} type="number" min={0} step={1} value={form.maxSdk} onChange={event => update({ maxSdk: event.target.value })} />
          </Field>
        </div>
      </details>
    </div>}
    <p role="status" aria-live="polite" aria-atomic="true"
      className={cx("break-all text-xs leading-5", matches.length ? "text-fg-muted" : "text-warning-fg")}>
      <span className="font-medium">{tp("device.matchesCount", matches.length)}</span>
      {!!matches.length && <> · {matches.slice(0, 5).map(device => device.serial).join(", ")}{matches.length > 5 && tp("device.moreCount", matches.length - 5)}</>}
      {sdkExcluded > 0 && <> {t("m_735d71f783")} {tp("device.excludedCount", sdkExcluded)}</>}
      {!matches.length && <> {t("m_8a7a9cb26d")}</>}
    </p>
  </>;
}
