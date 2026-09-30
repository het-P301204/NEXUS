import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowDown, ArrowRight, ArrowUp, CircleHelp, Equal, FileX, GitCompare, Minus, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ProductListItem } from '../../types/api.ts'
import { compareVersions } from '../../lib/engine/versions.ts'
import { Select, cx } from '../ui/primitives.tsx'
import { EmptyState, Notice } from '../ui/feedback.tsx'
import type { Tone } from '../ui/status.tsx'
import { TONE_TEXT } from '../ui/status.tsx'
import { SbomMark } from './shared.tsx'

/**
 * Side-by-side component diff between two products (typically two releases
 * of the same product). A side without an SBOM is not "empty": a component
 * that only one side lists is marked unknown, never removed or added.
 */

type Change = 'added' | 'removed' | 'upgraded' | 'downgraded' | 'changed' | 'same' | 'unknown'

const CHANGE: Record<Change, { label: string; tone: Tone; icon: LucideIcon; order: number }> = {
  upgraded: { label: 'Upgraded', tone: 'blue', icon: ArrowUp, order: 0 },
  downgraded: { label: 'Downgraded', tone: 'amber', icon: ArrowDown, order: 1 },
  changed: { label: 'Changed', tone: 'amber', icon: CircleHelp, order: 2 },
  added: { label: 'Added', tone: 'neutral', icon: Plus, order: 3 },
  removed: { label: 'Removed', tone: 'neutral', icon: Minus, order: 4 },
  unknown: { label: 'Not comparable', tone: 'dim', icon: CircleHelp, order: 5 },
  same: { label: 'Same', tone: 'dim', icon: Equal, order: 6 },
}

interface Row {
  componentId: string
  name: string
  purl: string
  base: string | null
  target: string | null
  change: Change
}

