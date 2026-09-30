import { motion } from 'motion/react'
import { Check, CircleDashed, Minus, X } from 'lucide-react'
import type { RuleTraceStep } from '../../types/domain.ts'
import { cx } from '../ui/primitives.tsx'

/**
 * A rule evaluation drawn as the flow it is: each rule a node, its inputs
 * listed, its result stated, joined to the next by a line. Nothing about the
 * evaluation is hidden behind the outcome.
 */

const STATE = {
  pass: { icon: Check, ring: 'border-green bg-green-soft text-green', label: 'Met', text: 'text-green' },
  fail: { icon: X, ring: 'border-line-bright bg-s3 text-ink-2', label: 'Not met', text: 'text-ink-2' },
  pending: { icon: CircleDashed, ring: 'border-amber border-dashed bg-amber-soft text-amber', label: 'Pending', text: 'text-amber' },
  info: { icon: Minus, ring: 'border-line-strong bg-s2 text-ink-3', label: 'Not applicable', text: 'text-ink-3' },
} as const

function isInstantLike(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(v)
}

export function RuleTrace({ steps, compact }: { steps: RuleTraceStep[]; compact?: boolean }) {
  return (
    <ol className="relative min-w-0">
      {steps.map((s, i) => {
        const st = STATE[s.state]
        const Icon = st.icon
        const last = i === steps.length - 1
        return (
          <motion.li key={`${s.ruleId}-${i}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 + i * 0.06, duration: 0.3 }} className="relative flex min-w-0 gap-4 pb-6 last:pb-0">
            {!last && <span className="absolute bottom-0 left-[13px] top-8 w-px bg-line-strong" aria-hidden />}
            <span className={cx('relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border', st.ring)} aria-hidden>
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-ink">{s.label}</span>
                <span className="ident text-[11px] text-ink-4">{s.ruleId}</span>
                <span className={cx('micro', st.text)}>
                  <span className="sr-only">{st.label}: </span>
                  {s.result}
                </span>
              </div>
              {!compact && Object.keys(s.inputs).length > 0 && (
                <dl className="mt-2.5 grid min-w-0 gap-x-4 gap-y-1 text-xs sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
                  {Object.entries(s.inputs).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="truncate text-ink-3">{k}</dt>
                      <dd className={cx('min-w-0 text-ink-2 [overflow-wrap:anywhere]', v && isInstantLike(v) && 'mono')}>{v ?? <span className="text-ink-4">not recorded</span>}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {!compact && s.detail && <p className="mt-2 max-w-3xl text-xs leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{s.detail}</p>}
            </div>
          </motion.li>
        )
      })}
    </ol>
  )
}
