import { motion } from 'motion/react'
import { ArrowDown, Check, CircleDashed, Minus, OctagonAlert, X } from 'lucide-react'
import type { AffectednessStepId, StepAnswer } from '../../types/domain.ts'
import type { AffectednessEvaluation, PathEffect } from '../../lib/engine/affectedness.ts'
import { STEPS } from '../../lib/engine/affectedness.ts'
import { AFFECTEDNESS, Badge } from '../ui/status.tsx'
import { cx } from '../ui/primitives.tsx'

/**
 * The affectedness reasoning, drawn as the walk the engine takes: each
 * question, the answer given, and what that answer did -- continued the walk,
 * decided it, blocked it, or was only noted. Steps the walk never reached are
 * shown too, so a short path is visibly short.
 */

const SHORT: Record<AffectednessStepId, string> = {
  component_present: 'Component present',
  vulnerable_version: 'Vulnerable version',
  functionality_enabled: 'Functionality enabled',
  feature_reachable: 'Reachable code path',
  exploit_path: 'Adversary-controlled input',
  configuration_mitigates: 'Configuration mitigates',
  compensating_control: 'Compensating control',
  exploitation_demonstrated: 'Exploitation demonstrated',
  product_validation: 'Product-specific validation',
}

const EFFECT: Record<PathEffect, { label: string; cls: string }> = {
  continue: { label: 'continues', cls: 'text-ink-3' },
  decides: { label: 'decides', cls: 'text-ink' },
  blocks: { label: 'blocks', cls: 'text-amber' },
  noted: { label: 'noted', cls: 'text-blue' },
  not_reached: { label: 'not reached', cls: 'text-ink-4' },
  unanswered: { label: 'unanswered', cls: 'text-amber' },
}

function AnswerMark({ a }: { a: StepAnswer['answer'] }) {
  if (a === 'YES') return <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line-bright bg-s3 text-ink"><Check className="h-3.5 w-3.5" /></span>
  if (a === 'NO') return <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line-bright bg-s3 text-ink"><X className="h-3.5 w-3.5" /></span>
  if (a === 'UNKNOWN') return <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-amber bg-amber-soft text-amber"><CircleDashed className="h-3.5 w-3.5" /></span>
  return <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-4"><Minus className="h-3 w-3" /></span>
}

export function ReasoningFlow({ evaluation, answers, compact }: { evaluation: AffectednessEvaluation; answers: Record<AffectednessStepId, StepAnswer>; compact?: boolean }) {
  const meta = AFFECTEDNESS[evaluation.result]
  const path = compact ? evaluation.path.filter((p) => p.effect !== 'not_reached') : evaluation.path
  return (
    <div className="min-w-0">
      <ol className="min-w-0">
        {path.map((p, i) => {
          const step = STEPS[p.n - 1]!
          const e = EFFECT[p.effect]
          const decisive = p.effect === 'decides' || p.effect === 'blocks'
          return (
            <motion.li key={p.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.045 }} className="relative flex min-w-0 gap-3 pb-3">
              <span className={cx('absolute left-[11.5px] top-7 w-px', i === path.length - 1 ? 'hidden' : 'bottom-0', p.effect === 'not_reached' ? 'bg-line' : 'bg-line-strong')} aria-hidden />
              <span className={cx('relative z-10', p.effect === 'not_reached' && 'opacity-40')}>
                <AnswerMark a={p.answer} />
              </span>
              <div className={cx('min-w-0 flex-1 rounded-md px-2 py-0.5', decisive && 'bg-s3', p.effect === 'not_reached' && 'opacity-50')}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="mono text-[10.5px] text-ink-4">{String(p.n).padStart(2, '0')}</span>
                  <span className={cx('text-sm', decisive ? 'font-medium text-ink' : 'text-ink-2')}>{SHORT[p.id]}</span>
                  <span className="mono text-[11px] text-ink-3">{p.answer ?? '—'}</span>
                  <span className={cx('micro', e.cls)}>{e.label}</span>
                  {p.evidenceCount > 0 && <span className="mono text-[10.5px] text-violet">{p.evidenceCount} evidence</span>}
                </div>
                {!compact && answers[p.id]?.note && <p className="mt-0.5 text-xs text-ink-3">{answers[p.id].note}</p>}
                {!compact && p.explanation && p.effect !== 'continue' && <p className="mt-0.5 text-xs text-ink-3">{p.explanation}</p>}
                {decisive && !compact && <span className="sr-only">{step.question}</span>}
              </div>
            </motion.li>
          )
        })}
      </ol>
      <div className="flex items-center gap-3 pl-[3px] pt-1">
        <ArrowDown className="h-4 w-4 text-ink-4" />
        <Badge tone={meta.tone} icon={meta.icon}>
          {meta.label}
        </Badge>
        {evaluation.justification && <span className="mono text-[11px] text-ink-3">{evaluation.justification}</span>}
      </div>
      {evaluation.contradictions.length > 0 && (
        <div className="mt-3 rounded-md border border-red-line bg-red/[0.048] px-3 py-2">
          <div className="micro flex items-center gap-1.5 text-red">
            <OctagonAlert className="h-3.5 w-3.5" /> Contradictory answers
          </div>
          <ul className="mt-1 space-y-1 text-xs text-ink-2">
            {evaluation.contradictions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
