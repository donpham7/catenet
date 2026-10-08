// Privacy defaults for the event log (ARCHITECTURE 2.4, CLAUDE.md principle 4): store paths, hashes and counts; any
// text that is kept (prompt previews, Bash commands, search patterns) goes through redactSecrets first.
import { isAbsolute } from "node:path";
import { repoRelative } from "../fspath.js";

const R = "[REDACTED]";

const SECRET_WORD =
  "(?:password|passwd|pwd|pass|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credentials?)";
/** A value: double-quoted, single-quoted (spaces allowed), or bare. */
const VALUE = String.raw`(?:"[^"\n]*"|'[^'\n]*'|[^\s"',;]+)`;
const keepQuotes = (value: string) => {
  const q = value[0];
  return (q === '"' || q === "'") && value.endsWith(q) && value.length >= 2 ? `${q}${R}${q}` : R;
};

const PATTERNS: [RegExp, string | ((...m: string[]) => string)][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, R],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, R],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, R],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, R],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, R],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, R],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, R],
  [/\bAIza[0-9A-Za-z_-]{35}/g, R],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, R],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${R}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{3,}/g, R],
  // Credentials in a URL (scheme://user:password@host) and signed-URL parameters.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${R}@`],
  [/\b(X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s"']+/gi, `$1${R}`],
  // curl -u user:password, mysql -pPASSWORD.
  [/(\s-u\s+[^\s:]+:)\S+/g, `$1${R}`],
  [/(\b(?:mysql|mysqldump|mariadb)\b[^\n]*?\s-p)(?!\s)\S+/g, `$1${R}`],
  // Flags that take a secret: --password value, --api-key=value, -p value after `login`.
  [
    new RegExp(`(--?${SECRET_WORD}(?:[_-][A-Za-z]+)*(?:=|\\s+))(${VALUE})`, "gi"),
    (_m: string, flag: string, value: string) => `${flag}${keepQuotes(value)}`,
  ],
  [/(\blogin\b[^\n]*?\s-p\s+)\S+/g, `$1${R}`],
  // key = value, key: value and "key": "value" where the key names a secret; quoted values may contain spaces.
  [
    new RegExp(`([A-Za-z0-9_-]*${SECRET_WORD}[A-Za-z0-9_-]*["']?\\s*[:=]\\s*)(${VALUE})`, "gi"),
    (_m: string, key: string, value: string) => `${key}${keepQuotes(value)}`,
  ],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS)
    out =
      typeof replacement === "string"
        ? out.replace(pattern, replacement)
        : out.replace(pattern, replacement as (...m: string[]) => string);
  return out;
}

const PATH_KEYS = ["file_path", "notebook_path", "path"];

/** Repo-relative when inside the repo (`root` must be the absolute repository root), otherwise as given. */
const relPath = (p: string, root: string) =>
  isAbsolute(p) && isAbsolute(root) ? (repoRelative(p, root) ?? p) : p;

/**
 * The part of a shell command that says what it does, not the data it carries: the first line only, cut before a
 * here-string. A heredoc's body (often a whole file Claude is writing) starts on the next line, so it is dropped.
 */
function commandHead(command: string): string {
  const lines = command.split("\n");
  let head = lines[0] ?? "";
  const hereString = head.indexOf("<<<");
  const cut = hereString >= 0 || lines.length > 1;
  if (hereString >= 0) head = head.slice(0, hereString + 3);
  return cut ? `${head.trimEnd()} …` : head;
}

/**
 * What the event log keeps about a tool call's input: target paths and a short, redacted summary. File contents,
 * old/new strings and patches are never stored.
 */
export function summarizeToolInput(
  _tool: string,
  input: Record<string, unknown>,
  root: string,
): { targetPaths: string[]; argsSummary: string } {
  const targetPaths = PATH_KEYS.flatMap((k) =>
    typeof input[k] === "string" ? [relPath(input[k] as string, root)] : [],
  );
  let summary: string;
  if (typeof input.command === "string") summary = redactSecrets(commandHead(input.command));
  else if (typeof input.pattern === "string")
    summary = `${redactSecrets(input.pattern)}${targetPaths.length ? ` in ${targetPaths.join(", ")}` : ""}`;
  else if (typeof input.url === "string") summary = redactSecrets(input.url);
  else if (targetPaths.length > 0) summary = targetPaths.join(", ");
  else summary = Object.keys(input).sort().join(", ");
  return { targetPaths, argsSummary: summary.length > 200 ? `${summary.slice(0, 199)}…` : summary };
}
