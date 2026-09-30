import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import { FlaskConical, Timer } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { CaseStatus } from '../../types/domain.ts'
import type { Deadline, DeadlineStatus } from '../../lib/engine/deadlines.ts'
import { api } from '../../lib/client/api.ts'
import { useCase, useUsers } from '../../lib/client/queries.ts'
import { useNow, syncServerTime } from '../../lib/client/useNow.ts'
import { live, isLive } from '../../lib/client/live.ts'
import { dayMonth, hhmm, short, stamp } from '../../lib/client/format.ts'
import { PageHeader, Segmented, Select, SkeletonPage, Skeleton, Ident, cx } from '../../components/ui/primitives.tsx'
import { DEADLINE_STATUS, DeadlineBadge, TONE_TEXT } from '../../components/ui/status.tsx'
import { EmptyState, ErrorState } from '../../components/ui/feedback.tsx'
import { Countdown } from '../../components/ui/time.tsx'
import { WhyDeadline } from '../../components/clock/Deadlines.tsx'
import { WhatIf } from '../../components/clock/WhatIf.tsx'

interface ClockItem {
  caseId: string
  caseTitle: string
  cve: string | null
  products: string
  ownerId: string
  lifecycle: string
  status: CaseStatus
  awarenessInstant: string | null
  applicability: string
  deadlines: Deadline[]
}

type Filter = 'running' | 'critical' | 'completed' | 'pending' | 'all'
const HOUR = 3_600_000
const DAY = 24 * HOUR

function useClocks() {
  return useQuery({
    queryKey: ['clocks'],
    queryFn: async () => {
      const r = await api<{ items: ClockItem[]; now: string }>('/api/clocks')
      syncServerTime(r.now)
      return r.items
    },
    refetchInterval: 60_000,
  })
}

