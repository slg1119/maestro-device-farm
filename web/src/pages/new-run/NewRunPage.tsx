import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router";

import { apiFetch } from "../../api/client";
import { keys, useApps, useDevices, useWorkspaces } from "../../api/queries";
import type { AppBuild, Device, RunSummary, Workspace } from "../../api/types";
import { TokenNotice, useCanWrite } from "../../components/Layout";
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, StatusDot, Textarea, cx } from "../../components/ui";
import { timeAgo } from "../../lib/format";
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
      if (form.flowSource === "workspace" && !selectedWorkspace) throw new Error("저장소를 고르세요.");
      if (form.flowSource === "upload" && !flows) throw new Error("테스트 zip 파일을 올리세요.");
      if (form.appSource === "library" && !selectedBuild) throw new Error("앱 버전을 고르세요.");
      if (form.appSource === "upload" && !apk) throw new Error("APK 파일을 올리세요.");
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
          <Section title="테스트 파일 가져올 곳">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Choice name="flow-source" label="등록된 저장소" checked={form.flowSource === "workspace"}
                onChange={() => { update({ flowSource: "workspace" }); setFlows(null); }} />
              <Choice name="flow-source" label="zip 파일 올리기" checked={form.flowSource === "upload"}
                onChange={() => { update({ flowSource: "upload" }); setFlows(null); }} />
            </div>
            {form.flowSource === "workspace" ? <>
              <Field label="저장소">
                <Select value={form.workspace} onChange={event => {
                  const workspace = workspaces.find(item => item.name === event.target.value);
                  update({ workspace: event.target.value, ref: "", packageName: defaultPackage(workspace, packages), appBuildId: "" });
                }}>
                  {!workspaces.length && <option value="">등록된 저장소가 없습니다</option>}
                  {workspaces.map(workspace => <option key={workspace.id} value={workspace.name}>
                    {workspace.name} ({workspace.repo}@{workspace.branch})
                  </option>)}
                </Select>
              </Field>
              <Field label="브랜치 또는 커밋" hint={selectedWorkspace ? `비우면 ${selectedWorkspace.branch} 브랜치의 최신 상태로 실행합니다.` : "저장소를 먼저 고르세요."}>
                <Input aria-label="브랜치 또는 커밋" value={form.ref} placeholder={selectedWorkspace?.branch}
                  onChange={event => update({ ref: event.target.value })} />
              </Field>
            </> : <Field label="테스트 zip 파일">
              <Input type="file" accept=".zip" onChange={event => setFlows(event.target.files?.[0] ?? null)} />
            </Field>}
          </Section>

          <Section title="앱">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Choice name="app-source" label="올려둔 앱" checked={form.appSource === "library"}
                onChange={() => { update({ appSource: "library" }); setApk(null); }} />
              <Choice name="app-source" label="APK 파일 올리기" checked={form.appSource === "upload"}
                onChange={() => { update({ appSource: "upload" }); setApk(null); }} />
            </div>
            {form.appSource === "library" ? <>
              <Field label="앱">
                <Select value={form.packageName} onChange={event => update({ packageName: event.target.value, appBuildId: "" })}>
                  {!packages.length && <option value="">올려둔 앱이 없습니다</option>}
                  {packages.map(pkg => <option key={pkg} value={pkg}>{pkg}</option>)}
                </Select>
              </Field>
              <Field label="버전">
                <Select value={form.appBuildId} onChange={event => update({ appBuildId: event.target.value })}>
                  <option value="">가장 최근 버전</option>
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

        <Section title="실행 방식">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Choice name="mode" label="나눠서 한 번씩" hint="테스트를 여러 기기에 나눠 각각 한 번만 돌립니다. 빨리 끝납니다." checked={form.mode === "split"}
              onChange={() => update({ mode: "split" })} />
            <Choice name="mode" label="기기마다 전부" hint="고른 기기마다 모든 테스트를 돌립니다. 기기별 차이를 볼 때 씁니다." checked={form.mode === "matrix"}
              onChange={() => update({ mode: "matrix" })} />
          </div>
        </Section>

        <Section title="실행할 기기">
          <DeviceConditions devices={devices} form={form} mode={deviceMode} onModeChange={changeDeviceMode} update={update}
            matches={matches} appMinSdk={appMinSdk} sdkExcluded={eligible.length - count} />
        </Section>

        <Section title="실행할 테스트">
          <p className="text-xs text-fg-subtle">비워두면 전체 테스트를 돌립니다.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="이 태그가 하나라도 붙은 테스트만" hint="쉼표로 구분. 예: smoke">
              <Input aria-label="이 태그가 하나라도 붙은 테스트만" disabled={form.flowPaths.length > 0} value={form.includeTags} onChange={event => update({ includeTags: event.target.value })} />
            </Field>
            <Field label="이 태그가 붙은 테스트는 빼기" hint="예: known-issue">
              <Input aria-label="이 태그가 붙은 테스트는 빼기" disabled={form.flowPaths.length > 0} value={form.excludeTags} onChange={event => update({ excludeTags: event.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-fg-subtle">{form.flowPaths.length > 0
            ? "파일을 직접 지정한 동안에는 태그 조건을 쓰지 않습니다."
            : "테스트 폴더의 config.yaml에 정한 태그 조건도 함께 적용합니다."}</p>
          <Field label="테스트 파일 직접 지정" hint={form.flowSource === "upload"
            ? "zip 안의 경로, 한 줄에 하나. 지정하면 태그 조건은 쓰지 않습니다."
            : selectedWorkspace
              ? `${selectedWorkspace.path || "저장소 루트"} 폴더 기준 파일 경로, 한 줄에 하나. 지정하면 태그 조건은 쓰지 않습니다.`
              : "저장소를 먼저 고르세요."}>
            <Textarea aria-label="테스트 파일 직접 지정" placeholder="flows/login.yaml" rows={3} value={form.flowPaths} onChange={event => update({ flowPaths: event.target.value })} />
          </Field>
        </Section>

        <Section title="추가 설정 (선택)">
          <Field label="테스트에 넘길 값" hint="KEY=VALUE 형식, 한 줄에 하나. 실행 결과에서는 값이 가려집니다. 비밀번호 같은 값은 여기에 넣으세요.">
            <Textarea aria-label="테스트에 넘길 값" rows={4} spellCheck={false} autoComplete="off" placeholder="KEY=VALUE"
              value={form.env} onChange={event => update({ env: event.target.value })} />
          </Field>
          <div className="sm:max-w-xs">
            <Field label="제한 시간(초)" hint={form.mode === "split"
              ? "테스트 하나가 이 시간을 넘기면 중단하고 최대 한 번 더 시도합니다. 다시 넘기면 오류로 끝납니다."
              : "기기 한 대가 모든 테스트를 끝내야 하는 시간입니다. 넘기면 그 기기의 테스트를 중단하고 처음부터 최대 한 번 더 시도합니다. 다시 넘기면 오류로 끝납니다."}>
              <Input aria-label="제한 시간(초)" type="number" min={1} step={1} value={form.taskTimeoutSec}
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
              <dt className="mb-1 text-xs text-fg-subtle">테스트 파일 가져올 곳</dt>
              <dd className="break-all font-medium text-fg">{form.flowSource === "workspace" ? selectedWorkspace?.name || "저장소를 고르세요" : flows?.name || "zip 파일을 올리세요"}</dd>
              {form.flowSource === "workspace" && selectedWorkspace && <dd className="mt-1 break-all font-mono text-xs text-fg-muted">{form.ref || selectedWorkspace.branch}</dd>}
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs text-fg-subtle">앱</dt>
              <dd className="break-all font-mono text-xs leading-5 text-fg">{form.appSource === "upload" ? apk?.name || "APK 파일을 올리세요" : !selectedBuild ? "앱 버전을 고르세요" : form.appBuildId
                ? `${selectedBuild.package_name} · ${selectedBuild.version_name} (${selectedBuild.version_code})` : `${form.packageName} · 가장 최근 버전`}</dd>
            </div>
            <div>
              <dt className="mb-1 text-xs text-fg-subtle">실행 방식</dt>
              <dd className="text-xs text-fg">{form.mode === "split" ? "나눠서 한 번씩" : "기기마다 전부"}</dd>
            </div>
          </dl>
          <div role="status" aria-live="polite" className={cx("rounded-lg px-3 py-3 text-sm",
            count ? "bg-passed-bg text-passed-fg" : "bg-warning-bg text-warning-fg")}>
            <p className="flex items-center gap-2"><StatusDot tone={count ? "passed" : "warning"} />실행할 기기 {count}대</p>
            {!count && <p className="mt-1 text-xs">기기 상태와 선택 조건을 확인하세요.</p>}
          </div>
          <ErrorBox error={validationError ?? submitRun.error} />
          <Button type="submit" variant="primary" icon={<Play />} className="w-full" disabled={!canWrite || submitRun.isPending || !count}>
            {submitRun.isPending ? "시작하는 중…" : "실행 시작"}
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
    <PageHeader title="새 실행" description="어떤 테스트를, 어떤 앱으로, 어떤 기기에서 돌릴지 고릅니다." />
    <TokenNotice />
    {error && <div className="mb-4"><ErrorBox error={error} /></div>}
    {ready ? <NewRunForm workspaces={workspaces.data!} apps={apps.data!} devices={devices.data!} /> : !error && <Loading />}
  </>;
}
