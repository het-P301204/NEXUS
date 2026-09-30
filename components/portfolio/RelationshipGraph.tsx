import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CircleDashed,
  Info,
  MousePointerClick,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Timer,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ComponentListItem, GraphNode, GraphResponse, ProductListItem } from '../../types/api.ts'
import type { ExploitationStatus, Severity } from '../../types/domain.ts'
import { inRange } from '../../lib/engine/versions.ts'
import { humanize } from '../../lib/client/format.ts'
import { Checkbox, IconButton, Segmented, Select, cx } from '../ui/primitives.tsx'
import { AffectednessBadge, Badge, EXPLOITATION, ExploitationBadge, SeverityMark } from '../ui/status.tsx'
import { EmptyState } from '../ui/feedback.tsx'
import { COLUMNS, COLUMN_LABELS, buildModel, edgeKey, edgePath, edgeTones, filterPaths, layoutGraph, unionOf } from './graphModel.ts'
import type { Box, EdgeTone, GPath, GraphModel } from './graphModel.ts'
import { EXPOSURE, NoDeterminationMark, RangeMark, RiskBadge, SbomMark, fmtCount } from './shared.tsx'

/**
 * The relationship graph: CVE -> component -> version -> product ->
 * deployment -> determination, laid out by hand in six columns. The point it
 * makes is the gap between amber and red: a product can contain a vulnerable
 * component version without being affected. Only a determination recorded
 * in a case says it is.
 */

const BASE = {
  colW: [124, 120, 96, 148, 128, 164],
  gapX: [26, 22, 56, 32, 32, 0],
  padX: 12,
  nodeH: 42,
  versionH: 36,
  laneH: 8,
  gapY: 6,
  groupGapY: 14,
}
const BASE_WIDTH = BASE.colW.reduce((a, b) => a + b, 0) + BASE.gapX.reduce((a, b) => a + b, 0) + BASE.padX * 2
const PAD_Y = 14

const STROKE: Record<EdgeTone, string> = {
  neutral: 'rgba(236,231,221,0.17)',
  amber: 'rgba(231,162,74,0.78)',
  red: 'rgba(236,106,88,0.92)',
}

type View = 'diagram' | 'list'