/** Swimlanes: one row per case with a live clock, from its start to its last deadline. */
function Timeline({ items }: { items: ClockItem[] }) {
  const now = useNow()
  const lanes = items
    .map((it) => ({ it, ds: it.deadlines.map((d) => live(d, now)).filter((d) => d.dueAt && (isLive(d) || d.status === 'COMPLETED' || d.status === 'COMPLETED_LATE')) }))
    .filter((l) => l.ds.some(isLive))
  if (lanes.length === 0) return null
  const from = now - 3 * DAY
  const to = now + 15 * DAY
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - from) / (to - from)) * 100))
  const ticks = Array.from({ length: 19 }, (_, i) => from + i * DAY)
  return (
    <section aria-label="Deadline timeline" className="panel min-w-0 overflow-hidden">
      <div className="px-5 pt-5 sm:px-6">
        <div className="micro mb-1.5">Deadline timeline</div>
        <h2 className="text-lg font-medium text-ink">When does each running obligation fall due?</h2>
      </div>
      <div className="mt-5 overflow-x-auto pb-5">
        <div className="relative min-w-[760px] px-5 sm:px-6">
          <div className="relative ml-[180px] h-6">
            {ticks.map((t, i) => (
              <div key={t} className="absolute top-0 -translate-x-1/2 text-[10px]" style={{ left: `${pct(t)}%` }}>
                {i % 2 === 0 && <span className="mono text-ink-4">{dayMonth(new Date(t).toISOString())}</span>}
              </div>
            ))}
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute bottom-0 left-[180px] right-0 top-0">
              {ticks.map((t) => (
                <div key={t} className="absolute bottom-0 top-0 w-px bg-line" style={{ left: `${pct(t)}%` }} />
              ))}
              <div className="absolute bottom-0 top-0 w-px bg-ink" style={{ left: `${pct(now)}%` }}>
                <span className="mono absolute -top-1 left-1 rounded-sm bg-ink px-1 text-[9px] font-semibold uppercase text-canvas">now</span>
              </div>
            </div>
            {lanes.map(({ it, ds }, i) => {
              const start = Date.parse(ds[0]!.start!.at)
              const end = Math.max(...ds.map((d) => Date.parse(d.dueAt!)))
              const worst = ds.filter(isLive).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))[0]
              const tone = worst ? DEADLINE_STATUS[worst.status].tone : 'neutral'
              return (
                <Link key={it.caseId} to={`/cases/${it.caseId}?tab=clock`} className="group grid grid-cols-[180px_minmax(0,1fr)] items-center py-2.5">
                  <div className="min-w-0 pr-4">
                    <Ident className="block text-[11.5px] group-hover:text-amber">{it.caseId}</Ident>
                    <div className="truncate text-[11px] text-ink-3">{it.cve}</div>
                  </div>
                  <div className="relative h-7">
                    <motion.div
                      className={cx('absolute top-1/2 h-[3px] origin-left -translate-y-1/2 rounded-full', tone === 'red' || tone === 'redSolid' ? 'bg-red/60' : tone === 'amber' ? 'bg-amber/60' : 'bg-ink-3/60')}
                      style={{ left: `${pct(start)}%`, width: `${Math.max(0.5, pct(end) - pct(start))}%` }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ delay: 0.1 + i * 0.05, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    />
                    {ds.map((d) => {
                      const m = DEADLINE_STATUS[d.status]
                      const done = d.status === 'COMPLETED' || d.status === 'COMPLETED_LATE'
                      return (
                        <span
                          key={d.kind}
                          title={`${d.label} · ${stamp(d.dueAt!)} · ${m.label}`}
                          className={cx('absolute top-1/2 flex h-5 -translate-x-1/2 -translate-y-1/2 items-center rounded border px-1 font-mono text-[9.5px]', done ? 'border-green-line bg-s1 text-green' : d.status === 'CRITICAL' || d.status === 'OVERDUE' ? 'border-red bg-red-soft text-red' : d.status === 'WATCH' ? 'border-amber-line bg-s1 text-amber' : 'border-line-bright bg-s1 text-ink-2')}
                          style={{ left: `${pct(Date.parse(d.dueAt!))}%` }}
                        >
                          {d.shortLabel}
                        </span>
                      )
                    })}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function Simulator({ items }: { items: ClockItem[] }) {
  const withEvents = items.filter((i) => i.lifecycle === 'open')
  const [caseId, setCaseId] = useState(withEvents.find((i) => i.awarenessInstant)?.caseId ?? withEvents[0]?.caseId ?? '')
  const q = useCase(caseId)
  return (
    <section aria-labelledby="sim-h" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="micro mb-1.5 flex items-center gap-2 text-violet">
            <FlaskConical className="h-3.5 w-3.5" /> Clock simulator
          </div>
          <h2 id="sim-h" className="text-lg font-medium text-ink">
            What if awareness had been established at a different time?
          </h2>
        </div>
        <Select value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Case to simulate" className="w-auto max-w-full">
          {withEvents.map((i) => (
            <option key={i.caseId} value={i.caseId}>
              {i.caseId} · {i.cve}
            </option>
          ))}
        </Select>
      </div>
      <div className="panel p-5 sm:p-6">{q.data ? <WhatIf key={caseId} bundle={q.data.bundle} /> : <Skeleton className="h-64" />}</div>
    </section>
  )
}

export function Clocks() {
  const q = useClocks()
  const users = useUsers()
  const now = useNow()
  const [params] = useSearchParams()
  const [filter, setFilter] = useState<Filter>(params.get('filter') === 'critical' ? 'critical' : 'running')
  const simRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (params.get('simulate') === '1') setTimeout(() => simRef.current?.scrollIntoView({ behavior: 'smooth' }), 500)
  }, [params])
  const name = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id

  const rows = useMemo(() => {
    const out: Array<{ it: ClockItem; d: Deadline }> = []
    for (const it of q.data ?? []) for (const d0 of it.deadlines) out.push({ it, d: live(d0, now) })
    const keep: Record<Filter, (s: DeadlineStatus) => boolean> = {
      running: (s) => ['ON_TRACK', 'WATCH', 'CRITICAL', 'OVERDUE'].includes(s),
      critical: (s) => s === 'CRITICAL' || s === 'OVERDUE',
      completed: (s) => s === 'COMPLETED' || s === 'COMPLETED_LATE',
      pending: (s) => s === 'PENDING_START' || s === 'BLOCKED',
      all: () => true,
    }
    return out
      .filter((r) => keep[filter](r.d.status))
      .sort((a, b) => (a.d.dueAt ? Date.parse(a.d.dueAt) : Infinity) - (b.d.dueAt ? Date.parse(b.d.dueAt) : Infinity))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, filter, Math.floor(now / 60_000)])

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <SkeletonPage />
  const counts = {
    running: q.data.flatMap((i) => i.deadlines).map((d) => live(d, now)).filter(isLive).length,
    critical: q.data.flatMap((i) => i.deadlines).map((d) => live(d, now)).filter((d) => d.status === 'CRITICAL' || d.status === 'OVERDUE').length,
  }

  return (
    <div className="min-w-0 space-y-12">
      <PageHeader
        eyebrow="Record"
        title="Reporting clocks"
        description="Every deadline derived from every case, in the order it falls due. Deadlines are computed from their start events on each request and never stored, so a corrected timestamp moves them immediately."
      />
      <Timeline items={q.data} />
      <section aria-label="Deadlines" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Filter deadlines"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'running', label: `Running (${counts.running})` },
              { value: 'critical', label: `Critical (${counts.critical})`, tone: 'red' },
              { value: 'completed', label: 'Completed' },
              { value: 'pending', label: 'Pending start' },
              { value: 'all', label: 'All' },
            ]}
          />
          <span className="text-xs text-ink-3">Attention thresholds are operational, not statutory: 24h clocks turn WATCH at 12h and CRITICAL at 4h left.</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Timer} title={filter === 'critical' ? 'No critical deadlines' : 'No deadlines in this view'} why={filter === 'critical' ? 'No running deadline is within its critical threshold or overdue.' : 'No awareness event has established a reporting clock that matches this filter.'} />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {rows.map(({ it, d }, i) => {
              const m = DEADLINE_STATUS[d.status]
              return (
                <motion.li key={`${it.caseId}-${d.kind}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 15) * 0.02 }} className="grid min-w-0 gap-x-6 gap-y-3 py-5 md:grid-cols-[110px_minmax(0,1.2fr)_minmax(0,1fr)_150px]">
                  <div className="mono">
                    {d.dueAt ? (
                      <>
                        <div className={cx('text-xl font-medium leading-none', TONE_TEXT[m.tone])}>{hhmm(d.dueAt)}</div>
                        <div className="mt-1.5 text-[11px] text-ink-3">{dayMonth(d.dueAt)}</div>
                      </>
                    ) : (
                      <div className="text-sm text-ink-4">no due time</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium text-ink">
                        {d.shortLabel} · {d.label}
                      </span>
                      <span className="ident text-[11px] text-ink-4">{d.citation}</span>
                    </div>
                    <Link to={`/cases/${it.caseId}?tab=clock`} className="mt-1 block truncate text-xs text-ink-2 hover:text-amber">
                      <span className="ident">{it.caseId}</span> · {it.caseTitle}
                    </Link>
                    <div className="mt-2">
                      <WhyDeadline deadline={d} />
                    </div>
                  </div>
                  <div className="min-w-0 text-xs text-ink-3">
                    {d.start ? (
                      <>
                        <div>
                          Start: {d.start.label.toLowerCase()} <span className="ident text-ink-2">{d.start.eventId}</span>
                        </div>
                        <div className="mono mt-0.5 text-ink-2">{short(d.start.at)}</div>
                        <div className="mt-0.5 truncate" title={d.start.source}>
                          Source: {d.start.source}
                        </div>
                      </>
                    ) : (
                      <div>{d.reason}</div>
                    )}
                    <div className="mt-1">Owner: {name(it.ownerId)}</div>
                  </div>
                  <div className="flex flex-row items-center gap-3 md:flex-col md:items-end">
                    <DeadlineBadge status={d.status} size="sm" />
                    {isLive(d) && d.dueAt && (
                      <span className={cx('text-sm', TONE_TEXT[m.tone])}>
                        <Countdown dueAt={d.dueAt} size="sm" seconds={false} />
                      </span>
                    )}
                    {d.completedAt && <span className="mono text-[11px] text-ink-3">submitted {short(d.completedAt)}</span>}
                  </div>
                </motion.li>
              )
            })}
          </ul>
        )}
      </section>
      <div ref={simRef}>
        <Simulator items={q.data} />
      </div>
    </div>
  )
}
