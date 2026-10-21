import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { API, apiFetch, apiJson } from "../../api/client";
import { keys, useApps } from "../../api/queries";
import type { AppBuild } from "../../api/types";
import { TokenNotice, useCanWrite } from "../../components/Layout";
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader } from "../../components/ui";
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
    <tr className="border-t border-slate-100 align-top">
      <td className="px-4 py-3 font-medium text-slate-900">
        <div>{build.version_name} ({build.version_code})</div>
        {build.pinned && <div className="mt-1"><Badge>고정됨</Badge></div>}
      </td>
      <td className="px-4 py-3">{build.min_sdk}</td>
      <td className="px-4 py-3 whitespace-nowrap">{formatBytes(build.size_bytes)}</td>
      <td className="px-4 py-3 whitespace-nowrap">{build.source === "ci" ? "CI" : "대시보드"}</td>
      <td className="px-4 py-3">
        <div className="max-w-48 break-all">{build.uploaded_by}</div>
        <div className="mt-1 whitespace-nowrap text-xs text-slate-500">{timeAgo(build.created_at)}</div>
      </td>
      <td className="px-4 py-3">
        {build.ci_meta.branch && <div className="max-w-48 break-all">{build.ci_meta.branch}</div>}
        {build.ci_meta.commit && <div className="font-mono text-xs text-slate-500">{shortSha(build.ci_meta.commit)}</div>}
        {!build.ci_meta.branch && !build.ci_meta.commit && "-"}
      </td>
      <td className="px-4 py-3">
        <Button
          size="sm"
          className="min-h-9 whitespace-nowrap"
          aria-pressed={build.pinned}
          disabled={!canWrite || pin.isPending}
          onClick={() => { if (canWrite && !pin.isPending) pin.mutate(); }}
        >
          {build.pinned ? "고정 해제" : "고정"}
        </Button>
        {pin.error && <div className="mt-2 min-w-40"><ErrorBox error={pin.error} /></div>}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {build.purged ? <Badge>파일 삭제됨</Badge> : (
          <a
            href={`${API}/apps/${encodeURIComponent(build.id)}/download`}
            className="inline-flex min-h-9 items-center text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            다운로드
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
        ? `${build.package_name} ${build.version_name} (${build.version_code}) 추가됨`
        : "이미 보관함에 있는 빌드입니다");
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
      <PageHeader title="앱" actions={
        <>
          <input
            ref={fileInput}
            type="file"
            accept=".apk"
            aria-label="APK 파일"
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
            className="min-h-10"
            disabled={!canWrite || upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? "업로드 중…" : "APK 업로드"}
          </Button>
        </>
      } />
      <TokenNotice />
      <div className="space-y-4">
        {notice && (
          <div role="status" className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <span className="min-w-0 break-all">{notice}</span>
            <Button size="sm" variant="ghost" className="min-h-9 shrink-0" aria-label="알림 닫기" onClick={() => setNotice(null)}>닫기</Button>
          </div>
        )}
        <ErrorBox error={upload.error} />
        <Input
          placeholder="패키지 이름 검색"
          aria-label="패키지 이름 검색"
          className="min-h-10 sm:max-w-sm"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {apps.isPending ? <Loading /> : apps.isError ? <ErrorBox error={apps.error} /> : !apps.data.length ? (
          <Empty>{"보관함이 비어 있습니다. CI에서 `farmctl apps upload`로 올리거나 여기서 업로드하세요."}</Empty>
        ) : !groups.size ? <Empty>검색 결과가 없습니다.</Empty> : (
          [...groups].map(([packageName, builds]) => (
            <Card key={packageName} className="min-w-0 overflow-hidden">
              <div className="px-4 py-3">
                <h2 className="break-all font-semibold text-slate-900">{packageName}</h2>
                <div className="mt-1 break-all text-sm text-slate-500">{builds[0]?.label}</div>
              </div>
              <div className="overflow-x-auto">
                <table aria-label={`${packageName} 빌드`} className="w-full min-w-[880px] text-left text-sm text-slate-600">
                  <thead className="border-t border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      {["버전", "minSdk", "크기", "출처", "업로드", "CI 정보", "고정", "다운로드"].map((column) => (
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
