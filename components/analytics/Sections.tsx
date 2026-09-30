import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { AlertOctagon, FileSearch } from 'lucide-react'
import type { AffectednessResult } from '../../types/domain.ts'
import type { AnalyticsResponse } from '../../types/api.ts'
import { formatDuration } from '../../lib/engine/time.ts'
import { Skeleton, cx } from '../ui/primitives.tsx'
import { AFFECTEDNESS, CASE_STATUS, DEADLINE_STATUS, STAGE, TONE_DOT, TONE_TEXT } from '../ui/status.tsx'
import { EmptyState } from '../ui/feedback.tsx'
import { Tally } from '../ui/time.tsx'
import { EASE_OUT } from './chart.ts'
import { DurationFigure, ProportionBar, ScopeTag } from './parts.tsx'
import type { Scope } from './parts.tsx'

/**
 * The figure blocks of the analytics page. Each one names its population
 * (in range, or now), its sample size and how it is measured.
 */

// Measures -------------------------------------------------------------------------------

interface MeasureItem {
  key: string
  label: string
  scope: Scope
  value: ReactNode | null
  n: string
  definition: string
}

/** Padding that lines each cell up with the page edge in the 2- and 5-column layouts. */
function cellPad(i: number, count: number): string {
  return cx('py-5 md:px-6 xl:px-6', i % 2 === 0 ? 'md:pl-0' : 'md:pr-0', i === 0 && 'xl:pl-0', i === count - 1 && 'xl:pr-0')
}

export function MeasuresRow({ data }: { data: AnalyticsResponse }) {
  const duration = (m: AnalyticsResponse['determinationTime']) => (m.valueMs === null ? null : <DurationFigure text={formatDuration(m.valueMs, { seconds: false })} className="text-3xl" />)
  const cases = (n: number) => `n = ${n} ${n === 1 ? 'case' : 'cases'}`
  const items: MeasureItem[] = [
    { key: 'det', label: 'Average determination time', scope: 'range', value: duration(data.determinationTime), n: cases(data.determinationTime.n), definition: data.determinationTime.definition },
    { key: 'a2d', label: 'Average awareness-to-decision time', scope: 'range', value: duration(data.awarenessToDecision), n: cases(data.awarenessToDecision.n), definition: data.awarenessToDecision.definition },
    { key: 'd2a', label: 'Average detection-to-awareness', scope: 'range', value: duration(data.detectionToAwareness), n: cases(data.detectionToAwareness.n), definition: data.detectionToAwareness.definition },
    {
      key: 'open',
      label: 'Open clocks',
      scope: 'now',
      value: <Tally value={data.openClocks} className="font-mono text-3xl text-ink" />,
      n: `n = ${data.openClocks} running ${data.openClocks === 1 ? 'deadline' : 'deadlines'}`,
      definition: 'Article 14 deadlines running now, across every open case. Not filtered by the range.',
    },
    {
      key: 'overdue',
      label: 'Overdue clocks',
      scope: 'now',
      value:
        data.overdueClocks > 0 ? (
          <span className="inline-flex items-center gap-2.5 text-red">
            <AlertOctagon className="h-6 w-6" aria-hidden strokeWidth={1.75} />
            <Tally value={data.overdueClocks} className="font-mono text-3xl" />
            <span className="micro text-red">Overdue</span>
          </span>
        ) : (
          <Tally value={0} className="font-mono text-3xl text-ink" />
        ),
      n: `n = ${data.openClocks} running`,
      definition: 'Running deadlines past their due instant now. Not filtered by the range.',
    },
  ]
  return (
    <section aria-label="Measures" className="border-y border-line">
      <dl className="grid gap-px bg-line md:grid-cols-2 xl:grid-cols-5">
        {items.map((m, i) => (
          <motion.div
            key={m.key}
            className={cx('min-w-0 bg-canvas', cellPad(i, items.length), i === items.length - 1 && 'md:col-span-2 xl:col-span-1')}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.3, ease: EASE_OUT }}
          >
            <dt className="micro min-w-0">{m.label}</dt>
            <dd className="mt-4 flex min-h-[40px] items-center leading-none">{m.value ?? <span className="text-md text-ink-3">No data in range</span>}</dd>
            <dd className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
              <span className="mono text-xs text-ink-2">{m.n}</span>
              <ScopeTag scope={m.scope} />
            </dd>
            <dd className="mt-1 text-xs leading-relaxed text-ink-3">{m.definition}</dd>
          </motion.div>
        ))}
      </dl>
    </section>
  )
}

