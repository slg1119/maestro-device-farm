import { t } from "../../lib/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Package, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { API, apiFetch, apiJson } from "../../api/client";
import { keys, useApps } from "../../api/queries";
import type { AppBuild } from "../../api/types";
import { TokenNotice, useCanWrite } from "../../components/Layout";
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, StatusDot, cx } from "../../components/ui";
import { formatBytes, shortSha, timeAgo } from "../../lib/format";

function BuildRow({ build }: { build: AppBuild }) {
  const canWrite = useCanWrite();
  const client = useQueryClient();
  const pin = useMutation({
    mutationFn: () => apiJson<AppBuild>(`/apps/${encodeURIComponent(build.id)}`, {
      method: "PATCH", json: { pinned: !build.pinned },
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.appsAll }),
  });

  return (
    <tr className="border-t border-border align-top">
      <td className="px-4 py-3 font-medium text-fg">
        <div>{build.version_name} ({build.version_code})</div>
        {build.pinned && <div className="mt-1"><Badge><StatusDot />{t("m_97985586ac")}</Badge></div>}
      </td>
      <td className="px-4 py-3">{build.min_sdk}</td>
      <td className="px-4 py-3 whitespace-nowrap">{formatBytes(build.size_bytes)}</td>
      <td className="px-4 py-3 whitespace-nowrap">{build.source === "ci" ? "CI" : t("m_2859873b5b")}</td>
      <td className="px-4 py-3">
        <div className="max-w-48 break-all">{build.uploaded_by}</div>
        <div className="mt-1 whitespace-nowrap text-xs text-fg-subtle">{timeAgo(build.created_at)}</div>
      </td>
      <td className="px-4 py-3">
        {build.ci_meta.branch && <div className="max-w-48 break-all">{build.ci_meta.branch}</div>}
        {build.ci_meta.commit && <div className="font-mono text-xs text-fg-subtle">{shortSha(build.ci_meta.commit)}</div>}
        {!build.ci_meta.branch && !build.ci_meta.commit && "-"}
      </td>
      <td className="px-4 py-3">
        <Button
          size="sm"
          className="whitespace-nowrap"
          aria-pressed={build.pinned}
          disabled={!canWrite || pin.isPending}
          onClick={() => { if (canWrite && !pin.isPending) pin.mutate(); }}
        >
          {build.pinned ? t("m_82fb3cffc6") : t("m_4f48c00403")}
        </Button>
        {pin.error && <div className="mt-2 min-w-40"><ErrorBox error={pin.error} /></div>}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {build.purged ? <Badge><StatusDot />{t("m_8c10b71b3b")}</Badge> : (
          <a
            href={`${API}/apps/${encodeURIComponent(build.id)}/download`}
            className="inline-flex min-h-9 items-center rounded text-accent underline underline-offset-2 outline-none hover:text-accent-hover focus-visible:ring-2 focus-visible:ring-accent max-md:min-h-11"
          >
            {t("m_5c5095ab96")}
          </a>
        )}
      </td>
    </tr>
  );
}

