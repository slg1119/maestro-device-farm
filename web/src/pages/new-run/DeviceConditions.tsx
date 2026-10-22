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
      : <span className="shrink-0" role="img" aria-label={device.state === "busy" ? "실행 중" : "사용 가능"}>
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
    <Segmented<DeviceMode> label="기기 선택 방식" value={mode} onChange={onModeChange}
      className="w-full items-stretch [&>button]:min-w-0 [&>button]:flex-1 [&>button]:break-keep [&>button]:px-2"
      options={[
        { value: "all", label: "사용 가능한 기기 전체" },
        { value: "manual", label: "직접 고르기" },
        { value: "conditions", label: "조건으로 고르기" },
      ]} />
    {mode === "manual" && <div className="space-y-2">
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => update({ serials: available.map(device => device.serial) })}>모두 선택</Button>
        <Button variant="ghost" size="sm" onClick={() => update({ serials: [] })}>선택 해제</Button>
      </div>
      {available.length ? <div className="grid min-w-0 grid-cols-1 gap-x-3 sm:grid-cols-2">
        {available.map(device => <DeviceRow key={device.serial} device={device} selected={form.serials.includes(device.serial)}
          onChange={() => update({ serials: form.serials.includes(device.serial)
            ? form.serials.filter(serial => serial !== device.serial) : [...form.serials, device.serial] })} />)}
      </div> : <Empty>사용 가능한 기기가 없습니다.</Empty>}
      {!!unavailable.length && <details>
        <summary className="w-fit cursor-pointer py-2 text-xs text-fg-subtle focus-visible:outline-2 focus-visible:outline-accent">
          사용할 수 없는 기기 {unavailable.length}대
        </summary>
        <div className="grid min-w-0 grid-cols-1 gap-x-3 sm:grid-cols-2">
          {unavailable.map(device => <DeviceRow key={device.serial} device={device} selected={false} unavailable onChange={() => {}} />)}
        </div>
      </details>}
    </div>}
    {mode === "conditions" && <div className="space-y-3">
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-1 text-xs font-medium text-fg-muted">기기 태그</legend>
        <p className="text-xs text-fg-subtle">선택한 태그가 모두 있는 기기를 고릅니다.</p>
        {tags.length ? <div className="flex flex-wrap gap-2">
          {tags.map(tag => <Button key={tag} size="sm" aria-pressed={selectedTags.includes(tag)}
            className="max-w-full rounded-full! break-all aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-fg aria-pressed:hover:bg-accent-soft"
            onClick={() => update({ tags: (selectedTags.includes(tag)
              ? selectedTags.filter(value => value !== tag) : [...selectedTags, tag]).join(",") })}>{tag}</Button>)}
        </div> : <p className="text-xs text-fg-subtle">등록된 기기 태그가 없습니다.</p>}
      </fieldset>
      <details>
        <summary className="w-fit cursor-pointer py-2 text-xs text-fg-muted focus-visible:outline-2 focus-visible:outline-accent">모델·안드로이드 버전</summary>
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="모델" hint="쉼표로 구분">
              <Input aria-label="모델" value={form.models} onChange={event => update({ models: event.target.value })} placeholder="Pixel 7" />
            </Field>
          </div>
          <Field label="안드로이드 API 레벨 (이상)" hint="예: 30 = 안드로이드 11">
            <Input aria-label="안드로이드 API 레벨 (이상)" type="number" min={0} step={1} value={form.minSdk} onChange={event => update({ minSdk: event.target.value })} />
          </Field>
          <Field label="안드로이드 API 레벨 (이하)" hint="예: 30 = 안드로이드 11">
            <Input aria-label="안드로이드 API 레벨 (이하)" type="number" min={0} step={1} value={form.maxSdk} onChange={event => update({ maxSdk: event.target.value })} />
          </Field>
        </div>
      </details>
    </div>}
    <p role="status" aria-live="polite" aria-atomic="true"
      className={cx("break-all text-xs leading-5", matches.length ? "text-fg-muted" : "text-warning-fg")}>
      <span className="font-medium">실행할 기기 {matches.length}대</span>
      {!!matches.length && <> · {matches.slice(0, 5).map(device => device.serial).join(", ")}{matches.length > 5 && ` 외 ${matches.length - 5}대`}</>}
      {sdkExcluded > 0 && <> · 앱이 지원하지 않는 안드로이드 버전이라 {sdkExcluded}대 제외</>}
      {!matches.length && <> · 실행할 수 있는 기기가 없습니다. 기기 상태와 선택 조건을 확인하세요.</>}
    </p>
  </>;
}
