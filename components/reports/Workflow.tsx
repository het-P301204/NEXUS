import { useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Check, Send } from 'lucide-react'
import type { ReportTransition, ReportVersion, Review, ReviewAction, RoleId, SubmissionStage } from '../../types/domain.ts'
import type { ReportSummary } from '../../lib/engine/bundle.ts'
import { APPROVAL_POLICY, ROLES, can } from '../../lib/rbac.ts'
import { api } from '../../lib/client/api.ts'
import { useAction } from '../../lib/client/queries.ts'
import { useSession } from '../../lib/client/session.tsx'
import { Button, Field, TextArea, cx } from '../ui/primitives.tsx'
import { ErrorState, Notice } from '../ui/feedback.tsx'
import { Modal, useToast } from '../ui/overlay.tsx'

export const STAGES: SubmissionStage[] = ['DRAFT', 'INTERNAL_REVIEW', 'APPROVED', 'READY', 'SUBMITTED', 'ACKNOWLEDGED', 'CLOSED']
const STAGE_LABEL: Record<SubmissionStage, string> = {
  DRAFT: 'Draft',
  INTERNAL_REVIEW: 'Internal review',
  APPROVED: 'Approved',
  READY: 'Ready for submission',
  SUBMITTED: 'Submitted',
  ACKNOWLEDGED: 'Acknowledged',
  CLOSED: 'Closed',
}