// Ruled list with proportional bars ---------------------------------------------------------

interface RowItem {
  key: string
  label: ReactNode
  icon: ReactNode
  count: number
  fill: string
  prefix?: string
}

export function RuledBars({ rows, label, unit }: { rows: RowItem[]; label: string; unit: string }) {
  const max = Math.max(0, ...rows.map((r) => r.count))
  return (
    <ul aria-label={label} className="border-t border-line">
      {rows.map((r, i) => (
        <li key={r.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line py-2.5 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_2.5rem]">
          <span className={cx('flex min-w-0 items-center gap-2 text-sm', r.count > 0 ? 'text-ink' : 'text-ink-3')}>
            {r.prefix && <span className="mono w-5 shrink-0 text-[11px] text-ink-3">{r.prefix}</span>}
            {r.icon}
            <span className="min-w-0 truncate">{r.label}</span>
          </span>
          <span className={cx('mono text-right text-sm tabular md:order-last', r.count > 0 ? 'text-ink' : 'text-ink-3')}>{r.count}</span>
          <div className="col-span-2 min-w-0 md:col-span-1">
            <ProportionBar value={r.count} max={max} fill={r.fill} delay={0.06 + i * 0.04} label={`${r.count} ${unit}`} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function StatusList({ data }: { data: AnalyticsResponse }) {
  return (
    <RuledBars
      label="Cases by status"
      unit="cases"
      rows={data.byStatus.map((s) => {
        const meta = CASE_STATUS[s.status]
        const Icon = meta.icon
        return { key: s.status, label: meta.label, icon: <Icon className={cx('h-3.5 w-3.5 shrink-0', TONE_TEXT[meta.tone])} aria-hidden />, count: s.count, fill: TONE_DOT[meta.tone] }
      })}
    />
  )
}

export function SubmissionList({ data }: { data: AnalyticsResponse }) {
  return (
    <RuledBars
      label="Report versions by submission stage"
      unit="report versions"
      rows={data.submissions.map((s, i) => {
        const meta = STAGE[s.stage]
        const Icon = meta.icon
        return {
          key: s.stage,
          prefix: String(i + 1).padStart(2, '0'),
          label: meta.label,
          icon: <Icon className={cx('h-3.5 w-3.5 shrink-0', TONE_TEXT[meta.tone])} aria-hidden />,
          count: s.count,
          fill: TONE_DOT[meta.tone],
        }
      })}
    />
  )
}

// Affectedness --------------------------------------------------------------------------------

function affMeta(result: string) {
  return AFFECTEDNESS[(result in AFFECTEDNESS ? result : 'NO_DETERMINATION') as AffectednessResult | 'NO_DETERMINATION']
}

export function AffectednessBlock({ data }: { data: AnalyticsResponse }) {
  const reduce = useReducedMotion()
  const rows = data.byAffectedness
  const total = rows.reduce((a, r) => a + r.count, 0)
  return (
    <div className="min-w-0">
      <div className="h-3 w-full overflow-hidden rounded-[4px] bg-s2" role="img" aria-label={rows.map((r) => `${affMeta(r.result).label}: ${r.count}`).join(', ')}>
        {total > 0 && (
          <motion.div className="flex h-full w-full gap-[2px]" style={{ originX: 0 }} initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.1, duration: 0.55, ease: EASE_OUT }}>
            {rows
              .filter((r) => r.count > 0)
              .map((r) => (
                <div key={r.result} className={cx('h-full min-w-[3px]', TONE_DOT[affMeta(r.result).tone])} style={{ flexGrow: r.count, flexBasis: 0 }} />
              ))}
          </motion.div>
        )}
      </div>
      <dl className="mt-5 grid divide-y divide-line border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:border-y-0">
        {rows.map((r, i) => {
          const meta = affMeta(r.result)
          const Icon = meta.icon
          return (
            <div key={r.result} className={cx('flex min-w-0 items-center justify-between gap-3 py-2.5 sm:block sm:py-0', i === 0 ? 'sm:pr-4' : 'sm:px-4', i === rows.length - 1 && 'sm:pr-0')}>
              <dt className="flex min-w-0 items-start gap-1.5 text-sm text-ink-2 sm:text-xs">
                <Icon className={cx('mt-px h-3.5 w-3.5 shrink-0', TONE_TEXT[meta.tone])} aria-hidden />
                <span className="min-w-0">{meta.label}</span>
              </dt>
              <dd className="sm:mt-2">
                <Tally value={r.count} className={cx('font-mono text-2xl', r.count > 0 ? 'text-ink' : 'text-ink-3')} />
              </dd>
            </div>
          )
        })}
      </dl>
      <p className="mt-5 text-xs leading-relaxed text-ink-3">
        A case counts as affected when any in-scope product is affected, and as not affected only when every in-scope product is. Anything else, including an unanswered question, is under investigation.
      </p>
    </div>
  )
}

// Evidence gaps -------------------------------------------------------------------------------

export function EvidenceGaps({ data }: { data: AnalyticsResponse }) {
  const { total, byItem } = data.evidenceGaps
  const max = Math.max(0, ...byItem.map((b) => b.count))
  if (total === 0) {
    return <EmptyState compact icon={FileSearch} title="No missing checklist items" why="Every open case has the evidence its checklist asks for. A gap appears here as soon as an item a determination depends on is missing." />
  }
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-3">
        <Tally value={total} className="font-mono text-4xl text-ink" />
        <span className="text-sm text-ink-3">missing checklist {total === 1 ? 'item' : 'items'} across open cases</span>
      </div>
      <ol aria-label="Evidence gaps by checklist item" className="mt-5 border-t border-line">
        {byItem.map((b, i) => (
          <li key={b.label} className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line py-2.5">
            <span className="mono text-[11px] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
            <span className="min-w-0 truncate text-sm text-ink" title={b.label}>
              {b.label}
            </span>
            <span className="mono text-right text-sm tabular text-ink">{b.count}</span>
            <div className="col-start-2 col-end-4 min-w-0">
              <ProportionBar value={b.count} max={max} fill="bg-ink-3" delay={0.08 + i * 0.04} label={`${b.count} open cases missing ${b.label}`} />
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ink-3">Counted once per open case that lacks the item. One case can lack several.</p>
    </div>
  )
}

// Deadline outcomes ---------------------------------------------------------------------------

export function DeadlineOutcomes({ data }: { data: AnalyticsResponse }) {
  const { onTime, late, overdue } = data.deadlineOutcomes
  const rows: Array<{ key: string; meta: (typeof DEADLINE_STATUS)[keyof typeof DEADLINE_STATUS]; label: string; value: number; scope: Scope; definition: string }> = [
    { key: 'on', meta: DEADLINE_STATUS.COMPLETED, label: 'On time', value: onTime, scope: 'range', definition: 'Completed on or before the due instant.' },
    { key: 'late', meta: DEADLINE_STATUS.COMPLETED_LATE, label: 'Late', value: late, scope: 'range', definition: 'Completed after the due instant.' },
    { key: 'over', meta: DEADLINE_STATUS.OVERDUE, label: 'Overdue', value: overdue, scope: 'now', definition: 'Still running past the due instant, across open cases.' },
  ]
  return (
    <div className="min-w-0">
      <ul className="border-t border-line">
        {rows.map((r) => {
          const Icon = r.meta.icon
          return (
            <li key={r.key} className="flex min-w-0 items-center gap-4 border-b border-line py-3.5">
              <Icon className={cx('h-4 w-4 shrink-0', TONE_TEXT[r.meta.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  {r.label}
                  <ScopeTag scope={r.scope} />
                </div>
                <p className="mt-0.5 text-xs text-ink-3">{r.definition}</p>
              </div>
              <Tally value={r.value} className={cx('font-mono text-2xl', r.value > 0 ? (r.key === 'over' ? 'text-red' : 'text-ink') : 'text-ink-3')} />
            </li>
          )
        })}
      </ul>
      <p className="mono mt-3 text-xs text-ink-2">
        n = {onTime + late} completed {onTime + late === 1 ? 'deadline' : 'deadlines'}
      </p>
    </div>
  )
}

// Loading --------------------------------------------------------------------------------------

export function AnalyticsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading analytics" className="space-y-12">
      <div className="grid gap-px border-y border-line bg-line md:grid-cols-2 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={cx('space-y-3 bg-canvas', cellPad(i, 5), i === 4 && 'md:col-span-2 xl:col-span-1')}>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-12">
        <Skeleton className="h-80 lg:col-span-7" />
        <div className="space-y-3 lg:col-span-5">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
        <Skeleton className="h-40 lg:col-span-5" />
      </div>
    </div>
  )
}
