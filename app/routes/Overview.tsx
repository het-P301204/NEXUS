import { useMemo } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { AlertTriangle, ArrowRight, ArrowUpRight, CircleDashed, Eye, FileWarning, Timer } from 'lucide-react'
import { useOverview, useUsers } from '../../lib/client/queries.ts'
import { useNow } from '../../lib/client/useNow.ts'
import { live } from '../../lib/client/live.ts'
import { chronoParts, dayLabel, hhmm, short, stamp } from '../../lib/client/format.ts'
import type { AgendaItem, OverviewResponse } from '../../types/api.ts'
import { ClockRail } from '../../components/clock/ClockRail.tsx'
import { DeadlineTrack, WhyDeadline } from '../../components/clock/Deadlines.tsx'
import { Countdown, Tally } from '../../components/ui/time.tsx'
import { CaseStatusBadge, DEADLINE_STATUS, DeadlineBadge, Dot, ExploitationBadge, SeverityMark, TONE_TEXT } from '../../components/ui/status.tsx'
import { EmptyState, ErrorState } from '../../components/ui/feedback.tsx'
import { Ident, Skeleton, cx } from '../../components/ui/primitives.tsx'

const fade = (i: number) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.05 + i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } })

function Clockface() {
  const now = useNow()
  const p = chronoParts(new Date(now).toISOString())
  return (
    <div className="text-left sm:text-right" aria-label={`Current time ${stamp(new Date(now).toISOString())}`}>
      <div className="mono leading-none">
        <span className="text-2xl font-medium text-ink">{p.hm}</span>
        <span className="text-lg text-ink-3">:{p.s}</span>
      </div>
      <div className="micro mt-2">
        {p.date} · {p.zone}
      </div>
    </div>
  )
}

function Counts({ counts }: { counts: OverviewResponse['counts'] }) {
  const items = [
    { label: 'Active reporting clocks', value: counts.activeClocks, to: '/clocks', tone: counts.activeClocks > 0 ? 'text-amber' : 'text-ink' },
    { label: 'Critical deadlines', value: counts.critical, to: '/clocks?filter=critical', tone: counts.critical > 0 ? 'text-red' : 'text-ink' },
    { label: 'Open determinations', value: counts.openDeterminations, to: '/cases?view=open-determinations', tone: 'text-ink' },
    { label: 'Products under investigation', value: counts.underInvestigation, to: '/determinations?result=UNDER_INVESTIGATION', tone: 'text-ink' },
    { label: 'Evidence gaps', value: counts.evidenceGaps, to: '/cases?view=gaps', tone: counts.evidenceGaps > 0 ? 'text-ink' : 'text-ink' },
  ]
  return (
    <dl className="grid grid-cols-2 gap-y-6 border-y border-line py-6 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-line lg:py-7">
      {items.map((it, i) => (
        <motion.div key={it.label} {...fade(i)} className="min-w-0 lg:px-6 lg:first:pl-0">
          <Link to={it.to} className="group block rounded-md">
            <dd className={cx('mono text-3xl font-medium leading-none sm:text-4xl', it.tone)}>
              <Tally value={it.value} />
            </dd>
            <dt className="mt-3 flex items-center gap-1.5 text-xs text-ink-3 transition-colors group-hover:text-ink-2">
              {it.label}
              <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </dt>
          </Link>
        </motion.div>
      ))}
    </dl>
  )
}

