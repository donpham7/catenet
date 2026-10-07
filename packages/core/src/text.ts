// Repo-derived text is untrusted (CLAUDE.md principle 5). Everything Catenet shows to a terminal or an agent passes
// through sanitizeText: no control sequences, no line breaks, no bidi reordering, bounded length.

// Built with fromCharCode so the source contains no literal control characters.
const ch = (code: number) => String.fromCharCode(code);
/** 7-bit (ESC [) and 8-bit (CSI, 0x9b) terminal control sequences. */
const CONTROL_SEQUENCES = new RegExp(`(?:${ch(27)}\\[|${ch(0x9b)})[0-9;?]*[ -/]*[@-~]`, "g");
/** C0 controls (including newline, carriage return and tab), DEL, C1 controls, and Unicode bidi overrides/isolates. */
const UNSAFE_CHARS = new RegExp(
  `[${ch(0)}-${ch(31)}${ch(0x7f)}-${ch(0x9f)}${ch(0x202a)}-${ch(0x202e)}${ch(0x2066)}-${ch(0x2069)}]`,
  "g",
);

export const MAX_TEXT_FIELD = 300;

export function sanitizeText(s: string, max = MAX_TEXT_FIELD): string {
  const clean = s.replace(CONTROL_SEQUENCES, "").replace(UNSAFE_CHARS, "");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
