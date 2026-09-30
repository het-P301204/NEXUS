import { motion } from 'motion/react'
import { Link } from 'react-router'
import { AlertOctagon, CheckCircle2, Link2 } from 'lucide-react'
import type { AuditEvent } from '../../types/domain.ts'
import { stamp } from '../../lib/client/format.ts'
import { Hash, Ident, cx } from '../ui/primitives.tsx'

/**
 * One ledger entry, drawn as a link in a chain: its previous-hash pointer
 * above, its own hash below, joined to the neighbours by a rail. A broken
 * entry turns red where the chain no longer meets itself.
 */
export function ChainEntry({ e, name, index, broken, verified, showCase = true }: { e: AuditEvent; name: (id: string) => string; index: number; broken?: 'hash_mismatch' | 'prev_link_mismatch' | 'sequence_gap' | null; verified?: boolean; showCase?: boolean }) {
  return (
    <motion.li initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 20) * 0.02 }} className="relative grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-4">
      <div className="relative flex justify-center">
        <span className={cx('absolute bottom-[-8px] top-0 w-px', broken ? 'bg-red' : 'bg-line-strong')} aria-hidden />
        <span className={cx('relative z-10 mt-4 flex h-7 w-7 items-center justify-center rounded-md border font-mono text-[9.5px]', broken ? 'border-red bg-red-soft text-red' : verified ? 'border-green-line bg-s1 text-green' : 'border-line-strong bg-s1 text-ink-3')}>
          {broken ? <AlertOctagon className="h-3.5 w-3.5" /> : verified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        </span>
      </div>
      <div className={cx('mb-2 min-w-0 rounded-lg border px-4 py-3', broken ? 'border-red-line bg-red/[0.036]' : 'border-line bg-s1')}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <Ident className="text-[12px] text-ink">{e.id}</Ident>
            <span className="micro text-ink-2">{e.eventType.replace(/_/g, ' ')}</span>
            {e.source === 'demo' && <span className="micro text-violet">demo</span>}
          </div>
          <span className="mono text-[11px] text-ink-3">{stamp(e.at)}</span>
        </div>
        <p className="mt-1.5 text-sm text-ink-2 [overflow-wrap:anywhere]">{e.summary}</p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-3">
          <span>Actor: {e.actorId === 'system' ? 'system' : name(e.actorId)}</span>
          <span>
            Object: <span className="ident">{e.objectType}/{e.objectId}</span>
          </span>
          {showCase && e.caseId && (
            <Link to={`/cases/${e.caseId}`} className="ident hover:text-ink">
              {e.caseId}
            </Link>
          )}
          <span>Source: {e.source}</span>
        </div>
        <div className="mt-2.5 grid min-w-0 gap-1 border-t border-line pt-2 text-[11px] sm:grid-cols-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="micro shrink-0 text-ink-4">prev</span>
            <Hash value={e.prevHash} length={14} className={broken === 'prev_link_mismatch' ? '[&_span]:text-red' : undefined} />
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="micro shrink-0 text-ink-4">hash</span>
            <Hash value={e.hash} length={14} className={broken === 'hash_mismatch' ? '[&_span]:text-red' : undefined} />
          </span>
        </div>
      </div>
    </motion.li>
  )
}