export function VersionComparison({ product, products }: { product: ProductListItem; products: ProductListItem[] }) {
  const others = useMemo(() => products.filter((p) => p.id !== product.id), [products, product.id])
  const defaultOther = useMemo(() => {
    const same = others.filter((p) => p.name === product.name)
    if (same.length === 0) return ''
    // Nearest release of the same product first.
    return [...same].sort((a, b) => (compareVersions(b.version, a.version) ?? 0))[0]!.id
  }, [others, product.name])
  const [chosen, setChosen] = useState<string | null>(null)
  const otherId = chosen ?? defaultOther
  const other = others.find((p) => p.id === otherId) ?? null

  const view = useMemo(() => {
    if (!other) return null
    // Older release on the left, newer on the right, so arrows read forwards in time.
    const cmp = compareVersions(other.version, product.version)
    const [base, target] = cmp !== null && cmp > 0 ? [product, other] : [other, product]
    const baseMissing = base.sbomStatus === 'missing' || base.components.length === 0
    const targetMissing = target.sbomStatus === 'missing' || target.components.length === 0
    const ids = new Set([...base.components.map((c) => c.componentId), ...target.components.map((c) => c.componentId)])
    const rows: Row[] = [...ids].map((cid) => {
      const b = base.components.find((c) => c.componentId === cid)
      const t = target.components.find((c) => c.componentId === cid)
      const comp = (b ?? t)!.component
      let change: Change
      if (b && t) {
        if (b.version === t.version) change = 'same'
        else {
          const c = compareVersions(b.version, t.version)
          change = c === null ? 'changed' : c < 0 ? 'upgraded' : c > 0 ? 'downgraded' : 'same'
        }
      } else if (t) change = baseMissing ? 'unknown' : 'added'
      else change = targetMissing ? 'unknown' : 'removed'
      return { componentId: cid, name: comp.name, purl: comp.purl, base: b?.version ?? null, target: t?.version ?? null, change }
    })
    rows.sort((a, b) => CHANGE[a.change].order - CHANGE[b.change].order || a.name.localeCompare(b.name))
    const summary = rows.reduce<Partial<Record<Change, number>>>((acc, r) => ({ ...acc, [r.change]: (acc[r.change] ?? 0) + 1 }), {})
    return { base, target, rows, summary, incomplete: baseMissing || targetMissing, missingSide: baseMissing ? base : targetMissing ? target : null }
  }, [other, product])

  return (
    <section aria-label="Version comparison" className="min-w-0">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="micro mb-1.5">Version comparison</div>
          <h2 className="text-lg font-medium text-ink">Component changes between releases</h2>
        </div>
        <label className="flex min-w-0 flex-col gap-1.5 sm:w-80">
          <span className="text-xs font-medium text-ink-2">Compare with</span>
          <Select value={otherId} onChange={(e) => setChosen(e.target.value)}>
            <option value="">Choose a product</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.version} · {p.id}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {!view ? (
        <EmptyState compact icon={GitCompare} title="No comparison selected" why="Choose another product or release to see which component versions were added, removed or changed. Comparing releases shows whether a fix actually shipped." />
      ) : (
        <div className="mt-5 min-w-0">
          {view.incomplete && view.missingSide && (
            <Notice tone="amber" icon={FileX} title="SBOM missing: comparison is incomplete" className="mb-4">
              {view.missingSide.name} {view.missingSide.version} has no SBOM on record. Components listed only on the other side are marked not comparable rather than added or removed: absence from a missing SBOM is not evidence of absence.
            </Notice>
          )}
          {view.base.name !== view.target.name && (
            <p className="mb-3 text-xs text-ink-3">These are different products. The diff shows which components and versions each ships; the older and newer labels follow their product version numbers, not an upgrade path.</p>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-3">
            {(Object.keys(CHANGE) as Change[])
              .filter((c) => view.summary[c])
              .map((c) => {
                const Icon = CHANGE[c].icon
                return (
                  <span key={c} className={cx('inline-flex items-center gap-1.5', TONE_TEXT[CHANGE[c].tone])}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    <span className="mono">{view.summary[c]}</span> {CHANGE[c].label.toLowerCase()}
                  </span>
                )
              })}
          </div>
          <div className="min-w-0 overflow-hidden rounded-xl border border-line">
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-line bg-s1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
              <div className="micro px-4 py-3">Component</div>
              <div className="min-w-0 px-3 py-3">
                <Link to={`/products/${view.base.id}`} className="block truncate text-xs text-ink hover:text-amber">
                  {view.base.name} <span className="mono">{view.base.version}</span>
                </Link>
                <SbomMark status={view.base.sbomStatus} className="mt-0.5 text-[11px]" />
              </div>
              <div className="min-w-0 px-3 py-3">
                <Link to={`/products/${view.target.id}`} className="block truncate text-xs text-ink hover:text-amber">
                  {view.target.name} <span className="mono">{view.target.version}</span>
                </Link>
                <SbomMark status={view.target.sbomStatus} className="mt-0.5 text-[11px]" />
              </div>
              <div className="micro hidden px-3 py-3 sm:block">Change</div>
            </div>
            {view.rows.length === 0 ? (
              <p className="px-4 py-5 text-sm text-ink-3">Neither side lists any component.</p>
            ) : (
              <ul>
                {view.rows.map((r) => {
                  const c = CHANGE[r.change]
                  const Icon = c.icon
                  return (
                    <li key={r.componentId} className={cx('row-line grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]', r.change === 'same' && 'text-ink-3')}>
                      <div className="min-w-0 px-4 py-3">
                        <div className={cx('text-sm', r.change === 'same' ? 'text-ink-2' : 'text-ink')}>{r.name}</div>
                        <div className="ident mt-0.5 hidden text-[11px] text-ink-3 sm:block">{r.purl}</div>
                        <div className={cx('mt-1 inline-flex items-center gap-1 whitespace-nowrap text-[11px] sm:hidden', TONE_TEXT[c.tone])}>
                          <Icon className="h-3 w-3" aria-hidden /> {c.label}
                        </div>
                      </div>
                      <div className="ident min-w-0 px-3 py-3 text-[12.5px] text-ink-2">{r.base ?? <span className="text-ink-4">{view.missingSide === view.base ? 'unknown' : '--'}</span>}</div>
                      <div className="min-w-0 px-3 py-3">
                        <span className={cx('ident inline-flex items-center gap-1.5 text-[12.5px]', r.change === 'same' ? 'text-ink-2' : 'text-ink')}>
                          {r.base && r.target && r.base !== r.target && <ArrowRight className="h-3 w-3 shrink-0 text-ink-4" aria-hidden />}
                          {r.target ?? <span className="text-ink-4">{view.missingSide === view.target ? 'unknown' : '--'}</span>}
                        </span>
                      </div>
                      <div className={cx('hidden min-w-0 items-start gap-1.5 px-3 py-3 text-xs sm:flex', TONE_TEXT[c.tone])}>
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {c.label}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-3">Versions are ordered with the same comparator the SBOM matcher uses. "Changed" means the two versions could not be ordered.</p>
        </div>
      )}
    </section>
  )
}
