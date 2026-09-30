import { motion, useReducedMotion } from 'motion/react'
import { Minus, PencilLine } from 'lucide-react'
import type { ClockOfRecord, ClockStage, StageId } from '../../lib/engine/clock.ts'
import { formatDuration } from '../../lib/engine/time.ts'
import { chronoParts } from '../../lib/client/format.ts'
import { cx } from '../ui/primitives.tsx'

/**
 * The Clock of Record rail: five moments most processes collapse into one,
 * kept apart and joined by the time that elapsed between them.
 *
 * The segment leading into the first unrecorded stage carries moving
 * timestamp particles -- the one place in the product where motion runs
 * continuously, because it is the one place where time is doing something
 * that matters: a clock is running toward an obligation.
 */

const X = (i: number) => 10 + i * 20 // column centres, in %

function nodeTone(stage: ClockStage, active: boolean): { ring: string; fill: string; label: string } {
  if (stage.state === 'not_applicable') return { ring: 'border-line-strong', fill: 'bg-transparent', label: 'text-ink-4' }
  if (stage.state === 'recorded') {
    if (stage.id === 'AWARENESS') return { ring: 'border-amber', fill: 'bg-amber', label: 'text-ink' }
    if (stage.id === 'SUBMISSION') return { ring: 'border-green', fill: 'bg-green', label: 'text-ink' }
    return { ring: 'border-ink-2', fill: 'bg-ink', label: 'text-ink' }
  }
  if (stage.state === 'partial') return { ring: 'border-amber border-dashed', fill: 'bg-amber/40', label: 'text-ink' }
  return active ? { ring: 'border-amber border-dashed', fill: 'bg-transparent', label: 'text-ink-2' } : { ring: 'border-ink-4 border-dashed', fill: 'bg-transparent', label: 'text-ink-3' }
}

function Elapsed({ ms }: { ms: number }) {
  if (ms < 0) return <span className="text-amber">−{formatDuration(-ms)}</span>
  return <span>+{formatDuration(ms)}</span>
}

function Node({ stage, active, selected, onSelect, delay }: { stage: ClockStage; active: boolean; selected: boolean; onSelect?: (s: StageId) => void; delay: number }) {
  const reduce = useReducedMotion()
  const t = nodeTone(stage, active)
  const corrected = (stage.event?.corrections.length ?? 0) > 0
  return (
    <motion.button
      type="button"
      onClick={() => onSelect?.(stage.id)}
      disabled={!onSelect}
      aria-pressed={selected}
      aria-label={`${stage.label}: ${stage.at ? stage.at : stage.state.replace(/_/g, ' ')}`}
      initial={reduce ? false : { scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, type: 'spring', stiffness: 380, damping: 22 }}
      className={cx(
        'group relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 bg-s1 transition-shadow duration-200',
        t.ring,
        selected && 'shadow-[0_0_0_4px_rgba(236,231,221,0.08),0_0_0_1px_rgba(236,231,221,0.35)]',
        onSelect && 'cursor-pointer hover:shadow-[0_0_0_5px_rgba(236,231,221,0.06)]',
      )}
    >
      {active && <span className="pulse-ring absolute inset-0 rounded-full text-amber" aria-hidden />}
      {stage.state === 'not_applicable' ? (
        <Minus className="h-3 w-3 text-ink-4" />
      ) : (
        <span className={cx('h-2.5 w-2.5 rounded-full', t.fill)} />
      )}
      {corrected && (
        <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full border border-violet-line bg-s2 text-violet" title="Corrected timestamp">
          <PencilLine className="h-2.5 w-2.5" />
        </span>
      )}
    </motion.button>
  )
}

