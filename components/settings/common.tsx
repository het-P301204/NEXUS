import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import type { EvidenceType, NotificationSeverity, Permission, RoleId } from '../../types/domain.ts'
import { ROLES, ROLE_ORDER, can } from '../../lib/rbac.ts'
import { cx } from '../ui/primitives.tsx'
import type { Tone } from '../ui/status.tsx'

/**
 * Shared pieces for the Settings sections: the section heading, the quiet
 * read-only note shown to every role except Administrator, a switch, and the
 * small formatting helpers the policies share.
 */

export function SectionHeader({ eyebrow, title, description, action }: { eyebrow: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-7 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-2xl">
        <div className="micro mb-2">{eyebrow}</div>
        <h2 className="text-xl font-medium text-ink">{title}</h2>
        {description && <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-2">{description}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function ReadOnlyNote({ role, className }: { role: RoleId | undefined; className?: string }) {
  return (
    <p className={cx('flex items-start gap-2 text-xs leading-relaxed text-ink-3', className)}>
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Read only. Only the Administrator role can change these settings{role ? `; you are signed in as ${ROLES[role].label}` : ''}. The server refuses the change for every other role.
      </span>
    </p>
  )
}

/** A two-state switch. Keyboard: Space/Enter toggles (native button). */
export function Switch({ checked, onChange, label, disabled, busy }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-green-line bg-green-soft' : 'border-line-bright bg-s3',
      )}
      aria-busy={busy || undefined}
    >
      <span className={cx('inline-block h-3.5 w-3.5 rounded-full transition-transform duration-150 ease-out', checked ? 'translate-x-[18px] bg-green' : 'translate-x-[2px] bg-ink-3')} />
    </button>
  )
}

/** "T-12h", "T-1h 30m", "T-0". */
export function formatOffset(minutes: number): string {
  if (minutes <= 0) return 'T-0'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `T-${m}m`
  return m === 0 ? `T-${h}h` : `T-${h}h ${m}m`
}

export const LEVEL_META: Record<NotificationSeverity, { label: string; tone: Tone }> = {
  info: { label: 'Info', tone: 'blue' },
  watch: { label: 'Watch', tone: 'amber' },
  critical: { label: 'Critical', tone: 'red' },
}

export function roleLabel(role: RoleId | 'owner'): string {
  return role === 'owner' ? 'Case owner' : ROLES[role].label
}

/** The roles holding a permission, in the canonical role order. */
export function rolesWith(permission: Permission): RoleId[] {
  return ROLE_ORDER.filter((r) => can(r, permission))
}

/** "A, B and C". */
export function listPhrase(items: string[], conj = 'and'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`
}

/**
 * Evidence types an awareness criterion may require. SUBMISSION_RECEIPT is
 * produced by the simulated submission itself and is not accepted here.
 */
export const CRITERION_EVIDENCE_TYPES: EvidenceType[] = [
  'TICKET',
  'EMAIL',
  'VENDOR_ADVISORY',
  'SCANNER_RESULT',
  'ANALYST_NOTE',
  'EXPLOIT_EVIDENCE',
  'THREAT_INTELLIGENCE',
  'INCIDENT_RECORD',
  'LOG',
  'SBOM',
  'VEX',
  'SCREENSHOT',
  'CONFIGURATION',
  'POLICY',
  'CUSTOMER_COMMUNICATION',
]

export const EU_MEMBER_STATES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']
