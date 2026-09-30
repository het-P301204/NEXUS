import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { chronoParts, countdownParts, relative, stamp } from '../../lib/client/format.ts'
import { useNow } from '../../lib/client/useNow.ts'
import { cx } from './primitives.tsx'

/**
 * Time is NEXUS's primary material, so it has its own typography: the
 * chronograph treatment. Hours and minutes carry the weight, seconds sit
 * lighter, the date and zone recede. A timestamp is always shown with its
 * zone, and its full value is always one hover away.
 */

export function Chrono({ iso, size = 'md', showDate = true, tz, className }: { iso: string; size?: 'sm' | 'md' | 'lg' | 'xl'; showDate?: boolean; tz?: string; className?: string }) {
  const p = chronoParts(iso, tz)
  const sizes = {
    sm: { hm: 'text-sm', s: 'text-xs', meta: 'text-[10.5px]' },
    md: { hm: 'text-lg', s: 'text-sm', meta: 'text-[11px]' },
    lg: { hm: 'text-2xl', s: 'text-lg', meta: 'text-xs' },
    xl: { hm: 'text-3xl', s: 'text-xl', meta: 'text-xs' },
  }[size]
  return (
    <time dateTime={iso} title={`${stamp(iso, tz)} (${iso})`} className={cx('inline-flex min-w-0 flex-col', className)}>
      <span className="mono whitespace-nowrap leading-none">
        <span className={cx(sizes.hm, 'font-medium text-ink')}>{p.hm}</span>
        <span className={cx(sizes.s, 'text-ink-3')}>:{p.s}</span>
      </span>
      {showDate && (
        <span className={cx('mono mt-1.5 whitespace-nowrap uppercase tracking-[0.08em] text-ink-3', sizes.meta)}>
          {p.date} · {p.zone}
        </span>
      )}
    </time>
  )
}

export function Relative({ iso, className }: { iso: string; className?: string }) {
  const now = useNow()
  return (
    <time dateTime={iso} title={stamp(iso)} className={cx('tabular', className)}>
      {relative(iso, now)}
    </time>
  )
}

/** A single digit column that rolls when it changes. */
function Roll({ value, className }: { value: string; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <span className={cx('relative inline-block overflow-hidden', className)} style={{ height: '1em', lineHeight: '1em' }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          className="inline-block"
          initial={reduce ? false : { y: '-0.9em', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? undefined : { y: '0.9em', opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/**
 * Countdown to an instant. Recomputed every second from the shared ticker;
 * the server's clock is the reference (see useNow).
 */
export function Countdown({ dueAt, size = 'md', seconds = true, className }: { dueAt: string; size?: 'sm' | 'md' | 'lg' | 'hero'; seconds?: boolean; className?: string }) {
  const now = useNow()
  const remaining = Date.parse(dueAt) - now
  const { neg, d, h, m, s } = countdownParts(remaining)
  const unit = { sm: 'text-[10px] ml-[1px] mr-1.5', md: 'text-xs ml-0.5 mr-2', lg: 'text-sm ml-0.5 mr-2.5', hero: 'text-xl ml-1 mr-4 tracking-normal' }[size]
  const num = { sm: 'text-sm', md: 'text-lg', lg: 'text-3xl', hero: 'text-clock' }[size]
  const secondsSize = { sm: 'text-xs', md: 'text-sm', lg: 'text-xl', hero: 'text-3xl' }[size]
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <span className={cx('mono inline-flex items-baseline whitespace-nowrap font-medium', className)} aria-label={`${neg ? 'Overdue by' : 'Remaining'} ${d ? `${d} days ` : ''}${h} hours ${m} minutes`} role="timer">
      {neg && <span className={cx(num, 'mr-1')}>−</span>}
      {d > 0 && (
        <>
          <span className={num}>{d}</span>
          <span className={cx(unit, 'text-ink-3')}>d</span>
        </>
      )}
      <span className={num}>{d > 0 ? h : h}</span>
      <span className={cx(unit, 'text-ink-3')}>h</span>
      <span className={cx(num, 'inline-flex')}>
        <Roll value={pad(m)[0]!} />
        <Roll value={pad(m)[1]!} />
      </span>
      <span className={cx(unit, 'text-ink-3', !seconds && 'mr-0')}>m</span>
      {seconds && d === 0 && (
        <>
          {/* Seconds change every second: shown plainly, not rolled, so the
              countdown stays calm to read. */}
          <span className={cx(secondsSize, 'tabular text-ink-3')}>{pad(s)}</span>
          <span className={cx(unit, 'mr-0 text-ink-4')}>s</span>
        </>
      )}
    </span>
  )
}

/** A number that counts to its value on first render. */
export function Tally({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(reduce ? value : 0)
  const from = useRef(0)
  useEffect(() => {
    if (reduce) {
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700)
      const eased = 1 - Math.pow(1 - k, 3)
      setShown(Math.round(a + (value - a) * eased))
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, reduce])
  return <span className={cx('tabular', className)}>{shown}</span>
}
