import { forwardRef, useCallback } from 'react'
import type { InputHTMLAttributes } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Clock,
  FileX,
  Minus,
  Search,
  ShieldAlert,
  ShieldQuestion,
  Timer,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Exposure, ProductLifecycle, SbomStatus, Severity } from '../../types/domain.ts'
import type { ProductListItem } from '../../types/api.ts'
import { ApiFailure, api } from '../../lib/client/api.ts'
import { keys, useUsers } from '../../lib/client/queries.ts'
import { Badge, TONE_TEXT } from '../ui/status.tsx'
import type { Tone } from '../ui/status.tsx'
import { cx } from '../ui/primitives.tsx'

/**
 * Shared vocabulary for the portfolio and vulnerability pages. Every state
 * is a colour, an icon and a word, never the colour alone.
 */

export const LIFECYCLE: Record<ProductLifecycle, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'neutral' },
  maintenance: { label: 'Maintenance', tone: 'dim' },
  end_of_support: { label: 'End of support', tone: 'amber' },
}

export const EXPOSURE: Record<Exposure, { label: string; short: string }> = {
  internet_facing: { label: 'Internet-facing', short: 'Internet' },
  customer_network: { label: 'Customer network', short: 'Customer net' },
  internal: { label: 'Internal', short: 'Internal' },
  isolated: { label: 'Isolated', short: 'Isolated' },
}

export const SBOM: Record<SbomStatus, { label: string; tone: Tone; icon: LucideIcon; detail: string }> = {
  current: { label: 'Current', tone: 'green', icon: CheckCircle2, detail: 'SBOM regenerated for this release.' },
  stale: { label: 'Stale', tone: 'amber', icon: Clock, detail: 'SBOM is older than the current build. Matches may be out of date.' },
  missing: { label: 'Missing', tone: 'red', icon: FileX, detail: 'No SBOM on record. Component matching cannot run for this product.' },
}

export const RISK: Record<ProductListItem['riskState'], { label: string; tone: Tone; icon: LucideIcon }> = {
  clock_running: { label: 'Reporting clock running', tone: 'red', icon: Timer },
  affected: { label: 'Affected', tone: 'red', icon: ShieldAlert },
  investigating: { label: 'Investigating', tone: 'amber', icon: ShieldQuestion },
  clear: { label: 'No open case', tone: 'neutral', icon: Minus },
}

export const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

/** The CVSS v3 qualitative bands. A suggestion only: severity stays as entered. */
export function severityFromCvss(score: number): Severity {
  return score >= 9 ? 'CRITICAL' : score >= 7 ? 'HIGH' : score >= 4 ? 'MEDIUM' : 'LOW'
}

export function SbomMark({ status, className }: { status: SbomStatus; className?: string }) {
  const s = SBOM[status]
  const Icon = s.icon
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap text-xs', TONE_TEXT[s.tone], className)} title={s.detail}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
      <span>{s.label}</span>
    </span>
  )
}

export function RiskBadge({ state, reason, size = 'sm' }: { state: ProductListItem['riskState']; reason?: string; size?: 'sm' | 'md' }) {
  const r = RISK[state]
  return (
    <Badge tone={r.tone} icon={r.icon} size={size} title={reason}>
      {r.label}
    </Badge>
  )
}

export function LifecycleBadge({ lifecycle }: { lifecycle: ProductLifecycle }) {
  const l = LIFECYCLE[lifecycle]
  return (
    <Badge tone={l.tone} size="sm">
      {l.label}
    </Badge>
  )
}

/**
 * Whether a component version sits inside an affected range. "In range"
 * means the product contains the vulnerable component version; it is not a
 * statement that the product is affected.
 */
export function RangeMark({ value, compact }: { value: boolean | null; compact?: boolean }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-amber" title="The version is inside the affected range. The product contains the vulnerable component; affectedness is determined in a case.">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {compact ? 'In range' : 'In vulnerable range'}
      </span>
    )
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-3" title="The version is outside the affected range.">
        <Minus className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Outside range
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-2" title="The version or the range could not be parsed. Treated as unknown, never as safe.">
      <CircleHelp className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Cannot compare
    </span>
  )
}

export function NoDeterminationMark() {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-3">
      <CircleDashed className="h-3.5 w-3.5 shrink-0" aria-hidden />
      No determination
    </span>
  )
}

/** Field-level messages from a server validation failure, keyed by field path. */
export function fieldErrorsOf(err: unknown): Record<string, string> {
  if (err instanceof ApiFailure && err.body.fields) return err.body.fields
  return {}
}

/** The first message for any of the given field paths. */
export function pick(fields: Record<string, string>, ...names: string[]): string | undefined {
  for (const n of names) if (fields[n]) return fields[n]
  return undefined
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: keys.product(id),
    queryFn: async () => (await api<{ item: ProductListItem }>(`/api/products/${encodeURIComponent(id)}`)).item,
  })
}

export function useUserName() {
  const users = useUsers()
  const data = users.data
  return useCallback((id: string | null | undefined) => {
    if (!id) return '--'
    return data?.find((u) => u.id === id)?.name ?? id
  }, [data])
}

export const SearchBox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function SearchBox({ className, ...rest }, ref) {
  return (
    <div className={cx('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
      <input ref={ref} type="search" className="field h-9 pl-9" {...rest} />
    </div>
  )
})

export function Count({ shown, total, noun, plural }: { shown: number; total: number; noun: string; plural?: string }) {
  const word = total === 1 ? noun : (plural ?? `${noun}s`)
  return <span className="mono text-xs text-ink-3">{shown === total ? `${total} ${word}` : `${shown} of ${total} ${word}`}</span>
}

export function fmtCount(n: number): string {
  return n.toLocaleString('en')
}