export function RelationshipGraph({ graph, products, components }: { graph: GraphResponse; products: ProductListItem[]; components: ComponentListItem[] }) {
  const model = useMemo(() => buildModel(graph), [graph])
  const tones = useMemo(() => edgeTones(model), [model])
  const [vulnId, setVulnId] = useState('')
  const [onlyAffected, setOnlyAffected] = useState(false)
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'list' : 'diagram'))
  const [selectedRaw, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const filtered = useMemo(() => filterPaths(model, { vulnId, onlyAffected }), [model, vulnId, onlyAffected])
  const visible = useMemo(() => {
    if (!filtered) return { nodes: new Set(model.byId.keys()), edges: null as Set<string> | null }
    return unionOf(filtered)
  }, [filtered, model])
  const selected = selectedRaw && visible.nodes.has(selectedRaw) ? selectedRaw : null
  const active = selected ?? (hovered && visible.nodes.has(hovered) ? hovered : null)
  const focus = useMemo(() => {
    if (!active) return null
    const pool = filtered ?? model.paths
    const u = unionOf(pool.filter((p) => p.nodes.includes(active)))
    u.nodes.add(active)
    return u
  }, [active, filtered, model])

  const vulnOptions = useMemo(
    () => graph.nodes.filter((n) => n.kind === 'vulnerability').sort((a, b) => a.label.localeCompare(b.label)),
    [graph],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const id of visible.nodes) {
      const k = model.byId.get(id)?.kind
      if (k) c[k] = (c[k] ?? 0) + 1
    }
    return c
  }, [visible, model])

  const clear = () => {
    setVulnId('')
    setOnlyAffected(false)
  }

  return (
    <section aria-label="Relationship graph" className="min-w-0">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <p className="max-w-2xl text-sm text-ink-2">
          <span className="text-amber">Amber</span> paths reach a product that <em className="not-italic text-ink">contains</em> a component version inside a vulnerable range.{' '}
          <span className="text-red">Red</span> paths end in an <em className="not-italic text-ink">AFFECTED</em> determination recorded in a case. Containing the vulnerable component is a reason to investigate, not a conclusion.
        </p>
        <div className="shrink-0">
        <Segmented<View>
          label="Graph view"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'diagram', label: 'Diagram' },
            { value: 'list', label: 'Paths list' },
          ]}
        />
        </div>
      </div>

      <div className="mt-5 flex min-w-0 flex-col gap-4 border-y border-line py-4 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
          <Select value={vulnId} onChange={(e) => setVulnId(e.target.value)} aria-label="Filter by CVE" className="sm:w-72">
            <option value="">All vulnerabilities</option>
            {vulnOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {v.meta.severity ? humanize(v.meta.severity) : ''}
              </option>
            ))}
          </Select>
          <Checkbox checked={onlyAffected} onChange={setOnlyAffected} label="Only affected paths" description="Paths that end in an AFFECTED determination" />
        </div>
        <Legend />
      </div>

      {filtered && filtered.length === 0 ? (
        <EmptyState
          compact
          icon={ShieldCheck}
          title="No path matches"
          why={
            onlyAffected
              ? 'No product has an AFFECTED determination for this selection. That is a recorded result, not an absence of data: in-range products may still be under investigation.'
              : 'This vulnerability is not linked to a component in any product SBOM.'
          }
          action={
            <button type="button" onClick={clear} className="text-sm text-ink-2 underline decoration-line-bright underline-offset-4 hover:text-ink">
              Clear filters
            </button>
          }
        />
      ) : view === 'diagram' ? (
        <Diagram
          model={model}
          tones={tones}
          visible={visible}
          focus={focus}
          selected={selected}
          counts={counts}
          onSelect={(id) => setSelected((s) => (s === id ? null : id))}
          onHover={setHovered}
          onClear={() => setSelected(null)}
        />
      ) : (
        <PathList model={model} paths={(filtered ?? model.paths).filter((p) => p.v && p.p)} />
      )}

      <AnimatePresence>
        {selected && view === 'diagram' && (
          <motion.div
            key="inspector"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="sticky bottom-[76px] z-20 mt-4 lg:bottom-4"
          >
            <Inspector id={selected} model={model} paths={filtered ?? model.paths} products={products} components={components} onClose={() => setSelected(null)} onSelect={setSelected} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Diagram
// ---------------------------------------------------------------------------

function Diagram({
  model,
  tones,
  visible,
  focus,
  selected,
  counts,
  onSelect,
  onHover,
  onClear,
}: {
  model: GraphModel
  tones: Map<string, EdgeTone>
  visible: { nodes: Set<string>; edges: Set<string> | null }
  focus: { nodes: Set<string>; edges: Set<string> } | null
  selected: string | null
  counts: Record<string, number>
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onClear: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(BASE_WIDTH)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setAvail(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const k = Math.min(1.3, Math.max(1, avail / BASE_WIDTH))
  const layout = useMemo(
    () =>
      layoutGraph(model, visible.nodes, visible.edges, {
        ...BASE,
        colW: BASE.colW.map((w) => Math.round(w * k)),
        gapX: BASE.gapX.map((g) => Math.round(g * k)),
      }),
    [model, visible, k],
  )
  const refs = useRef(new Map<string, HTMLButtonElement>())

  const edges = useMemo(() => {
    const list = model.edges
      .filter((e) => layout.boxes.has(e.from) && layout.boxes.has(e.to) && (!visible.edges || visible.edges.has(edgeKey(e.from, e.to))))
      .map((e) => {
        const key = edgeKey(e.from, e.to)
        const d = edgePath(layout, e.from, e.to, model.byId.get(e.from)?.kind ?? '', model.byId.get(e.to)?.kind ?? '')
        const tone = tones.get(key) ?? 'neutral'
        const on = focus ? focus.edges.has(key) : false
        return { key, d, tone, on }
      })
    const rank = (x: { tone: EdgeTone; on: boolean }) => (x.on ? 10 : 0) + (x.tone === 'red' ? 2 : x.tone === 'amber' ? 1 : 0)
    return list.sort((a, b) => rank(a) - rank(b))
  }, [model, layout, visible, tones, focus])

  const move = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
      const box = layout.boxes.get(id)
      if (!box) return
      if (e.key === 'Escape') {
        onClear()
        return
      }
      const inCol = (col: number) => [...layout.boxes.values()].filter((b) => b.col === col && !b.lane).sort((a, b) => a.y - b.y)
      let target: string | undefined
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = inCol(box.col)
        const i = list.findIndex((b) => b.id === id)
        target = list[i + (e.key === 'ArrowDown' ? 1 : -1)]?.id
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const dir = e.key === 'ArrowRight' ? 1 : -1
        for (let col = box.col + dir; col >= 0 && col < COLUMNS.length && !target; col += dir) {
          const list = inCol(col)
          if (!list.length) continue
          const cy = box.y + box.h / 2
          const linked = list.filter((b) => (model.out.get(id) ?? []).some((x) => x.to === b.id) || (model.inc.get(id) ?? []).some((x) => x.from === b.id))
          const pool = linked.length ? linked : list
          target = pool.reduce((best, b) => (Math.abs(b.y + b.h / 2 - cy) < Math.abs(best.y + best.h / 2 - cy) ? b : best)).id
        }
      } else return
      e.preventDefault()
      if (target) refs.current.get(target)?.focus()
    },
    [layout, model, onClear],
  )

  const height = layout.height + PAD_Y * 2
  return (
    <div className="mt-5 min-w-0">
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-3">
        <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
        Select a node to trace its paths upstream and downstream. Arrow keys move between nodes; Escape clears.
      </div>
      <div ref={scrollRef} className="relative min-w-0 overflow-x-auto rounded-xl border border-line bg-s1" onMouseLeave={() => onHover(null)}>
        <div style={{ width: Math.max(layout.width, avail) }} className="relative">
          <div className="relative border-b border-line" style={{ height: 38 }}>
            {COLUMNS.map((kind, i) => (
              <div key={kind} className="absolute top-0 flex h-full items-center gap-2" style={{ left: layout.colX[i], width: layout.colW[i] }}>
                <span className="micro">{COLUMN_LABELS[kind]}</span>
                <span className="mono text-[10.5px] text-ink-4">{counts[kind] ?? 0}</span>
              </div>
            ))}
          </div>
          <div
            className="relative"
            style={{ height }}
            onClick={(e) => {
              if (e.target === e.currentTarget) onClear()
            }}
          >
            <svg className="pointer-events-none absolute left-0 top-0" width={layout.width} height={height} aria-hidden>
              <g transform={`translate(0 ${PAD_Y})`}>
                {edges.map((e) =>
                  e.d ? (
                    <motion.path
                      key={e.key}
                      initial={false}
                      animate={{ d: e.d, opacity: focus ? (e.on ? 1 : 0.07) : 1 }}
                      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                      fill="none"
                      stroke={focus && e.on && e.tone === 'neutral' ? 'rgba(236,231,221,0.55)' : STROKE[e.tone]}
                      strokeWidth={focus && e.on ? 1.8 : e.tone === 'neutral' ? 1 : 1.4}
                      strokeLinecap="round"
                    />
                  ) : null,
                )}
              </g>
            </svg>
            {[...layout.boxes.values()]
              .filter((b) => !b.lane)
              .map((b) => {
                const n = model.byId.get(b.id)
                if (!n) return null
                const dim = focus ? !focus.nodes.has(b.id) : false
                return (
                  <GraphNodeButton
                    key={b.id}
                    node={n}
                    model={model}
                    box={b}
                    dim={dim}
                    selected={selected === b.id}
                    onSelect={onSelect}
                    onHover={onHover}
                    onKeyDown={move}
                    buttonRef={(el) => {
                      if (el) refs.current.set(b.id, el)
                      else refs.current.delete(b.id)
                    }}
                  />
                )
              })}
          </div>
        </div>
      </div>
      {layout.width > avail + 1 && <p className="mt-2 text-xs text-ink-3">The diagram is wider than this screen. Scroll it sideways, or use the paths list.</p>}
    </div>
  )
}

function nodeTone(n: GraphNode): string {
  if (n.kind === 'vulnerability' && n.state === 'exploited') return 'border-red-line'
  if (n.kind === 'version' && n.state === 'under_investigation') return 'border-amber-line'
  if (n.kind === 'product' && (n.state === 'clock' || n.state === 'affected')) return 'border-red-line'
  if (n.kind === 'determination') return n.state === 'affected' ? 'border-red-line' : n.state === 'not_affected' ? 'border-green-line' : 'border-amber-line'
  return 'border-line-strong'
}

function ariaFor(n: GraphNode, model: GraphModel): string {
  switch (n.kind) {
    case 'vulnerability':
      return `Vulnerability ${n.label}, ${humanize(n.meta.severity ?? '')}, ${EXPLOITATION[(n.meta.exploitation ?? 'UNKNOWN') as ExploitationStatus].label}`
    case 'component':
      return `Component ${n.label}, ${n.sublabel}`
    case 'version':
      return `Version ${n.label}, ${n.state === 'under_investigation' ? 'in vulnerable range' : 'no matching range'}`
    case 'product':
      return `Product ${n.label} ${n.sublabel}${n.state === 'clock' ? ', reporting clock running' : n.state === 'affected' ? ', affected' : ''}`
    case 'deployment':
      return `Deployment ${n.label}, ${n.sublabel}`
    case 'determination': {
      const d = model.det.get(n.id)
      return `Determination ${n.id}, ${humanize(d?.result ?? '')}, ${d?.caseId ?? ''}`
    }
  }
}

function GraphNodeButton({
  node: n,
  model,
  box,
  dim,
  selected,
  onSelect,
  onHover,
  onKeyDown,
  buttonRef,
}: {
  node: GraphNode
  model: GraphModel
  box: Box
  dim: boolean
  selected: boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>, id: string) => void
  buttonRef: (el: HTMLButtonElement | null) => void
}) {
  return (
    <motion.button
      ref={buttonRef}
      type="button"
      aria-pressed={selected}
      aria-label={ariaFor(n, model)}
      title={n.kind === 'vulnerability' ? `${n.label}: ${n.sublabel}` : `${n.label}${n.sublabel ? ` · ${n.sublabel}` : ''}`}
      onClick={() => onSelect(n.id)}
      onMouseEnter={() => onHover(n.id)}
      onFocus={() => onHover(n.id)}
      onBlur={() => onHover(null)}
      onKeyDown={(e) => onKeyDown(e, n.id)}
      initial={{ opacity: 0, left: box.x, top: box.y + PAD_Y }}
      animate={{ opacity: dim ? 0.28 : 1, left: box.x, top: box.y + PAD_Y }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], opacity: { duration: 0.18, delay: 0 } }}
      style={{ width: box.w, height: box.h }}
      className={cx(
        'absolute flex min-w-0 flex-col justify-center overflow-hidden rounded-md border px-2 text-left transition-[background-color,box-shadow,border-color] duration-150',
        nodeTone(n),
        selected ? 'bg-s4 shadow-[0_0_0_1px_rgba(236,231,221,0.35)]' : 'bg-s2 hover:bg-s3',
      )}
    >
      <NodeBody n={n} model={model} />
    </motion.button>
  )
}

