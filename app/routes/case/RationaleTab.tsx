import { Fragment } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { ArrowRight, Check, CircleDashed, Minus, X } from 'lucide-react'
import type { ExplanationState } from '../../../lib/engine/analyze.ts'
import { eventEvidenceIds, determinationEvidenceIds } from '../../../lib/engine/bundle.ts'
import { short } from '../../../lib/client/format.ts'
import { cx } from '../../../components/ui/primitives.tsx'
import { EvidenceChips, SectionTitle, useCaseCtx } from './shared.tsx'

const MARK: Record<ExplanationState, { icon: typeof Check; cls: string; label: string }> = {
  established: { icon: Check, cls: 'border-green-line bg-green-soft text-green', label: 'Established' },
  not_established: { icon: X, cls: 'border-line-bright bg-s3 text-ink-2', label: 'Not established' },
  not_applicable: { icon: Minus, cls: 'border-line-strong bg-s2 text-ink-3', label: 'Not applicable' },
  pending: { icon: CircleDashed, cls: 'border-dashed border-amber bg-amber-soft text-amber', label: 'Pending' },
}

/** The evidence chain for the current decision: Evidence → Awareness → Determination → Decision → Report. */
function Chain() {
  const { data } = useCaseCtx()
  const b = data.bundle
  const d = data.analysis.decision
  const ea = data.analysis.clock.exploitationAwareness ?? data.analysis.clock.vulnerabilityAwareness
  const det = Object.values(data.analysis.determinations).find((x) => x.result === 'AFFECTED') ?? Object.values(data.analysis.determinations)[0]
  const ev = ea ? eventEvidenceIds(b, ea.original)[0] : det ? determinationEvidenceIds(b, det)[0] : undefined
  const report = d ? b.reports.filter((r) => r.decisionId === d.id).at(-1) : undefined
  const nodes = [
    ev && { id: ev, kind: 'Evidence', detail: b.evidence.find((e) => e.id === ev)?.title ?? '', href: `/evidence/${ev}`, violet: true },
    ea && { id: ea.original.id, kind: 'Awareness event', detail: `${ea.type.replace(/_/g, ' ').toLowerCase()} · ${short(ea.occurredAt)}`, href: '?tab=clock' },
    det && { id: det.id, kind: 'Determination', detail: `${b.products.find((p) => p.id === det.productId)?.name}: ${det.result.replace(/_/g, ' ').toLowerCase()}`, href: '?tab=products' },
    d && { id: d.id, kind: 'Decision', detail: d.outcome === 'REPORT' ? 'Report' : 'Reporting not required', href: '?tab=determination' },
    report && { id: report.id, kind: 'Report', detail: `${report.title} · ${report.stage.replace(/_/g, ' ').toLowerCase()}`, href: `/reports/${report.id}` },
  ].filter(Boolean) as Array<{ id: string; kind: string; detail: string; href: string; violet?: boolean }>
  if (nodes.length < 2) return null
  return (
    <section aria-label="Evidence chain" className="min-w-0">
      <SectionTitle eyebrow="Evidence chain" title="From the evidence to the record that rests on it" />
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-stretch">
        {nodes.map((n, i) => (
          <Fragment key={n.id}>
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="min-w-0 flex-1">
              <Link to={n.href} className={cx('block h-full rounded-lg border px-4 py-3 transition-colors hover:bg-s2', n.violet ? 'border-violet-line' : 'border-line-strong')}>
                <div className="micro">{n.kind}</div>
                <div className={cx('ident mt-1 text-sm', n.violet ? 'text-violet' : 'text-ink')}>{n.id}</div>
                <div className="mt-1 line-clamp-2 text-xs text-ink-3">{n.detail}</div>
              </Link>
            </motion.div>
            {i < nodes.length - 1 && (
              <div className="flex items-center justify-center text-ink-4 lg:px-0.5" aria-hidden>
                <ArrowRight className="h-4 w-4 rotate-90 lg:rotate-0" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </section>
  )
}

export function RationaleTab() {
  const { data, setTab, name } = useCaseCtx()
  const steps = data.analysis.explanation
  const d = data.analysis.decision
  return (
    <div className="min-w-0 space-y-12">
      <section className="min-w-0">
        <div className="micro mb-2">Explainability</div>
        <h2 className="text-2xl font-medium uppercase tracking-[0.03em] text-ink sm:text-3xl">Why this decision?</h2>
        <p className="mt-3 max-w-2xl text-sm text-ink-2">
          {d ? (
            <>
              {d.id}, recorded by {name(d.analystId)} on {short(d.decidedAt)}: {d.outcome === 'REPORT' ? 'report' : 'reporting not required'}. Each step below is derived from the record and links to what it rests on.
            </>
          ) : (
            'No decision has been recorded yet. The chain shows how far the record currently goes.'
          )}
        </p>
      </section>

      <ol className="relative min-w-0 max-w-4xl">
        {steps.map((s, i) => {
          const m = MARK[s.state]
          const Icon = m.icon
          return (
            <motion.li key={s.n} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 + i * 0.07, duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="relative flex min-w-0 gap-5 pb-8 last:pb-0">
              {i < steps.length - 1 && <span className="absolute bottom-0 left-[15px] top-9 w-px bg-line-strong" aria-hidden />}
              <span className={cx('relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border', m.cls)}>
                <Icon className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="mono text-xs text-ink-4">{s.n}.</span>
                  <h3 className="text-md font-medium text-ink">{s.title}</h3>
                  <span className={cx('micro', s.state === 'established' ? 'text-green' : s.state === 'pending' ? 'text-amber' : 'text-ink-3')}>{m.label}</span>
                </div>
                <p className="mt-1.5 text-sm text-ink-2 [overflow-wrap:anywhere]">{s.statement}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                  {s.evidenceIds.length > 0 && <EvidenceChips ids={s.evidenceIds.slice(0, 6)} />}
                  {s.refs.length > 0 && <span className="ident text-[11px] text-ink-4">{s.refs.slice(0, 4).join(' · ')}</span>}
                  <button type="button" onClick={() => setTab(s.tab)} className="text-xs text-ink-3 hover:text-amber">
                    Open →
                  </button>
                </div>
              </div>
            </motion.li>
          )
        })}
      </ol>

      <Chain />

      {d && (
        <section aria-label="Recorded rationale" className="panel max-w-4xl p-5 sm:p-6">
          <div className="micro mb-2">Recorded rationale · {d.id}</div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{d.rationale}</p>
          <div className="mt-4">
            <EvidenceChips ids={d.evidenceIds} />
          </div>
        </section>
      )}
    </div>
  )
}
