import type { ReactNode } from 'react'
import {
  AlertOctagon,
  AlertTriangle,
  Archive,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Clock,
  Eye,
  FileCheck2,
  FileClock,
  FilePen,
  Hourglass,
  Lock,
  Minus,
  Radio,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AffectednessResult, CaseStatus, ExploitationStatus, Severity, SubmissionStage } from '../../types/domain.ts'
import type { DeadlineStatus } from '../../lib/engine/deadlines.ts'
import type { HealthState } from '../../lib/engine/analyze.ts'
import { cx } from './primitives.tsx'

/**
 * Status vocabulary. Every state is a colour AND an icon AND words, so the
 * interface never relies on colour alone.
 */

export type Tone = 'neutral' | 'dim' | 'amber' | 'red' | 'green' | 'blue' | 'violet' | 'redSolid'

const TONES: Record<Tone, string> = {
  neutral: 'border-line-strong bg-s3 text-ink-2',
  dim: 'border-line bg-transparent text-ink-3',
  amber: 'border-amber-line bg-amber-soft text-amber',
  red: 'border-red-line bg-red-soft text-red',
  redSolid: 'border-red bg-red text-canvas',
  green: 'border-green-line bg-green-soft text-green',
  blue: 'border-blue-line bg-blue-soft text-blue',
  violet: 'border-violet-line bg-violet-soft text-violet',
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-2',
  dim: 'text-ink-3',
  amber: 'text-amber',
  red: 'text-red',
  redSolid: 'text-red',
  green: 'text-green',
  blue: 'text-blue',
  violet: 'text-violet',
}

export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-ink-3',
  dim: 'bg-ink-4',
  amber: 'bg-amber',
  red: 'bg-red',
  redSolid: 'bg-red',
  green: 'bg-green',
  blue: 'bg-blue',
  violet: 'bg-violet',
}

export function Badge({ tone = 'neutral', icon: Icon, children, size = 'md', className, title }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; size?: 'sm' | 'md'; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-mono uppercase',
        size === 'sm' ? 'h-5 px-2 text-[10px] tracking-[0.08em]' : 'h-6 px-2.5 text-[10.5px] tracking-[0.1em]',
        TONES[tone],
        className,
      )}
    >
      {Icon && <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden strokeWidth={2} />}
      <span className="truncate">{children}</span>
    </span>
  )
}

interface Meta {
  label: string
  tone: Tone
  icon: LucideIcon
}

export const CASE_STATUS: Record<CaseStatus, Meta> = {
  NEW: { label: 'New', tone: 'neutral', icon: CircleDashed },
  INVESTIGATING: { label: 'Investigating', tone: 'blue', icon: Search },
  AWARENESS_ESTABLISHED: { label: 'Awareness established', tone: 'amber', icon: Radio },
  DETERMINATION_PENDING: { label: 'Determination pending', tone: 'amber', icon: Hourglass },
  REPORTABLE: { label: 'Reportable', tone: 'red', icon: ShieldAlert },
  NOT_REPORTABLE: { label: 'Not reportable', tone: 'neutral', icon: CircleSlash },
  SUBMITTED: { label: 'Submitted', tone: 'green', icon: Send },
  CLOSED: { label: 'Closed', tone: 'dim', icon: Archive },
}

export const DEADLINE_STATUS: Record<DeadlineStatus, Meta> = {
  ON_TRACK: { label: 'On track', tone: 'neutral', icon: Clock },
  WATCH: { label: 'Watch', tone: 'amber', icon: Eye },
  CRITICAL: { label: 'Critical', tone: 'red', icon: AlertTriangle },
  OVERDUE: { label: 'Overdue', tone: 'redSolid', icon: AlertOctagon },
  COMPLETED: { label: 'Completed', tone: 'green', icon: CheckCircle2 },
  COMPLETED_LATE: { label: 'Completed late', tone: 'amber', icon: CheckCircle2 },
  PENDING_START: { label: 'Pending start', tone: 'dim', icon: CircleDashed },
  NOT_APPLICABLE: { label: 'Not applicable', tone: 'dim', icon: Minus },
  BLOCKED: { label: 'Blocked', tone: 'red', icon: Lock },
}