function ActiveClock({ data }: { data: NonNullable<OverviewResponse['activeClock']> }) {
  const now = useNow()
  const next = data.analysis.nextDeadline ? live(data.analysis.nextDeadline, now) : null
  const tone = next ? DEADLINE_STATUS[next.status].tone : 'neutral'
  const item = data.item
  return (
    <motion.section {...fade(5)} aria-label="Active clock" className="panel relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      <div className="relative px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="micro flex items-center gap-2">
            <Dot tone={tone === 'redSolid' ? 'red' : tone} pulse />
            Active clock · most urgent
          </div>
          <CaseStatusBadge status={data.analysis.status} />
        </div>

        <div className="mt-6 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <Link to={`/cases/${item.id}`} className="group inline-block max-w-full">
              <div className="ident text-2xl font-medium text-ink transition-colors group-hover:text-amber sm:text-3xl">{item.cve ?? item.vulnerabilityId}</div>
            </Link>
            <div className="mt-2 text-md text-ink-2">{item.products.map((p) => `${p.name} ${p.version}`).join(' · ')}</div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <SeverityMark severity={item.severity} />
              <ExploitationBadge status={item.exploitation} size="sm" />
              <Ident dim>{item.id}</Ident>
            </div>
          </div>
          {next && next.dueAt && (
            <div className="min-w-0 lg:text-right">
              <div className={cx('leading-none', TONE_TEXT[tone])}>
                <Countdown dueAt={next.dueAt} size="lg" className="sm:hidden" />
                <Countdown dueAt={next.dueAt} size="hero" className="hidden sm:inline-flex" />
              </div>
              <div className="mt-3 text-sm text-ink-2">
                remaining until the <span className="text-ink">{next.shortLabel} {next.label.toLowerCase()}</span>
              </div>
              <div className="mono mt-1 text-xs text-ink-3">
                due {stamp(next.dueAt)}
              </div>
            </div>
          )}
        </div>

        <div className="mt-9">
          <DeadlineTrack deadlines={data.analysis.deadlines} size="hero" />
        </div>

        <div className="mt-9 border-t border-line pt-7">
          <ClockRail clock={data.analysis.clock} compact />
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          {next ? <WhyDeadline deadline={next} /> : <span />}
          <Link to={`/cases/${item.id}?tab=clock`} className="inline-flex items-center gap-2 text-sm text-ink transition-colors hover:text-amber">
            Open Clock of Record <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </motion.section>
  )
}

function Agenda({ agenda, nowIso }: { agenda: AgendaItem[]; nowIso: string }) {
  const users = useUsers()
  const now = useNow()
  const name = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: AgendaItem[] }> = []
    for (const a of agenda) {
      const label = dayLabel(a.deadline.dueAt!, nowIso)
      const g = out.find((x) => x.label === label)
      if (g) g.items.push(a)
      else out.push({ label, items: [a] })
    }
    return out
  }, [agenda, nowIso])

  if (agenda.length === 0) {
    return <EmptyState icon={Timer} title="No active clocks" why="No awareness event has established a reporting clock for the current cases." action={<Link to="/cases" className="text-sm text-ink hover:text-amber">Review cases →</Link>} />
  }
  return (
    <div className="space-y-7">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="micro mb-2 text-ink-2">{g.label}</div>
          <ol className="divide-y divide-line border-y border-line">
            {g.items.map((a, i) => {
              const d = live(a.deadline, now)
              const meta = DEADLINE_STATUS[d.status]
              return (
                <motion.li key={`${a.caseId}-${d.kind}`} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.04 }} className="group">
                  <Link to={`/cases/${a.caseId}?tab=clock`} className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-x-4 gap-y-2 py-4 transition-colors hover:bg-s1 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:px-2">
                    <div className="mono pt-0.5">
                      <div className={cx('text-lg font-medium leading-none', TONE_TEXT[meta.tone])}>{hhmm(d.dueAt!)}</div>
                      <div className="mt-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-4">{d.shortLabel}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium text-ink">{d.label}</span>
                        <Ident dim className="text-[11.5px]">{a.caseId}</Ident>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-2">{a.caseTitle}</div>
                      <div className="mt-2 space-y-0.5 text-[11.5px] text-ink-3">
                        <div>
                          Start: {d.start?.label.toLowerCase()} <span className="mono text-ink-2">{d.start ? short(d.start.at) : '--'}</span>
                          <span className="text-ink-4"> · </span>Owner: <span className="text-ink-2">{name(a.ownerId)}</span>
                        </div>
                        <div className="truncate" title={d.start?.source}>
                          Source: {d.start?.source}
                        </div>
                      </div>
                    </div>
                    <div className="col-start-2 flex items-center gap-3 sm:col-start-3 sm:flex-col sm:items-end sm:gap-2">
                      <DeadlineBadge status={d.status} size="sm" />
                      <span className={cx('text-xs', TONE_TEXT[meta.tone])}>
                        <Countdown dueAt={d.dueAt!} size="sm" seconds={false} />
                      </span>
                    </div>
                  </Link>
                </motion.li>
              )
            })}
          </ol>
        </div>
      ))}
    </div>
  )
}

