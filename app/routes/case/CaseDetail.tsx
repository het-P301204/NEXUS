import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, ChevronDown, Copy, Download, FileJson, Lock, RotateCcw, ShieldAlert, ShieldCheck, ShieldQuestion, UserRoundCog, XCircle } from 'lucide-react'
import type { CaseDetailResponse } from '../../../types/api.ts'
import { api, download } from '../../../lib/client/api.ts'
import { useAction, useCase, useUsers } from '../../../lib/client/queries.ts'
import { useSession } from '../../../lib/client/session.tsx'
import { short } from '../../../lib/client/format.ts'
import { Button, Field, Ident, Select, SkeletonPage, TextArea, cx } from '../../../components/ui/primitives.tsx'
import { CaseStatusBadge, ExploitationBadge, HealthBadge, SeverityMark } from '../../../components/ui/status.tsx'
import { ErrorState } from '../../../components/ui/feedback.tsx'
import { Modal, useToast } from '../../../components/ui/overlay.tsx'
import { Popover } from '../../../components/ui/popover.tsx'
import { Tabs } from '../../../components/ui/tabs.tsx'
import { DeadlineStrip } from '../../../components/clock/Deadlines.tsx'
import { rememberRecent } from '../../preferences.ts'
import { CaseContext, useCaseValue } from './shared.tsx'
import { OverviewTab } from './OverviewTab.tsx'
import { DeterminationTab } from './DeterminationTab.tsx'
import { ClockTab } from './ClockTab.tsx'
import { ProductsTab } from './ProductsTab.tsx'
import { EvidenceTab } from './EvidenceTab.tsx'
import { RationaleTab } from './RationaleTab.tsx'
import { CaseLedgerTab } from './CaseLedgerTab.tsx'
import { ReportTab } from './ReportTab.tsx'

type TabId = 'overview' | 'determination' | 'clock' | 'products' | 'evidence' | 'rationale' | 'ledger' | 'report'

/** The large state indicator: the one answer the case exists to produce. */
function StateIndicator({ data }: { data: CaseDetailResponse }) {
  const { analysis } = data
  const s = analysis.status
  const decision = analysis.decision
  let label: string
  let tone: 'red' | 'green' | 'amber' | 'neutral'
  let Icon = ShieldQuestion
  let sub: string
  if (s === 'REPORTABLE' || s === 'SUBMITTED' || (s === 'CLOSED' && decision?.outcome === 'REPORT')) {
    label = 'Reportable'
    tone = 'red'
    Icon = ShieldAlert
    sub = s === 'SUBMITTED' ? 'Early warning submitted (simulated)' : s === 'CLOSED' ? 'Closed after reporting' : `Decision ${decision?.id} · ${decision ? short(decision.decidedAt) : ''}`
  } else if (s === 'NOT_REPORTABLE' || (s === 'CLOSED' && decision?.outcome === 'DO_NOT_REPORT')) {
    label = 'Not reportable'
    tone = 'neutral'
    Icon = ShieldCheck
    sub =
      s === 'NOT_REPORTABLE' && analysis.decisionStanding && !analysis.decisionStanding.inForce
        ? `Decision ${decision?.id} · not in force until its decision record is approved; clocks keep running`
        : `Decision ${decision?.id} · reporting not required`
  } else {
    label = 'Under investigation'
    tone = 'amber'
    sub = analysis.decisionStanding?.staleBy
      ? `Decision ${decision?.id} overtaken by ${analysis.decisionStanding.staleBy}; record a new decision`
      : analysis.suggestion.outcome === 'REPORT'
        ? 'Rule evaluation suggests REPORT; no decision recorded'
        : analysis.suggestion.outcome === 'DO_NOT_REPORT'
          ? 'Rule evaluation suggests not required; no decision recorded'
          : 'Determination pending'
  }
  const text = { red: 'text-red', green: 'text-green', amber: 'text-amber', neutral: 'text-ink' }[tone]
  return (
    <div className="min-w-0 lg:text-right">
      <div className="micro mb-2">Reportability</div>
      <div className={cx('flex items-center gap-3 lg:justify-end', text)}>
        <Icon className="h-6 w-6 shrink-0" strokeWidth={1.6} />
        <span className="text-2xl font-medium uppercase tracking-[0.04em] sm:text-3xl">{label}</span>
      </div>
      <div className="mt-2 text-xs text-ink-3">{sub}</div>
    </div>
  )
}

