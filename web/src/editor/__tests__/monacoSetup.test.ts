import { beforeAll, expect, test, vi } from "vitest";
import type { editor, languages } from "monaco-editor";
// Monaco ships declarations for its public API only. Test the actual engines directly,
// avoiding editor DOM/worker initialization in jsdom.
// @ts-expect-error internal Monaco engine has no published declarations
import { compile } from "monaco-editor/editor/standalone/common/monarch/monarchCompile";
// @ts-expect-error internal Monaco engine has no published declarations
import { MonarchTokenizer } from "monaco-editor/editor/standalone/common/monarch/monarchLexer";
// @ts-expect-error internal Monaco engine has no published declarations
import { TokenTheme } from "monaco-editor/editor/common/languages/supports/tokenization";
// @ts-expect-error built-in Monaco themes have no published declarations
import { vs, vs_dark } from "monaco-editor/editor/standalone/common/themes";

const registered = vi.hoisted(() => ({
  themes: new Map<string, editor.IStandaloneThemeData>(),
  tokenizer: undefined as languages.IMonarchLanguage | undefined,
}));
vi.mock("monaco-editor", () => ({
  editor: { defineTheme: (name: string, theme: editor.IStandaloneThemeData) => registered.themes.set(name, theme) },
  languages: {
    getLanguages: () => [{ id: "yaml" }],
    setLanguageConfiguration: vi.fn(),
    setMonarchTokensProvider: (_id: string, tokenizer: languages.IMonarchLanguage) => { registered.tokenizer = tokenizer; },
  },
}));
vi.mock("monaco-editor/editor/editor.api", () => ({ languages: { IndentAction: { Indent: 1 } } }));
vi.mock("@monaco-editor/react", () => ({ loader: { config: vi.fn() } }));
vi.mock("monaco-editor/editor/editor.worker?worker", () => ({ default: class {} }));
beforeAll(async () => { await (await import("../monacoSetup")).ensureMonaco(); });

function tokenize(source: string): { offset: number; type: string }[][] {
  const tokenizer = new MonarchTokenizer({}, {}, "yaml", compile("yaml", registered.tokenizer), {
    getValue: () => 20_000, onDidChangeConfiguration: () => ({ dispose() {} }),
  });
  let state = tokenizer.getInitialState();
  try {
    return source.split("\n").map(line => {
      const result = tokenizer.tokenize(line, true, state); state = result.endState;
      return result.tokens;
    });
  } finally { tokenizer.dispose(); }
}

test.each(["light", "dark"])("YAML tokens resolve to the design colors in farm-%s", name => {
  const theme = registered.themes.get(`farm-${name}`)!;
  const resolved = TokenTheme.createFromRawTokenTheme([...(name === "light" ? vs : vs_dark).rules, ...theme.rules], []);
  const colors = name === "light"
    ? ["#2440b8", "#15803d", "#a15c07", "#6b7280", "#6d28d9"]
    : ["#8ab4ff", "#7fd1a0", "#f2b37c", "#6b7686", "#c4a7ff"];
  for (const [token, index] of [["type.yaml", 0], ["string.yaml", 1], ["number.yaml", 2], ["keyword.yaml", 2], ["variable.yaml", 2], ["comment.yaml", 3], ["maestro.command.yaml", 4]] as const) {
    expect(resolved.getColorMap()[resolved._match(token)._foreground].toString().toLowerCase()).toBe(colors[index]);
  }
  expect(resolved._match("comment.yaml")._fontStyle).toBe(1);
  if (name === "light") {
    for (const token of ["operators.yaml", "delimiter.bracket.yaml"]) expect(resolved.getColorMap()[resolved._match(token)._foreground].toString().toLowerCase()).toBe("#6b7280");
  }
});

test("only list command names get command tokens; normal keys and block strings stay YAML", () => {
  const source = 'appId: demo\n---\n- launchApp\n- tapOn:\n    id: button\n- assertVisible: "OK"\ntext: |\n  - tapOn: literal\n- inputText: ${NAME}\n- id: selector';
  const tokens = tokenize(source);
  expect(tokens[0]?.some(token => token.type === "type.yaml")).toBe(true);
  for (const line of [2, 3, 5, 8]) expect(tokens[line]?.some(token => token.type === "maestro.command.yaml")).toBe(true);
  for (const line of [4, 9]) expect(tokens[line]?.some(token => token.type === "type.yaml")).toBe(true);
  expect(tokens[7]?.every(token => token.type !== "maestro.command.yaml")).toBe(true);
  expect(tokens[8]?.some(token => token.type === "variable.yaml")).toBe(true);
});

test("quoted values, collections, variables and comments retain their YAML tokenization", () => {
  const tokens = tokenize('count: 42\nenabled: true\n# comment\ntext: "Hello ${NAME}"\nkeys: { id: "button", index: 1 }');
  for (const [line, token] of [[0, "number.yaml"], [1, "keyword.yaml"], [2, "comment.yaml"], [3, "variable.yaml"], [4, "type.yaml"]] as const) expect(tokens[line]?.some(part => part.type === token)).toBe(true);
});
