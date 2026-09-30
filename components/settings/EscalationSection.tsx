import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Bell, FlaskConical, Save, Undo2 } from 'lucide-react'
import type { EscalationRule, NotificationSeverity, RoleId } from '../../types/domain.ts'
import { ROLE_ORDER } from '../../lib/rbac.ts'
import { api } from '../../lib/client/api.ts'
import { useAction } from '../../lib/client/queries.ts'
import { Button, Checkbox, Panel, Select, TextInput, cx } from '../ui/primitives.tsx'
import { Badge, TONE_DOT, TONE_TEXT } from '../ui/status.tsx'
import { EmptyState, ErrorState } from '../ui/feedback.tsx'
import { useToast } from '../ui/overlay.tsx'
import { LEVEL_META, ReadOnlyNote, SectionHeader, formatOffset, roleLabel } from './common.tsx'

/**
 * Deadline escalation: operational reminders a fixed time before each running
 * deadline. They never move a deadline. Demo behaviour: they surface in the
 * notification centre only.
 */

type Target = RoleId | 'owner'

interface Draft {
  id: string
  hours: string
  targetRole: Target
  level: NotificationSeverity
  active: boolean
  label: string
  original: EscalationRule
}

const MAX_HOURS = 14 * 24
const TARGETS: Target[] = ['owner', ...ROLE_ORDER]
const LEVELS: NotificationSeverity[] = ['info', 'watch', 'critical']

function toDraft(r: EscalationRule): Draft {
  return { id: r.id, hours: String(Math.round((r.offsetMinutes / 60) * 100) / 100), targetRole: r.targetRole, level: r.level, active: r.active, label: r.label, original: r }
}

function minutesOf(hours: string): number | null {
  if (!hours.trim()) return null
  const h = Number(hours)
  if (!Number.isFinite(h) || h < 0 || h > MAX_HOURS) return null
  return Math.round(h * 60)
}

function sortRules(rules: EscalationRule[]): EscalationRule[] {
  return [...rules].sort((a, b) => b.offsetMinutes - a.offsetMinutes)
}

export function EscalationSection({ rules, editable, role }: { rules: EscalationRule[]; editable: boolean; role: RoleId | undefined }) {
  return (
    <section aria-label="Deadline escalation">
      <SectionHeader
        eyebrow="Decisions"
        title="Deadline escalation"
        description={
          <>
            <p>
              Each step fires a fixed time before a running deadline (early warning, vulnerability notification, final report) on every open case. The most recent step that has fired is shown to its target role and always to the case owner.
            </p>
            <p>Escalations are reminders. They never move a deadline, and a deadline is never extended by the absence of one.</p>
          </>
        }
      />
      <div className="mb-6 flex min-w-0 items-start gap-2.5 rounded-lg border border-dashed border-amber-line px-4 py-3">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden />
        <p className="text-sm text-ink-2">
          <span className="micro mr-2 text-amber">Fictional demo behaviour</span>
          Escalations appear in the notification centre only. Nothing is sent by email, SMS or pager.
        </p>
      </div>
      {editable ? <EscalationEditor key={JSON.stringify(rules)} rules={rules} /> : <EscalationReadOnly rules={rules} role={role} />}
    </section>
  )
}

interface Marker {
  id: string
  minutes: number
  level: NotificationSeverity
  target: Target
  active: boolean
}

