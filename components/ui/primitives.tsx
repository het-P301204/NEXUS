import { forwardRef, useId, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { motion } from 'motion/react'
import { Check, Copy, Loader2 } from 'lucide-react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// Buttons -------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-canvas hover:bg-white shadow-[0_1px_0_0_rgba(255,255,255,0.4)_inset]',
  secondary: 'bg-s3 text-ink border border-line-strong hover:bg-s4 hover:border-line-bright',
  ghost: 'text-ink-2 hover:text-ink hover:bg-s3',
  danger: 'bg-red-soft text-red border border-red-line hover:bg-red/20',
  quiet: 'text-ink-3 hover:text-ink',
}
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
  lg: 'h-11 px-5 text-sm gap-2 rounded-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  busy?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, busy, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-s3 hover:text-ink', className)}
      {...rest}
    >
      {children}
    </button>
  )
}

// Layout ------------------------------------------------------------------------------

export function Panel({ children, className, raised, as: As = 'section' }: { children: ReactNode; className?: string; raised?: boolean; as?: 'section' | 'div' | 'article' | 'aside' }) {
  return <As className={cx(raised ? 'panel-raised' : 'panel', className)}>{children}</As>
}

export function PanelHeader({ eyebrow, title, action, className, children }: { eyebrow?: ReactNode; title?: ReactNode; action?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cx('flex min-w-0 flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="micro mb-1.5">{eyebrow}</div>}
        {title && <h2 className="text-lg font-medium text-ink">{title}</h2>}
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('micro', className)}>{children}</div>
}

export function PageHeader({ eyebrow, title, description, actions, children }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8 flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="micro mb-3">{eyebrow}</div>}
        <h1 className="text-2xl font-medium text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-3 max-w-2xl text-md text-ink-2">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px w-full bg-line', className)} role="separator" />
}

export function KeyValue({ label, children, mono, className }: { label: ReactNode; children: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="micro mb-1">{label}</dt>
      <dd className={cx('min-w-0 text-sm text-ink', mono && 'ident')}>{children}</dd>
    </div>
  )
}

// Identifiers and hashes -------------------------------------------------------------

export function Ident({ children, className, dim }: { children: ReactNode; className?: string; dim?: boolean }) {
  return <span className={cx('ident text-[12.5px]', dim ? 'text-ink-3' : 'text-ink-2', className)}>{children}</span>
}

export function Hash({ value, length = 12, className, copy = true }: { value: string; length?: number; className?: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false)
  const short = value.length > length * 2 ? `${value.slice(0, length)}…${value.slice(-4)}` : value
  return (
    <span className={cx('inline-flex min-w-0 max-w-full items-center gap-1.5', className)}>
      <span className="ident truncate text-[12px] text-ink-3" title={value}>
        {short}
      </span>
      {copy && (
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-ink-4 transition-colors hover:text-ink-2"
          aria-label="Copy full hash"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            })
          }}
        >
          {copied ? <Check className="h-3 w-3 text-green" /> : <Copy className="h-3 w-3" />}
        </button>
      )}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-s3 px-1.5 font-mono text-[10.5px] text-ink-3">{children}</kbd>
}

// Form fields ----------------------------------------------------------------------------

export function Field({ label, hint, error, children, required, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: (id: string) => ReactNode; required?: boolean; className?: string }) {
  const id = useId()
  return (
    <div className={cx('min-w-0', className)}>
      <label htmlFor={id} className="mb-1.5 flex items-baseline gap-1 text-xs font-medium text-ink-2">
        {label}
        {required && <span className="text-amber" aria-hidden>*</span>}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1.5 text-xs text-red" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-ink-3">{hint}</p>
      ) : null}
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function TextInput({ className, invalid, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx('field h-9', className)} {...rest} />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function TextArea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cx('field min-h-[88px] resize-y leading-relaxed', className)} {...rest} />
})

export function Select({ className, children, invalid, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select aria-invalid={invalid || undefined} className={cx('field h-9 appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%238C867C' stroke-width='1.5'%3E%3Cpath d='M3 4.5l3 3 3-3'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  )
}

export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; tone?: 'green' | 'red' | 'amber' | 'blue' }>; label: string; size?: 'sm' | 'md' }) {
  const group = useId()
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex min-w-0 flex-wrap rounded-md border border-line-strong bg-s2 p-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative rounded-[7px] font-medium transition-colors duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${group}`}
                className={cx(
                  'absolute inset-0 rounded-[7px] border',
                  o.tone === 'green' ? 'border-green-line bg-green-soft' : o.tone === 'red' ? 'border-red-line bg-red-soft' : o.tone === 'amber' ? 'border-amber-line bg-amber-soft' : o.tone === 'blue' ? 'border-blue-line bg-blue-soft' : 'border-line-bright bg-s4',
                )}
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Checkbox({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <span className="relative mt-0.5 inline-flex">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-line-bright bg-s2 transition-colors checked:border-amber checked:bg-amber" />
        <Check className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-canvas opacity-0 peer-checked:opacity-100" strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-3">{description}</span>}
      </span>
    </label>
  )
}

// Skeleton / states -----------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />
}

export function SkeletonPage() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-2/3 max-w-xl" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}
