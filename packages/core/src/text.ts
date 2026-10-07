// Repo-derived text is untrusted (CLAUDE.md principle 5). Everything Catenet shows to a terminal or an agent passes
// through sanitizeText: no control sequences, no line breaks, no bidi reordering, bounded length.

// Built with fromCharCode so the source contains no literal control characters.
const ch = (code: number) => String.fromCharCode(code);
/** 7-bit (ESC [) and 8-bit (CSI, 0x9b) terminal control sequences. */
const CONTROL_SEQUENCES = new RegExp(`(?:${ch(27)}\\[|${ch(0x9b)})[0-9;?]*[ -/]*[@-~]`, "g");
/**
 * Control characters (C0 including newline and tab, DEL, C1), format characters (bidi overrides and isolates,
 * zero-width characters, the byte-order mark, and the invisible "tag" characters that can hide text a model reads but
 * a human doesn't), and the Unicode line and paragraph separators.
 */
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{E0000}-\u{E007F}]/gu;

export const MAX_TEXT_FIELD = 300;

export function sanitizeText(s: string, max = MAX_TEXT_FIELD): string {
  const clean = s.replace(CONTROL_SEQUENCES, "").replace(UNSAFE_CHARS, "");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Every string in a JSON-like value, sanitised (object keys are Catenet's own, so they are kept). */
export function sanitizeDeep(value: unknown, max = MAX_TEXT_FIELD): unknown {
  if (typeof value === "string") return sanitizeText(value, max);
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, max));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v, max)]));
  return value;
}
