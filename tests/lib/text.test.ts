import { describe, expect, it } from 'vitest'
import { cleanLine, csvCell, escapeHtml, mdCell, stripInvisible } from '../../lib/text.ts'
import { parseCsv } from '../../lib/csv.ts'

const ch = (cp: number) => String.fromCodePoint(cp)

describe('text hygiene', () => {
  it('strips bidirectional overrides and isolates (Trojan Source)', () => {
    const hostile = `invoice${ch(0x202e)}fdp.exe${ch(0x2066)}x${ch(0x2069)}`
    expect(stripInvisible(hostile)).toBe('invoicefdp.exex')
  })

  it('strips zero-width and C0/C1 controls but keeps tab, newline and carriage return', () => {
    expect(stripInvisible(`a${ch(0x200b)}b${ch(0x0007)}c${ch(0x009b)}d\te\nf\rg${ch(0xfeff)}`)).toBe('abcd\te\nf\rg')
  })

  it('is idempotent', () => {
    const s = `x${ch(0x202a)}y${ch(0x200f)}z`
    expect(stripInvisible(stripInvisible(s))).toBe(stripInvisible(s))
  })

  it('leaves international text intact', () => {
    for (const s of ['Île-de-France', '日本語', 'Kovač', 'Tomás', 'Ελληνικά']) expect(stripInvisible(s)).toBe(s)
  })

  it('collapses whitespace in single-line fields', () => {
    expect(cleanLine('  a \n\n b\t c  ')).toBe('a b c')
  })
})

describe('export safety', () => {
  it('neutralises spreadsheet formulas in CSV cells', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csvCell('+1')).toBe(`"'+1"`)
    expect(csvCell('-2')).toBe(`"'-2"`)
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
    expect(csvCell('plain')).toBe('"plain"')
  })

  it('prevents a pipe from forging Markdown table cells and a newline from forging a heading', () => {
    const hostile = 'evil | REPORTABLE | fine\n## Forged heading'
    const cell = mdCell(hostile)
    expect(cell).not.toContain('\n')
    expect(cell.split(/(?<!\\)\|/)).toHaveLength(1)
  })

  it('escapes HTML markup: a hostile string is never emitted verbatim', () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const out = escapeHtml(hostile)
    expect(out).not.toContain('<img')
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('CSV parsing', () => {
  it('handles quoted fields, escaped quotes, embedded commas and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ])
  })
})
