import type { SelectorCandidate } from "./store";
export interface MaestroCompletion { name: string; description: string; snippet: string }
const command = (name: string, description: string, body?: string): MaestroCompletion => ({ name, description, snippet: body ?? name });
export const maestroCommands: MaestroCompletion[] = [
  command("launchApp", "앱을 실행합니다", "launchApp:\n    appId: ${1:com.example.app}\n    clearState: ${2:true}"),
  ...["tapOn", "doubleTapOn", "longPressOn"].map(name => command(name, "화면의 요소를 누릅니다", `${name}:\n    id: \"\${1:resource-id}\"`)),
  command("inputText", "텍스트를 입력합니다", 'inputText: "${1:텍스트}"'),
  command("inputRandomEmail", "임의의 이메일을 입력합니다"), command("inputRandomNumber", "임의의 숫자를 입력합니다"),
  command("inputRandomPersonName", "임의의 이름을 입력합니다"), command("inputRandomText", "임의의 텍스트를 입력합니다"),
  command("eraseText", "입력한 텍스트를 지웁니다", "eraseText: ${1:50}"), command("pressKey", "기기 키를 누릅니다", "pressKey: ${1:Enter}"),
  command("back", "이전 화면으로 돌아갑니다"), command("hideKeyboard", "키보드를 닫습니다"), command("scroll", "화면을 스크롤합니다"),
  command("scrollUntilVisible", "요소가 보일 때까지 스크롤합니다", 'scrollUntilVisible:\n    element:\n      id: "${1:resource-id}"\n    direction: ${2:DOWN}\n    timeout: ${3:10000}'),
  command("swipe", "화면을 쓸어 넘깁니다", "swipe:\n    direction: ${1:UP}"),
  command("assertVisible", "요소가 보이는지 확인합니다", 'assertVisible:\n    id: "${1:resource-id}"'),
  command("assertNotVisible", "요소가 보이지 않는지 확인합니다", 'assertNotVisible:\n    text: "${1:텍스트}"'),
  command("assertTrue", "조건식이 참인지 확인합니다", "assertTrue: ${1:조건식}"),
  command("extendedWaitUntil", "요소가 나타나거나 사라질 때까지 기다립니다", 'extendedWaitUntil:\n    visible: "${1:텍스트}"\n    timeout: ${2:10000}'),
  command("waitForAnimationToEnd", "애니메이션이 끝날 때까지 기다립니다"),
  command("takeScreenshot", "스크린샷을 저장합니다", "takeScreenshot: ${1:screen}"),
  command("copyTextFrom", "요소의 텍스트를 복사합니다", 'copyTextFrom:\n    id: "${1:resource-id}"'), command("pasteText", "복사한 텍스트를 붙여 넣습니다"),
  command("openLink", "링크를 엽니다", 'openLink: "${1:https://example.com}"'),
  command("runFlow", "다른 플로우를 실행합니다", "runFlow:\n    file: ${1:subflow.yaml}"), command("runScript", "자바스크립트 파일을 실행합니다", "runScript: ${1:script.js}"),
  command("evalScript", "자바스크립트 식을 실행합니다", "evalScript: ${1:표현식}"),
  command("repeat", "명령을 반복합니다", "repeat:\n    times: ${1:3}\n    commands:\n      - ${2:back}"),
  command("retry", "실패한 명령을 다시 시도합니다", "retry:\n    maxRetries: ${1:3}\n    commands:\n      - ${2:back}"),
  command("clearState", "앱 데이터를 초기화합니다"), command("stopApp", "앱을 중지합니다"), command("killApp", "앱 프로세스를 종료합니다"),
  command("setLocation", "기기 위치를 설정합니다", "setLocation:\n    latitude: ${1:37.5}\n    longitude: ${2:127.0}"),
  command("addMedia", "기기에 미디어를 추가합니다", "addMedia:\n    - ${1:media/image.png}"),
];
export const configKeys = ["appId", "name", "tags", "env", "onFlowStart", "onFlowComplete", "flows", "includeTags", "excludeTags"].map(name => command(name, "플로우 설정", `${name}: \${1:값}`));
export const selectorKeys = ["id", "text", "accessibilityText", "index", "childOf", "below", "above", "leftOf", "rightOf", "optional", "enabled", "point", "retryTapIfNoChange"].map(name => command(name, "요소 선택 조건", `${name}: \${1:값}`));
export function completionsFor(line: string, selectors: SelectorCandidate[]): MaestroCompletion[] {
  const match = line.match(/^\s*-\s*([\w]*)$/);
  if (match) return maestroCommands.filter(c => c.name.toLowerCase().startsWith((match[1] ?? "").toLowerCase()));
  if (/^\s+/.test(line)) {
    const kind = line.match(/(id|text|accessibilityText):\s*["']?[^"']*$/)?.[1];
    if (kind) return selectors.filter(s => s.kind === kind).map(s => command(s.value, s.note ?? "화면 스냅샷의 셀렉터", JSON.stringify(s.value)));
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