/** A horizontal scale from the earliest step to the deadline, with a marker per step. */
function EscalationScale({ markers }: { markers: Marker[] }) {
  const railRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  // Role labels are shown from the sm breakpoint up; below it only offsets and levels.
  const [showRoles, setShowRoles] = useState(true)
  useEffect(() => {
    const el = railRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
      setShowRoles(window.matchMedia('(min-width: 640px)').matches)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const maxMinutes = Math.max(12 * 60, ...markers.map((m) => m.minutes))
  const placed = [...markers]
    .sort((a, b) => b.minutes - a.minutes)
    .map((m) => ({ ...m, left: (1 - m.minutes / maxMinutes) * 100 }))

  // Labels at either end are anchored inwards so they never leave the rail.
  const edge = (left: number): 'start' | 'end' | 'center' => (left < 8 ? 'start' : left > 92 ? 'end' : 'center')
  const anchor = (left: number) => ({ start: 'translate-x-0 items-start text-left', end: '-translate-x-full items-end text-right', center: '-translate-x-1/2 items-center text-center' })[edge(left)]
  // Each label goes on the first row where it does not overlap its neighbour.
  // Widths are estimated from the label text; the rail width is measured.
  const extent = (m: (typeof placed)[number]): [number, number] => {
    const short = Math.max(formatOffset(m.minutes).length * 7.8, LEVEL_META[m.level].label.length * 7.4)
    const w = (showRoles ? Math.max(short, roleLabel(m.target).length * 6.6) : short) + 10
    const x = (m.left / 100) * width
    const e = edge(m.left)
    return e === 'start' ? [x, x + w] : e === 'end' ? [x - w, x] : [x - w / 2, x + w / 2]
  }
  const rows: number[] = []
  const rowEnds: number[] = []
  placed.forEach((m, i) => {
    const [a, b] = extent(m)
    let r = rowEnds.findIndex((end) => a >= end + 8)
    if (r === -1) r = Math.min(rowEnds.length, 3)
    rows[i] = r
    rowEnds[r] = Math.max(rowEnds[r] ?? -Infinity, b)
  })
  const maxRow = Math.max(0, ...rows)
  // Row 0: role above the rail, offset and level below it. Lower rows stack everything below.
  const ROW_H = showRoles ? 52 : 36
  const lowerTop = (r: number) => (r === 0 ? 6 : 40 + (r - 1) * ROW_H)
  const lowerHeight = maxRow === 0 ? 44 : 40 + maxRow * ROW_H
  return (
    <figure className="min-w-0" aria-label="Escalation timeline">
      <div ref={railRef} className="relative mx-1.5">
        {/* Upper labels: who is notified (hidden on small screens, listed below instead) */}
        <div className="relative hidden h-9 sm:block">
          {placed.map((m, i) =>
            rows[i] === 0 ? (
              <span
                key={m.id}
                className={cx('absolute bottom-2 flex max-w-[160px] truncate text-[11.5px]', anchor(m.left), m.active ? 'text-ink-2' : 'text-ink-4 line-through')}
                style={{ left: `${m.left}%` }}
                title={roleLabel(m.target)}
              >
                {roleLabel(m.target)}
              </span>
            ) : null,
          )}
        </div>
        {/* Rail */}
        <div className="relative h-5">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-bright" />
          <div className="absolute right-0 top-1/2 h-4 w-px -translate-y-1/2 bg-ink-3" aria-hidden />
          {placed.map((m, i) => {
            const tone = LEVEL_META[m.level].tone
            return (
              <motion.span
                key={m.id}
                initial={{ opacity: 0, scale: 0.6, left: `${m.left}%` }}
                animate={{ opacity: 1, scale: 1, left: `${m.left}%` }}
                transition={{ type: 'spring', stiffness: 420, damping: 34, delay: i * 0.04 }}
                className={cx('absolute top-1/2 -ml-1.5 -mt-1.5 h-3 w-3 rounded-full border-2 border-canvas', m.active ? TONE_DOT[tone] : 'bg-s4 ring-1 ring-line-bright')}
                aria-hidden
              />
            )
          })}
        </div>
        {/* Lower labels: offset and level */}
        <div className="relative" style={{ height: lowerHeight }}>
          {placed.map((m, i) => {
            const tone = LEVEL_META[m.level].tone
            const row = rows[i] ?? 0
            return (
              <span key={m.id} className={cx('absolute flex flex-col whitespace-nowrap', anchor(m.left))} style={{ left: `${m.left}%`, top: lowerTop(row) }}>
                <span className={cx('mono text-[12.5px]', m.active ? 'text-ink' : 'text-ink-4 line-through')}>{formatOffset(m.minutes)}</span>
                <span className={cx('font-mono text-[10px] uppercase tracking-[0.1em]', m.active ? TONE_TEXT[tone] : 'text-ink-4')}>{m.active ? LEVEL_META[m.level].label : 'Off'}</span>
                {row > 0 && showRoles && <span className="max-w-[160px] truncate text-[11.5px] text-ink-2">{roleLabel(m.target)}</span>}
              </span>
            )
          })}
        </div>
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2 text-[11px] text-ink-3">
        <span>Earlier</span>
        <span className="text-right">Deadline due</span>
      </figcaption>
      <ul className="sr-only">
        {placed.map((m) => (
          <li key={m.id}>
            {formatOffset(m.minutes)}: notify {roleLabel(m.target)}, level {LEVEL_META[m.level].label}
            {m.active ? '' : ', inactive'}
          </li>
        ))}
      </ul>
    </figure>
  )
}

function LevelBadge({ level }: { level: NotificationSeverity }) {
  const meta = LEVEL_META[level]
  return (
    <Badge tone={meta.tone} size="sm">
      {meta.label}
    </Badge>
  )
}

function EscalationReadOnly({ rules, role }: { rules: EscalationRule[]; role: RoleId | undefined }) {
  const sorted = sortRules(rules)
  if (sorted.length === 0) {
    return <EmptyState icon={Bell} title="No escalation steps" why="No step fires before a deadline, so nobody is reminded as one approaches. The Administrator can define steps here." />
  }
  return (
    <>
      <Panel className="mb-6 px-4 py-5 sm:px-6">
        <EscalationScale markers={sorted.map((r) => ({ id: r.id, minutes: r.offsetMinutes, level: r.level, target: r.targetRole, active: r.active }))} />
      </Panel>
      <ol className="border-t border-line">
        {sorted.map((r) => (
          <li key={r.id} className={cx('grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-start gap-x-4 gap-y-1 border-b border-line py-3.5 sm:grid-cols-[96px_minmax(0,1fr)_auto_auto] sm:items-center', !r.active && 'opacity-60')}>
            <span className="mono text-md text-ink">{formatOffset(r.offsetMinutes)}</span>
            <span className="min-w-0">
              <span className="block text-sm text-ink">Notify {roleLabel(r.targetRole)}</span>
              <span className="block text-xs text-ink-3">{r.label}</span>
            </span>
            <span className="col-start-2 flex items-center gap-3 sm:col-start-auto">
              <LevelBadge level={r.level} />
              <span className="text-xs text-ink-3">{r.active ? 'Active' : 'Inactive'}</span>
            </span>
            <span className="ident col-start-2 text-[11px] text-ink-3 sm:col-start-auto">{r.id}</span>
          </li>
        ))}
      </ol>
      <ReadOnlyNote role={role} className="mt-5" />
    </>
  )
}

function EscalationEditor({ rules }: { rules: EscalationRule[] }) {
  const toast = useToast()
  const initial = useMemo(() => sortRules(rules).map(toDraft), [rules])
  const [rows, setRows] = useState<Draft[]>(initial)
  const save = useAction((body: { rules: EscalationRule[] }) => api<{ ok: true }>('/api/settings/escalation', { method: 'PUT', body }))

  const patch = (id: string, p: Partial<Draft>) => setRows((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const built = rows.map((r) => {
    const minutes = minutesOf(r.hours)
    const changed = minutes !== r.original.offsetMinutes || r.targetRole !== r.original.targetRole
    const label = minutes === null ? r.label : changed ? `${formatOffset(minutes)}: notify ${roleLabel(r.targetRole)}` : r.label
    return { row: r, minutes, rule: { id: r.id, offsetMinutes: minutes ?? 0, targetRole: r.targetRole, level: r.level, label: label.slice(0, 80), active: r.active } satisfies EscalationRule }
  })
  const invalid = built.filter((b) => b.minutes === null)
  const dirty = built.some(({ row, rule }) => {
    const o = row.original
    return rule.offsetMinutes !== o.offsetMinutes || rule.targetRole !== o.targetRole || rule.level !== o.level || rule.active !== o.active || rule.label !== o.label
  })

  const submit = () => {
    if (invalid.length) return
    save.mutate(
      { rules: built.map((b) => b.rule) },
      {
        onSuccess: () => toast({ tone: 'success', title: 'Escalation policy saved', body: `${built.length} steps. Recorded in the audit ledger with the policy before and after.` }),
        onError: (e) => toast({ tone: 'error', title: 'Escalation policy not saved', body: e.message }),
      },
    )
  }

  if (rows.length === 0) {
    return <EmptyState icon={Bell} title="No escalation steps" why="No step fires before a deadline, so nobody is reminded as one approaches. Reset the demo data to restore the default four-step policy." />
  }

  return (
    <>
      <Panel className="mb-6 px-4 py-5 sm:px-6">
        <EscalationScale markers={built.filter((b) => b.minutes !== null).map((b) => ({ id: b.row.id, minutes: b.minutes!, level: b.row.level, target: b.row.targetRole, active: b.row.active }))} />
      </Panel>

      <Panel>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="hidden grid-cols-[64px_150px_minmax(0,1fr)_130px_84px] gap-4 border-b border-line px-6 py-3 lg:grid">
            <span className="micro">Step</span>
            <span className="micro">Hours before due</span>
            <span className="micro">Notify</span>
            <span className="micro">Level</span>
            <span className="micro text-right">Active</span>
          </div>
          <ol>
            {built.map(({ row, minutes }) => {
              const bad = minutes === null
              return (
                <li key={row.id} className="grid min-w-0 gap-3 border-b border-line px-5 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-[64px_150px_minmax(0,1fr)_130px_84px] lg:items-center lg:gap-4">
                  <div className="flex items-baseline justify-between gap-3 sm:col-span-2 lg:col-span-1 lg:block">
                    <span className="ident text-[12px] text-ink-3">{row.id}</span>
                    <span className="mono text-sm text-ink lg:hidden">{bad ? 'Invalid' : formatOffset(minutes)}</span>
                  </div>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs text-ink-3 lg:sr-only">Hours before due</span>
                    <span className="flex items-center gap-2">
                      <TextInput
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={MAX_HOURS}
                        step={0.5}
                        value={row.hours}
                        onChange={(e) => patch(row.id, { hours: e.target.value })}
                        invalid={bad}
                        className="w-24 font-mono tabular"
                        aria-describedby={bad ? `${row.id}-err` : undefined}
                      />
                      <span className="mono hidden text-xs text-ink-3 lg:inline">{bad ? '' : formatOffset(minutes)}</span>
                    </span>
                    {bad && (
                      <span id={`${row.id}-err`} className="mt-1 block text-xs text-red" role="alert">
                        0 to {MAX_HOURS} hours.
                      </span>
                    )}
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs text-ink-3 lg:sr-only">Notify</span>
                    <Select value={row.targetRole} onChange={(e) => patch(row.id, { targetRole: e.target.value as Target })}>
                      {TARGETS.map((t) => (
                        <option key={t} value={t}>
                          {roleLabel(t)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs text-ink-3 lg:sr-only">Level</span>
                    <Select value={row.level} onChange={(e) => patch(row.id, { level: e.target.value as NotificationSeverity })}>
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {LEVEL_META[l].label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <div className="flex items-center lg:justify-end">
                    <Checkbox checked={row.active} onChange={(v) => patch(row.id, { active: v })} label={<span className="lg:sr-only">Active</span>} />
                  </div>
                </li>
              )
            })}
          </ol>
          {save.error && (
            <div className="px-5 pt-5 sm:px-6">
              <ErrorState error={save.error} />
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs text-ink-3">
              {invalid.length ? `${invalid.length} step${invalid.length === 1 ? ' has' : 's have'} an invalid offset.` : dirty ? 'Unsaved changes. A changed step gets a new label from its offset and target.' : 'No unsaved changes.'}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setRows(initial)} disabled={!dirty || save.isPending}>
                Revert
              </Button>
              <Button type="submit" variant="primary" icon={<Save className="h-3.5 w-3.5" />} busy={save.isPending} disabled={!dirty || invalid.length > 0}>
                Save policy
              </Button>
            </div>
          </div>
        </form>
      </Panel>
    </>
  )
}
