/**
 * Version-range matching for SBOM-backed suggestions.
 *
 * Deliberately small: dotted versions with optional letter suffixes
 * ("3.0.9", "1.1.1w", "2022.83"), and ranges written as space-separated
 * comparators with "||" alternatives (">=3.0.0 <3.0.16 || =1.1.1w").
 * Anything it cannot parse returns null, which the affectedness engine turns
 * into UNKNOWN -- a version it cannot read is never assumed safe.
 */

type Part = number | string

function tokens(v: string): Part[] {
  const out: Part[] = []
  for (const token of v.split(/[.\-_+]/)) {
    if (token === '') continue
    // "1w" -> 1, "w" so that 1.1.1w orders after 1.1.1v and after 1.1.1.
    const m = /^(\d+)([a-z]*)$/i.exec(token)
    if (m) {
      out.push(Number(m[1]))
      if (m[2]) out.push(m[2].toLowerCase())
    } else {
      out.push(token.toLowerCase())
    }
  }
  return out
}

interface Parsed {
  main: Part[]
  /** Pre-release identifiers ("rc1" in 1.3.1-rc1), or null for a release. */
  pre: Part[] | null
}

function parse(version: string): Parsed | null {
  const v = version.trim().replace(/^v/i, '')
  if (!/^[0-9][0-9a-z.\-_+]*$/i.test(v)) return null
  // A hyphen followed by a letter starts a pre-release ("1.3.1-rc1",
  // "2.0.0-beta.2"), which orders BEFORE its release. A hyphen followed by a
  // digit ("1.2.3-1") is a packaging revision and orders after, like any
  // further part. A letter directly on a number ("1.1.1w") is a suffix and
  // orders after too.
  const m = /^(.*?)-([a-z].*)$/i.exec(v)
  const main = tokens(m ? m[1]! : v)
  if (!main.length) return null
  return { main, pre: m ? tokens(m[2]!) : null }
}

function compareParts(pa: Part[], pb: Part[]): number {
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined || y === undefined) {
      // A missing numeric part reads as 0 ("3.0" = "3.0.0"); a letter suffix
      // sorts after its absence ("1.1.1" < "1.1.1w").
      const other = (x === undefined ? y : x)!
      if (typeof other === 'string' || other !== 0) return x === undefined ? -1 : 1
      continue
    }
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1
    } else if (typeof x === 'string' && typeof y === 'string') {
      if (x !== y) return x < y ? -1 : 1
    } else {
      // A number sorts after a letter suffix at the same position.
      return typeof x === 'number' ? 1 : -1
    }
  }
  return 0
}

export function compareVersions(a: string, b: string): number | null {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return null
  const main = compareParts(pa.main, pb.main)
  if (main !== 0) return main
  if (!pa.pre && !pb.pre) return 0
  if (!pa.pre) return 1 // a release follows its pre-releases
  if (!pb.pre) return -1
  return compareParts(pa.pre, pb.pre)
}

const COMPARATOR = /^(>=|<=|>|<|=)?\s*(\S+)$/

/** True if in range, false if not, null if the version or range is unreadable. */
export function inRange(version: string, range: string): boolean | null {
  const alternatives = range.split('||').map((s) => s.trim()).filter(Boolean)
  if (alternatives.length === 0) return null
  let unreadable = false
  for (const alt of alternatives) {
    const comparators = alt.split(/\s+/).filter(Boolean)
    let all = true
    for (const c of comparators) {
      const m = COMPARATOR.exec(c)
      if (!m) {
        unreadable = true
        all = false
        break
      }
      const op = m[1] ?? '='
      const cmp = compareVersions(version, m[2]!)
      if (cmp === null) {
        unreadable = true
        all = false
        break
      }
      const ok =
        op === '>=' ? cmp >= 0 : op === '<=' ? cmp <= 0 : op === '>' ? cmp > 0 : op === '<' ? cmp < 0 : cmp === 0
      if (!ok) {
        all = false
        break
      }
    }
    if (all) return true
  }
  return unreadable ? null : false
}
