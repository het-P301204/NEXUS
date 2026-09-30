import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowRight, FilePlus2, FileText } from 'lucide-react'
import type { ReportKind } from '../../../types/domain.ts'
import { REPORT_KIND_LABELS } from '../../../lib/engine/report.ts'
import { api } from '../../../lib/client/api.ts'
import { useAction } from '../../../lib/client/queries.ts'
import { useSession } from '../../../lib/client/session.tsx'
import { short } from '../../../lib/client/format.ts'
import { Button, Field, Hash, Ident, Select, cx } from '../../../components/ui/primitives.tsx'
import { StageBadge } from '../../../components/ui/status.tsx'
import { EmptyState, ErrorState, Notice } from '../../../components/ui/feedback.tsx'
import { Modal, useToast } from '../../../components/ui/overlay.tsx'
import { ReportActions, Stepper } from '../../../components/reports/Workflow.tsx'
import { SectionTitle, useCaseCtx } from './shared.tsx'

const KINDS: ReportKind[] = ['EARLY_WARNING', 'VULNERABILITY_NOTIFICATION', 'FINAL_REPORT', 'DECISION_RECORD']

export function ReportTab() {
  const { data, name, writable } = useCaseCtx()
  const { can } = useSession()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(params.get('generate') === '1')
  const decision = data.analysis.decision
  const suggestedKind: ReportKind = decision?.outcome === 'DO_NOT_REPORT' ? 'DECISION_RECORD' : !data.analysis.clock.earlyWarningSubmitted ? 'EARLY_WARNING' : !data.analysis.clock.notificationSubmitted ? 'VULNERABILITY_NOTIFICATION' : 'FINAL_REPORT'
  const [kind, setKind] = useState<ReportKind>(suggestedKind)
  const [error, setError] = useState<unknown>(null)
  const generate = useAction((k: ReportKind) => api<{ id: string; version: string }>(`/api/cases/${data.bundle.case.id}/reports`, { body: { kind: k } }))
  const reports = data.bundle.reports
  const canGenerate = can('report.generate') && writable
  const close = () => {
    setOpen(false)
    if (params.get('generate')) setParams({ tab: 'report' })
  }

  return (
    <div className="min-w-0 space-y-12">
      <section className="flex min-w-0 flex-wrap items-end justify-between gap-6">
        <div className="min-w-0 max-w-2xl">
          <div className="micro mb-2">Reports</div>
          <h2 className="text-lg font-medium text-ink">Versioned, frozen snapshots of the case record</h2>
          <p className="mt-2 text-sm text-ink-3">
            A report version is never replaced. Regenerating adds the next version: a minor version when the decision and case status are unchanged, a major version when either changed. Each version keeps who generated it, when, the case state, the rule-set version and a hash of the evidence state.
          </p>
        </div>
        {canGenerate && (
          <Button variant="primary" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Generate report
          </Button>
        )}
      </section>

      {reports.length === 0 ? (
        <EmptyState icon={FileText} title="No reports" why={decision ? 'Generate the first report version from the current record.' : 'Reports are usually generated once a reportability decision is recorded. A decision not to report produces its own decision record automatically.'} action={canGenerate ? <Button onClick={() => setOpen(true)}>Generate report</Button> : undefined} />
      ) : (
        KINDS.filter((k) => reports.some((r) => r.kind === k)).map((k) => {
          const versions = reports.filter((r) => r.kind === k).sort((a, b) => b.major - a.major || b.minor - a.minor)
          const latest = versions[0]!
          const decisionAnalyst = data.bundle.decisions.find((d) => d.id === latest.decisionId)?.analystId ?? null
          return (
            <section key={k} className="min-w-0" aria-label={REPORT_KIND_LABELS[k]}>
              <SectionTitle eyebrow={REPORT_KIND_LABELS[k]} title={`${latest.title}`} action={<StageBadge stage={latest.stage} />} />
              <div className="panel min-w-0 p-5 sm:p-6">
                <Stepper stage={latest.stage} kind={k} />
                <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                  <ReportActions report={latest} reviews={data.bundle.reviews} transitions={data.transitions} decisionAnalystId={decisionAnalyst} canWriteCase={writable} latest />
                  <Link to={`/reports/${latest.id}`} className="inline-flex items-center gap-1.5 text-sm text-ink hover:text-amber">
                    Preview report <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
                {latest.submissionReference && (
                  <Notice tone="violet" className="mt-5" title="Simulated submission">
                    Reference <span className="mono">{latest.submissionReference}</span>. Nothing left NEXUS.
                  </Notice>
                )}
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line">
                        {['Version', 'Stage', 'Generated', 'By', 'Case state', 'Rule set', 'Evidence state', 'Content hash'].map((h) => (
                          <th key={h} className="micro py-2 pr-3 font-normal">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v) => (
                        <tr key={v.id} className={cx('border-b border-line last:border-0', v.id !== latest.id && 'text-ink-3')}>
                          <td className="py-2.5 pr-3">
                            <Link to={`/reports/${v.id}`} className="mono text-sm text-ink hover:text-amber">
                              v{v.major}.{v.minor}
                            </Link>
                            <Ident dim className="ml-2 text-[11px]">
                              {v.id}
                            </Ident>
                          </td>
                          <td className="py-2.5 pr-3">
                            <StageBadge stage={v.stage} size="sm" />
                          </td>
                          <td className="mono py-2.5 pr-3 text-xs">{short(v.generatedAt)}</td>
                          <td className="py-2.5 pr-3 text-xs">{name(v.generatedBy)}</td>
                          <td className="py-2.5 pr-3 text-xs">{v.caseStatus.replace(/_/g, ' ').toLowerCase()}</td>
                          <td className="mono py-2.5 pr-3 text-xs">{v.ruleSetVersion}</td>
                          <td className="py-2.5 pr-3 text-xs">
                            {v.evidenceCount} · <span className="mono">{v.evidenceStateHash.slice(0, 8)}</span>
                          </td>
                          <td className="py-2.5">
                            <Hash value={v.contentHash} length={8} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.bundle.reviews.some((r) => versions.some((v) => v.id === r.targetId)) && (
                  <div className="mt-6 border-t border-line pt-4">
                    <div className="micro mb-2">Reviews</div>
                    <ul className="space-y-2">
                      {data.bundle.reviews
                        .filter((r) => versions.some((v) => v.id === r.targetId))
                        .map((r) => (
                          <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 text-xs">
                            <span className={cx('micro', r.action === 'APPROVE' ? 'text-green' : r.action === 'COMMENT' ? 'text-ink-3' : 'text-amber')}>{r.action.replace(/_/g, ' ')}</span>
                            <span className="text-ink">{name(r.reviewerId)}</span>
                            <Ident dim className="text-[11px]">
                              {r.targetId}
                            </Ident>
                            <span className="mono text-ink-3">{short(r.createdAt)}</span>
                            {r.comment && <span className="w-full text-ink-2">{r.comment}</span>}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )
        })
      )}

      <Modal
        open={open}
        onClose={close}
        eyebrow={data.bundle.case.id}
        title="Generate report version"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={generate.isPending}
              onClick={async () => {
                setError(null)
                try {
                  const r = await generate.mutateAsync(kind)
                  toast({ tone: 'success', title: `${REPORT_KIND_LABELS[kind]} v${r.version} generated`, body: `${r.id} is a draft. Send it for internal review when ready.` })
                  close()
                } catch (e) {
                  setError(e)
                }
              }}
            >
              Generate
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Report" hint={kind === 'FINAL_REPORT' && !data.analysis.clock.measureAvailable ? 'No corrective measure is recorded yet. A final report can be drafted but not submitted.' : undefined}>
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {REPORT_KIND_LABELS[k]}
                    {k === suggestedKind ? ' (next due)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {!decision && kind !== 'DECISION_RECORD' && <Notice tone="amber">No decision to report is recorded. You can draft the report, but it cannot be submitted until one is.</Notice>}
          <p className="text-xs text-ink-3">The report is built from the case record as it stands now, as plain text sections: executive summary, case information, vulnerability, affected products, affectedness determination, exploitation assessment, awareness criterion, Clock of Record, reporting determination, deadline status, evidence register, decision rationale and audit references.</p>
          {error !== null && <ErrorState error={error} />}
        </div>
      </Modal>
    </div>
  )
}
