import type { Iso } from '../../types/domain.ts'

/**
 * Instant arithmetic for the engine.
 *
 * The engine never reads the wall clock. Every function that needs "now"
 * takes it as an argument, so the same inputs always produce the same
 * deadlines and a what-if simulation can move time without touching a record.
 */

export function ms(at: Iso): number {
  const t = Date.parse(at)
  if (Number.isNaN(t)) throw new Error(`Invalid instant: ${at}`)
  return t
}

export function iso(t: number): Iso {
  return new Date(t).toISOString()
}

export function addMs(at: Iso, delta: number): Iso {
  return iso(ms(at) + delta)
}

export function diffMs(later: Iso, earlier: Iso): number {
  return ms(later) - ms(earlier)
}

export function isBefore(a: Iso, b: Iso): boolean {
  return ms(a) < ms(b)
}

export function maxIso(values: Array<Iso | null | undefined>): Iso | null {
  let best: number | null = null
  for (const v of values) {
    if (!v) continue
    const t = ms(v)
    if (best === null || t > best) best = t
  }
  return best === null ? null : iso(best)
}

export function minIso(values: Array<Iso | null | undefined>): Iso | null {
  let best: number | null = null
  for (const v of values) {
    if (!v) continue
    const t = ms(v)
    if (best === null || t < best) best = t
  }
  return best === null ? null : iso(best)
}

/** True for a well-formed ISO-8601 instant that carries an explicit offset. */
export function isInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

/**
 * "1h 13m 22s", "2d 4h", "40m 46s". Compact and exact at the unit it shows:
 * two significant units, never rounded up past the true value.
 */
export function formatDuration(delta: number, opts: { seconds?: boolean } = {}): string {
  const sign = delta < 0 ? '-' : ''
  let rest = Math.floor(Math.abs(delta) / 1000)
  const d = Math.floor(rest / 86400)
  rest -= d * 86400
  const h = Math.floor(rest / 3600)
  rest -= h * 3600
  const m = Math.floor(rest / 60)
  const s = rest - m * 60
  const withSeconds = opts.seconds ?? true
  if (d > 0) return `${sign}${d}d ${h}h`
  if (h > 0) return withSeconds ? `${sign}${h}h ${m}m ${s}s` : `${sign}${h}h ${m}m`
  if (m > 0) return withSeconds ? `${sign}${m}m ${s}s` : `${sign}${m}m`
  return `${sign}${s}s`
}

/** Hours and minutes only, for countdowns: "17h 42m", "3d 4h". */
export function formatRemaining(delta: number): string {
  return formatDuration(delta, { seconds: false })
}