export function AppsPage() {
  const apps = useApps();
  const canWrite = useCanWrite();
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("apk", file);
      body.append("source", "dashboard");
      const response = await apiFetch("/apps", { method: "POST", body });
      return { status: response.status, build: await response.json() as AppBuild };
    },
    onMutate: () => setNotice(null),
    onSuccess: ({ status, build }) => {
      setNotice(status === 201
        ? t("m_85ccfc46e9", [build.package_name, build.version_name, build.version_code])
        : t("m_ecf75c7555"));
      return client.invalidateQueries({ queryKey: keys.appsAll });
    },
  });

  // The API returns newest first, so insertion order also orders packages by their latest build.
  const groups = new Map<string, AppBuild[]>();
  const search = filter.toLowerCase();
  for (const build of apps.data ?? []) {
    if (!build.package_name.toLowerCase().includes(search)) continue;
    const group = groups.get(build.package_name);
    if (group) group.push(build);
    else groups.set(build.package_name, [build]);
  }

  return (
    <>
      <PageHeader title={t("m_053d5241c7")} description={t("m_48a19ae3df")} actions={
        <>
          <input
            ref={fileInput}
            type="file"
            accept=".apk"
            aria-label={t("m_cb7f89a9af")}
            hidden
            disabled={!canWrite || upload.isPending}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file && canWrite && !upload.isPending) upload.mutate(file);
            }}
          />
          <Button
            variant="primary"
            icon={<Upload />}
            disabled={!canWrite || upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? t("m_7cc8ef1fcd") : t("m_95a2e79288")}
          </Button>
        </>
      } />
      <TokenNotice />
      <div className="space-y-4">
        <section
          aria-label={t("m_9e10c930fc")}
          aria-disabled={!canWrite || upload.isPending}
          aria-busy={upload.isPending}
          className={cx("flex min-w-0 flex-col items-center gap-3 rounded-[10px] border border-dashed p-6 text-center transition-colors sm:p-8",
            dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface",
            (!canWrite || upload.isPending) && "opacity-50")}
          onDragOver={event => {
            event.preventDefault();
            if (canWrite && !upload.isPending) { event.dataTransfer.dropEffect = "copy"; setDragging(true); }
          }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={event => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file && canWrite && !upload.isPending) upload.mutate(file);
          }}
        >
          <span aria-hidden="true" className="rounded-lg bg-accent-soft p-3 text-accent-soft-fg"><Upload size={18} strokeWidth={1.8} /></span>
          <div>
            <p className="font-semibold text-fg">{t("m_6d503b74f5")}</p>
            <p className="mt-1 text-xs text-fg-muted">{t("m_cba68f3f94")}</p>
          </div>
          <Button disabled={!canWrite || upload.isPending} onClick={() => fileInput.current?.click()}>{t("m_a3d68212dd")}</Button>
        </section>
        {notice && (
          <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-passed/25 bg-passed-bg px-3 py-2 text-sm text-passed-fg">
            <span className="min-w-0 break-all">{notice}</span>
            <Button size="sm" variant="ghost" className="shrink-0" aria-label={t("m_d7556ddd22")} onClick={() => setNotice(null)}>{t("m_94b7dba159")}</Button>
          </div>
        )}
        <ErrorBox error={upload.error} />
        <Input
          placeholder={t("m_d06f1b17c1")}
          aria-label={t("m_d06f1b17c1")}
          className="sm:max-w-sm"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {apps.isPending ? <Loading /> : apps.isError ? <ErrorBox error={apps.error} /> : !apps.data.length ? (
          <Empty>{t("m_8c131c48d9")}</Empty>
        ) : !groups.size ? <Empty>{t("m_300d3cac5f")}</Empty> : (
          [...groups].map(([packageName, builds]) => (
            <Card key={packageName} className="min-w-0 overflow-hidden">
              <div className="flex items-start gap-3 px-4 py-4">
                <span aria-hidden="true" className="shrink-0 rounded-lg bg-neutral-bg p-2 text-fg-muted"><Package size={18} strokeWidth={1.8} /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="break-all font-mono text-sm font-semibold text-fg">{packageName}</h2>
                  <div className="mt-1 break-all text-xs text-fg-muted">{builds[0]?.label}</div>
                </div>
                <Badge>{builds.length}{t("m_821f1f43fc")}</Badge>
              </div>
              <div className="overflow-x-auto">
                <table aria-label={t("m_e2e3ead219", [packageName])} className="w-full min-w-[880px] text-left text-sm text-fg-muted">
                  <thead className="border-t border-border bg-surface-2 text-xs text-fg-subtle">
                    <tr>
                      {[t("m_593f8a81a6"), "minSdk", t("m_8451e9aa31"), t("m_2151edbebc"), t("m_51672ccd18"), t("m_a892df926c"), t("m_4f48c00403"), t("m_5c5095ab96")].map((column) => (
                        <th key={column} scope="col" className="px-4 py-2 font-medium whitespace-nowrap">{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{builds.map((build) => <BuildRow key={build.id} build={build} />)}</tbody>
                </table>
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
