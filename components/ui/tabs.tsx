import { useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { motion } from 'motion/react'
import { cx } from './primitives.tsx'

export interface TabDef<T extends string> {
  id: T
  label: ReactNode
  count?: number | string
  alert?: boolean
}

/**
 * Tabs with a sliding indicator. Arrow keys move between tabs (roving
 * tabindex), Home/End jump; the panel is labelled by its tab.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label, className }: { tabs: TabDef<T>[]; value: T; onChange: (id: T) => void; label: string; className?: string }) {
  const group = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next: number
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    refs.current[next]?.focus()
    onChange(tabs[next]!.id)
  }
  return (
    <div role="tablist" aria-label={label} className={cx('-mx-1 flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden border-b border-line px-1 [scrollbar-width:none]', className)}>
      {tabs.map((t, i) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            role="tab"
            id={`${group}-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`${group}-panel`}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(t.id)}
            className={cx(
              'relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3 pb-3 pt-2 text-sm transition-colors duration-150',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className={cx('mono rounded px-1.5 text-[10.5px]', active ? 'bg-s4 text-ink-2' : 'bg-s3 text-ink-3')}>{t.count}</span>}
            {t.alert && <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-label="needs attention" />}
            {active && <motion.span layoutId={`tab-${group}`} className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-amber" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
          </button>
        )
      })}
    </div>
  )
}
