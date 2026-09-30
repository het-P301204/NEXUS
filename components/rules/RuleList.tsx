import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, CheckCircle2, ChevronDown, FilePen } from 'lucide-react'
import type { RuleDefinition, RuleStatus } from '../../types/domain.ts'
import { fullDate, stamp } from '../../lib/client/format.ts'
import { Button, cx } from '../ui/primitives.tsx'
import { Badge } from '../ui/status.tsx'
import type { Tone } from '../ui/status.tsx'
import type { LucideIcon } from 'lucide-react'

/**
 * The rule table. Each rule opens to its description, its IF / THEN listing
 * in the same words the engine is documented with, and its notes. Nothing
 * here is paraphrased: the text is the rule set's own.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

export function dash(s: string): string {
  return s.replace(/ -- /g, ' — ')
}

const STATUS: Record<RuleStatus, { tone: Tone; icon: LucideIcon; label: string }> = {
  ACTIVE: { tone: 'green', icon: CheckCircle2, label: 'Active' },
  DRAFT: { tone: 'neutral', icon: FilePen, label: 'Draft' },
  SUPERSEDED: { tone: 'dim', icon: Archive, label: 'Superseded' },
}

function StatusBadge({ status }: { status: RuleStatus }) {
  const s = STATUS[status]
  return (
    <Badge tone={s.tone} icon={s.icon} size="sm">
      {s.label}
    </Badge>
  )
}

const COLS = 'lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_4rem_7rem_6.5rem_1.25rem] xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_4rem_7rem_6.5rem_minmax(0,0.9fr)_1.25rem]'

// IF / THEN listing ------------------------------------------------------------------------

type Keyword = 'IF' | 'AND' | 'OR' | 'THEN' | 'ELSE'

interface Line {
  kw: Keyword
  text: string
  group: 'if' | 'then'
}

function parse(rule: RuleDefinition): Line[] {
  const out: Line[] = []
  rule.conditions.forEach((raw, i) => {
    const m = /^(IF|AND|OR)\s+/i.exec(raw)
    const explicit = m ? (m[1]!.toUpperCase() as Keyword) : null
    const text = m ? raw.slice(m[0].length) : raw
    out.push({ kw: i === 0 ? 'IF' : explicit && explicit !== 'IF' ? explicit : 'AND', text, group: 'if' })
  })
  rule.outcomes.forEach((raw, i) => {
    const m = /^(THEN|ELSE|AND)\s+/i.exec(raw)
    const explicit = m ? (m[1]!.toUpperCase() as Keyword) : null
    const text = m ? raw.slice(m[0].length) : raw
    out.push({ kw: explicit ?? (i === 0 ? 'THEN' : 'AND'), text, group: 'then' })
  })
  return out
}

/** Operators and parenthetical comments recede; the operands carry the weight. */
function Expr({ text }: { text: string }) {
  const parts = dash(text).split(/(\s(?:=|<|>|\+|≤|≥)\s|\([^)]*\))/g)
  return (
    <>
      {parts.map((p, i) =>
        p === '' ? null : /^\s(?:=|<|>|\+|≤|≥)\s$/.test(p) ? (
          <span key={i} className="text-amber/80">
            {p}
          </span>
        ) : p.startsWith('(') ? (
          <span key={i} className="text-ink-3">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}

export function RuleListing({ rule }: { rule: RuleDefinition }) {
  const lines = parse(rule)
  return (
    <figure className="min-w-0 overflow-hidden rounded-lg border border-line bg-s2">
      <figcaption className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="micro">Rule listing</span>
        <span className="ident text-[11px] text-ink-3">
          {rule.id} v{rule.version}
        </span>
      </figcaption>
      <ol className="space-y-1.5 px-4 py-4 font-mono text-[12.5px] leading-[1.7] text-ink">
        {lines.map((l, i) => (
          <li key={i} className={cx('grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3', l.group === 'then' && lines[i - 1]?.group === 'if' && 'mt-3 border-t border-line pt-3')}>
            <span className="pt-[3px] text-[10.5px] font-medium uppercase tracking-[0.14em] text-amber">{l.kw}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <Expr text={l.text} />
            </span>
          </li>
        ))}
      </ol>
    </figure>
  )
}

// Row ---------------------------------------------------------------------------------------------

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="micro mb-1">{label}</dt>
      <dd className="min-w-0 text-sm text-ink-2">{children}</dd>
    </div>
  )
}

function RuleRow({ rule, open, onToggle }: { rule: RuleDefinition; open: boolean; onToggle: () => void }) {
  const panelId = `rule-${rule.id}`
  return (
    <li className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={cx('group block w-full min-w-0 text-left transition-colors duration-150 hover:bg-s2', open && 'bg-s1')}
      >
        {/* Stacked below lg */}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-1 py-4 lg:hidden">
          <span className="ident text-[12.5px] text-ink-2">{rule.id}</span>
          <ChevronDown className={cx('mt-0.5 h-4 w-4 text-ink-3 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
          <span className="col-span-2 text-sm font-medium text-ink">{rule.title}</span>
          <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusBadge status={rule.status} />
            <span className="mono text-xs text-ink-2">v{rule.version}</span>
            <span className="text-xs text-ink-3">Effective {fullDate(rule.effectiveFrom)}</span>
          </span>
          <span className="col-span-2 text-xs text-ink-3">{dash(rule.citation)}</span>
        </div>
        {/* Table layout from lg */}
        <div className={cx('hidden min-w-0 items-baseline gap-x-4 px-2 py-3.5 lg:grid', COLS)}>
          <span className="ident text-[12.5px] text-ink-2 group-hover:text-ink">{rule.id}</span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">{rule.title}</span>
            <span className="mt-0.5 block text-xs text-ink-3 xl:hidden">{dash(rule.citation)}</span>
          </span>
          <span className="mono text-sm text-ink-2">{rule.version}</span>
          <span className="mono text-xs text-ink-2">{fullDate(rule.effectiveFrom)}</span>
          <span>
            <StatusBadge status={rule.status} />
          </span>
          <span className="hidden min-w-0 text-xs text-ink-3 xl:block">{dash(rule.citation)}</span>
          <ChevronDown className={cx('h-4 w-4 self-center text-ink-3 transition-transform duration-200 group-hover:text-ink-2', open && 'rotate-180')} aria-hidden />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            id={panelId}
            role="region"
            aria-label={`${rule.id} ${rule.title}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: EASE }}
            className="overflow-hidden bg-s1"
          >
            <div className="grid min-w-0 gap-6 px-1 pb-7 pt-2 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-x-4 lg:px-2">
              <dl className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-1 lg:content-start">
                <Meta label="Version">
                  <span className="mono text-ink">{rule.version}</span>
                </Meta>
                <Meta label="Effective from">
                  <span className="mono text-xs">{stamp(rule.effectiveFrom)}</span>
                </Meta>
              </dl>
              <div className="min-w-0 max-w-4xl space-y-6">
                <p className="text-sm leading-relaxed text-ink-2">{dash(rule.description)}</p>
                <RuleListing rule={rule} />
                {rule.notes.length > 0 && (
                  <div>
                    <div className="micro mb-2">Notes</div>
                    <ul className="space-y-2">
                      {rule.notes.map((n, i) => (
                        <li key={i} className="flex gap-3 text-sm text-ink-2">
                          <span className="mt-[9px] h-px w-3 shrink-0 bg-ink-3" aria-hidden />
                          <span className="min-w-0">{dash(n)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <div className="micro mb-1.5">Citation</div>
                  <p className="text-sm text-ink-2">{dash(rule.citation)}</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

export function RuleList({ rules }: { rules: RuleDefinition[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allOpen = rules.length > 0 && rules.every((r) => open.has(r.id))
  const active = rules.filter((r) => r.status === 'ACTIVE').length
  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <span className="mono text-xs text-ink-2">
          {active} of {rules.length} active
        </span>
        <Button variant="quiet" size="sm" className="-mr-3" aria-pressed={allOpen} onClick={() => setOpen(allOpen ? new Set() : new Set(rules.map((r) => r.id)))}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>
      <div className={cx('hidden gap-x-4 border-b border-line px-2 pb-2 lg:grid', COLS)} aria-hidden>
        <span className="micro">Rule</span>
        <span className="micro">Title</span>
        <span className="micro">Version</span>
        <span className="micro">Effective</span>
        <span className="micro">Status</span>
        <span className="micro hidden xl:block">Citation</span>
        <span />
      </div>
      <ul aria-label="Rules" className="border-t border-line lg:border-t-0">
        {rules.map((r) => (
          <RuleRow key={r.id} rule={r} open={open.has(r.id)} onToggle={() => toggle(r.id)} />
        ))}
      </ul>
    </div>
  )
}
