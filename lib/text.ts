/**
 * Text hygiene for every user-supplied string.
 *
 * HTML escaping does not cover two injection classes, and both matter to a
 * product whose output is meant to be trusted by someone who was not there:
 *
 *   Bidirectional controls (Trojan Source). A right-to-left override in a
 *   product name makes a report read differently from what it says. These
 *   are stripped, not escaped -- they are not markup.
 *
 *   Spreadsheet formulas. A cell beginning with = + - @ is executed by the
 *   spreadsheet that opens the CSV export.
 *
 * The character ranges are assembled from documented code points rather than
 * written as escape sequences, so the set is reviewable line by line.
 */

const INVISIBLE_RANGES: Array<[number, number, string]> = [
  [0x0000, 0x0008, 'C0 controls before TAB'],
  [0x000b, 0x000c, 'vertical tab, form feed'],
  [0x000e, 0x001f, 'C0 controls after CR'],
  [0x007f, 0x009f, 'DEL and C1 controls'],
  [0x061c, 0x061c, 'Arabic letter mark'],
  [0x180e, 0x180e, 'Mongolian vowel separator'],
  [0x200b, 0x200f, 'zero-width space/joiners, LRM, RLM'],
  [0x2028, 0x2029, 'line and paragraph separators'],
  [0x202a, 0x202e, 'bidi embeddings and overrides'],
  [0x2066, 0x2069, 'bidi isolates'],
  [0xfeff, 0xfeff, 'byte-order mark / zero-width no-break space'],
]

function isInvisible(cp: number): boolean {
  for (const [lo, hi] of INVISIBLE_RANGES) if (cp >= lo && cp <= hi) return true
  return false
}

/** Remove bidi controls, zero-width characters and C0/C1 controls (keeps TAB, LF, CR). Idempotent. */
export function stripInvisible(input: string): string {
  let out = ''
  for (const ch of input) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      out += ch
      continue
    }
    if (!isInvisible(cp)) out += ch
  }
  return out
}

/** Single-line text: invisible characters stripped, whitespace collapsed, trimmed. */
export function cleanLine(input: string): string {
  return stripInvisible(input).replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

/** Multi-line text: invisible characters stripped, CRLF normalised, trimmed. */
export function cleanText(input: string): string {
  return stripInvisible(input).replace(/\r\n?/g, '\n').trim()
}

/** CSV cell: quoted, and formula-leading values neutralised with an apostrophe. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value)
  s = stripInvisible(s)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/**
 * Markdown text, for table cells and paragraphs alike: nothing a user writes can
 * become structure. Newlines cannot start a heading, pipes cannot forge cells, a
 * block marker at the start of the text (#, -, +, 1.) is escaped, emphasis and
 * link syntax are escaped, and HTML is written as entities so no renderer treats
 * it as markup.
 */
export function mdCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return cleanLine(s)
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([|*_[\]~])/g, '\\$1')
    .replace(/`/g, "'")
    .replace(/^(\s*)([#+-]|\d+[.)])/, '$1\\$2')
}

/** HTML text escaping for server-rendered exports. */
export function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return stripInvisible(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