function CaseActions({ data }: { data: CaseDetailResponse }) {
  const { can } = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const users = useUsers()
  const c = data.bundle.case
  const [dialog, setDialog] = useState<null | 'close' | 'reopen' | 'archive' | 'assign'>(null)
  const [reason, setReason] = useState('')
  const [owner, setOwner] = useState(c.ownerId)
  const [error, setError] = useState<unknown>(null)
  const lifecycle = useAction((body: { action: string; reason: string }) => api(`/api/cases/${c.id}/lifecycle`, { body }))
  const assign = useAction((ownerId: string) => api(`/api/cases/${c.id}/assign`, { body: { ownerId } }))
  const duplicate = useAction(() => api<{ id: string }>(`/api/cases/${c.id}/duplicate`, { method: 'POST' }))
  const open = (d: typeof dialog) => {
    setReason('')
    setError(null)
    setOwner(c.ownerId)
    setDialog(d)
  }
  const run = async () => {
    setError(null)
    try {
      if (dialog === 'assign') {
        await assign.mutateAsync(owner)
        toast({ tone: 'success', title: 'Ownership transferred', body: `${c.id} now belongs to ${users.data?.find((u) => u.id === owner)?.name}.` })
      } else if (dialog) {
        await lifecycle.mutateAsync({ action: dialog, reason })
        toast({ tone: 'success', title: `${c.id} ${dialog === 'reopen' ? 'reopened' : dialog === 'close' ? 'closed' : 'archived'}` })
      }
      setDialog(null)
    } catch (e) {
      setError(e)
    }
  }
  const item = (label: string, Icon: typeof Copy, onClick: () => void, enabled = true, hint?: string) => (
    <button type="button" disabled={!enabled} onClick={onClick} title={hint} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-ink-2 transition-colors hover:bg-s3 hover:text-ink disabled:pointer-events-none disabled:opacity-40">
      <Icon className="h-3.5 w-3.5" />
      {label}
      {!enabled && <Lock className="ml-auto h-3 w-3 text-ink-4" />}
    </button>
  )
  const isOpen = c.lifecycle === 'open'
  return (
    <>
      <Popover
        label="Case actions"
        width="w-64"
        trigger={({ toggle, open: o }) => (
          <Button size="sm" onClick={toggle} aria-expanded={o}>
            Case actions <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        )}
      >
        {(close) => (
          <div className="p-1.5">
            {item('Export case record (JSON)', Download, () => { close(); void download(`/api/cases/${c.id}/export`, `${c.id}.json`) })}
            {item('Export VEX (OpenVEX-style)', FileJson, () => { close(); void download(`/api/cases/${c.id}/vex`, `${c.id}.openvex.json`) })}
            <div className="my-1 h-px bg-line" />
            {item('Duplicate case', Copy, async () => {
              close()
              try {
                const r = await duplicate.mutateAsync(undefined)
                toast({ tone: 'success', title: `${r.id} created`, body: `Duplicated from ${c.id}; history stays with the original.` })
                navigate(`/cases/${r.id}`)
              } catch (e) {
                toast({ tone: 'error', title: 'Case not duplicated', body: e instanceof Error ? e.message : String(e) })
              }
            }, can('case.create'))}
            {item('Assign / transfer ownership', UserRoundCog, () => { close(); open('assign') }, can('case.assign') && isOpen, 'Requires case.assign')}
            {item('Close case', XCircle, () => { close(); open('close') }, can('case.close') && isOpen, 'Requires PSIRT Lead or Security Manager')}
            {item('Reopen case', RotateCcw, () => { close(); open('reopen') }, can('case.reopen') && !isOpen, 'Reopening is controlled: Security Manager only')}
            {item('Archive case', Archive, () => { close(); open('archive') }, can('case.archive') && isOpen)}
          </div>
        )}
      </Popover>
      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        eyebrow={c.id}
        title={dialog === 'assign' ? 'Transfer ownership' : dialog === 'reopen' ? 'Reopen case' : dialog === 'archive' ? 'Archive case' : 'Close case'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant={dialog === 'close' || dialog === 'archive' ? 'danger' : 'primary'} onClick={() => void run()} busy={lifecycle.isPending || assign.isPending} disabled={dialog !== 'assign' && reason.trim().length < 10}>
              {dialog === 'assign' ? 'Transfer ownership' : dialog === 'reopen' ? 'Reopen case' : dialog === 'archive' ? 'Archive case' : 'Close case'}
            </Button>
          </>
        }
      >
        {dialog === 'assign' ? (
          <Field label="New owner" hint="The previous owner stays on the case as a collaborator. The transfer is recorded in the ledger.">
            {(id) => (
              <Select id={id} value={owner} onChange={(e) => setOwner(e.target.value)}>
                {(users.data ?? []).filter((u) => u.role !== 'read_only').map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              {dialog === 'close'
                ? 'A case with a running reporting clock cannot be closed. The server checks this; the reason is recorded in the ledger.'
                : dialog === 'reopen'
                  ? 'Reopening is a controlled action. History is not reset: the case continues from its existing record.'
                  : 'Archiving removes the case from the working list. It stays readable and its ledger entries remain.'}
            </p>
            <Field label="Reason" required hint="At least 10 characters. Recorded verbatim in the audit ledger.">
              {(id) => <TextArea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />}
            </Field>
          </div>
        )}
        {error !== null && <ErrorState error={error} className="mt-4" />}
      </Modal>
    </>
  )
}

export function CaseDetail() {
  const { id = '' } = useParams()
  const q = useCase(id)
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabId | null) ?? 'overview'
  const { can } = useSession()
  const setTab = (t: string, extra: Record<string, string> = {}) => {
    setParams({ tab: t, ...extra }, { replace: false })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const ctx = useCaseValue(q.data ?? ({} as CaseDetailResponse), setTab, !!q.data?.canWrite)
  const recentLabel = q.data ? `${q.data.bundle.case.id} · ${q.data.bundle.vulnerability.cve ?? q.data.bundle.vulnerability.id}` : null
  useEffect(() => {
    if (recentLabel) rememberRecent({ id: `case-${id}`, label: recentLabel, href: `/cases/${id}` })
  }, [id, recentLabel])

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <SkeletonPage />
  const data = q.data
  const { bundle, analysis } = data
  const c = bundle.case
  const v = bundle.vulnerability

  const gaps = analysis.completeness.missing.length
  const qualityErrors = analysis.quality.filter((x) => x.severity === 'error').length
  const tabs = [
    { id: 'overview' as const, label: 'Overview', count: data.changes.items.length ? `+${data.changes.items.length}` : undefined },
    { id: 'determination' as const, label: 'Determination', alert: !analysis.decision && analysis.suggestion.outcome !== 'PENDING' },
    { id: 'clock' as const, label: 'Clock of Record' },
    { id: 'products' as const, label: 'Affected Products', count: bundle.products.length },
    { id: 'evidence' as const, label: 'Evidence', count: `${analysis.completeness.satisfied}/${analysis.completeness.applicable}`, alert: gaps > 0 },
    { id: 'rationale' as const, label: 'Decision Rationale' },
    { id: 'ledger' as const, label: 'Audit Ledger', count: data.ledger.length },
    { id: 'report' as const, label: 'Report', count: bundle.reports.length || undefined, alert: analysis.pendingReviews.length > 0 },
  ]

  return (
    <CaseContext.Provider value={ctx}>
      <div className="min-w-0">
        <header className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Ident className="text-[12.5px]">{c.id}</Ident>
              <span className="text-ink-4">·</span>
              <span className="text-xs text-ink-3">opened {short(c.createdAt)}</span>
              <CaseStatusBadge status={analysis.status} size="sm" />
              <span title={analysis.health.reason}>
                <HealthBadge state={analysis.health.state} size="sm" />
              </span>
              {c.lifecycle !== 'open' && <span className="micro text-ink-3">{c.lifecycle}</span>}
            </div>
            <h1 className="ident mt-4 text-3xl font-medium text-ink sm:text-4xl">{v.cve ?? v.id}</h1>
            <p className="mt-2 max-w-3xl text-md text-ink-2">{c.title}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <SeverityMark severity={v.severity} />
              {v.cvssScore !== null && <span className="mono text-xs text-ink-2">CVSS {v.cvssScore.toFixed(1)}</span>}
              <ExploitationBadge status={v.exploitation} size="sm" />
              <span className="text-xs text-ink-3">
                {bundle.products.map((p) => `${p.name} ${p.version}`).join(' · ')}
              </span>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-5 lg:items-end">
            <StateIndicator data={data} />
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {can('report.generate') && data.canWrite && (
                <Button size="sm" onClick={() => setTab('report', { generate: '1' })}>
                  Generate report
                </Button>
              )}
              <CaseActions data={data} />
            </div>
          </div>
        </header>

        {(qualityErrors > 0 || !data.canWrite) && (
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            {qualityErrors > 0 && (
              <button type="button" onClick={() => setTab('overview')} className="rounded-md border border-red-line bg-red-soft px-2.5 py-1 text-red">
                {qualityErrors} data-quality error{qualityErrors > 1 ? 's' : ''}: correct the record before relying on it
              </button>
            )}
            {!data.canWrite && (
              <span className="rounded-md border border-line-strong bg-s2 px-2.5 py-1 text-ink-3">
                {c.lifecycle !== 'open' ? `This case is ${c.lifecycle}: read only.` : 'Read only: you are not the owner or a collaborator, or your role cannot change this case.'}
              </span>
            )}
          </div>
        )}

        <div className="mt-8">
          <DeadlineStrip deadlines={analysis.deadlines} onOpenClock={() => setTab('clock')} />
        </div>

        <div className="mt-10">
          <Tabs tabs={tabs} value={tab} onChange={(t) => setTab(t)} label="Case sections" />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="min-w-0 pt-8" role="tabpanel" aria-label={tabs.find((t) => t.id === tab)?.label}>
            {tab === 'overview' && <OverviewTab />}
            {tab === 'determination' && <DeterminationTab />}
            {tab === 'clock' && <ClockTab />}
            {tab === 'products' && <ProductsTab />}
            {tab === 'evidence' && <EvidenceTab />}
            {tab === 'rationale' && <RationaleTab />}
            {tab === 'ledger' && <CaseLedgerTab />}
            {tab === 'report' && <ReportTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </CaseContext.Provider>
  )
}
