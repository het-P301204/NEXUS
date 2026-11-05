import { useState } from 'react'
import { Link, useHref, useNavigate } from 'react-router'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import type { Analytics } from '../../lib/engine/analytics.ts'
import { formatDuration } from '../../lib/engine/time.ts'
import { dayMonth, short, stamp } from '../../lib/client/format.ts'
import { EASE_OUT, useWidth, valueTicks } from './chart.ts'
import { dash } from './parts.tsx'

/**
 * "How long did each reportability decision take after awareness?"
 * One lollipop per case: x is when the decision was recorded, y is the time
 * from first awareness to that decision, in hours. Reference lines mark 24h
 * and 72h after first awareness.
 */

type Point = Analytics['turnaround'][number]

const HOUR = 3_600_000
const DAY = 24 * HOUR
const H = 268
const M = { top: 28, right: 22, bottom: 42, left: 50 }
const DAY_STEPS = [1, 2, 3, 7, 14, 30, 60, 90, 180, 365]

function dayTicks(min: number, max: number, maxCount: number): number[] {
  const spanDays = (max - min) / DAY
  const step = DAY_STEPS.find((s) => spanDays / s <= Math.max(1, maxCount)) ?? 365
  const out: number[] = []
  for (let t = Math.ceil(min / DAY) * DAY; t <= max; t += step * DAY) out.push(t)
  return out
}

export function TurnaroundChart({ points }: { points: Point[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const reduce = useReducedMotion()
  const navigate = useNavigate()
  const root = useHref('/').replace(/\/$/, '')
  const [hover, setHover] = useState<number | null>(null)

  const iw = Math.max(0, width - M.left - M.right)
  const ih = H - M.top - M.bottom
  const base = M.top + ih

  const hours = points.map((p) => p.awarenessToDecisionMs / HOUR)
  const maxH = Math.max(72, ...hours)
  const yt = valueTicks(maxH * 1.04, 4)
  const top = yt[yt.length - 1] ?? maxH
  const y = (h: number) => base - (Math.max(0, h) / top) * ih

  const times = points.map((p) => Date.parse(p.decidedAt))
  let t0 = Math.min(...times)
  let t1 = Math.max(...times)
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
    t0 = 0
    t1 = DAY
  }
  if (t1 - t0 < DAY) {
    const mid = (t0 + t1) / 2
    t0 = mid - DAY
    t1 = mid + DAY
  } else {
    const pad = Math.max(12 * HOUR, (t1 - t0) * 0.06)
    t0 -= pad
    t1 += pad
  }
  const x = (t: number) => M.left + ((t - t0) / (t1 - t0)) * iw
  const xt = dayTicks(t0, t1, Math.max(2, Math.floor(iw / 72)))

  const longest = hours.length > 0 ? hours.indexOf(Math.max(...hours)) : -1
  const refs = [24, 72].filter((h) => h <= top)
  const refGap = Math.abs(y(24) - y(72))
  const hp = hover !== null ? points[hover] : undefined

  return (
    <div ref={ref} className="relative min-w-0">
      {width > 40 && (
        <svg width={width} height={H} className="block max-w-full" role="img" aria-label={`Awareness to decision per case, ${points.length} cases. Longest ${longest >= 0 ? formatDuration(points[longest]!.awarenessToDecisionMs, { seconds: false }) : 'none'}.`}>
          <text x={0} y={11} className="fill-ink-3 font-mono text-[10px] uppercase tracking-[0.12em]">
            Hours, awareness to decision
          </text>

          {yt.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-line-bright' : 'stroke-line'} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={M.left - 10} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-ink-3 font-mono text-[10.5px] tabular">
                {t}
              </text>
            </g>
          ))}

          {refs.map((h) => {
            const right = h === 24 && refGap < 14
            return (
              <g key={`ref-${h}`}>
                <line x1={M.left} x2={width - M.right} y1={y(h)} y2={y(h)} className="stroke-amber" strokeOpacity={0.45} strokeWidth={1} shapeRendering="crispEdges" />
                <text x={right ? width - M.right - 4 : M.left + 6} y={y(h) - 5} textAnchor={right ? 'end' : 'start'} className="fill-ink-3 font-mono text-[10px]">
                  {h}h
                </text>
              </g>
            )
          })}

          {xt.map((t) => (
            <text key={t} x={x(t)} y={base + 18} textAnchor="middle" className="fill-ink-2 font-mono text-[11px]">
              {dayMonth(new Date(t).toISOString())}
            </text>
          ))}

          {points.map((p, i) => {
            const px = x(times[i]!)
            const py = y(hours[i]!)
            const active = hover === i
            const label = `${p.caseId}: ${formatDuration(p.awarenessToDecisionMs, { seconds: false })} from awareness to decision, decided ${stamp(p.decidedAt)}`
            return (
              <a
                key={p.caseId}
                href={`${root}/cases/${encodeURIComponent(p.caseId)}`}
                aria-label={label}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(`/cases/${encodeURIComponent(p.caseId)}`)
                }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((h) => (h === i ? null : h))}
                className="cursor-pointer outline-none"
              >
                <motion.line
                  x1={px}
                  x2={px}
                  y1={base}
                  y2={py}
                  className="stroke-ink-3"
                  strokeWidth={1.5}
                  strokeOpacity={active ? 1 : 0.6}
                  style={{ originY: 1, transformBox: 'fill-box' }}
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: 0.1 + i * 0.05, duration: 0.45, ease: EASE_OUT }}
                />
                <circle cx={px} cy={py} r={14} fill="transparent" />
                <motion.circle
                  cx={px}
                  cy={py}
                  r={active ? 6 : 4.5}
                  className={active ? 'fill-ink stroke-amber' : 'fill-ink stroke-s1'}
                  strokeWidth={2}
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 + i * 0.05, duration: 0.25 }}
                />
                {i === longest && !active && (
                  <text x={Math.min(Math.max(px, M.left + 30), width - M.right - 30)} y={py - 12} textAnchor="middle" className="fill-ink-2 font-mono text-[11px]">
                    {formatDuration(p.awarenessToDecisionMs, { seconds: false })}
                  </text>
                )}
              </a>
            )
          })}

          <text x={M.left + iw / 2} y={H - 6} textAnchor="middle" className="fill-ink-3 font-mono text-[10px] uppercase tracking-[0.12em]">
            Decision recorded
          </text>
        </svg>
      )}

      {hp && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 w-60 max-w-[80%] -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-s3 px-3 py-2.5 shadow-raise"
          style={{ left: Math.min(Math.max(x(times[hover]!), 124), width - 124), top: y(hours[hover]!) - 14 }}
          role="status"
        >
          <div className="ident text-xs text-ink">{hp.caseId}</div>
          <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">{dash(hp.title)}</div>
          <div className="mono mt-2 text-sm text-ink">{formatDuration(hp.awarenessToDecisionMs, { seconds: false })}</div>
          <div className="mt-0.5 text-[11px] text-ink-3">Decided {short(hp.decidedAt)}</div>
        </div>
      )}
    </div>
  )
}

