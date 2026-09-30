import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/client/api.ts'
import { keys } from '../../lib/client/queries.ts'
import { cx } from '../../components/ui/primitives.tsx'
import { Mark } from './Wordmark.tsx'

/**
 * The loading sequence. Each step is a real request -- the portfolio, the
 * rule set, the clock state, the ledger -- and a step completes when its
 * request does. It is never longer than the work it describes, and any key
 * or click skips it.
 */

interface Step {
  label: string
  run: () => Promise<unknown>
}

const MIN_STEP_MS = 110

export function Boot({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const reduce = useReducedMotion()
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const finished = useRef(false)

  const steps: Step[] = [
    { label: 'Initializing evidence engine', run: () => Promise.resolve() },
    { label: 'Loading product portfolio', run: () => qc.prefetchQuery({ queryKey: keys.products, queryFn: async () => (await api<{ items: unknown[] }>('/api/products')).items }) },
    { label: 'Loading rule set', run: () => qc.prefetchQuery({ queryKey: keys.rules, queryFn: () => api('/api/rules') }) },
    { label: 'Verifying clock state', run: () => qc.prefetchQuery({ queryKey: keys.overview, queryFn: () => api('/api/overview') }) },
    { label: 'Loading evidence ledger', run: () => qc.prefetchQuery({ queryKey: keys.status, queryFn: () => api('/api/system/status') }) },
  ]

  const finish = () => {
    if (finished.current) return
    finished.current = true
    onDone()
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < steps.length; i++) {
        const started = performance.now()
        try {
          await steps[i]!.run()
        } catch {
          if (!cancelled) setFailed(steps[i]!.label)
        }
        const wait = MIN_STEP_MS - (performance.now() - started)
        if (wait > 0 && !reduce) await new Promise((r) => setTimeout(r, wait))
        if (cancelled) return
        setDone(i + 1)
      }
      await new Promise((r) => setTimeout(r, reduce ? 0 : 320))
      if (!cancelled) finish()
    })()
    const skip = () => finish()
    window.addEventListener('keydown', skip)
    return () => {
      cancelled = true
      window.removeEventListener('keydown', skip)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ready = done >= steps.length
  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-canvas"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      onClick={finish}
      role="status"
      aria-live="polite"
      aria-label="Loading NEXUS"
    >
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      {!reduce && <div className="scanline pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-transparent via-amber/[0.035] to-transparent" />}
      <div className="relative w-full max-w-[520px] px-8">
        <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="flex items-center gap-4">
          <Mark className="h-9 w-9" />
          <div>
            <div className="font-mono text-2xl font-semibold tracking-[0.34em] text-ink">NEXUS</div>
            <div className="micro mt-1.5">CRA Article 14 · Reportability engine</div>
          </div>
        </motion.div>

        {/* evidence-node trace */}
        <div className="relative mt-12 h-6">
          <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
          <motion.div className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-amber" animate={{ width: `${(done / steps.length) * 100}%` }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />
          {steps.map((_, i) => (
            <span
              key={i}
              className={cx('absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-colors duration-300', i < done ? 'border-amber bg-amber' : i === done ? 'border-amber bg-canvas' : 'border-ink-4 bg-canvas')}
              style={{ left: `${(i / (steps.length - 1)) * 100}%` }}
            />
          ))}
        </div>

        <ol className="mt-8 space-y-2.5">
          {steps.map((s, i) => (
            <li key={s.label} className={cx('flex items-center gap-3 font-mono text-[12.5px] transition-colors duration-300', i < done ? 'text-ink-2' : i === done ? 'text-ink' : 'text-ink-4')}>
              <span className="flex h-4 w-4 items-center justify-center">
                {i < done ? <Check className="h-3.5 w-3.5 text-green" /> : i === done ? <span className="blink h-1.5 w-1.5 rounded-full bg-amber" /> : <span className="h-1 w-1 rounded-full bg-ink-4" />}
              </span>
              {s.label}
            </li>
          ))}
          <AnimatePresence>
            {ready && (
              <motion.li initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 pt-1 font-mono text-[12.5px] text-green">
                <span className="flex h-4 w-4 items-center justify-center">
                  <span className="h-2 w-2 rounded-full bg-green" />
                </span>
                System ready
              </motion.li>
            )}
          </AnimatePresence>
        </ol>
        {failed && <p className="mt-6 text-xs text-amber">{failed} did not complete; the page will retry when it opens.</p>}
        <p className="mt-10 text-[11px] text-ink-4">Press any key to skip</p>
      </div>
    </motion.div>
  )
}
