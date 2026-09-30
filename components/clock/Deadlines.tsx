import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CheckCircle2, ChevronDown, CircleDashed, HelpCircle, Lock } from 'lucide-react'
import type { Deadline } from '../../lib/engine/deadlines.ts'
import { live, isLive } from '../../lib/client/live.ts'
import { dayMonth, hhmm, short, stamp, zoneAbbr } from '../../lib/client/format.ts'
import { useNow } from '../../lib/client/useNow.ts'
import { formatDuration } from '../../lib/engine/time.ts'
import { Countdown } from '../ui/time.tsx'
import { DEADLINE_STATUS, DeadlineBadge, TONE_TEXT } from '../ui/status.tsx'
import { cx } from '../ui/primitives.tsx'

const HOUR = 3_600_000

/** "Why this deadline?" -- the full calculation, line by line. */
export function WhyDeadline({ deadline, defaultOpen = false }: { deadline: Deadline; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-xs text-ink-3 transition-colors hover:text-ink">
        <HelpCircle className="h-3.5 w-3.5" />
        Why this deadline?
        <ChevronDown className={cx('h-3 w-3 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-1.5 border-l border-line-strong pl-3">
              {deadline.calculation.map((line, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink-2">
                  <span className="mono shrink-0 text-ink-4">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{line}</span>
                </li>
              ))}
            </div>
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Three cells: 24h, 72h, 14d. Used under every case header. */
export function DeadlineStrip({ deadlines, onOpenClock }: { deadlines: Deadline[]; onOpenClock?: () => void }) {
  const now = useNow()
  return (
    <div className="grid min-w-0 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
      {deadlines.map((d0) => {
        const d = live(d0, now)
        const meta = DEADLINE_STATUS[d.status]
        return (
          <div key={d.kind} className="min-w-0 bg-s1 px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="micro truncate">
                <span className="text-ink-2">{d.shortLabel}</span> · {d.label}
              </div>
              <DeadlineBadge status={d.status} size="sm" />
            </div>
            <div className="mt-3 min-h-[34px]">
              {isLive(d) && d.dueAt ? (
                <div className={cx(TONE_TEXT[meta.tone])}>
                  <Countdown dueAt={d.dueAt} size="md" />
                </div>
              ) : d.status === 'COMPLETED' || d.status === 'COMPLETED_LATE' ? (
                <div className="flex items-center gap-2 text-sm text-ink">
                  <CheckCircle2 className={cx('h-4 w-4', d.status === 'COMPLETED' ? 'text-green' : 'text-amber')} />
                  Submitted {d.completedAt ? short(d.completedAt) : ''}
                </div>
              ) : d.status === 'BLOCKED' ? (
                <button type="button" onClick={onOpenClock} className="flex items-center gap-2 text-left text-sm text-red hover:underline">
                  <Lock className="h-4 w-4 shrink-0" /> Calculation blocked
                </button>
              ) : (
                <div className="flex items-start gap-2 text-sm text-ink-3">
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">{d.status === 'NOT_APPLICABLE' ? 'Not applicable' : 'Not started'}</span>
                </div>
              )}
            </div>
            <div className="mt-2 text-xs text-ink-3">
              {d.dueAt ? (
                <span className="mono">
                  Due {dayMonth(d.dueAt)} {hhmm(d.dueAt)} {zoneAbbr(d.dueAt)}
                </span>
              ) : (
                <span>{d.reason}</span>
              )}
            </div>
            <div className="mt-3">
              <WhyDeadline deadline={d} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The proportional track: where "now" sits between the start event and each
 * deadline. The awareness lane carries 24h and 72h; the final-report lane has
 * its own start, because its clock begins at a different event.
 */
export function DeadlineTrack({ deadlines, size = 'normal' }: { deadlines: Deadline[]; size?: 'normal' | 'hero' }) {
  const now = useNow()
  const reduce = useReducedMotion()
  const ew = live(deadlines.find((d) => d.kind === 'EARLY_WARNING')!, now)
  const vn = live(deadlines.find((d) => d.kind === 'VULNERABILITY_NOTIFICATION')!, now)
  const fr = live(deadlines.find((d) => d.kind === 'FINAL_REPORT')!, now)

  const lanes: Array<{ key: string; start: string | null; label: string; markers: Deadline[]; pending?: string }> = []
  if (ew.start) lanes.push({ key: 'awareness', start: ew.start.at, label: 'From awareness', markers: [ew, vn] })
  else lanes.push({ key: 'awareness', start: null, label: 'From awareness', markers: [], pending: ew.reason })
  if (fr.start) lanes.push({ key: 'final', start: fr.start.at, label: 'From measure availability', markers: [fr] })
  else lanes.push({ key: 'final', start: null, label: 'From measure availability', markers: [], pending: fr.reason })

  const hero = size === 'hero'
  return (
    <div className={cx('min-w-0', hero ? 'space-y-7' : 'space-y-5')}>
      {lanes.map((lane) => {
        if (!lane.start) {
          return (
            <div key={lane.key} className="min-w-0">
              <div className="micro mb-2.5">{lane.label}</div>
              <div className="relative h-2">
                <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-line-bright" />
              </div>
              <div className="mt-2.5 text-xs text-ink-3">{lane.pending}</div>
            </div>
          )
        }
        const startMs = Date.parse(lane.start)
        const lastDue = Math.max(...lane.markers.map((m) => Date.parse(m.dueAt!)))
        const endMs = Math.max(lastDue, now) + (lane.key === 'final' ? 12 * HOUR : 4 * HOUR)
        const span = endMs - startMs
        const pct = (t: number) => Math.max(0, Math.min(100, ((t - startMs) / span) * 100))
        const nowPct = pct(now)
        const allDone = lane.markers.every((m) => m.status === 'COMPLETED' || m.status === 'COMPLETED_LATE')
        const worst = lane.markers.find((m) => m.status === 'OVERDUE' || m.status === 'CRITICAL')
        return (
          <div key={lane.key} className="min-w-0">
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <div className="micro">{lane.label}</div>
              <div className="mono truncate text-[11px] text-ink-3">
                start {short(lane.start)} {zoneAbbr(lane.start)}
              </div>
            </div>
            <div className={cx('relative', hero ? 'h-16' : 'h-14')}>
              <div className="absolute inset-x-0 top-[26px] h-[3px] rounded-full bg-s4" />
              <motion.div
                className={cx('absolute left-0 top-[26px] h-[3px] origin-left rounded-full', allDone ? 'bg-green/70' : worst ? 'bg-red' : 'bg-amber')}
                style={{ width: `${nowPct}%` }}
                initial={reduce ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
              />
              {/* start tick */}
              <div className="absolute left-0 top-[20px] h-[15px] w-[2px] rounded bg-ink-2" />
              {/* markers */}
              {lane.markers.map((m) => {
                const x = pct(Date.parse(m.dueAt!))
                const done = m.status === 'COMPLETED' || m.status === 'COMPLETED_LATE'
                const meta = DEADLINE_STATUS[m.status]
                return (
                  <div key={m.kind} className="absolute top-0 -translate-x-1/2" style={{ left: `${x}%` }}>
                    <div className={cx('mono mb-1 whitespace-nowrap text-center text-[10.5px] uppercase tracking-[0.08em]', TONE_TEXT[meta.tone])}>{m.shortLabel}</div>
                    <div className={cx('mx-auto h-[19px] w-[2px] rounded', done ? 'bg-green' : m.status === 'OVERDUE' || m.status === 'CRITICAL' ? 'bg-red' : m.status === 'WATCH' ? 'bg-amber' : 'bg-ink-2')} />
                    <div className="mono mt-1 whitespace-nowrap text-center text-[11px] text-ink-2" title={stamp(m.dueAt!)}>
                      {hhmm(m.dueAt!)} <span className="text-ink-4">{dayMonth(m.dueAt!)}</span>
                    </div>
                  </div>
                )
              })}
              {/* now needle */}
              {nowPct > 0 && nowPct < 100 && (
                <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${nowPct}%` }} aria-hidden>
                  {/* The label steps aside when a deadline marker sits in the same place. */}
                  <div
                    className={cx(
                      'mono h-[14px] whitespace-nowrap rounded-sm bg-ink px-1 text-[9.5px] font-semibold uppercase leading-[14px] tracking-[0.1em] text-canvas',
                      lane.markers.some((m) => Math.abs(pct(Date.parse(m.dueAt!)) - nowPct) < 7) && 'invisible',
                    )}
                  >
                    now
                  </div>
                  <div className={cx('mt-[3px] h-[21px] w-px', allDone ? 'bg-ink-3' : 'bg-ink')} />
                </div>
              )}
            </div>
            {!hero && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-3">
                {lane.markers.map((m) => (
                  <span key={m.kind}>
                    {m.label}:{' '}
                    {m.completedAt ? (
                      <span className="text-ink-2">submitted {short(m.completedAt)}</span>
                    ) : m.remainingMs !== null && m.remainingMs >= 0 ? (
                      <span className={TONE_TEXT[DEADLINE_STATUS[m.status].tone]}>{formatDuration(m.remainingMs, { seconds: false })} left</span>
                    ) : (
                      <span className="text-red">overdue {formatDuration(-(m.remainingMs ?? 0), { seconds: false })}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
