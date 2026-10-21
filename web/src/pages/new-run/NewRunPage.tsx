import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router";

import { apiFetch } from "../../api/client";
import { keys, useApps, useDevices, useWorkspaces } from "../../api/queries";
import type { AppBuild, Device, RunSummary, Workspace } from "../../api/types";
import { TokenNotice, useCanWrite } from "../../components/Layout";
import { DeviceStateBadge } from "../../components/StatusBadge";
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, PageHeader, Select, StatusDot, Textarea, cx } from "../../components/ui";
import { timeAgo } from "../../lib/format";
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
  const selectedWorkspace = workspaces.find(workspace => workspace.name === form.workspace);
  const packageBuilds = availableBuilds.filter(build => build.package_name === form.packageName);
  const selectedBuild = form.appBuildId ? packageBuilds.find(build => build.id === form.appBuildId) : packageBuilds[0];
  const count = matchingDevices(devices, buildDeviceSelector(form), form.appSource === "library" ? selectedBuild?.min_sdk : undefined).length;
  const update = (patch: Partial<RunForm>) => setForm(previous => ({ ...previous, ...patch }));

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
    if (!canWrite || submitRun.isPending) return;
    submitRun.reset();
    setValidationError(null);
    try {
      if (form.flowSource === "workspace" && !selectedWorkspace) throw new Error("워크스페이스를 선택하세요.");
      if (form.flowSource === "upload" && !flows) throw new Error("Flow zip 파일을 선택하세요.");
      if (form.appSource === "library" && !selectedBuild) throw new Error("앱 빌드를 선택하세요.");
      if (form.appSource === "upload" && !apk) throw new Error("APK 파일을 선택하세요.");
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
          <Section title="Flow 출처">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Choice name="flow-source" label="워크스페이스" checked={form.flowSource === "workspace"}
                onChange={() => { update({ flowSource: "workspace" }); setFlows(null); }} />
              <Choice name="flow-source" label="zip 업로드" checked={form.flowSource === "upload"}
                onChange={() => { update({ flowSource: "upload" }); setFlows(null); }} />
            </div>
            {form.flowSource === "workspace" ? <>
              <Field label="워크스페이스">
                <Select value={form.workspace} onChange={event => {
                  const workspace = workspaces.find(item => item.name === event.target.value);
                  update({ workspace: event.target.value, ref: "", packageName: defaultPackage(workspace, packages), appBuildId: "" });
                }}>
                  {!workspaces.length && <option value="">등록된 워크스페이스가 없습니다</option>}
                  {workspaces.map(workspace => <option key={workspace.id} value={workspace.name}>
                    {workspace.name} ({workspace.repo}@{workspace.branch})
                  </option>)}
                </Select>
              </Field>
              <Field label="ref" hint="브랜치 이름이나 40자리 커밋 SHA. 비우면 브랜치 최신 커밋">
                <Input aria-label="ref" value={form.ref} placeholder={selectedWorkspace?.branch}
                  onChange={event => update({ ref: event.target.value })} />
              </Field>
            </> : <Field label="Flow zip">
              <Input type="file" accept=".zip" onChange={event => setFlows(event.target.files?.[0] ?? null)} />
            </Field>}
          </Section>

          <Section title="앱">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Choice name="app-source" label="보관함" checked={form.appSource === "library"}
                onChange={() => { update({ appSource: "library" }); setApk(null); }} />
              <Choice name="app-source" label="APK 업로드" checked={form.appSource === "upload"}
                onChange={() => { update({ appSource: "upload" }); setApk(null); }} />
            </div>
            {form.appSource === "library" ? <>
              <Field label="패키지">
                <Select value={form.packageName} onChange={event => update({ packageName: event.target.value, appBuildId: "" })}>
                  {!packages.length && <option value="">보관된 앱이 없습니다</option>}
                  {packages.map(pkg => <option key={pkg} value={pkg}>{pkg}</option>)}
                </Select>
              </Field>
              <Field label="빌드">
                <Select value={form.appBuildId} onChange={event => update({ appBuildId: event.target.value })}>
                  <option value="">최신 빌드</option>
                  {packageBuilds.map(build => <option key={build.id} value={build.id}>
                    {build.version_name} ({build.version_code}) · {timeAgo(build.created_at)}
                  </option>)}
                </Select>
              </Field>
            </> : <Field label="APK 파일">
              <Input type="file" accept=".apk" onChange={event => setApk(event.target.files?.[0] ?? null)} />
            </Field>}
          </Section>
        </div>

        <Section title="모드">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Choice name="mode" label="split" hint="flow를 기기들에 나눠 실행" checked={form.mode === "split"}
              onChange={() => update({ mode: "split" })} />
            <Choice name="mode" label="matrix" hint="모든 기기에서 전체 flow 실행" checked={form.mode === "matrix"}
              onChange={() => update({ mode: "matrix" })} />
          </div>
        </Section>

        <Section title="기기 조건">
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="기기 태그" hint="쉼표로 구분. 모든 태그가 있는 기기만 선택됩니다.">
              <Input aria-label="기기 태그" value={form.tags} onChange={event => update({ tags: event.target.value })} placeholder="smoke, tablet" />
            </Field>
            <Field label="모델" hint="쉼표로 구분">
              <Input aria-label="모델" value={form.models} onChange={event => update({ models: event.target.value })} placeholder="Pixel 7" />
            </Field>
            <Field label="최소 SDK">
              <Input type="number" min={0} step={1} value={form.minSdk} onChange={event => update({ minSdk: event.target.value })} />
            </Field>
            <Field label="최대 SDK">
              <Input type="number" min={0} step={1} value={form.maxSdk} onChange={event => update({ maxSdk: event.target.value })} />
            </Field>
          </div>
          <fieldset className="min-w-0">
            <legend className="mb-1 text-xs font-medium text-fg-muted">기기 지정</legend>
            <p className="mb-2 text-xs text-fg-subtle">선택하지 않으면 모든 기기에 조건을 적용합니다.</p>
            {devices.length ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {devices.map(device => <label key={device.serial}
                className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 rounded-lg border border-border p-2 text-sm">
                <input type="checkbox" className="mt-1 accent-accent focus-visible:outline-2 focus-visible:outline-accent" checked={form.serials.includes(device.serial)}
                  onChange={event => update({ serials: event.target.checked
                    ? [...form.serials, device.serial] : form.serials.filter(serial => serial !== device.serial) })} />
                <span className="min-w-0 space-y-1">
                  <span className="block break-all">{device.model} ({device.serial})</span>
                  <DeviceStateBadge state={device.state} />
                </span>
              </label>)}
            </div> : <Empty>연결된 기기가 없습니다.</Empty>}
          </fieldset>
        </Section>

        <Section title="Flow 선택">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="포함 태그" hint="쉼표로 구분">
              <Input aria-label="포함 태그" value={form.includeTags} onChange={event => update({ includeTags: event.target.value })} />
            </Field>
            <Field label="제외 태그" hint="쉼표로 구분">
              <Input aria-label="제외 태그" value={form.excludeTags} onChange={event => update({ excludeTags: event.target.value })} />
            </Field>
          </div>
          <Field label="Flow 경로" hint="비우면 전체 flow. 한 줄에 하나씩 또는 쉼표로 구분하세요.">
            <Textarea aria-label="Flow 경로" rows={3} value={form.flowPaths} onChange={event => update({ flowPaths: event.target.value })} />
          </Field>
        </Section>

        <Section title="환경 변수 및 타임아웃">
          <Field label="환경 변수" hint="값은 API 응답에서 가려집니다. 비밀번호 같은 값은 여기에 넣으세요.">
            <Textarea aria-label="환경 변수" rows={4} spellCheck={false} autoComplete="off" placeholder="KEY=VALUE"
              value={form.env} onChange={event => update({ env: event.target.value })} />
          </Field>
          <div className="sm:max-w-xs">
            <Field label="Task 타임아웃(초)">
              <Input type="number" min={1} step={1} value={form.taskTimeoutSec}
                onChange={event => update({ taskTimeoutSec: event.target.value })} />
            </Field>
          </div>
        </Section>
      </fieldset>
      <aside aria-label="실행 요약" className="min-w-0 lg:sticky lg:top-8">
        <Card className="space-y-5 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-fg">실행 요약</h2>
          <dl className="space-y-4 text-sm">
            <div className="min-w-0">
              <dt className="mb-1 text-xs text-fg-subtle">Flow 출처</dt>
              <dd className="break-all font-medium text-fg">{form.flowSource === "workspace" ? selectedWorkspace?.name || "워크스페이스 미선택" : flows?.name || "zip 파일 미선택"}</dd>
              {form.flowSource === "workspace" && selectedWorkspace && <dd className="mt-1 break-all font-mono text-xs text-fg-muted">{form.ref || selectedWorkspace.branch}</dd>}
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs text-fg-subtle">앱</dt>
              <dd className="break-all font-mono text-xs leading-5 text-fg">{form.appSource === "upload" ? apk?.name || "APK 파일 미선택" : !selectedBuild ? "앱 빌드 미선택" : form.appBuildId
                ? `${selectedBuild.package_name} · ${selectedBuild.version_name} (${selectedBuild.version_code})` : `${form.packageName}@latest`}</dd>
            </div>
            <div>
              <dt className="mb-1 text-xs text-fg-subtle">모드</dt>
              <dd className="font-mono text-xs text-fg">{form.mode}</dd>
            </div>
          </dl>
          <div role="status" aria-live="polite" className={cx("rounded-lg px-3 py-3 text-sm",
            count ? "bg-passed-bg text-passed-fg" : "bg-warning-bg text-warning-fg")}>
            <p className="flex items-center gap-2"><StatusDot tone={count ? "passed" : "warning"} />조건에 맞는 기기 {count}대</p>
            {!count && <p className="mt-1 text-xs">제출하면 거절됩니다</p>}
          </div>
          <ErrorBox error={validationError ?? submitRun.error} />
          <Button type="submit" variant="primary" icon={<Play />} className="w-full" disabled={!canWrite || submitRun.isPending}>
            {submitRun.isPending ? "제출 중…" : "실행 시작"}
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
    <PageHeader title="새 실행" description="Flow와 앱을 선택하고 실행할 기기 조건을 설정합니다." />
    <TokenNotice />
    {error && <div className="mb-4"><ErrorBox error={error} /></div>}
    {ready ? <NewRunForm workspaces={workspaces.data!} apps={apps.data!} devices={devices.data!} /> : !error && <Loading />}
  </>;
}
