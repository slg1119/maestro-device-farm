import { t } from "../../lib/i18n";
import type { Device, DeviceSelector, RunMode, RunOptions } from "../../api/types";

/** Text inputs stay strings so clearing an optional numeric field omits it. */
export interface RunForm {
  flowSource: "workspace" | "upload";
  workspace: string;
  ref: string;
  appSource: "library" | "upload";
  packageName: string;
  appBuildId: string;
  mode: RunMode;
  tags: string;
  models: string;
  minSdk: string;
  maxSdk: string;
  serials: string[];
  includeTags: string;
  excludeTags: string;
  flowPaths: string;
  env: string;
  taskTimeoutSec: string;
}

export function splitList(text: string): string[] {
  return text.split(/[,\n]/).map(item => item.trim()).filter(Boolean);
}

export function parseEnv(text: string): Record<string, string> {
  const entries: [string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const equals = line.indexOf("=");
    const key = line.slice(0, equals).trim();
    if (equals < 0 || !key) throw new Error(t("m_7c2a29afe5", [line]));
    // Preserve the value verbatim, including spaces and any further '=' characters.
    entries.push([key, line.slice(equals + 1)]);
  }
  return Object.fromEntries(entries);
}

export function buildDeviceSelector(form: RunForm): DeviceSelector {
  const selector: DeviceSelector = {};
  const tags = splitList(form.tags);
  const models = splitList(form.models);
  if (tags.length) selector.tags = tags;
  if (models.length) selector.models = models;
  if (form.serials.length) selector.serials = [...form.serials];
  if (form.minSdk.trim()) selector.min_sdk = Number(form.minSdk);
  if (form.maxSdk.trim()) selector.max_sdk = Number(form.maxSdk);
  return selector;
}

export function buildRunOptions(form: RunForm): RunOptions {
  const options: RunOptions = {
    mode: form.mode,
    origin: "dashboard",
    flow_source: form.flowSource,
    device_selector: buildDeviceSelector(form),
    include_tags: splitList(form.includeTags),
    exclude_tags: splitList(form.excludeTags),
    env: parseEnv(form.env),
  };
  if (form.flowSource === "workspace") {
    options.workspace = form.workspace;
    if (form.ref.trim()) options.ref = form.ref.trim();
  }
  if (form.appSource === "library") {
    if (form.appBuildId) options.app_build_id = form.appBuildId;
    else options.app = `${form.packageName}@latest`;
  }
  const paths = splitList(form.flowPaths);
  if (paths.length) options.flow_paths = paths;
  if (form.taskTimeoutSec.trim()) options.task_timeout_sec = Number(form.taskTimeoutSec);
  return options;
}

/** Mirrors scheduler eligibility plus device_matches, without predicting APK metadata. */
export function matchingDevices(devices: Device[], selector: DeviceSelector, minSdk = 0): Device[] {
  return devices.filter(device =>
    (device.state === "available" || device.state === "busy") &&
    !device.reservation && !device.disabled &&
    (!selector.serials || selector.serials.includes(device.serial)) &&
    (!selector.models || selector.models.includes(device.model)) &&
    (!selector.tags || selector.tags.every(tag => device.tags.includes(tag))) &&
    (selector.min_sdk === undefined || device.sdk_int >= selector.min_sdk) &&
    (selector.max_sdk === undefined || device.sdk_int <= selector.max_sdk) &&
    device.sdk_int >= minSdk,
  );
}
