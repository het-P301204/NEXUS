import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import { REPO_URL } from '../../lib/client/mode.ts'
import { demoCapturedAt } from '../../lib/client/static-demo.ts'
import { stamp } from '../../lib/client/format.ts'

/**
 * Shown only in the static GitHub Pages build. Says what the visitor is
 * looking at: recorded synthetic data, no server, nothing saved, and the
 * instant the clocks were recorded at -- so a deadline that reads "4h left"
 * weeks after the build is understood as 4h after that instant.
 */
export function StaticDemoBanner() {
  const captured = useQuery({ queryKey: ['static-demo-captured-at'], queryFn: demoCapturedAt, staleTime: Infinity, retry: false })
  return (
    <div role="note" className="no-print border-b border-amber-line bg-amber/[0.06] px-4 py-1.5 text-[11.5px] leading-relaxed text-ink-2 sm:px-6">
      <span className="font-medium text-amber">Static demo</span>
      <span className="text-ink-3"> · synthetic data · read-only. </span>
      {captured.data && <span className="text-ink-3">Recorded from a freshly seeded NEXUS server at {stamp(captured.data)}; the demo clock runs on from there. </span>}
      <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 whitespace-nowrap text-ink-2 underline underline-offset-2 hover:text-ink">
        Source and local setup <ArrowUpRight className="h-3 w-3" aria-hidden />
      </a>
    </div>
  )
}