/** The same points as a ruled list: the chart's table view, and the links. */
export function TurnaroundList({ points }: { points: Point[] }) {
  return (
    <div className="min-w-0">
      <div className="hidden grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_8.5rem_6.5rem] gap-x-4 border-b border-line pb-2 md:grid" aria-hidden>
        <span className="micro">Case</span>
        <span className="micro">Title</span>
        <span className="micro">Decision recorded</span>
        <span className="micro text-right">Duration</span>
      </div>
      <ul aria-label="Decision turnaround per case">
        {points.map((p) => (
          <li key={p.caseId} className="border-b border-line transition-colors duration-150 hover:bg-s2">
            <Link
              to={`/cases/${encodeURIComponent(p.caseId)}`}
              className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-3 md:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_8.5rem_6.5rem] md:items-baseline md:py-2.5"
            >
              <span className="ident inline-flex min-w-0 items-center gap-1 text-[12.5px] text-ink-2 group-hover:text-amber">
                {p.caseId}
                <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden />
              </span>
              <span className="mono text-right text-sm text-ink md:order-last">{formatDuration(p.awarenessToDecisionMs, { seconds: false })}</span>
              <span className="col-span-2 min-w-0 truncate text-sm text-ink-2 md:col-span-1" title={dash(p.title)}>
                {dash(p.title)}
              </span>
              <span className="mono col-span-2 text-xs text-ink-3 md:col-span-1">{short(p.decidedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