export const AFFECTEDNESS: Record<AffectednessResult | 'NO_DETERMINATION', Meta> = {
  AFFECTED: { label: 'Affected', tone: 'red', icon: ShieldAlert },
  NOT_AFFECTED: { label: 'Not affected', tone: 'green', icon: ShieldCheck },
  UNDER_INVESTIGATION: { label: 'Under investigation', tone: 'amber', icon: ShieldQuestion },
  NO_DETERMINATION: { label: 'No determination', tone: 'dim', icon: CircleDashed },
}

export const HEALTH: Record<HealthState, Meta> = {
  READY: { label: 'Ready', tone: 'green', icon: CheckCircle2 },
  INCOMPLETE: { label: 'Incomplete', tone: 'amber', icon: CircleDashed },
  BLOCKED: { label: 'Blocked', tone: 'red', icon: Lock },
  UNDER_REVIEW: { label: 'Under review', tone: 'blue', icon: Eye },
}

export const EXPLOITATION: Record<ExploitationStatus, Meta> = {
  CONFIRMED: { label: 'Actively exploited', tone: 'red', icon: AlertOctagon },
  SUSPECTED: { label: 'Suspected', tone: 'amber', icon: AlertTriangle },
  NOT_OBSERVED: { label: 'Not observed', tone: 'neutral', icon: Minus },
  UNKNOWN: { label: 'Unknown', tone: 'dim', icon: CircleDashed },
}

export const STAGE: Record<SubmissionStage, Meta> = {
  DRAFT: { label: 'Draft', tone: 'neutral', icon: FilePen },
  INTERNAL_REVIEW: { label: 'Internal review', tone: 'blue', icon: Eye },
  APPROVED: { label: 'Approved', tone: 'green', icon: FileCheck2 },
  READY: { label: 'Ready for submission', tone: 'amber', icon: FileClock },
  SUBMITTED: { label: 'Submitted', tone: 'green', icon: Send },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'green', icon: CheckCircle2 },
  CLOSED: { label: 'Closed', tone: 'dim', icon: Archive },
}

export const SEVERITY: Record<Severity, { label: string; tone: Tone; bars: number }> = {
  CRITICAL: { label: 'Critical', tone: 'red', bars: 4 },
  HIGH: { label: 'High', tone: 'amber', bars: 3 },
  MEDIUM: { label: 'Medium', tone: 'blue', bars: 2 },
  LOW: { label: 'Low', tone: 'neutral', bars: 1 },
}

export function StatusBadge({ meta, size }: { meta: Meta; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={meta.tone} icon={meta.icon} size={size}>
      {meta.label}
    </Badge>
  )
}

export function CaseStatusBadge({ status, size }: { status: CaseStatus; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={CASE_STATUS[status]} size={size} />
}

export function DeadlineBadge({ status, size }: { status: DeadlineStatus; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={DEADLINE_STATUS[status]} size={size} />
}

export function AffectednessBadge({ result, size }: { result: AffectednessResult | 'NO_DETERMINATION'; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={AFFECTEDNESS[result]} size={size} />
}

export function HealthBadge({ state, size }: { state: HealthState; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={HEALTH[state]} size={size} />
}

export function StageBadge({ stage, size }: { stage: SubmissionStage; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={STAGE[stage]} size={size} />
}

export function ExploitationBadge({ status, size }: { status: ExploitationStatus; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={EXPLOITATION[status]} size={size} />
}

export function SeverityMark({ severity, showLabel = true }: { severity: Severity; showLabel?: boolean }) {
  const s = SEVERITY[severity]
  return (
    <span className={cx('inline-flex items-center gap-2', TONE_TEXT[s.tone])} title={`Severity: ${s.label}`}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cx('w-[3px] rounded-[1px]', i <= s.bars ? 'bg-current' : 'bg-ink-4/50')} style={{ height: 4 + i * 2.5 }} />
        ))}
      </span>
      {showLabel && <span className="font-mono text-[10.5px] uppercase tracking-[0.1em]">{s.label}</span>}
      {!showLabel && <span className="sr-only">{s.label}</span>}
    </span>
  )
}

export function Dot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cx('relative inline-flex h-2 w-2 shrink-0 rounded-full', TONE_DOT[tone], TONE_TEXT[tone], pulse && 'pulse-ring', className)} aria-hidden />
  )
}
