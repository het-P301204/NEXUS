import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cx } from '../ui/primitives.tsx'
import { EASE_OUT } from './chart.ts'

/**
 * Shared pieces of the analytics page: the scope tag every figure carries,
 * section headings that state the question a figure answers, and the
 * proportional bar used by the ruled lists.
 */

export type Scope = 'range' | 'now'

/** Source text uses " -- " for a dash; show a real one. */
export function dash(s: string): string {
  return s.replace(/ -- /g, ' — ')
}

/** Where a figure's population comes from. Some figures ignore the range. */
export function ScopeTag({ scope, className }: { scope: Scope; className?: string }) {
  return (
    <span
      className={cx('inline-flex h-5 shrink-0 items-center rounded border border-line-strong px-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3', className)}
      title={scope === 'now' ? 'Current state of open cases. Not filtered by the selected range.' : 'Cases or report versions created within the selected range.'}
    >
      {scope === 'now' ? 'Now' : 'In range'}
    </span>
  )
}

export function SectionHead({ eyebrow, title, question, meta, scope, id }: { eyebrow?: ReactNode; title: ReactNode; question: ReactNode; meta?: ReactNode; scope: Scope; id?: string }) {
  return (
    <div className="mb-5 flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        {eyebrow && <div className="micro mb-1.5">{eyebrow}</div>}
        <h2 id={id} className="flex flex-wrap items-center gap-2.5 text-lg font-medium text-ink">
          {title}
          <ScopeTag scope={scope} />
        </h2>
        <p className="mt-1 text-sm text-ink-3">{question}</p>
      </div>
      {meta && <div className="mono shrink-0 pt-1 text-xs text-ink-2">{meta}</div>}
    </div>
  )
}

/** A horizontal bar whose length is `value / max` of the track, growing from the left on mount. */
export function ProportionBar({ value, max, fill, delay = 0, label }: { value: number; max: number; fill: string; delay?: number; label: string }) {
  const reduce = useReducedMotion()
  const share = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div className="relative h-2 w-full min-w-0 overflow-hidden rounded-[4px] bg-s2" role="img" aria-label={label}>
      {share > 0 && (
        <motion.div
          className={cx('absolute inset-y-0 left-0 rounded-r-[4px]', fill)}
          style={{ width: `${share * 100}%`, originX: 0 }}
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay, duration: 0.5, ease: EASE_OUT }}
        />
      )}
    </div>
  )
}

/** Duration text from formatDuration, with the unit letters set lighter than the digits. */
export function DurationFigure({ text, className }: { text: string; className?: string }) {
  const parts = text.match(/-?\d+|[a-z]+/g) ?? [text]
  return (
    <span className={cx('whitespace-nowrap font-mono', className)}>
      {parts.map((p, i) =>
        /\d/.test(p) ? (
          <span key={i} className="text-ink">
            {p}
          </span>
        ) : (
          <span key={i} className="ml-0.5 mr-2 text-[0.55em] text-ink-3 last:mr-0">
            {p}
          </span>
        ),
      )}
    </span>
  )
}
