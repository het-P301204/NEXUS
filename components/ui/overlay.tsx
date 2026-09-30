import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { IconButton, cx } from './primitives.tsx'

/** Focus trap + Escape + restore focus, shared by Modal and Drawer. */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  // Callers usually pass an inline onClose, which is a new function on every
  // render. Reading it through a ref keeps the effect keyed on `open` alone, so
  // typing in the dialog (which re-renders the caller) does not re-run the
  // effect and pull focus back to the first control.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])
    const first = focusables()[0]
    ;(node?.querySelector<HTMLElement>('[data-autofocus]') ?? first ?? node)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      } else if (e.key === 'Tab') {
        const list = focusables()
        if (list.length === 0) return
        const idx = list.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && (idx <= 0)) {
          e.preventDefault()
          list[list.length - 1]!.focus()
        } else if (!e.shiftKey && idx === list.length - 1) {
          e.preventDefault()
          list[0]!.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open])
  return ref
}

export function Modal({ open, onClose, title, eyebrow, children, footer, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; eyebrow?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  const ref = useDialog(open, onClose)
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={onClose} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            tabIndex={-1}
            className={cx('relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-s1 shadow-overlay sm:rounded-2xl', width)}
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0">
                {eyebrow && <div className="micro mb-1.5">{eyebrow}</div>}
                <h2 className="text-lg font-medium text-ink">{title}</h2>
              </div>
              <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-s1 px-6 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function Drawer({ open, onClose, title, eyebrow, children, footer, width = 'sm:max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; eyebrow?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  const ref = useDialog(open, onClose)
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div className="absolute inset-0 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={onClose} />
          <motion.aside
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            tabIndex={-1}
            className={cx('relative flex h-full w-full flex-col border-l border-line-strong bg-s1 shadow-overlay', width)}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0">
                {eyebrow && <div className="micro mb-1.5">{eyebrow}</div>}
                <h2 className="text-lg font-medium text-ink">{title}</h2>
              </div>
              <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// Toasts ---------------------------------------------------------------------------------

interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  title: string
  body?: string
}

const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts((xs) => [...xs.slice(-3), { ...t, id }])
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.tone === 'error' ? 8000 : 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line-strong bg-s2 px-4 py-3 shadow-overlay"
            >
              {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green" /> : t.tone === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue" />}
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{t.title}</div>
                {t.body && <div className="mt-0.5 text-xs text-ink-2">{t.body}</div>}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}