function Marker({ icon: Icon, tone, children }: { icon?: LucideIcon; tone: 'red' | 'amber' | 'green' | 'dim'; children: ReactNode }) {
  const t = { red: 'text-red', amber: 'text-amber', green: 'text-green', dim: 'text-ink-3' }[tone]
  return (
    <span className={cx('inline-flex min-w-0 shrink-0 items-center gap-1 font-mono text-[9.5px] uppercase leading-3 tracking-[0.05em]', t)}>
      {Icon && <Icon className="h-[11px] w-[11px] shrink-0" aria-hidden strokeWidth={2.2} />}
      <span className="truncate">{children}</span>
    </span>
  )
}

function NodeBody({ n, model }: { n: GraphNode; model: GraphModel }) {
  switch (n.kind) {
    case 'vulnerability': {
      const ex = (n.meta.exploitation ?? 'UNKNOWN') as ExploitationStatus
      return (
        <>
          <span className="mono shrink-0 truncate text-[11px] leading-4 text-ink">{n.label}</span>
          <span className="mt-1 flex min-w-0 shrink-0 items-center justify-between gap-1 leading-3">
            {ex === 'CONFIRMED' ? (
              <Marker icon={AlertOctagon} tone="red">
                Exploited
              </Marker>
            ) : ex === 'SUSPECTED' ? (
              <Marker icon={AlertTriangle} tone="amber">
                Suspected
              </Marker>
            ) : (
              <Marker tone="dim">{EXPLOITATION[ex].label}</Marker>
            )}
            {n.meta.severity && <SeverityMark severity={n.meta.severity as Severity} showLabel={false} />}
          </span>
        </>
      )
    }
    case 'component':
      return (
        <>
          <span className="shrink-0 truncate text-[12px] leading-4 text-ink">{n.label}</span>
          <span className="mono mt-0.5 shrink-0 truncate text-[10px] leading-3 text-ink-3">{n.sublabel}</span>
        </>
      )
    case 'version':
      return (
        <>
          <span className="mono shrink-0 truncate text-[11.5px] leading-4 text-ink">{n.meta.version ?? n.label}</span>
          <span className="mt-0.5 flex shrink-0 leading-3">
            {n.state === 'under_investigation' ? (
              <Marker icon={AlertTriangle} tone="amber">
                In range
              </Marker>
            ) : (
              <Marker tone="dim">No match</Marker>
            )}
          </span>
        </>
      )
    case 'product':
      return (
        <>
          <span className="shrink-0 truncate text-[12px] leading-4 text-ink">{n.label}</span>
          <span className="mt-0.5 flex min-w-0 shrink-0 items-center gap-2">
            <span className="mono shrink-0 text-[10.5px] leading-3 text-ink-2">{n.sublabel}</span>
            {n.state === 'clock' ? (
              <Marker icon={Timer} tone="red">
                Clock
              </Marker>
            ) : n.state === 'affected' ? (
              <Marker icon={ShieldAlert} tone="red">
                Affected
              </Marker>
            ) : null}
          </span>
        </>
      )
    case 'deployment':
      return (
        <>
          <span className="shrink-0 truncate text-[12px] leading-4 text-ink">{n.label}</span>
          <span className="mono mt-0.5 shrink-0 truncate text-[10px] leading-3 text-ink-3">{n.sublabel}</span>
        </>
      )
    case 'determination': {
      const d = model.det.get(n.id)
      const r = d?.result ?? 'UNDER_INVESTIGATION'
      return (
        <>
          {r === 'AFFECTED' ? (
            <Marker icon={ShieldAlert} tone="red">
              Affected
            </Marker>
          ) : r === 'NOT_AFFECTED' ? (
            <Marker icon={ShieldCheck} tone="green">
              Not affected
            </Marker>
          ) : (
            <Marker icon={ShieldQuestion} tone="amber">
              Under investigation
            </Marker>
          )}
          <span className="mono mt-1 shrink-0 truncate text-[10px] leading-3 text-ink-3">
            {n.id} · {d?.caseId ?? ''}
          </span>
        </>
      )
    }
  }
}

