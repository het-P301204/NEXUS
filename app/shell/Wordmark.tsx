import { Link } from 'react-router'
import { cx } from '../../components/ui/primitives.tsx'

/**
 * The mark: a timeline crossed by the record -- the nexus where what was known
 * meets when it was known. The point is the instant of awareness every
 * deadline runs from; the amber stretch is time already elapsed.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-5 w-5', className)} aria-hidden>
      <path d="M2 16h20" stroke="#6A655D" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M2 16h10" stroke="#E7A24A" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="16" r="2.6" fill="#E7A24A" />
      <path d="M12 3.5v8" stroke="#ECE7DD" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-md" aria-label="NEXUS, go to overview">
      <Mark />
      {!compact && <span className="font-mono text-[13px] font-semibold tracking-[0.28em] text-ink">NEXUS</span>}
    </Link>
  )
}
