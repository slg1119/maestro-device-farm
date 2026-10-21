declare module "monaco-editor/languages/definitions/yaml/yaml" {
  import type { languages } from "monaco-editor";
  export const conf: languages.LanguageConfiguration;
  export const language: languages.IMonarchLanguage & { tokenizer: {
    root: languages.IMonarchLanguageRule[];
    doubleQuotedString: languages.IMonarchLanguageRule[];
  } };
}
