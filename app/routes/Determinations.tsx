import { Fragment, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import { ChevronRight, Scale } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { AffectednessResult, Determination } from '../../types/domain.ts'
import type { AffectednessEvaluation } from '../../lib/engine/affectedness.ts'
import { JUSTIFICATION_LABELS } from '../../lib/engine/affectedness.ts'
import { api } from '../../lib/client/api.ts'
import { useUsers } from '../../lib/client/queries.ts'
import { short } from '../../lib/client/format.ts'
import { Ident, PageHeader, Segmented, SkeletonPage, cx } from '../../components/ui/primitives.tsx'
import { AFFECTEDNESS, AffectednessBadge, Badge } from '../../components/ui/status.tsx'
import { EmptyState, ErrorState } from '../../components/ui/feedback.tsx'
import { ReasoningFlow } from '../../components/reasoning/ReasoningFlow.tsx'

interface Row {
  caseId: string
  caseTitle: string
  lifecycle: string
  cve: string
  component: string | null
  componentVersion: string | null
  product: { id: string; name: string; version: string }
  determination: Determination | null
  evaluation: AffectednessEvaluation | null
  history: number
}

type Filter = AffectednessResult | 'NO_DETERMINATION' | 'all'

export function Determinations() {
  const q = useQuery({ queryKey: ['determinations'], queryFn: async () => (await api<{ items: Row[] }>('/api/determinations')).items })
  const users = useUsers()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState<string | null>(null)
  const filter = (params.get('result') as Filter | null) ?? 'all'
  const name = (id: string | null) => users.data?.find((u) => u.id === id)?.name ?? id ?? '--'
  const rows = useMemo(() => {
    const list = (q.data ?? []).filter((r) => r.lifecycle === 'open')
    return filter === 'all' ? list : list.filter((r) => (r.determination?.result ?? 'NO_DETERMINATION') === filter)
  }, [q.data, filter])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of (q.data ?? []).filter((x) => x.lifecycle === 'open')) {
      const k = r.determination?.result ?? 'NO_DETERMINATION'
      c[k] = (c[k] ?? 0) + 1
    }
    return c
  }, [q.data])

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <SkeletonPage />

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Record"
        title="Determinations"
        description="The current affectedness determination for every product in every open case, as a VEX-style statement. A product with no determination counts as under investigation: it is never assumed safe."
      />
      <div className="mb-8 grid grid-cols-2 gap-y-5 border-y border-line py-5 sm:grid-cols-4 sm:divide-x sm:divide-line">
        {(['AFFECTED', 'UNDER_INVESTIGATION', 'NOT_AFFECTED', 'NO_DETERMINATION'] as const).map((k) => {
          const m = AFFECTEDNESS[k]
          return (
            <button key={k} type="button" onClick={() => setParams(filter === k ? {} : { result: k })} className={cx('min-w-0 text-left sm:px-5 sm:first:pl-0', filter === k && 'opacity-100')}>
              <div className={cx('mono text-3xl', k === 'AFFECTED' ? 'text-red' : k === 'UNDER_INVESTIGATION' ? 'text-amber' : k === 'NOT_AFFECTED' ? 'text-green' : 'text-ink-3')}>{counts[k] ?? 0}</div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
                <m.icon className="h-3.5 w-3.5" /> {m.label}
              </div>
            </button>
          )
        })}
      </div>
      <div className="mb-4">
        <Segmented<Filter>
          label="Filter by result"
          value={filter}
          onChange={(v) => setParams(v === 'all' ? {} : { result: v })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'AFFECTED', label: 'Affected', tone: 'red' },
            { value: 'UNDER_INVESTIGATION', label: 'Under investigation', tone: 'amber' },
            { value: 'NOT_AFFECTED', label: 'Not affected', tone: 'green' },
            { value: 'NO_DETERMINATION', label: 'No determination' },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Scale} title="Nothing in this view" why="No open case has a product with this affectedness result." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-line bg-s1">
              <tr>
                {['', 'Product', 'Vulnerability', 'Result', 'VEX', 'Confidence', 'Analyst', 'Recorded', 'Next action'].map((h, i) => (
                  <th key={i} className="micro px-3 py-2.5 font-normal first:w-8 first:pl-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const d = r.determination
                const key = `${r.caseId}-${r.product.id}`
                const expanded = open === key
                return (
                  <Fragment key={key}>
                    <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 15) * 0.02 }} className={cx('row-line cursor-pointer align-top', expanded && 'bg-s2')} onClick={() => setOpen(expanded ? null : key)}>
                      <td className="py-3 pl-4">
                        <button type="button" aria-expanded={expanded} aria-label="Show reasoning" className="text-ink-3">
                          <ChevronRight className={cx('h-4 w-4 transition-transform', expanded && 'rotate-90')} />
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-sm text-ink">{r.product.name}</div>
                        <div className="mono text-[11px] text-ink-3">
                          {r.product.version} · {r.component ?? '--'} {r.componentVersion ?? ''}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Link to={`/cases/${r.caseId}?tab=products`} onClick={(e) => e.stopPropagation()} className="ident text-[12px] text-ink-2 hover:text-amber">
                          {r.cve}
                        </Link>
                        <div className="ident text-[11px] text-ink-4">{r.caseId}</div>
                      </td>
                      <td className="px-3 py-3">
                        <AffectednessBadge result={d?.result ?? 'NO_DETERMINATION'} size="sm" />
                      </td>
                      <td className="px-3 py-3">
                        <div className="mono text-[11.5px] text-ink-2">{d?.vexStatus ?? 'under_investigation'}</div>
                        {d?.vexJustification && <div className="text-[11px] text-ink-3">{JUSTIFICATION_LABELS[d.vexJustification]}</div>}
                      </td>
                      <td className="px-3 py-3">{d ? <Badge size="sm" tone={d.confidence === 'HIGH' ? 'green' : d.confidence === 'MEDIUM' ? 'amber' : 'red'}>{d.confidence}</Badge> : <span className="text-ink-4">--</span>}</td>
                      <td className="px-3 py-3 text-xs text-ink-2">{d ? name(d.analystId) : '--'}</td>
                      <td className="mono px-3 py-3 text-[11px] text-ink-3">{d ? short(d.recordedAt) : '--'}</td>
                      <td className="max-w-[240px] px-3 py-3 text-xs">
                        {d?.result === 'UNDER_INVESTIGATION' ? (
                          <>
                            <div className="text-ink">{d.nextAction}</div>
                            <div className="mt-0.5 text-[11px] text-ink-3">
                              {name(d.nextActionOwnerId)} · due <span className="mono">{d.nextActionDue ? short(d.nextActionDue) : '--'}</span>
                            </div>
                          </>
                        ) : !d ? (
                          <span className="text-amber">Record a determination</span>
                        ) : (
                          <span className="text-ink-4">--</span>
                        )}
                      </td>
                    </motion.tr>
                    {expanded && (
                      <tr className="border-b border-line bg-s2">
                        <td colSpan={9} className="px-4 pb-5 pt-1 sm:pl-12">
                          {d && r.evaluation ? (
                            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                              <ReasoningFlow evaluation={r.evaluation} answers={d.answers} />
                              <div className="min-w-0 space-y-3 text-sm">
                                <div>
                                  <div className="micro mb-1">Rationale</div>
                                  <p className="text-ink-2">{d.rationale}</p>
                                </div>
                                {d.unresolved && (
                                  <div>
                                    <div className="micro mb-1 text-amber">Unresolved</div>
                                    <p className="text-ink-2">{d.unresolved}</p>
                                  </div>
                                )}
                                <div className="text-xs text-ink-3">
                                  <Ident dim>{d.id}</Ident> · {r.history} determination{r.history > 1 ? 's' : ''} on record for this product in this case
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-ink-3">No determination recorded. Open the case to walk the nine affectedness questions.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
