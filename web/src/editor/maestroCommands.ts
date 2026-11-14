import { t } from "../lib/i18n";
import type { SelectorCandidate } from "./store";
export interface MaestroCompletion { name: string; description: string; snippet: string }
const command = (name: string, description: string, body?: string): MaestroCompletion => ({ name, description, snippet: body ?? name });
export const maestroCommands: MaestroCompletion[] = [
  command("launchApp", t("m_35561ea5a3"), "launchApp:\n    appId: ${1:com.example.app}\n    clearState: ${2:true}"),
  ...["tapOn", "doubleTapOn", "longPressOn"].map(name => command(name, t("m_75f5532102"), `${name}:\n    id: \"\${1:resource-id}\"`)),
  command("inputText", t("m_b99c2a702a"), t("m_09a7dc67e4")),
  command("inputRandomEmail", t("m_e1139f0f89")), command("inputRandomNumber", t("m_c6d7c5c3b0")),
  command("inputRandomPersonName", t("m_5d1b23ec87")), command("inputRandomText", t("m_4bbb1417a0")),
  command("eraseText", t("m_eab7c29d73"), "eraseText: ${1:50}"), command("pressKey", t("m_8308912c0f"), "pressKey: ${1:Enter}"),
  command("back", t("m_3c9ead3414")), command("hideKeyboard", t("m_fef6297eb9")), command("scroll", t("m_6d32bc10ef")),
  command("scrollUntilVisible", t("m_d17cb1614a"), 'scrollUntilVisible:\n    element:\n      id: "${1:resource-id}"\n    direction: ${2:DOWN}\n    timeout: ${3:10000}'),
  command("swipe", t("m_9e7ed69e61"), "swipe:\n    direction: ${1:UP}"),
  command("assertVisible", t("m_24507dce12"), 'assertVisible:\n    id: "${1:resource-id}"'),
  command("assertNotVisible", t("m_6e93914be3"), t("m_a4b90ed268")),
  command("assertTrue", t("m_2a0329fe44"), t("m_e2d174c9dd")),
  command("extendedWaitUntil", t("m_6ada7a397d"), t("m_f99c290e47")),
  command("waitForAnimationToEnd", t("m_68b342ce11")),
  command("takeScreenshot", t("m_bf3d31ed23"), "takeScreenshot: ${1:screen}"),
  command("copyTextFrom", t("m_01d302dfbb"), 'copyTextFrom:\n    id: "${1:resource-id}"'), command("pasteText", t("m_5af8eba1cf")),
  command("openLink", t("m_0ae8786655"), 'openLink: "${1:https://example.com}"'),
  command("runFlow", t("m_b887ecf9e8"), "runFlow:\n    file: ${1:subflow.yaml}"), command("runScript", t("m_15482f8bfd"), "runScript: ${1:script.js}"),
  command("evalScript", t("m_298f542ee7"), t("m_22b68b0b38")),
  command("repeat", t("m_e8e7c2697b"), "repeat:\n    times: ${1:3}\n    commands:\n      - ${2:back}"),
  command("retry", t("m_548d705619"), "retry:\n    maxRetries: ${1:3}\n    commands:\n      - ${2:back}"),
  command("clearState", t("m_0cc473b31c")), command("stopApp", t("m_524a81d5b2")), command("killApp", t("m_54797dd01e")),
  command("setLocation", t("m_a53681c39f"), "setLocation:\n    latitude: ${1:37.5}\n    longitude: ${2:127.0}"),
  command("addMedia", t("m_d129f61d2e"), "addMedia:\n    - ${1:media/image.png}"),
];
export const configKeys = ["appId", "name", "tags", "env", "onFlowStart", "onFlowComplete", "flows", "includeTags", "excludeTags"].map(name => command(name, t("m_48ac797496"), t("m_63fd9a0460", [name])));
export const selectorKeys = ["id", "text", "accessibilityText", "index", "childOf", "below", "above", "leftOf", "rightOf", "optional", "enabled", "point", "retryTapIfNoChange"].map(name => command(name, t("m_c01af96df5"), t("m_63fd9a0460", [name])));
export function completionsFor(line: string, selectors: SelectorCandidate[]): MaestroCompletion[] {
  const match = line.match(/^\s*-\s*([\w]*)$/);
  if (match) return maestroCommands.filter(c => c.name.toLowerCase().startsWith((match[1] ?? "").toLowerCase()));
  if (/^\s+/.test(line)) {
    const kind = line.match(/(id|text|accessibilityText):\s*["']?[^"']*$/)?.[1];
    if (kind) return selectors.filter(s => s.kind === kind).map(s => command(s.value, s.note ?? t("m_a987d39dbf"), JSON.stringify(s.value)));
    return selectorKeys;
  }
  return configKeys.filter(c => c.name.startsWith(line.trim()));
}
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let prev = row[0]!; row[0] = i; for (let j = 1; j <= b.length; j++) { const old = row[j]!; row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = old; } }
  return row[b.length]!;
}
export function closestCommand(name: string): string | null {
  const found = maestroCommands.map(c => ({ name: c.name, score: distance(name, c.name) })).sort((a, b) => a.score - b.score)[0];
  return found && found.score <= 2 && found.score > 0 ? found.name : null;
}
