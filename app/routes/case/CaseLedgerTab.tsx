import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { ChainEntry } from '../../../components/ledger/ChainEntry.tsx'
import { EmptyState } from '../../../components/ui/feedback.tsx'
import { SectionTitle, useCaseCtx } from './shared.tsx'

export function CaseLedgerTab() {
  const { data, name } = useCaseCtx()
  const entries = [...data.ledger].reverse()
  return (
    <div className="min-w-0 max-w-4xl">
      <SectionTitle
        eyebrow="Append-only audit ledger"
        title={`${data.ledger.length} entries reference ${data.bundle.case.id}`}
        action={
          <Link to="/ledger?verify=1" className="inline-flex items-center gap-1.5 text-sm text-ink hover:text-amber">
            Verify the full chain <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />
      <p className="-mt-2 mb-6 text-sm text-ink-3">
        These entries are interleaved with the rest of the organisation's ledger; each one's previous-hash points at the entry immediately before it in the full chain, not in this filtered view. Verification runs over the whole chain.
      </p>
      {entries.length === 0 ? (
        <EmptyState title="No entries" why="Every change to this case is appended to the ledger. None has been recorded yet." />
      ) : (
        <ol className="min-w-0">
          {entries.map((e, i) => (
            <ChainEntry key={e.seq} e={e} name={name} index={i} showCase={false} />
          ))}
        </ol>
      )}
    </div>
  )
}
