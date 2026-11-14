import { t } from "../../lib/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router";

import { apiFetch } from "../../api/client";
import { keys, useApps, useDevices, useHealth, useWorkspaces } from "../../api/queries";
import type { AppBuild, Device, RunSummary, Workspace } from "../../api/types";
import { TokenNotice, useCanWrite } from "../../components/Layout";
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, StatusDot, Textarea, cx } from "../../components/ui";
import { formatDurationKo, timeAgo } from "../../lib/format";
import { DeviceConditions, type DeviceMode } from "./DeviceConditions";
import { buildDeviceSelector, buildRunOptions, matchingDevices, type RunForm } from "./options";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="min-w-0 p-4">
      <fieldset className="min-w-0 space-y-4">
        <legend className="mb-3 text-sm font-semibold text-fg">{title}</legend>
        {children}
      </fieldset>
    </Card>
  );
}

function Choice({ name, label, hint, checked, onChange }: {
  name: string; label: string; hint?: string; checked: boolean; onChange: () => void;
}) {
  return (
    <label className={cx("flex min-h-9 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm max-md:min-h-11",
      checked ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-border bg-surface-2 text-fg-muted")}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 accent-accent focus-visible:outline-2 focus-visible:outline-accent" />
      <span>{label}{hint && <span className="mt-0.5 block text-xs text-fg-subtle">{hint}</span>}</span>
    </label>
  );
}

function defaultPackage(workspace: Workspace | undefined, packages: string[]): string {
  return workspace?.default_app_package && packages.includes(workspace.default_app_package)
    ? workspace.default_app_package : packages[0] ?? "";
}

function NewRunForm({ workspaces, apps, devices }: { workspaces: Workspace[]; apps: AppBuild[]; devices: Device[] }) {
  const canWrite = useCanWrite();
  const health = useHealth();
  const defaultTimeoutSec = health.data?.default_task_timeout_sec;
  const client = useQueryClient();
  const navigate = useNavigate();
  // /apps is ordered by created_at DESC, id DESC, the same order used by @latest.
  const availableBuilds = apps.filter(build => !build.purged);
  const packages = [...new Set(availableBuilds.map(build => build.package_name))];
  const [form, setForm] = useState<RunForm>(() => ({
    flowSource: workspaces.length ? "workspace" : "upload", workspace: workspaces[0]?.name ?? "", ref: "",
    appSource: "library", packageName: defaultPackage(workspaces[0], packages), appBuildId: "", mode: "split",
    tags: "", models: "", minSdk: "", maxSdk: "", serials: [], includeTags: "", excludeTags: "",
    flowPaths: "", env: "", taskTimeoutSec: "",
  }));
  const [flows, setFlows] = useState<File | null>(null);
  const [apk, setApk] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<unknown>(null);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("all");
  const selectedWorkspace = workspaces.find(workspace => workspace.name === form.workspace);
  const packageBuilds = availableBuilds.filter(build => build.package_name === form.packageName);
  const selectedBuild = form.appBuildId ? packageBuilds.find(build => build.id === form.appBuildId) : packageBuilds[0];
  const selector = buildDeviceSelector(form);
  // An empty manual selection means no devices, while the API's omitted serials means all.
  if (deviceMode === "manual") selector.serials = form.serials;
  const appMinSdk = form.appSource === "library" ? selectedBuild?.min_sdk : undefined;
  const eligible = matchingDevices(devices, selector);
  const matches = matchingDevices(eligible, {}, appMinSdk);
  const count = matches.length;
  const update = (patch: Partial<RunForm>) => setForm(previous => ({ ...previous, ...patch }));
  const changeDeviceMode = (mode: DeviceMode) => {
    if (mode === deviceMode) return;
    setDeviceMode(mode);
    update({ serials: [], tags: "", models: "", minSdk: "", maxSdk: "" });
  };

  const submitRun = useMutation({
    mutationFn: async (body: FormData) => {
      const response = await apiFetch("/runs", { method: "POST", body });
      const run = await response.json() as Pick<RunSummary, "id">;
      return run.id;
    },
    onSuccess: id => {
      void client.invalidateQueries({ queryKey: keys.runsAll });
      void navigate(`/runs/${id}`);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || submitRun.isPending || !count) return;
    submitRun.reset();
    setValidationError(null);
    try {
      if (form.flowSource === "workspace" && !selectedWorkspace) throw new Error(t("m_44f07c96ac"));
      if (form.flowSource === "upload" && !flows) throw new Error(t("m_d99dc3d098"));
      if (form.appSource === "library" && !selectedBuild) throw new Error(t("m_1f9c587c1c"));
      if (form.appSource === "upload" && !apk) throw new Error(t("m_74a40a5744"));
      const body = new FormData();
      body.append("options", JSON.stringify(buildRunOptions(form)));
      if (form.flowSource === "upload" && flows) body.append("flows", flows);
      if (form.appSource === "upload" && apk) body.append("apk", apk);
      submitRun.mutate(body);
    } catch (error) {
      setValidationError(error);
    }
  };

  return (
    <form onSubmit={submit} className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_288px] xl:grid-cols-[minmax(0,1fr)_304px]">
      <fieldset disabled={submitRun.isPending} className="min-w-0 space-y-4">
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2">
          <Section title={t("m_0d7ce6ac57")}>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Choice name="flow-source" label={t("m_260ea9e24b")} checked={form.flowSource === "workspace"}
                onChange={() => { update({ flowSource: "workspace" }); setFlows(null); }} />
              <Choice name="flow-source" label={t("m_34621695a5")} checked={form.flowSource === "upload"}
                onChange={() => { update({ flowSource: "upload" }); setFlows(null); }} />
            </div>
            {form.flowSource === "workspace" ? <>
              <Field label={t("m_e036434408")}>
                <Select value={form.workspace} onChange={event => {
                  const workspace = workspaces.find(item => item.name === event.target.value);
                  update({ workspace: event.target.value, ref: "", packageName: defaultPackage(workspace, packages), appBuildId: "" });
                }}>
                  {!workspaces.length && <option value="">{t("m_a0d605d818")}</option>}
                  {workspaces.map(workspace => <option key={workspace.id} value={workspace.name}>
                    {workspace.name} ({workspace.repo}@{workspace.branch})
                  </option>)}
                </Select>
              </Field>
              <Field label={t("m_383620edc1")} hint={selectedWorkspace ? t("m_ef549915ac", [selectedWorkspace.branch]) : t("m_da1ba59b9e")}>
                <Input aria-label={t("m_383620edc1")} value={form.ref} placeholder={selectedWorkspace?.branch}
                  onChange={event => update({ ref: event.target.value })} />
              </Field>
            </> : <Field label={t("m_e5910f78ff")}>
              <Input type="file" accept=".zip" onChange={event => setFlows(event.target.files?.[0] ?? null)} />
            </Field>}
          </Section>

          <Section title={t("m_053d5241c7")}>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Choice name="app-source" label={t("m_1144be1e2e")} checked={form.appSource === "library"}
                onChange={() => { update({ appSource: "library" }); setApk(null); }} />
              <Choice name="app-source" label={t("m_f4519df8b6")} checked={form.appSource === "upload"}
                onChange={() => { update({ appSource: "upload" }); setApk(null); }} />
            </div>
            {form.appSource === "library" ? <>
              <Field label={t("m_053d5241c7")}>
                <Select value={form.packageName} onChange={event => update({ packageName: event.target.value, appBuildId: "" })}>
                  {!packages.length && <option value="">{t("m_2b9d47d9b6")}</option>}
                  {packages.map(pkg => <option key={pkg} value={pkg}>{pkg}</option>)}
                </Select>
              </Field>
              <Field label={t("m_593f8a81a6")}>
                <Select value={form.appBuildId} onChange={event => update({ appBuildId: event.target.value })}>
                  <option value="">{t("m_9adf3c0a94")}</option>
                  {packageBuilds.map(build => <option key={build.id} value={build.id}>
                    {build.version_name} ({build.version_code}) · {timeAgo(build.created_at)}
                  </option>)}
                </Select>
              </Field>
            </> : <Field label={t("m_cb7f89a9af")}>
              <Input type="file" accept=".apk" onChange={event => setApk(event.target.files?.[0] ?? null)} />
            </Field>}
          </Section>
        </div>

        <Section title={t("m_653a81b819")}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Choice name="mode" label={t("m_d0c30a953b")} hint={t("m_57a42d6a27")} checked={form.mode === "split"}
              onChange={() => update({ mode: "split" })} />
            <Choice name="mode" label={t("m_4bb6b1b996")} hint={t("m_d55e2bced4")} checked={form.mode === "matrix"}
              onChange={() => update({ mode: "matrix" })} />
          </div>
        </Section>

        <Section title={t("m_9bd4a9d512")}>
          <DeviceConditions devices={devices} form={form} mode={deviceMode} onModeChange={changeDeviceMode} update={update}
            matches={matches} appMinSdk={appMinSdk} sdkExcluded={eligible.length - count} />
        </Section>

        <Section title={t("m_e7434c7bfb")}>
          <p className="text-xs text-fg-subtle">{t("m_d6680840a2")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("m_bfe6684ed4")} hint={t("m_cdc8e599f7")}>
              <Input aria-label={t("m_bfe6684ed4")} disabled={form.flowPaths.length > 0} value={form.includeTags} onChange={event => update({ includeTags: event.target.value })} />
            </Field>
            <Field label={t("m_c77e978003")} hint={t("m_ff72bfaa45")}>
              <Input aria-label={t("m_c77e978003")} disabled={form.flowPaths.length > 0} value={form.excludeTags} onChange={event => update({ excludeTags: event.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-fg-subtle">{form.flowPaths.length > 0
            ? t("m_47b8e59b1e")
            : t("m_223ad52c14")}</p>
          <Field label={t("m_213aef1eb7")} hint={form.flowSource === "upload"
            ? t("m_15b121086c")
            : selectedWorkspace
              ? t("m_183e5913fd", [selectedWorkspace.path || t("m_91e03ce7ff")])
              : t("m_da1ba59b9e")}>
            <Textarea aria-label={t("m_213aef1eb7")} placeholder={t("e_4f658f5874")} rows={3} value={form.flowPaths} onChange={event => update({ flowPaths: event.target.value })} />
          </Field>
        </Section>

        <Section title={t("m_e6e52c476c")}>
          <Field label={t("m_6c1c51df41")} hint={t("m_67e9dbf1cf")}>
            <Textarea aria-label={t("m_6c1c51df41")} rows={4} spellCheck={false} autoComplete="off" placeholder={t("e_5626d54413")}
              value={form.env} onChange={event => update({ env: event.target.value })} />
          </Field>
          <div className="sm:max-w-xs">
            <Field label={t("m_e8624e187d")} hint={form.mode === "split"
              ? t("m_d7c6e79dac")
              : t("m_c857413f87")}>
              <Input aria-label={t("m_e8624e187d")} type="number" min={1} step={1} value={form.taskTimeoutSec}
                placeholder={defaultTimeoutSec === undefined ? t("m_f6a5e1dcf2") : t("m_6fc01f2d6b", [formatDurationKo(defaultTimeoutSec)])}
                onChange={event => update({ taskTimeoutSec: event.target.value })} />
            </Field>
          </div>
        </Section>
      </fieldset>
      <aside aria-label={t("m_559fdf1e6a")} className="min-w-0 lg:sticky lg:top-8">
        <Card className="space-y-5 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-fg">{t("m_559fdf1e6a")}</h2>
          <dl className="space-y-4 text-sm">
            <div className="min-w-0">
              <dt className="mb-1 text-xs text-fg-subtle">{t("m_0d7ce6ac57")}</dt>
              <dd className="break-all font-medium text-fg">{form.flowSource === "workspace" ? selectedWorkspace?.name || t("m_020a168455") : flows?.name || t("m_92b9a7b888")}</dd>
              {form.flowSource === "workspace" && selectedWorkspace && <dd className="mt-1 break-all font-mono text-xs text-fg-muted">{form.ref || selectedWorkspace.branch}</dd>}
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs text-fg-subtle">{t("m_053d5241c7")}</dt>
              <dd className="break-all font-mono text-xs leading-5 text-fg">{form.appSource === "upload" ? apk?.name || t("m_2820ef9e6a") : !selectedBuild ? t("m_e8bd648b93") : form.appBuildId
                ? `${selectedBuild.package_name} · ${selectedBuild.version_name} (${selectedBuild.version_code})` : t("m_828c4996c5", [form.packageName])}</dd>
            </div>
            <div>
              <dt className="mb-1 text-xs text-fg-subtle">{t("m_653a81b819")}</dt>
              <dd className="text-xs text-fg">{form.mode === "split" ? t("m_d0c30a953b") : t("m_4bb6b1b996")}</dd>
            </div>
          </dl>
          <div role="status" aria-live="polite" className={cx("rounded-lg px-3 py-3 text-sm",
            count ? "bg-passed-bg text-passed-fg" : "bg-warning-bg text-warning-fg")}>
            <p className="flex items-center gap-2"><StatusDot tone={count ? "passed" : "warning"} />{t("m_9bd4a9d512")} {count}{t("m_8cbb379d24")}</p>
            {!count && <p className="mt-1 text-xs">{t("m_f9532eff6e")}</p>}
          </div>
          <ErrorBox error={validationError ?? submitRun.error} />
          <Button type="submit" variant="primary" icon={<Play />} className="w-full" disabled={!canWrite || submitRun.isPending || !count}>
            {submitRun.isPending ? t("m_f295e2dbdf") : t("m_2c0b4923b7")}
          </Button>
        </Card>
      </aside>
    </form>
  );
}

export function NewRunPage() {
  const workspaces = useWorkspaces();
  const apps = useApps();
  const devices = useDevices();
  const error = workspaces.error ?? apps.error ?? devices.error;
  const ready = workspaces.data !== undefined && apps.data !== undefined && devices.data !== undefined;
  return <>
    <PageHeader title={t("m_fbdfd04fb8")} description={t("m_e55f539e4d")} />
    <TokenNotice />
    {error && <div className="mb-4"><ErrorBox error={error} /></div>}
    {ready ? <NewRunForm workspaces={workspaces.data!} apps={apps.data!} devices={devices.data!} /> : !error && <Loading />}
  </>;
}