function Attention({ items }: { items: OverviewResponse['attention'] }) {
  if (items.length === 0) {
    return <EmptyState compact title="Nothing blocked" why="No data-quality errors, pending reviews or blocking evidence gaps across open cases." />
  }
  const icon = { gap: FileWarning, review: Eye, quality: AlertTriangle, blocked: CircleDashed }
  return (
    <ul className="divide-y divide-line">
      {items.map((a, i) => {
        const Icon = icon[a.kind]
        return (
          <motion.li key={`${a.caseId}-${a.kind}-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + i * 0.04 }}>
            <Link to={`/cases/${a.caseId}?tab=${a.tab}`} className="flex gap-3 py-3.5 transition-colors hover:bg-s2 sm:px-2">
              <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', a.severity === 'critical' ? 'text-red' : a.severity === 'watch' ? 'text-amber' : 'text-ink-3')} />
              <div className="min-w-0">
                <div className="text-sm text-ink">{a.title}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">{a.detail}</div>
                <Ident dim className="mt-1 block text-[11px]">
                  {a.caseId}
                </Ident>
              </div>
            </Link>
          </motion.li>
        )
      })}
    </ul>
  )
}

export function Overview() {
  const q = useOverview()
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const data = q.data
  return (
    <div className="min-w-0">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <motion.div {...fade(0)} className="min-w-0">
          <div className="micro mb-3">Article 14 reporting operations</div>
          <h1 className="text-2xl font-medium text-ink sm:text-3xl">What requires attention right now</h1>
        </motion.div>
        <motion.div {...fade(1)}>
          <Clockface />
        </motion.div>
      </header>

      <div className="mt-8">{data ? <Counts counts={data.counts} /> : <Skeleton className="h-28" />}</div>

      <div className="mt-8">
        {!data ? (
          <Skeleton className="h-[420px] rounded-xl" />
        ) : data.activeClock ? (
          <ActiveClock data={data.activeClock} />
        ) : (
          <div className="panel px-8">
            <EmptyState icon={Timer} title="No active clocks" why="No awareness event has established a reporting clock for the current cases. Clocks start when awareness of an actively exploited vulnerability is recorded against a criterion." action={<Link to="/cases" className="text-sm text-ink hover:text-amber">Review cases →</Link>} />
          </div>
        )}
      </div>

      <div className="mt-14 grid min-w-0 gap-12 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section aria-labelledby="agenda-h" className="min-w-0">
          <div className="mb-5 flex items-baseline justify-between gap-3">
            <div>
              <div className="micro mb-1.5">Deadline intelligence</div>
              <h2 id="agenda-h" className="text-lg font-medium text-ink">
                Running obligations, in the order they fall due
              </h2>
            </div>
            <Link to="/clocks" className="shrink-0 text-xs text-ink-3 hover:text-ink">
              All clocks →
            </Link>
          </div>
          {data ? <Agenda agenda={data.agenda} nowIso={data.now} /> : <Skeleton className="h-64" />}
        </section>

        <div className="min-w-0 space-y-12">
          <section aria-labelledby="attention-h">
            <div className="micro mb-1.5">Attention required</div>
            <h2 id="attention-h" className="mb-3 text-lg font-medium text-ink">
              Blocked, awaiting review, or missing evidence
            </h2>
            {data ? <Attention items={data.attention} /> : <Skeleton className="h-48" />}
          </section>
          <section aria-labelledby="recent-h">
            <div className="mb-3 flex items-baseline justify-between">
              <div>
                <div className="micro mb-1.5">Evidence ledger</div>
                <h2 id="recent-h" className="text-lg font-medium text-ink">
                  Latest entries
                </h2>
              </div>
              <Link to="/ledger" className="text-xs text-ink-3 hover:text-ink">
                Audit ledger →
              </Link>
            </div>
            {data ? (
              <ol className="relative space-y-0 border-l border-line-strong pl-5">
                {[...data.recent].reverse().map((e) => (
                  <li key={e.seq} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-[23.5px] top-1.5 h-2 w-2 rounded-full border border-line-bright bg-s1" />
                    <div className="flex items-baseline justify-between gap-3">
                      <Ident className="text-[11.5px]">{e.id}</Ident>
                      <span className="mono text-[11px] text-ink-3">{short(e.at)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-2">{e.summary}</div>
                    <div className="mono mt-1 truncate text-[10.5px] text-ink-4" title={e.hash}>
                      {e.hash.slice(0, 20)}…
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <Skeleton className="h-48" />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
