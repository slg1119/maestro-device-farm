import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { apiJson } from "../../api/client";
import { keys, useDevices } from "../../api/queries";
import type { Device, DeviceState } from "../../api/types";
import { TokenNotice } from "../../components/Layout";
import { DeviceStateBadge } from "../../components/StatusBadge";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, PageHeader, cx } from "../../components/ui";
import { formatTime, parseTs, timeAgo } from "../../lib/format";
import { useSettings } from "../../lib/settings";

const STATES: { state: DeviceState; label: string }[] = [
  { state: "available", label: "사용 가능" },
  { state: "busy", label: "실행 중" },
  { state: "reserved", label: "예약됨" },
  { state: "unhealthy", label: "점검 필요" },
  { state: "disabled", label: "정비 모드" },
  { state: "offline", label: "오프라인" },
];

function DeviceCard({ device }: { device: Device }) {
  const { token } = useSettings();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState("");
  const mutation = useMutation({
    mutationFn: (patch: Partial<Pick<Device, "tags" | "disabled">>) =>
      apiJson<Device>(`/devices/${encodeURIComponent(device.serial)}`, { method: "PATCH", json: patch }),
    onSuccess: async (_updated, patch) => {
      await client.invalidateQueries({ queryKey: keys.devices });
      if (patch.tags !== undefined) setEditing(false);
    },
  });
  const writesDisabled = !token || mutation.isPending;

  const toggleMaintenance = () => {
    if (writesDisabled) return;
    if (
      !device.disabled && device.state === "busy" &&
      !window.confirm("실행 중인 task는 끝까지 돌고 이후 배정이 멈춥니다. 정비 모드를 켤까요?")
    ) return;
    mutation.mutate({ disabled: !device.disabled });
  };

  return (
    <article aria-label={`${device.model} (${device.serial})`} className="min-w-0">
      <Card className="flex h-full min-w-0 flex-col gap-4 p-4">
        <div className="min-w-0">
          <h2 className="break-words font-semibold text-slate-900">{device.model}</h2>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">{device.serial}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
            <span>Android {device.os_version} · SDK {device.sdk_int}</span>
            <span className={cx(device.battery !== null && device.battery < 20 && "text-red-600")}>
              🔋 {device.battery === null ? "-" : `${device.battery}%`}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DeviceStateBadge state={device.state} />
          {device.state_reason && <span className="min-w-0 break-words text-xs text-slate-500">{device.state_reason}</span>}
        </div>

        {editing ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (writesDisabled) return;
              mutation.mutate({ tags: [...new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean))].sort() });
            }}
          >
            <Field label="태그" hint="쉼표로 구분해 입력하세요.">
              <Input autoFocus value={tags} disabled={writesDisabled} onChange={(event) => setTags(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" disabled={writesDisabled}>저장</Button>
              <Button
                disabled={mutation.isPending}
                onClick={() => {
                  setEditing(false);
                  mutation.reset();
                }}
              >
                취소
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {device.tags.length ? device.tags.map((tag) => (
              <Badge key={tag}><span className="break-all">{tag}</span></Badge>
            )) : <span className="text-xs text-slate-400">태그 없음</span>}
          </div>
        )}

        <div className="space-y-2 text-xs text-slate-500">
          {device.reservation && (
            <p className="break-words">
              예약: {device.reservation.holder_name} · {parseTs(device.reservation.expires_at).getTime() <= Date.now()
                ? "만료됨" : `${formatTime(device.reservation.expires_at)}까지`}
            </p>
          )}
          {device.current_run_id && (
            <Link className="inline-block text-sm text-blue-700 underline hover:text-blue-900" to={`/runs/${device.current_run_id}`}>
              실행 중인 run
            </Link>
          )}
          <p title={formatTime(device.last_seen_at)}>마지막 확인 {timeAgo(device.last_seen_at)}</p>
        </div>

        <ErrorBox error={mutation.error} />
        <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {!editing && (
            <Button
              disabled={writesDisabled}
              onClick={() => {
                setTags(device.tags.join(", "));
                mutation.reset();
                setEditing(true);
              }}
            >
              태그 편집
            </Button>
          )}
          <Button disabled={writesDisabled} onClick={toggleMaintenance}>
            {device.disabled ? "정비 모드 끄기" : "정비 모드 켜기"}
          </Button>
        </div>
      </Card>
    </article>
  );
}

export function DevicesPage() {
  const { data, isPending, error } = useDevices();
  const summary = STATES.map(({ state, label }) => {
    const count = data?.filter((device) => device.state === state).length ?? 0;
    return count ? `${label} ${count}` : null;
  }).filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader title="기기">{summary}</PageHeader>
      <TokenNotice />
      {isPending ? <Loading /> : error ? <ErrorBox error={error} /> : !data?.length ? (
        <Empty>연결된 기기가 없습니다. farm-agent가 실행 중인지 확인하세요.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...data].sort((a, b) => a.serial.localeCompare(b.serial)).map((device) => (
            <DeviceCard key={device.serial} device={device} />
          ))}
        </div>
      )}
    </>
  );
}
