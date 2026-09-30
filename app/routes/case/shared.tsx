import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Paperclip } from 'lucide-react'
import type { CaseDetailResponse } from '../../../types/api.ts'
import type { Evidence, User } from '../../../types/domain.ts'
import { useUsers } from '../../../lib/client/queries.ts'
import { cx } from '../../../components/ui/primitives.tsx'

export interface CaseCtx {
  data: CaseDetailResponse
  users: User[]
  name: (id: string | null | undefined) => string
  evidence: (id: string) => (Evidence & { redacted?: boolean }) | undefined
  setTab: (tab: string, extra?: Record<string, string>) => void
  writable: boolean
}

export const CaseContext = createContext<CaseCtx | null>(null)

export function useCaseCtx(): CaseCtx {
  const v = useContext(CaseContext)
  if (!v) throw new Error('useCaseCtx outside case')
  return v
}

export function useCaseValue(data: CaseDetailResponse, setTab: CaseCtx['setTab'], writable: boolean): CaseCtx {
  const users = useUsers().data ?? []
  const byId = new Map((data.bundle?.evidence ?? []).map((e) => [e.id, e]))
  return {
    data,
    users,
    name: (id) => (id ? (users.find((u) => u.id === id)?.name ?? id) : '--'),
    evidence: (id) => byId.get(id),
    setTab,
    writable,
  }
}

/** A compact, clickable evidence reference: violet, the colour of evidence links. */
export function EvidenceChip({ id, className }: { id: string; className?: string }) {
  const ctx = useContext(CaseContext)
  const e = ctx?.evidence(id)
  return (
    <Link
      to={`/evidence/${encodeURIComponent(id)}`}
      title={e ? `${e.title} · ${e.type.replace(/_/g, ' ').toLowerCase()} · sha256 ${e.sha256}` : id}
      className={cx('inline-flex max-w-full items-center gap-1 rounded-md border border-violet-line bg-violet-soft px-1.5 py-0.5 font-mono text-[11px] text-violet transition-colors hover:bg-violet/20', className)}
    >
      <Paperclip className="h-3 w-3 shrink-0" />
      <span className="truncate">{id}</span>
    </Link>
  )
}

export function EvidenceChips({ ids, empty = 'No evidence linked' }: { ids: string[]; empty?: string }) {
  if (ids.length === 0) return <span className="text-xs text-ink-4">{empty}</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {[...new Set(ids)].map((id) => (
        <EvidenceChip key={id} id={id} />
      ))}
    </span>
  )
}

export function SectionTitle({ eyebrow, title, action, id }: { eyebrow: string; title?: string; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="micro mb-1.5">{eyebrow}</div>
        {title && (
          <h2 id={id} className="text-lg font-medium text-ink">
            {title}
          </h2>
        )}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}
