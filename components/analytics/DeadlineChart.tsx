import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Analytics } from '../../lib/engine/analytics.ts'
import { EASE_OUT, columnPath, countTicks, useWidth } from './chart.ts'

/**
 * "When are open obligations due?" Running deadlines per time-remaining
 * bucket. The critical share of each column (inside its attention threshold,
 * or overdue) sits at the foot in red; the rest of the column is amber.
 */

const H = 236
const M = { top: 30, right: 4, bottom: 50, left: 28 }
const GAP = 2

export function DeadlineChart({ data }: { data: Analytics['deadlineDistribution'] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const reduce = useReducedMotion()
  const [hover, setHover] = useState<number | null>(null)

  const iw = Math.max(0, width - M.left - M.right)
  const ih = H - M.top - M.bottom
  const max = Math.max(0, ...data.map((d) => d.count))
  const ticks = countTicks(max)
  const top = ticks[ticks.length - 1] ?? 1
  const y = (v: number) => M.top + ih - (v / top) * ih
  const band = data.length > 0 ? iw / data.length : iw
  const bw = Math.max(8, Math.min(24, band * 0.42))
  const base = M.top + ih
  const hovered = hover !== null ? data[hover] : undefined
  const total = data.reduce((a, d) => a + d.count, 0)

  return (
    <div ref={ref} className="relative min-w-0">
      {width > 40 && (
        <svg
          width={width}
          height={H}
          className="block max-w-full"
          role="img"
          aria-label={`Running deadlines by time remaining. ${data.map((d) => `${d.bucket}: ${d.count} (${d.critical} critical)`).join('; ')}.`}
        >
          <text x={0} y={11} className="fill-ink-3 font-mono text-[10px] uppercase tracking-[0.12em]">
            Running deadlines
          </text>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-line-bright' : 'stroke-line'} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={M.left - 10} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-ink-3 font-mono text-[10.5px] tabular">
                {t}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const cx = M.left + band * i + band / 2
            const x = cx - bw / 2
            const critical = Math.min(d.critical, d.count)
            const rest = d.count - critical
            const hc = (critical / top) * ih
            const hr = (rest / top) * ih
            const restTop = y(d.count)
            return (
              <g key={d.bucket}>
                <motion.g
                  style={{ originY: 1, transformBox: 'fill-box' }}
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: 0.08 + i * 0.05, duration: 0.5, ease: EASE_OUT }}
                >
                  {critical > 0 && (rest > 0 ? <rect x={x} y={base - hc} width={bw} height={hc} className="fill-red" /> : <path d={columnPath(x, base - hc, bw, hc)} className="fill-red" />)}
                  {rest > 0 && <path d={columnPath(x, restTop, bw, Math.max(0, hr - (critical > 0 ? GAP : 0)))} className="fill-amber" />}
                </motion.g>
                <motion.text
                  x={cx}
                  y={d.count > 0 ? restTop - 8 : base - 8}
                  textAnchor="middle"
                  className={d.count > 0 ? 'fill-ink-2 font-mono text-[11px] tabular' : 'fill-ink-3 font-mono text-[11px] tabular'}
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35 + i * 0.05, duration: 0.25 }}
                >
                  {d.count}
                </motion.text>
                <text x={cx} y={base + 19} textAnchor="middle" className={band < 60 ? 'fill-ink-2 font-mono text-[10px]' : 'fill-ink-2 font-mono text-[11px]'}>
                  {d.bucket}
                </text>
                <rect
                  x={M.left + band * i}
                  y={M.top - 12}
                  width={band}
                  height={ih + 12}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                />
              </g>
            )
          })}

          <text x={M.left + iw / 2} y={H - 6} textAnchor="middle" className="fill-ink-3 font-mono text-[10px] uppercase tracking-[0.12em]">
            Time remaining until due
          </text>
        </svg>
      )}

      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-[9rem] -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-s3 px-3 py-2 shadow-raise"
          style={{ left: Math.min(Math.max(M.left + band * hover + band / 2, 76), width - 76), top: y(hovered.count) - 14 }}
          role="status"
        >
          <div className="micro text-ink-2">{hovered.bucket}</div>
          <div className="mono mt-1 text-xs text-ink">
            {hovered.count} running
            <span className="text-ink-3"> · </span>
            {hovered.critical} critical
          </div>
        </div>
      )}

      <table className="sr-only">
        <caption>Running deadlines by time remaining, {total} in total</caption>
        <thead>
          <tr>
            <th scope="col">Time remaining</th>
            <th scope="col">Running</th>
            <th scope="col">Critical or overdue</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.bucket}>
              <th scope="row">{d.bucket}</th>
              <td>{d.count}</td>
              <td>{d.critical}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
