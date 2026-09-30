import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Small, dependency-free helpers for the hand-built analytics charts.
 *
 * Charts are drawn at the container's real pixel width rather than scaled
 * through a viewBox, so axis text stays at its designed size on a phone
 * instead of shrinking with the drawing.
 */

export function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.max(0, Math.floor(el.getBoundingClientRect().width)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** A clean step (1, 2, 2.5 or 5 times a power of ten) giving about `target` intervals. */
export function niceStep(max: number, target = 4): number {
  if (!(max > 0)) return 1
  const raw = max / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return m * pow
}

/** Integer ticks from 0 that cover `max`. Counts never get fractional ticks. */
export function countTicks(max: number, target = 4): number[] {
  const step = Math.max(1, Math.ceil(niceStep(Math.max(max, 1), target)))
  const top = Math.max(step, Math.ceil(Math.max(max, 1) / step) * step)
  const out: number[] = []
  for (let v = 0; v <= top; v += step) out.push(v)
  return out
}

/** Ticks from 0 covering `max`, for continuous values. */
export function valueTicks(max: number, target = 4): number[] {
  const step = niceStep(max, target)
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = 0; v <= top + step / 1000; v += step) out.push(Math.round(v * 1000) / 1000)
  return out
}

/**
 * A column with a 4px rounded data end and a square foot on the baseline.
 * `y` is the top of the column, `h` its height, in SVG pixels.
 */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0 || w <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h}`,
    'Z',
  ].join(' ')
}

export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]
