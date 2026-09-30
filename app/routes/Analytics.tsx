import { useState } from 'react'
import { motion } from 'motion/react'
import { CalendarClock, FlaskConical, Loader2, Timer } from 'lucide-react'
import type { Range } from '../../lib/engine/analytics.ts'
import type { AnalyticsResponse } from '../../types/api.ts'
import { useAnalytics } from '../../lib/client/queries.ts'
import { PageHeader, Panel, Segmented, cx } from '../../components/ui/primitives.tsx'
import { Badge } from '../../components/ui/status.tsx'
import { EmptyState, ErrorState } from '../../components/ui/feedback.tsx'
import { SectionHead } from '../../components/analytics/parts.tsx'
import { DeadlineChart } from '../../components/analytics/DeadlineChart.tsx'
import { TurnaroundChart, TurnaroundList } from '../../components/analytics/TurnaroundChart.tsx'
import { AffectednessBlock, AnalyticsSkeleton, DeadlineOutcomes, EvidenceGaps, MeasuresRow, StatusList, SubmissionList } from '../../components/analytics/Sections.tsx'

/**
 * Operational analytics. Every figure answers one question, says how it is
 * measured and what population it is drawn from, and carries its sample
 * size. Two populations exist and are labelled apart: cases created within
 * the selected range, and the current state of every open case.
 */

const RANGES: Array<{ value: Range; label: string; long: string }> = [
  { value: '7d', label: '7 days', long: 'the last 7 days' },
  { value: '30d', label: '30 days', long: 'the last 30 days' },
  { value: '90d', label: '90 days', long: 'the last 90 days' },
  { value: 'all', label: 'All time', long: 'all time' },
]

function rangeLong(r: Range): string {
  return RANGES.find((x) => x.value === r)?.long ?? r
}

