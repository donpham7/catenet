import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/** In the plugin bundle the .wasm files sit in dist/wasm/ next to the code (ADR-0015); otherwise in node_modules. */
const BUNDLED_WASM = join(dirname(fileURLToPath(import.meta.url)), "wasm");
const isBundled = () => existsSync(join(BUNDLED_WASM, "web-tree-sitter.wasm"));

/** Load web-tree-sitter and the four grammars once per process (ADR-0011). */
export function loadExtractor(): Promise<Extractor> {
  shared ??= (async () => {
    const bundled = isBundled();
    await Parser.init(bundled ? { locateFile: (name: string) => join(BUNDLED_WASM, name) } : undefined);
    const require = createRequire(import.meta.url);
    const languages = {} as Record<Lang, Language>;
    for (const lang of Object.keys(GRAMMARS) as Lang[]) {
      const file = GRAMMARS[lang];
      languages[lang] = await Language.load(
        bundled ? join(BUNDLED_WASM, basename(file)) : require.resolve(file),
      );
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
