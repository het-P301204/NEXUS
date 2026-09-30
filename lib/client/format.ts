/**
 * Time formatting for the interface. All instants are UTC on the wire and
 * formatted in the organisation's timezone for display, with the zone always
 * shown next to a full timestamp. A time without its zone is not evidence.
 */

let zone = 'Europe/Berlin'

export function setDisplayZone(tz: string): void {
  zone = tz
}

export function displayZone(): string {
  return zone
}

const cache = new Map<string, Intl.DateTimeFormat>()
function fmt(key: string, opts: Intl.DateTimeFormatOptions, tz = zone): Intl.DateTimeFormat {
  const k = `${key}|${tz}`
  let f = cache.get(k)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz })
    cache.set(k, f)
  }
  return f
}

function partsOf(iso: string, tz = zone): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of fmt('parts', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }, tz).formatToParts(new Date(iso))) {
    out[p.type] = p.value
  }
  if (out.hour === '24') out.hour = '00'
  if (out.month === 'Sept') out.month = 'Sep'
  return out
}

/** "09:32" */
export function hhmm(iso: string, tz = zone): string {
  const p = partsOf(iso, tz)
  return `${p.hour}:${p.minute}`
}

/** "09:32:18" */
export function hhmmss(iso: string, tz = zone): string {
  const p = partsOf(iso, tz)
  return `${p.hour}:${p.minute}:${p.second}`
}

/** "14 Sep" */
export function dayMonth(iso: string, tz = zone): string {
  const p = partsOf(iso, tz)
  return `${Number(p.day)} ${p.month}`
}

/** "30 Sep 2026" */
export function fullDate(iso: string, tz = zone): string {
  const p = partsOf(iso, tz)
  return `${Number(p.day)} ${p.month} ${p.year}`
}

/** "CEST" */
export function zoneAbbr(iso: string, tz = zone): string {
  return partsOf(iso, tz).timeZoneName ?? tz
}

/** "30 Sep 2026, 09:32:18 CEST" */
export function stamp(iso: string | null | undefined, tz = zone): string {
  if (!iso) return '--'
  const p = partsOf(iso, tz)
  return `${Number(p.day)} ${p.month} ${p.year}, ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName}`
}

/** "30 Sep, 09:32" */
export function short(iso: string | null | undefined, tz = zone): string {
  if (!iso) return '--'
  const p = partsOf(iso, tz)
  return `${Number(p.day)} ${p.month}, ${p.hour}:${p.minute}`
}

export function chronoParts(iso: string, tz = zone): { date: string; hm: string; s: string; zone: string } {
  const p = partsOf(iso, tz)
  return { date: `${Number(p.day)} ${p.month} ${p.year}`, hm: `${p.hour}:${p.minute}`, s: p.second ?? '00', zone: p.timeZoneName ?? tz }
}

export function sameDay(a: string, b: string, tz = zone): boolean {
  const x = partsOf(a, tz)
  const y = partsOf(b, tz)
  return x.year === y.year && x.month === y.month && x.day === y.day
}

/** Relative day label for agendas: "Today", "Tomorrow", "Fri 2 Oct". */
export function dayLabel(iso: string, nowIso: string, tz = zone): string {
  if (sameDay(iso, nowIso, tz)) return 'Today'
  const tomorrow = new Date(Date.parse(nowIso) + 86_400_000).toISOString()
  if (sameDay(iso, tomorrow, tz)) return 'Tomorrow'
  const yesterday = new Date(Date.parse(nowIso) - 86_400_000).toISOString()
  if (sameDay(iso, yesterday, tz)) return 'Yesterday'
  return fmt('weekday', { weekday: 'short', day: 'numeric', month: 'short' }, tz).format(new Date(iso))
}

/** "3h ago", "in 17h", "just now" */
export function relative(iso: string, nowMs: number): string {
  const d = Date.parse(iso) - nowMs
  const abs = Math.abs(d)
  const past = d < 0
  const unit = (n: number, u: string) => (past ? `${n}${u} ago` : `in ${n}${u}`)
  if (abs < 45_000) return 'just now'
  if (abs < 3_600_000) return unit(Math.round(abs / 60_000), 'm')
  if (abs < 86_400_000) return unit(Math.round(abs / 3_600_000), 'h')
  return unit(Math.round(abs / 86_400_000), 'd')
}

/** Countdown parts: days, hours, minutes, seconds. */
export function countdownParts(ms: number): { neg: boolean; d: number; h: number; m: number; s: number } {
  const neg = ms < 0
  let r = Math.floor(Math.abs(ms) / 1000)
  const d = Math.floor(r / 86400)
  r -= d * 86400
  const h = Math.floor(r / 3600)
  r -= h * 3600
  const m = Math.floor(r / 60)
  return { neg, d, h, m, s: r - m * 60 }
}

export function humanize(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase()
}

export function titleCase(s: string): string {
  return humanize(s).replace(/(^|\s)\S/g, (c) => c.toUpperCase())
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

/**
 * Local datetime-input value <-> ISO, in the display zone. Seconds are kept by
 * default: a recorded instant that round-trips through an input without them
 * silently moves up to 59 seconds, and every deadline moves with it. Inputs
 * showing seconds need step={1}.
 */
export function toLocalInput(iso: string, tz = zone, seconds = true): string {
  const p = partsOf(iso, tz)
  const months: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Sept: '09', Oct: '10', Nov: '11', Dec: '12' }
  return `${p.year}-${months[p.month!] ?? '01'}-${p.day}T${p.hour}:${p.minute}${seconds ? `:${p.second}` : ''}`
}

/** Interpret "2026-09-30T14:05" as wall-clock time in tz and return the UTC instant. */
export function fromLocalInput(value: string, tz = zone): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!m) return null
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0))
  // Find the offset of tz at that wall time by formatting a guess and correcting.
  let guess = asUtc
  for (let i = 0; i < 3; i++) {
    const p = partsOf(new Date(guess).toISOString(), tz)
    const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11 }
    const wall = Date.UTC(+p.year!, months[p.month!] ?? 0, +p.day!, +p.hour!, +p.minute!, +p.second!)
    guess += asUtc - wall
  }
  return new Date(guess).toISOString()
}