/** The submission workflow as a stepper. A decision record skips READY to SUBMITTED. */
export function Stepper({ stage, kind }: { stage: SubmissionStage; kind: string }) {
  const stages = kind === 'DECISION_RECORD' ? (['DRAFT', 'INTERNAL_REVIEW', 'APPROVED', 'CLOSED'] as SubmissionStage[]) : STAGES
  const at = stages.indexOf(stage)
  return (
    <ol className="flex min-w-0 flex-wrap items-center gap-y-3" aria-label="Submission workflow">
      {stages.map((s, i) => {
        const done = i < at
        const current = i === at
        return (
          <li key={s} className="flex items-center" aria-current={current ? 'step' : undefined}>
            <span className={cx('flex items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px]', done ? 'border-green-line text-green' : current ? 'border-amber bg-amber-soft text-ink' : 'border-line text-ink-4')}>
              {done ? <Check className="h-3 w-3" /> : <span className={cx('h-1.5 w-1.5 rounded-full', current ? 'bg-amber' : 'bg-ink-4')} />}
              {STAGE_LABEL[s]}
            </span>
            {i < stages.length - 1 && <span className={cx('mx-1.5 h-px w-4', i < at ? 'bg-green-line' : 'bg-line-strong')} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

export function approvalState(report: ReportSummary | ReportVersion, reviews: Review[], transitions: ReportTransition[], decisionAnalystId: string | null) {
  const policy = APPROVAL_POLICY[report.kind]!
  const entered = [...transitions].filter((t) => t.reportId === report.id).reverse().find((t) => t.to === 'INTERNAL_REVIEW')
  const approvals = reviews.filter((r) => r.targetType === 'report' && r.targetId === report.id && r.action === 'APPROVE' && (!entered || r.createdAt >= entered.at) && r.reviewerId !== report.generatedBy && r.reviewerId !== decisionAnalystId)
  const roles = new Set(approvals.map((a) => a.reviewerRole))
  const needed = policy.anyOf.map((set) => set.filter((r) => !roles.has(r)))
  return { policy: policy.label, approvals, satisfied: needed.some((n) => n.length === 0), missingRoles: needed.sort((a, b) => a.length - b.length)[0] ?? [] }
}

export function ReportActions({ report, reviews, transitions, decisionAnalystId, canWriteCase, latest }: { report: ReportSummary | ReportVersion; reviews: Review[]; transitions: ReportTransition[]; decisionAnalystId: string | null; canWriteCase: boolean; latest: boolean }) {
  const { session } = useSession()
  const toast = useToast()
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null)
  const [comment, setComment] = useState('')
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const transition = useAction((to: SubmissionStage) => api<{ submission: { reference: string } | null }>(`/api/reports/${report.id}/transition`, { body: { to } }))
  const review = useAction((b: { action: ReviewAction; comment: string }) => api<{ advanced: string | null }>(`/api/cases/${report.caseId}/reviews`, { body: { targetType: 'report', targetId: report.id, ...b } }))
  if (!session) return null
  const role: RoleId = session.user.role
  const me = session.user.id
  const state = approvalState(report, reviews, transitions, decisionAnalystId)
  const conflicted = report.generatedBy === me || decisionAnalystId === me
  const go = async (to: SubmissionStage, label: string) => {
    setError(null)
    try {
      const r = await transition.mutateAsync(to)
      toast({ tone: 'success', title: label, body: r.submission ? `Simulated submission ${r.submission.reference}. Nothing was sent outside NEXUS.` : undefined })
    } catch (e) {
      setError(e)
    }
  }
  const stage = report.stage
  const buttons: ReactNode[] = []
  if (stage === 'DRAFT' && can(role, 'submission.advance') && canWriteCase) {
    buttons.push(
      <Button key="rev" size="sm" variant="primary" busy={transition.isPending} onClick={() => void go('INTERNAL_REVIEW', 'Sent for internal review')} disabled={!latest}>
        Send for internal review
      </Button>,
    )
  }
  if (stage === 'INTERNAL_REVIEW' && can(role, 'review.approve')) {
    buttons.push(
      <Button key="ap" size="sm" variant="primary" onClick={() => { setComment(''); setReviewAction('APPROVE') }} disabled={conflicted} title={conflicted ? 'Separation of duties: you generated this report or recorded its decision' : undefined}>
        Approve
      </Button>,
      <Button key="rc" size="sm" onClick={() => { setComment(''); setReviewAction('REQUEST_CHANGES') }} disabled={conflicted}>
        Request changes
      </Button>,
      <Button key="rj" size="sm" variant="danger" onClick={() => { setComment(''); setReviewAction('REJECT') }} disabled={conflicted}>
        Reject
      </Button>,
    )
  }
  if (stage === 'APPROVED' && can(role, 'submission.advance') && canWriteCase) {
    if (report.kind === 'DECISION_RECORD') buttons.push(<Button key="file" size="sm" variant="primary" onClick={() => void go('CLOSED', 'Decision record filed')}>File decision record</Button>)
    else buttons.push(<Button key="ready" size="sm" variant="primary" onClick={() => void go('READY', 'Marked ready for submission')} disabled={!latest}>Mark ready for submission</Button>)
  }
  if (stage === 'READY' && can(role, 'submission.submit') && canWriteCase) {
    buttons.push(
      <Button key="sub" size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} onClick={() => setConfirmSubmit(true)} disabled={!latest}>
        Submit (simulated)
      </Button>,
    )
  }
  if (stage === 'SUBMITTED' && can(role, 'submission.advance') && canWriteCase) buttons.push(<Button key="ack" size="sm" onClick={() => void go('ACKNOWLEDGED', 'Acknowledgement recorded (simulated)')}>Record acknowledgement</Button>)
  if (stage === 'ACKNOWLEDGED' && can(role, 'submission.advance') && canWriteCase) buttons.push(<Button key="close" size="sm" onClick={() => void go('CLOSED', 'Report closed')}>Close</Button>)

  return (
    <div className="min-w-0 space-y-3">
      {stage === 'INTERNAL_REVIEW' && (
        <div className="text-xs text-ink-3">
          <span className="text-ink-2">Approval policy:</span> {state.policy}{' '}
          {state.approvals.length > 0 && <span className="text-green">Approved so far by {state.approvals.map((a) => ROLES[a.reviewerRole].label).join(', ')}.</span>}{' '}
          {!state.satisfied && state.missingRoles.length > 0 && <span className="text-amber">Still needed: {state.missingRoles.map((r) => ROLES[r].label).join(' and ')}.</span>}
        </div>
      )}
      {!latest && (stage === 'DRAFT' || stage === 'APPROVED' || stage === 'READY') && <p className="text-xs text-ink-3">A newer version of this report exists. Only the latest version can move forward.</p>}
      {buttons.length > 0 ? <div className="flex flex-wrap gap-2">{buttons}</div> : stage !== 'CLOSED' && <p className="text-xs text-ink-3">No workflow action is available to your role at this stage.</p>}
      {conflicted && stage === 'INTERNAL_REVIEW' && can(role, 'review.approve') && <p className="text-xs text-ink-3">Separation of duties: you generated this report or recorded the decision it carries, so your approval would not count.</p>}
      {error !== null && <ErrorState error={error} />}

      <Modal
        open={reviewAction !== null}
        onClose={() => setReviewAction(null)}
        eyebrow={report.title}
        title={reviewAction === 'APPROVE' ? 'Approve report version' : reviewAction === 'REJECT' ? 'Reject report version' : 'Request changes'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewAction(null)}>
              Cancel
            </Button>
            <Button
              variant={reviewAction === 'REJECT' ? 'danger' : 'primary'}
              busy={review.isPending}
              disabled={reviewAction !== 'APPROVE' && comment.trim().length < 10}
              onClick={async () => {
                setError(null)
                try {
                  const r = await review.mutateAsync({ action: reviewAction!, comment })
                  toast({ tone: 'success', title: reviewAction === 'APPROVE' ? (r.advanced === 'APPROVED' ? 'Approved: policy satisfied' : 'Approval recorded') : 'Returned to draft' })
                  setReviewAction(null)
                } catch (e) {
                  setError(e)
                  setReviewAction(null)
                }
              }}
            >
              {reviewAction === 'APPROVE' ? 'Approve' : reviewAction === 'REJECT' ? 'Reject' : 'Request changes'}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-ink-2">Your review is recorded in the audit ledger with your role ({ROLES[role].label}).</p>
        <Field label="Comment" required={reviewAction !== 'APPROVE'} hint={reviewAction !== 'APPROVE' ? 'Explain what must change (at least 10 characters).' : undefined}>
          {(id) => <TextArea id={id} value={comment} onChange={(e) => setComment(e.target.value)} rows={4} />}
        </Field>
      </Modal>

      <Modal
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        eyebrow="Simulated submission"
        title={`Submit ${report.title}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSubmit(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Send className="h-4 w-4" />}
              busy={transition.isPending}
              onClick={async () => {
                setConfirmSubmit(false)
                await go('SUBMITTED', 'Submitted (simulated)')
              }}
            >
              Record simulated submission
            </Button>
          </>
        }
      >
        <Notice tone="violet" title="Simulated submission">
          Nothing is transmitted to ENISA or any CSIRT. NEXUS records a server-witnessed submission event on the Clock of Record and stores a simulated receipt as evidence, so the deadline and the evidence checklist behave as they would after a real submission.
        </Notice>
      </Modal>
    </div>
  )
}

export function Appear({ children, i = 0 }: { children: ReactNode; i?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
      {children}
    </motion.div>
  )
}
