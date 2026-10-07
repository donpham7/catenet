import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";
import { extractPython } from "./python.js";
import type { FileFacts, Lang } from "./types.js";
import { extractTypeScript } from "./typescript.js";

export * from "./types.js";

/**
 * Bump whenever extraction output changes for the same input (new constructs, fixed bugs). Stored facts from another
 * version are never reused, so an upgrade always re-parses (ADR-0013).
 */
export const EXTRACTOR_VERSION = 3;

export interface Extractor {
  /** Parse and extract one file. Synchronous and pure; the grammars are already loaded. */
  extract(source: string, lang: Lang): FileFacts;
}

const GRAMMARS: Record<Lang, string> = {
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
};

export function langForPath(path: string): Lang | null {
  if (/\.(ts|mts|cts)$/.test(path)) return "typescript";
  if (path.endsWith(".tsx")) return "tsx";
  if (/\.(js|jsx|mjs|cjs)$/.test(path)) return "javascript";
  if (path.endsWith(".py")) return "python";
  return null;
}

let shared: Promise<Extractor> | null = null;

/** Load web-tree-sitter and the four grammars once per process (ADR-0011). */
export function loadExtractor(): Promise<Extractor> {
  shared ??= (async () => {
    await Parser.init();
    const require = createRequire(import.meta.url);
    const languages = {} as Record<Lang, Language>;
    for (const lang of Object.keys(GRAMMARS) as Lang[]) {
      languages[lang] = await Language.load(require.resolve(GRAMMARS[lang]));
    }
    const parser = new Parser();
    return {
      extract(source: string, lang: Lang): FileFacts {
        parser.setLanguage(languages[lang]);
        const tree = parser.parse(source);
        if (!tree) throw new Error(`tree-sitter returned no tree for ${lang} source`);
        try {
          return lang === "python" ? extractPython(tree.rootNode) : extractTypeScript(tree.rootNode, lang);
        } finally {
          tree.delete();
        }
      },
    };
  })();
  return shared;
}
