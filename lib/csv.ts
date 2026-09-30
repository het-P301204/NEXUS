/**
 * RFC 4180 CSV parsing: quoted fields, escaped quotes, CRLF or LF.
 * Returns rows of raw strings; validation is the caller's job.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const s = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  while (i < s.length) {
    const ch = s[i]!
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') {
      quoted = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field)
      field = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += ch
    i++
  }
  row.push(field)
  if (row.some((c) => c !== '')) rows.push(row)
  return rows
}

/** Rows as objects keyed by the (lower-cased, trimmed) header row. */
export function csvRecords(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input)
  if (rows.length === 0) return []
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}
