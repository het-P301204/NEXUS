import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { useSystemStatus } from '../../lib/client/queries.ts'
import { short } from '../../lib/client/format.ts'
import { Drawer } from '../../components/ui/overlay.tsx'
import { Dot } from '../../components/ui/status.tsx'
import { Skeleton } from '../../components/ui/primitives.tsx'

/**
 * System integrity. Each line is a check the server runs, not a constant:
 * the rule and deadline engines run known-answer vectors, the ledger reports
 * its last verification, and the evidence store re-hashes its objects.
 */
export function SystemStatusDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useSystemStatus()
  const s = q.data
  const rows = s
    ? [
        { label: 'Rule engine', ok: s.ruleEngine.state === 'operational', state: s.ruleEngine.state === 'operational' ? 'Operational' : 'Degraded', detail: s.ruleEngine.detail, link: '/rules' },
        { label: 'Evidence ledger', ok: s.ledger.state === 'verified', warn: s.ledger.state === 'unverified', state: s.ledger.state === 'verified' ? 'Verified' : s.ledger.state === 'unverified' ? 'Unverified' : 'Integrity exception', detail: `${s.ledger.detail}${s.ledger.at ? ` Last verified ${short(s.ledger.at)}.` : ''}`, link: '/ledger' },
        { label: 'Deadline engine', ok: s.deadlineEngine.state === 'operational', state: s.deadlineEngine.state === 'operational' ? 'Operational' : 'Degraded', detail: s.deadlineEngine.detail, link: '/rules' },
        { label: 'Data integrity', ok: s.dataIntegrity.state === 'verified', state: s.dataIntegrity.state === 'verified' ? 'Verified' : 'Exception', detail: s.dataIntegrity.detail, link: '/evidence' },
      ]
    : []
  return (
    <Drawer open={open} onClose={onClose} eyebrow="System" title="System integrity" width="sm:max-w-md">
      {!s ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        <div className="space-y-6">
          <ul className="divide-y divide-line rounded-xl border border-line">
            {rows.map((r) => (
              <li key={r.label} className="px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Dot tone={r.ok ? 'green' : r.warn ? 'amber' : 'red'} pulse={!r.ok && !r.warn} />
                    <span className="text-sm text-ink">{r.label}</span>
                  </div>
                  <span className={r.ok ? 'micro text-green' : r.warn ? 'micro text-amber' : 'micro text-red'}>{r.state}</span>
                </div>
                <p className="mt-2 text-xs text-ink-3">{r.detail}</p>
                <Link to={r.link} onClick={onClose} className="mt-2 inline-flex items-center gap-1 text-xs text-ink-2 hover:text-amber">
                  Open <ArrowRight className="h-3 w-3" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="text-xs text-ink-3">
            Rule set <span className="mono text-ink-2">{s.ruleSetVersion}</span>. Checks refresh every two minutes.
          </div>
        </div>
      )}
    </Drawer>
  )
}
