import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { FileText } from 'lucide-react'
import type { ReportKind, SubmissionStage } from '../../types/domain.ts'
import { REPORT_KIND_LABELS } from '../../lib/engine/report.ts'
import { useReports, useUsers } from '../../lib/client/queries.ts'
import { short } from '../../lib/client/format.ts'
import { Hash, Ident, PageHeader, Select, SkeletonPage } from '../../components/ui/primitives.tsx'
import { STAGE, StageBadge } from '../../components/ui/status.tsx'
import { EmptyState, ErrorState } from '../../components/ui/feedback.tsx'

export function Reports() {
  const q = useReports()
  const users = useUsers()
  const [kind, setKind] = useState<ReportKind | 'all'>('all')
  const [stage, setStage] = useState<SubmissionStage | 'all'>('all')
  const name = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id
  const rows = useMemo(
    () =>
      [...(q.data ?? [])]
        .filter((r) => (kind === 'all' || r.kind === kind) && (stage === 'all' || r.stage === stage))
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)),
    [q.data, kind, stage],
  )
  const inReview = (q.data ?? []).filter((r) => r.stage === 'INTERNAL_REVIEW').length
  const ready = (q.data ?? []).filter((r) => r.stage === 'READY').length
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <SkeletonPage />
  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Record"
        title="Reports"
        description="Every report version ever generated. Versions are frozen snapshots and are never replaced. Submission is simulated: nothing leaves NEXUS."
      />
      <div className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-y border-line py-4 text-sm">
        <span>
          <span className="mono text-xl text-ink">{q.data.length}</span> <span className="text-ink-3">versions</span>
        </span>
        <span>
          <span className="mono text-xl text-blue">{inReview}</span> <span className="text-ink-3">awaiting internal review</span>
        </span>
        <span>
          <span className="mono text-xl text-amber">{ready}</span> <span className="text-ink-3">ready for submission</span>
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as ReportKind | 'all')} className="w-auto" aria-label="Kind">
            <option value="all">All kinds</option>
            {Object.entries(REPORT_KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={stage} onChange={(e) => setStage(e.target.value as SubmissionStage | 'all')} className="w-auto" aria-label="Stage">
            <option value="all">All stages</option>
            {Object.entries(STAGE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={FileText} title="No reports" why="Report versions are generated from a case's Report tab. A decision not to report generates its decision record automatically." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-line bg-s1">
              <tr>
                {['Report', 'Case', 'Stage', 'Generated', 'By', 'Case state', 'Rule set', 'Content hash'].map((h) => (
                  <th key={h} className="micro px-3 py-2.5 font-normal first:pl-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 15) * 0.02 }} className="row-line align-top">
                  <td className="px-3 py-3 pl-4">
                    <Link to={`/reports/${r.id}`} className="text-sm text-ink hover:text-amber">
                      {REPORT_KIND_LABELS[r.kind]} <span className="mono text-ink-2">v{r.major}.{r.minor}</span>
                    </Link>
                    <Ident dim className="block text-[11px]">
                      {r.id}
                    </Ident>
                  </td>
                  <td className="px-3 py-3">
                    <Link to={`/cases/${r.caseId}?tab=report`} className="ident text-[12px] text-ink-2 hover:text-amber">
                      {r.caseId}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <StageBadge stage={r.stage} size="sm" />
                    {r.submissionReference && <div className="mono mt-1 text-[10.5px] text-violet">{r.submissionReference}</div>}
                  </td>
                  <td className="mono px-3 py-3 text-xs text-ink-2">{short(r.generatedAt)}</td>
                  <td className="px-3 py-3 text-xs text-ink-2">{name(r.generatedBy)}</td>
                  <td className="px-3 py-3 text-xs text-ink-3">{r.caseStatus.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="mono px-3 py-3 text-xs text-ink-3">{r.ruleSetVersion}</td>
                  <td className="px-3 py-3">
                    <Hash value={r.contentHash} length={8} />
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