export function ClockRail({ clock, selected, onSelect, compact }: { clock: ClockOfRecord; selected?: StageId | null; onSelect?: (s: StageId) => void; compact?: boolean }) {
  const reduce = useReducedMotion()
  const stages = clock.stages
  const activeIdx = clock.activeStageIndex
  // The live segment runs from the last stage before the active one that has
  // a time, to the active stage.
  let liveFrom: number | null = null
  if (activeIdx !== null) {
    for (let i = activeIdx - 1; i >= 0; i--) {
      if (stages[i]!.at) {
        liveFrom = i
        break
      }
    }
  }
  const liveTo = activeIdx

  return (
    <div className="min-w-0">
      {/* Horizontal (md and up) */}
      <div className="relative hidden md:block">
        <div className="grid grid-cols-5">
          {stages.map((s) => (
            <div key={s.id} className="flex flex-col items-center px-2 text-center">
              <div className={cx('micro', s.state === 'not_applicable' ? 'text-ink-4' : undefined)}>
                <span className="text-ink-4">{String(s.index).padStart(2, '0')}</span> <span className="text-ink-4">—</span> {s.label}
              </div>
            </div>
          ))}
        </div>

        <div className="relative mt-4 h-10">
          {/* base rail */}
          <div className="absolute top-1/2 h-px -translate-y-1/2 bg-line-strong" style={{ left: `${X(0)}%`, right: `${100 - X(4)}%` }} />
          {/* completed segments */}
          {stages.slice(1).map((s, i) => {
            const prev = stages[i]!
            const done = !!prev.at && !!s.at && s.state !== 'not_applicable'
            if (!done) return null
            return (
              <motion.div
                key={`seg-${s.id}`}
                className="absolute top-1/2 h-[2px] origin-left -translate-y-1/2 bg-ink-3"
                style={{ left: `${X(i)}%`, width: '20%' }}
                initial={reduce ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.15 + i * 0.14, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              />
            )
          })}
          {/* live segment with timestamp particles */}
          {liveFrom !== null && liveTo !== null && liveTo > liveFrom && (
            <div className="absolute top-1/2 h-4 -translate-y-1/2 overflow-hidden" style={{ left: `${X(liveFrom)}%`, width: `${(liveTo - liveFrom) * 20}%` }} aria-hidden>
              <svg className="absolute inset-x-0 top-1/2 h-[2px] w-full -translate-y-1/2" preserveAspectRatio="none" viewBox="0 0 100 2">
                <line x1="0" y1="1" x2="100" y2="1" stroke="#E7A24A" strokeOpacity="0.55" strokeWidth="2" className="flow-line" vectorEffect="non-scaling-stroke" />
              </svg>
              {!reduce &&
                [0, 1, 2, 3].map((k) => (
                  <motion.span
                    key={k}
                    className="absolute top-1/2 h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-amber shadow-[0_0_8px_rgba(231,162,74,0.8)]"
                    initial={{ left: '0%', opacity: 0 }}
                    animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
                    transition={{ duration: 3.4, repeat: Infinity, delay: 0.8 + k * 0.85, ease: 'linear', times: [0, 0.12, 0.88, 1] }}
                  />
                ))}
            </div>
          )}
          {/* elapsed labels */}
          {stages.map((s, i) => {
            if (i === 0 || s.sincePreviousMs === null || !s.previousStageId) return null
            const from = stages.findIndex((x) => x.id === s.previousStageId)
            const centre = (X(from) + X(i)) / 2
            return (
              <motion.div
                key={`el-${s.id}`}
                className="mono absolute -top-3 -translate-x-1/2 whitespace-nowrap rounded bg-s1 px-1.5 text-[11px] text-ink-3"
                style={{ left: `${centre}%` }}
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.12, duration: 0.3 }}
              >
                <Elapsed ms={s.sincePreviousMs} />
              </motion.div>
            )
          })}
          {/* nodes */}
          {stages.map((s, i) => (
            <div key={s.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${X(i)}%` }}>
              <Node stage={s} active={i === activeIdx} selected={selected === s.id} onSelect={onSelect} delay={0.1 + i * 0.12} />
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-5">
          {stages.map((s, i) => (
            <StageCaption key={s.id} stage={s} active={i === activeIdx} compact={compact} />
          ))}
        </div>
      </div>

      {/* Vertical (mobile) */}
      <ol className="relative md:hidden">
        {stages.map((s, i) => {
          const next = stages[i + 1]
          const doneToNext = !!s.at && !!next?.at && next.state !== 'not_applicable'
          const liveToNext = liveFrom !== null && liveTo !== null && i >= liveFrom && i < liveTo
          return (
            <li key={s.id} className="relative flex gap-4 pb-6 last:pb-0">
              {next && (
                <span
                  className={cx('absolute left-[13px] top-8 w-[2px]', doneToNext ? 'bg-ink-3' : liveToNext ? 'bg-amber/50' : 'bg-line-strong')}
                  style={{ bottom: 0 }}
                  aria-hidden
                />
              )}
              <Node stage={s} active={i === activeIdx} selected={selected === s.id} onSelect={onSelect} delay={0.05 + i * 0.08} />
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="micro">
                  <span className="text-ink-4">{String(s.index).padStart(2, '0')}</span> — {s.label}
                </div>
                <StageCaption stage={s} active={i === activeIdx} compact={compact} align="left" />
                {next?.sincePreviousMs !== null && next?.sincePreviousMs !== undefined && next.previousStageId === s.id && (
                  <div className="mono mt-2 text-[11px] text-ink-3">
                    ↓ <Elapsed ms={next.sincePreviousMs} />
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function StageCaption({ stage, active, compact, align = 'center' }: { stage: ClockStage; active: boolean; compact?: boolean; align?: 'center' | 'left' }) {
  const p = stage.at ? chronoParts(stage.at) : null
  return (
    <div className={cx('min-w-0', align === 'center' ? 'px-2 text-center' : 'mt-1 text-left')}>
      {p && stage.state !== 'not_applicable' ? (
        <>
          <div className="mono leading-none">
            <span className="text-lg font-medium text-ink">{p.hm}</span>
            <span className="text-sm text-ink-3">:{p.s}</span>
          </div>
          <div className="mono mt-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
            {p.date} · {p.zone}
          </div>
          {!compact && stage.event && (
            <div className="mt-1.5 truncate text-[11px] text-ink-3" title={stage.event.current.source}>
              <span className="ident text-ink-2">{stage.event.original.id}</span>
              {stage.event.corrections.length > 0 && <span className="text-violet"> · corrected</span>}
            </div>
          )}
          {stage.state === 'partial' && <div className="mt-1.5 text-[11px] text-amber">Exploitation not established</div>}
        </>
      ) : stage.state === 'not_applicable' ? (
        <div className="text-xs text-ink-4">Not applicable</div>
      ) : (
        <div className={cx('mono text-sm', active ? 'text-amber' : 'text-ink-3')}>{active ? 'Pending' : '—'}</div>
      )}
    </div>
  )
}