function Legend() {
  const line = (tone: EdgeTone, label: string) => (
    <li className="flex items-center gap-2">
      <svg width="22" height="8" aria-hidden>
        <path d="M1,4 L21,4" stroke={STROKE[tone]} strokeWidth={tone === 'neutral' ? 1.2 : 1.8} strokeLinecap="round" />
      </svg>
      {label}
    </li>
  )
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-2" aria-label="Legend">
      {line('neutral', 'Relationship')}
      {line('amber', 'In range or exploited')}
      {line('red', 'Determined affected')}
      <li className="flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-green" aria-hidden /> Not affected
      </li>
      <li className="flex items-center gap-1.5">
        <Timer className="h-3.5 w-3.5 text-red" aria-hidden /> Clock running
      </li>
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Paths list (the narrow-screen and screen-reader alternative)
// ---------------------------------------------------------------------------

function DetCell({ p, model }: { p: GPath; model: GraphModel }) {
  if (!p.dets.length) return <NoDeterminationMark />
  return (
    <div className="flex flex-col items-start gap-1.5">
      {p.dets.map((d) => {
        const info = model.det.get(d)
        return (
          <div key={d} className="flex flex-wrap items-center gap-2">
            <AffectednessBadge result={info?.result ?? 'UNDER_INVESTIGATION'} size="sm" />
            {info?.caseId && (
              <Link to={`/cases/${info.caseId}`} className="ident text-[11px] text-ink-3 hover:text-ink">
                {d} · {info.caseId}
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PathList({ model, paths }: { model: GraphModel; paths: GPath[] }) {
  const rows = useMemo(
    () =>
      [...paths].sort((a, b) => {
        const va = model.byId.get(a.v ?? '')?.label ?? ''
        const vb = model.byId.get(b.v ?? '')?.label ?? ''
        return va.localeCompare(vb) || (model.byId.get(a.p ?? '')?.label ?? '').localeCompare(model.byId.get(b.p ?? '')?.label ?? '')
      }),
    [paths, model],
  )
  if (rows.length === 0) {
    return <EmptyState compact icon={Info} title="No CVE-to-product paths" why="No vulnerability links to a component version in a product SBOM for this selection." />
  }
  const label = (id: string | null) => (id ? (model.byId.get(id)?.label ?? id) : '--')
  return (
    <div className="mt-5 min-w-0">
      <div className="hidden min-w-0 overflow-hidden rounded-xl border border-line md:block">
        <table className="w-full table-fixed text-left">
          <thead className="border-b border-line bg-s1">
            <tr>
              <th className="micro w-[18%] px-4 py-3 font-normal">CVE</th>
              <th className="micro w-[18%] px-3 py-3 font-normal">Component</th>
              <th className="micro w-[22%] px-3 py-3 font-normal">Product</th>
              <th className="micro w-[16%] px-3 py-3 font-normal">SBOM match</th>
              <th className="micro w-[26%] px-3 py-3 font-normal">Determination</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const ver = p.ver ? model.byId.get(p.ver) : null
              return (
                <tr key={`${p.v}|${p.ver}|${p.p}|${i}`} className={cx('row-line', p.affected && 'bg-red/[0.036]')}>
                  <td className="px-4 py-3 align-top">
                    <Link to={`/vulnerabilities/${p.v}`} className="ident text-[12.5px] text-ink hover:text-amber">
                      {label(p.v)}
                    </Link>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className="text-sm text-ink">{label(p.c)}</span> <span className="ident text-[12px] text-ink-2">{ver?.meta.version ?? ''}</span>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <Link to={`/products/${p.p}`} className="text-sm text-ink hover:text-amber">
                      {label(p.p)}
                    </Link>{' '}
                    <span className="mono text-[11.5px] text-ink-3">{model.byId.get(p.p ?? '')?.sublabel}</span>
                  </td>
                  <td className="px-3 py-3 align-top">{p.ver ? <RangeMark value={p.range} compact /> : <span className="text-xs text-ink-3">Not in SBOM</span>}</td>
                  <td className="px-3 py-3 align-top">
                    <DetCell p={p} model={model} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-y border-line md:hidden">
        {rows.map((p, i) => {
          const ver = p.ver ? model.byId.get(p.ver) : null
          return (
            <li key={`${p.v}|${p.ver}|${p.p}|${i}`} className="py-3.5">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <Link to={`/vulnerabilities/${p.v}`} className="ident text-[12.5px] text-ink">
                  {label(p.v)}
                </Link>
                <ArrowRight className="h-3 w-3 shrink-0 text-ink-4" aria-hidden />
                <span className="min-w-0 text-ink-2">
                  {label(p.c)} <span className="ident text-[12px]">{ver?.meta.version ?? ''}</span>
                </span>
              </div>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Link to={`/products/${p.p}`} className="text-sm text-ink">
                  {label(p.p)} <span className="mono text-[11.5px] text-ink-3">{model.byId.get(p.p ?? '')?.sublabel}</span>
                </Link>
                {p.ver ? <RangeMark value={p.range} compact /> : null}
              </div>
              <div className="mt-2">
                <DetCell p={p} model={model} />
              </div>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-3">
        <span className="mono">{rows.length}</span> CVE-to-product path{rows.length === 1 ? '' : 's'}. Versions outside a vulnerable range are not listed.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="micro mb-1">{label}</dt>
      <dd className={cx('min-w-0 text-sm text-ink', mono && 'ident text-[12.5px]')}>{children}</dd>
    </div>
  )
}

function Chip({ onClick, children, title }: { onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line-strong bg-s3 px-2 py-1 text-left text-xs text-ink-2 transition-colors duration-150 hover:border-line-bright hover:text-ink">
      {children}
    </button>
  )
}

function Inspector({
  id,
  model,
  paths,
  products,
  components,
  onClose,
  onSelect,
}: {
  id: string
  model: GraphModel
  paths: GPath[]
  products: ProductListItem[]
  components: ComponentListItem[]
  onClose: () => void
  onSelect: (id: string) => void
}) {
  const n = model.byId.get(id)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!n) return null
  const mine = paths.filter((p) => p.nodes.includes(id))
  const label = (x: string | null) => (x ? (model.byId.get(x)?.label ?? x) : '--')

  let body: ReactNode = null
  let link: ReactNode = null
  if (n.kind === 'vulnerability') {
    const comp = components.find((c) => (model.out.get(id) ?? []).some((e) => e.to === c.id))
    const exposed = mine.filter((p) => p.p && p.ver)
    body = (
      <>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Title">{n.sublabel}</Fact>
          <Fact label="Severity">{n.meta.severity ? <SeverityMark severity={n.meta.severity as Severity} /> : '--'}</Fact>
          <Fact label="Exploitation">
            <ExploitationBadge status={(n.meta.exploitation ?? 'UNKNOWN') as ExploitationStatus} size="sm" />
          </Fact>
          <Fact label="Affected range" mono>
            {n.meta.range}
          </Fact>
          <Fact label="Component">{comp ? <span>{comp.name} <span className="ident text-[12px] text-ink-3">{comp.purl}</span></span> : 'Not mapped'}</Fact>
        </dl>
        <InspectorList title="Products containing an in-range version" empty="No product SBOM contains a version in this range.">
          {exposed.map((p, i) => (
            <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
              <Chip onClick={() => onSelect(p.p!)}>{label(p.p)} <span className="mono text-ink-3">{model.byId.get(p.p!)?.sublabel}</span></Chip>
              <span className="ident text-[12px] text-ink-2">{model.byId.get(p.ver!)?.meta.version}</span>
              <RangeMark value={p.range} compact />
              {p.dets.length ? p.dets.map((d) => <AffectednessBadge key={d} result={model.det.get(d)?.result ?? 'UNDER_INVESTIGATION'} size="sm" />) : <NoDeterminationMark />}
            </li>
          ))}
        </InspectorList>
      </>
    )
    link = <InspectorLink to={`/vulnerabilities/${id}`}>Open vulnerability</InspectorLink>
  } else if (n.kind === 'component') {
    const c = components.find((x) => x.id === id)
    body = (
      <>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Package identity" mono>
            {n.sublabel}
          </Fact>
          <Fact label="Ecosystem">{n.meta.ecosystem ?? '--'}</Fact>
          <Fact label="Supplier">{n.meta.supplier ?? '--'}</Fact>
          <Fact label="Known vulnerabilities">
            {c?.vulnerabilities.length ? (
              <span className="flex flex-wrap gap-1.5">
                {c.vulnerabilities.map((v) => (
                  <Chip key={v.id} onClick={() => onSelect(v.id)} title={`Affected: ${v.affectedVersions}`}>
                    <span className="ident">{v.cve ?? v.id}</span>
                  </Chip>
                ))}
              </span>
            ) : (
              <span className="text-ink-3">None recorded</span>
            )}
          </Fact>
        </dl>
        <InspectorList title="Products containing this component" empty="No product SBOM lists this component.">
          {(c?.usedBy ?? []).map((u) => (
            <li key={`${u.productId}-${u.version}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
              <Chip onClick={() => onSelect(u.productId)}>{u.productName} <span className="mono text-ink-3">v{products.find((p) => p.id === u.productId)?.version}</span></Chip>
              <span className="ident text-[12px] text-ink-2">{u.version}</span>
              <span className="text-xs text-ink-3">{u.relation}</span>
            </li>
          ))}
        </InspectorList>
      </>
    )
  } else if (n.kind === 'version') {
    const compId = model.versionOf.get(id) ?? ''
    const comp = components.find((x) => x.id === compId)
    const version = n.meta.version ?? ''
    const inProducts = products.flatMap((p) => p.components.filter((pc) => pc.componentId === compId && pc.version === version).map((pc) => ({ p, pc })))
    body = (
      <>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Package identity" mono>
            {comp ? `${comp.purl}@${version}` : n.label}
          </Fact>
          <Fact label="Version" mono>
            {version}
          </Fact>
          <Fact label="Supplier">{comp ? `${comp.supplier} · ${comp.ecosystem}` : '--'}</Fact>
          <Fact label="Vulnerable ranges">
            {comp?.vulnerabilities.length ? (
              <span className="flex flex-col gap-1.5">
                {comp.vulnerabilities.map((v) => (
                  <span key={v.id} className="flex flex-wrap items-center gap-2">
                    <Chip onClick={() => onSelect(v.id)}>
                      <span className="ident">{v.cve ?? v.id}</span>
                    </Chip>
                    <RangeMark value={inRange(version, v.affectedVersions)} compact />
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-ink-3">No known vulnerability</span>
            )}
          </Fact>
        </dl>
        <InspectorList title="Products containing this version" empty="No product lists this version.">
          {inProducts.map(({ p, pc }) => {
            const via = pc.viaId ? p.components.find((x) => x.id === pc.viaId) : null
            return (
              <li key={pc.id} className="py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Chip onClick={() => onSelect(p.id)}>
                    {p.name} <span className="mono text-ink-3">v{p.version}</span>
                  </Chip>
                  <Badge tone={pc.relation === 'direct' ? 'neutral' : 'dim'} size="sm">
                    {pc.relation}
                  </Badge>
                  {via && <span className="text-xs text-ink-3">via {via.component.name}</span>}
                </div>
                {pc.usage && <p className="mt-1.5 max-w-3xl text-xs text-ink-3">{pc.usage}</p>}
              </li>
            )
          })}
        </InspectorList>
      </>
    )
  } else if (n.kind === 'product') {
    const p = products.find((x) => x.id === id)
    const detIds = (model.out.get(id) ?? []).map((e) => e.to).filter((t) => model.byId.get(t)?.kind === 'determination')
    body = p ? (
      <>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Reporting state">
            <span className="flex flex-col items-start gap-1">
              <RiskBadge state={p.riskState} reason={p.riskReason} />
              <span className="text-xs text-ink-3">{p.riskReason}</span>
            </span>
          </Fact>
          <Fact label="Exposure">{EXPOSURE[p.exposure].label}</Fact>
          <Fact label="SBOM">
            <SbomMark status={p.sbomStatus} />
          </Fact>
          <Fact label="Deployed units">
            <span className="mono">{fmtCount(p.deploymentCount)}</span> <span className="text-ink-3">in {p.deployments.length} deployment{p.deployments.length === 1 ? '' : 's'}</span>
          </Fact>
        </dl>
        <InspectorList title="Determinations recorded for this product" empty="No determination recorded. In-range components remain unresolved until a case records one.">
          {detIds.map((d) => {
            const info = model.det.get(d)
            return (
              <li key={d} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                <AffectednessBadge result={info?.result ?? 'UNDER_INVESTIGATION'} size="sm" />
                <Chip onClick={() => onSelect(d)}>
                  <span className="ident">{d}</span>
                </Chip>
                <span className="ident text-[12px] text-ink-3">
                  {label(info?.vulnId ?? null)} · {info?.caseId}
                </span>
              </li>
            )
          })}
        </InspectorList>
      </>
    ) : null
    link = <InspectorLink to={`/products/${id}`}>Open product</InspectorLink>
  } else if (n.kind === 'deployment') {
    const productId = (model.inc.get(id) ?? []).map((e) => e.from)[0] ?? ''
    body = (
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Product">
          <Chip onClick={() => onSelect(productId)}>
            {label(productId)} <span className="mono text-ink-3">{model.byId.get(productId)?.sublabel}</span>
          </Chip>
        </Fact>
        <Fact label="Units and region" mono>
          {n.sublabel}
        </Fact>
        <Fact label="Environment">{n.meta.environment ?? '--'}</Fact>
        <Fact label="Exposure">{n.meta.exposure ? (EXPOSURE[n.meta.exposure as keyof typeof EXPOSURE]?.label ?? n.meta.exposure) : '--'}</Fact>
      </dl>
    )
  } else if (n.kind === 'determination') {
    const info = model.det.get(id)
    body = (
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Result">
          <AffectednessBadge result={info?.result ?? 'UNDER_INVESTIGATION'} size="sm" />
        </Fact>
        <Fact label="VEX status" mono>
          {n.meta.vex ?? '--'}
          {n.meta.justification ? <span className="mt-1 block text-ink-3">{n.meta.justification}</span> : null}
        </Fact>
        <Fact label="For">
          <span className="flex flex-wrap gap-1.5">
            {info?.vulnId && (
              <Chip onClick={() => onSelect(info.vulnId!)}>
                <span className="ident">{label(info.vulnId)}</span>
              </Chip>
            )}
            {info?.productId && (
              <Chip onClick={() => onSelect(info.productId)}>
                {label(info.productId)} <span className="mono text-ink-3">{model.byId.get(info.productId)?.sublabel}</span>
              </Chip>
            )}
          </span>
        </Fact>
        <Fact label="Case" mono>
          {info?.caseId ?? '--'}
        </Fact>
      </dl>
    )
    if (info?.caseId) link = <InspectorLink to={`/cases/${info.caseId}`}>Open case</InspectorLink>
  }

  return (
    <div className="panel-raised max-h-[40vh] overflow-y-auto" role="region" aria-label={`Selected ${COLUMN_LABELS[n.kind]}`}>
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-s2 px-5 py-3.5">
        <div className="min-w-0">
          <div className="micro">{COLUMN_LABELS[n.kind]}</div>
          <div className={cx('mt-1 text-md text-ink', (n.kind === 'vulnerability' || n.kind === 'determination' || n.kind === 'version') && 'ident')}>
            {n.kind === 'determination' ? n.id : n.label}
            {n.kind === 'product' && <span className="mono ml-2 text-sm text-ink-3">{n.sublabel}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {link}
          <IconButton label="Close inspector" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      <div className="px-5 py-4">{body}</div>
    </div>
  )
}

function InspectorList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="micro mb-1">{title}</div>
      {has ? (
        <ul className="divide-y divide-line">{children}</ul>
      ) : (
        <p className="flex items-center gap-2 py-2 text-xs text-ink-3">
          <CircleDashed className="h-3.5 w-3.5" aria-hidden /> {empty}
        </p>
      )}
    </div>
  )
}

function InspectorLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-ink-2 transition-colors hover:bg-s3 hover:text-ink">
      {children} <ArrowRight className="h-3 w-3" aria-hidden />
    </Link>
  )
}