export function Analytics() {
  const [range, setRange] = useState<Range>('30d')
  const q = useAnalytics(range)
  // Keep the last answer on screen while another range loads, marked as stale.
  const [last, setLast] = useState<AnalyticsResponse | null>(null)
  if (q.data && q.data !== last) setLast(q.data)
  const data = q.data ?? last
  const stale = !q.data && data !== null

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Govern"
        title="Operational analytics"
        description="Every figure states how it is measured and the sample size it rests on. There is no composite score: an average over three cases is shown as an average over three cases."
        actions={
          <>
            {data?.demoData && (
              <Badge tone="amber" icon={FlaskConical} title="The organisation is a demo organisation. Every figure on this page is computed from fictional records.">
                Demo data
              </Badge>
            )}
            <Segmented<Range> label="Range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
          </>
        }
      />

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !data ? (
        <AnalyticsSkeleton />
      ) : (
        <div className={cx('min-w-0 transition-opacity duration-200', stale && 'opacity-50')} aria-busy={stale || undefined}>
          <p className="mb-5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            {stale ? (
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading {rangeLong(range)}
              </span>
            ) : (
              <span>
                <span className="text-ink-2">In range</span> means created in {rangeLong(data.range)}: <span className="mono text-ink-2">{data.cases}</span> {data.cases === 1 ? 'case' : 'cases'}.
              </span>
            )}
            <span aria-hidden className="text-ink-4">·</span>
            <span>
              <span className="text-ink-2">Now</span> means every open case at this instant, whatever the range.
            </span>
          </p>

          <MeasuresRow data={data} />

          {/* Open obligations: current state -------------------------------------------------- */}
          <div className="mt-14 grid min-w-0 gap-x-10 gap-y-12 lg:grid-cols-12">
            <motion.section aria-labelledby="an-deadlines" className="min-w-0 lg:col-span-7" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
              <Panel as="div" className="p-5 sm:p-6">
                <SectionHead id="an-deadlines" eyebrow="Deadline distribution" title="When are open obligations due?" question="Running Article 14 deadlines, grouped by time remaining until due." scope="now" meta={`n = ${data.openClocks}`} />
                {data.openClocks === 0 ? (
                  <EmptyState compact icon={Timer} title="No running deadlines" why="No open case has a running Article 14 clock. A deadline starts when awareness of an actively exploited vulnerability is recorded and the rule set finds Article 14 applicable." />
                ) : (
                  <>
                    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-red" aria-hidden /> Critical or overdue
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-amber" aria-hidden /> Running
                      </span>
                    </div>
                    <DeadlineChart data={data.deadlineDistribution} />
                    <p className="mt-3 text-xs leading-relaxed text-ink-3">Critical means inside the operational attention threshold set for that deadline type, or past due. The threshold is an operating setting, not a regulatory term.</p>
                  </>
                )}
              </Panel>
            </motion.section>

            <motion.section aria-labelledby="an-gaps" className="min-w-0 lg:col-span-5 lg:pt-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
              <SectionHead id="an-gaps" eyebrow="Evidence gaps" title="What evidence is missing?" question="Checklist items open cases still lack, most frequent first." scope="now" meta={`n = ${data.evidenceGaps.total}`} />
              <EvidenceGaps data={data} />
            </motion.section>
          </div>

          {/* Cases in range ------------------------------------------------------------------ */}
          <div className="mt-16 grid min-w-0 gap-x-10 gap-y-12 lg:grid-cols-12">
            <motion.section aria-labelledby="an-status" className="min-w-0 lg:col-span-7" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <SectionHead id="an-status" eyebrow="Cases by status" title="Where are cases in the workflow?" question="Current status of each case created in range." scope="range" meta={`n = ${data.cases}`} />
              <StatusList data={data} />
            </motion.section>

            <motion.section aria-labelledby="an-aff" className="min-w-0 lg:col-span-5" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
              <SectionHead id="an-aff" eyebrow="Cases by affectedness" title="Is a product affected?" question="Aggregate product affectedness per case created in range." scope="range" meta={`n = ${data.byAffectedness.reduce((a, r) => a + r.count, 0)}`} />
              <AffectednessBlock data={data} />
            </motion.section>
          </div>

          <motion.section aria-labelledby="an-turn" className="mt-16 min-w-0" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
            <Panel as="div" className="p-5 sm:p-6">
              <SectionHead
                id="an-turn"
                eyebrow="Decision turnaround"
                title="How long did each decision take after awareness?"
                question="Per case: when the first reportability decision was recorded, and how long after the first awareness event."
                scope="range"
                meta={`n = ${data.turnaround.length}`}
              />
              {data.turnaround.length === 0 ? (
                <EmptyState
                  compact
                  icon={CalendarClock}
                  title="No decisions in range"
                  why="Turnaround needs both a recorded awareness event and a recorded reportability decision. No case created in this range has both yet."
                />
              ) : (
                <div className="min-w-0 space-y-8">
                  <div className="min-w-0">
                    <TurnaroundChart points={data.turnaround} />
                    <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-3">
                      Reference lines mark 24h and 72h after first awareness. Article 14 clocks run from awareness of an actively exploited vulnerability, which can come later, so a point above a line is not by itself a missed deadline.
                    </p>
                  </div>
                  <TurnaroundList points={data.turnaround} />
                </div>
              )}
            </Panel>
          </motion.section>

          <div className="mt-16 grid min-w-0 gap-x-10 gap-y-12 lg:grid-cols-12">
            <motion.section aria-labelledby="an-subs" className="min-w-0 lg:col-span-7" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32 }}>
              <SectionHead
                id="an-subs"
                eyebrow="Submission status"
                title="Where are reports in the submission pipeline?"
                question="Report versions generated in range, by their current stage, in pipeline order."
                scope="range"
                meta={`n = ${data.submissions.reduce((a, s) => a + s.count, 0)}`}
              />
              <SubmissionList data={data} />
            </motion.section>

            <motion.section aria-labelledby="an-out" className="min-w-0 lg:col-span-5" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.36 }}>
              <SectionHead id="an-out" eyebrow="Deadline outcomes" title="Were obligations met on time?" question="Completed deadlines of cases created in range, and deadlines overdue now." scope="range" />
              <DeadlineOutcomes data={data} />
            </motion.section>
          </div>
        </div>
      )}
    </div>
  )
}
