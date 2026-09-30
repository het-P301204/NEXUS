import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { AlertTriangle, ArrowRight, FileX, ListTree } from 'lucide-react'
import type { GraphResponse, ProductListItem } from '../../types/api.ts'
import type { VulnerabilityListItem } from '../../lib/client/queries.ts'
import { inRange } from '../../lib/engine/versions.ts'
import { Checkbox, cx } from '../ui/primitives.tsx'
import { AffectednessBadge, Badge, ExploitationBadge, SeverityMark } from '../ui/status.tsx'
import { EmptyState } from '../ui/feedback.tsx'
import { buildModel } from './graphModel.ts'
import type { DetInfo } from './graphModel.ts'
import { EXPOSURE, NoDeterminationMark, RangeMark, RiskBadge, SEVERITY_ORDER, SbomMark, fmtCount } from './shared.tsx'

/**
 * Exposure map: for each product, the component versions its SBOM lists and
 * the vulnerabilities whose range each one falls in, ending in the
 * determination recorded for that product (if any). Tree lines are drawn
 * with borders; a branch is red where it leads to an AFFECTED determination
 * and amber where it leads to an in-range version still unresolved.
 */

type LineTone = 'red' | 'amber' | 'neutral'
const RANK: Record<LineTone, number> = { neutral: 0, amber: 1, red: 2 }
const LINE: Record<LineTone, string> = { red: 'border-red/80', amber: 'border-amber/70', neutral: 'border-line-bright' }

interface Leaf {
  v: VulnerabilityListItem
  range: boolean | null
  dets: Array<DetInfo & { id: string }>
  tone: LineTone
}

export function ExposureMap({ products, vulns, graph }: { products: ProductListItem[]; vulns: VulnerabilityListItem[]; graph: GraphResponse }) {
  const model = useMemo(() => buildModel(graph), [graph])
  const [exploitedOnly, setExploitedOnly] = useState(false)
  const [affectedOnly, setAffectedOnly] = useState(false)
  const filtering = exploitedOnly || affectedOnly

  const trees = useMemo(() => {
    return products.map((p) => {
      const comps = p.components
        .map((pc) => {
          const leaves: Leaf[] = vulns
            .filter((v) => v.componentId === pc.componentId)
            .map((v) => ({ v, range: inRange(pc.version, v.affectedVersions) }))
            .filter((x) => x.range !== false)
            .map((x) => {
              const dets = (model.detsFor.get(`${p.id}|${x.v.id}`) ?? []).map((id) => ({ id, ...model.det.get(id)! }))
              const affected = dets.some((d) => d.result === 'AFFECTED')
              const cleared = dets.length > 0 && dets.every((d) => d.result === 'NOT_AFFECTED')
              const tone: LineTone = affected ? 'red' : cleared ? 'neutral' : x.range === true ? 'amber' : 'neutral'
              return { ...x, dets, tone }
            })
            .filter((x) => (!exploitedOnly || x.v.exploitation === 'CONFIRMED') && (!affectedOnly || x.dets.some((d) => d.result === 'AFFECTED')))
            .sort((a, b) => RANK[b.tone] - RANK[a.tone] || SEVERITY_ORDER[a.v.severity] - SEVERITY_ORDER[b.v.severity])
          const tone = leaves.reduce<LineTone>((t, l) => (RANK[l.tone] > RANK[t] ? l.tone : t), 'neutral')
          return { pc, leaves, tone }
        })
        .filter((c) => !filtering || c.leaves.length > 0)
        .sort((a, b) => RANK[b.tone] - RANK[a.tone] || b.leaves.length - a.leaves.length || a.pc.component.name.localeCompare(b.pc.component.name))
      return { p, comps }
    }).filter((t) => !filtering || t.comps.length > 0)
  }, [products, vulns, model, exploitedOnly, affectedOnly, filtering])

  return (
    <section aria-label="Exposure map" className="min-w-0">
      <p className="max-w-2xl text-sm text-ink-2">
        Each product's SBOM, component by component, with the vulnerabilities whose affected range includes that version. The last node on each branch is the determination recorded in a case, or its absence.
      </p>
      <div className="mt-5 flex min-w-0 flex-col gap-4 border-y border-line py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
          <Checkbox checked={exploitedOnly} onChange={setExploitedOnly} label="Actively exploited only" description="Exploitation status CONFIRMED" />
          <Checkbox checked={affectedOnly} onChange={setAffectedOnly} label="Affected only" description="Branches that end in an AFFECTED determination" />
        </div>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-2" aria-label="Legend">
          <li className="flex items-center gap-2">
            <span className="h-px w-5 border-t border-red/80" aria-hidden /> Determined affected
          </li>
          <li className="flex items-center gap-2">
            <span className="h-px w-5 border-t border-amber/70" aria-hidden /> In range, unresolved
          </li>
          <li className="flex items-center gap-2">
            <span className="h-px w-5 border-t border-line-bright" aria-hidden /> Not affected or no match
          </li>
        </ul>
      </div>

      {trees.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title="No branch matches"
          why={affectedOnly ? 'No product has an AFFECTED determination for an actively exploited vulnerability in this view. In-range branches may still be under investigation.' : 'No product contains a component version inside the range of an actively exploited vulnerability.'}
          action={
            <button
              type="button"
              onClick={() => {
                setExploitedOnly(false)
                setAffectedOnly(false)
              }}
              className="text-sm text-ink-2 underline decoration-line-bright underline-offset-4 hover:text-ink"
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="mt-2 divide-y divide-line">
          {trees.map(({ p, comps }, i) => (
            <motion.article key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }} className="min-w-0 py-6" aria-label={`${p.name} ${p.version}`}>
              <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link to={`/products/${p.id}`} className="group inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="text-md font-medium text-ink group-hover:text-amber">{p.name}</span>
                    <span className="mono text-sm text-ink-2">{p.version}</span>
                    <span className="ident text-[11.5px] text-ink-3">{p.id}</span>
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
                    <span>{EXPOSURE[p.exposure].label}</span>
                    <span>
                      <span className="mono text-ink-2">{fmtCount(p.deploymentCount)}</span> units deployed
                    </span>
                    <SbomMark status={p.sbomStatus} />
                  </div>
                </div>
                <div className="flex min-w-0 flex-col items-start gap-1 sm:items-end">
                  <RiskBadge state={p.riskState} reason={p.riskReason} />
                  <span className="text-xs text-ink-3 sm:text-right">{p.riskReason}</span>
                </div>
              </header>

              <div className="mt-4 pl-1">
                {comps.length === 0 ? (
                  <Branch
                    items={[
                      {
                        key: 'none',
                        tone: 'neutral',
                        content:
                          p.sbomStatus === 'missing' ? (
                            <span className="flex items-center gap-2 text-sm text-red">
                              <FileX className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              SBOM missing: exposure cannot be derived for this product.
                            </span>
                          ) : (
                            <span className="text-sm text-ink-3">No component versions on record.</span>
                          ),
                      },
                    ]}
                  />
                ) : (
                  <Branch
                    items={comps.map(({ pc, leaves, tone }) => {
                      const via = pc.viaId ? p.components.find((x) => x.id === pc.viaId) : null
                      return {
                        key: pc.id,
                        tone,
                        content: (
                          <>
                            <span className="text-sm text-ink">{pc.component.name}</span>
                            <span className="mono text-[12.5px] text-ink-2">{pc.version}</span>
                            <Badge tone={pc.relation === 'direct' ? 'neutral' : 'dim'} size="sm">
                              {pc.relation}
                            </Badge>
                            {via && <span className="text-xs text-ink-3">via {via.component.name}</span>}
                            {leaves.length === 0 && <span className="text-xs text-ink-3">No known vulnerability in range</span>}
                          </>
                        ),
                        children: leaves.length ? (
                          <Branch
                            items={leaves.map((l) => ({
                              key: l.v.id,
                              tone: l.tone,
                              content: <LeafRow leaf={l} />,
                            }))}
                          />
                        ) : undefined,
                      }
                    })}
                  />
                )}
              </div>
              {p.sbomStatus === 'stale' && (
                <p className="mt-3 flex items-center gap-2 text-xs text-amber">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> SBOM is stale. Branches reflect the last generated SBOM, not necessarily the shipped build.
                </p>
              )}
            </motion.article>
          ))}
        </div>
      )}
      {filtering && trees.length > 0 && (
        <p className="mt-2 text-xs text-ink-3">
          Showing <span className="mono">{trees.length}</span> of <span className="mono">{products.length}</span> products.
        </p>
      )}
    </section>
  )
}

function LeafRow({ leaf }: { leaf: Leaf }) {
  const { v, range, dets } = leaf
  return (
    <>
      <Link to={`/vulnerabilities/${v.id}`} className={cx('ident text-[12.5px] hover:text-amber', leaf.tone === 'red' ? 'text-red' : 'text-ink')}>
        {v.cve ?? v.id}
      </Link>
      <SeverityMark severity={v.severity} showLabel={false} />
      <ExploitationBadge status={v.exploitation} size="sm" />
      {range === null && <RangeMark value={null} />}
      <ArrowRight className="h-3 w-3 shrink-0 text-ink-4" aria-hidden />
      {dets.length ? (
        dets.map((d) => (
          <span key={d.id} className="inline-flex flex-wrap items-center gap-2">
            <AffectednessBadge result={d.result} size="sm" />
            <Link to={`/cases/${d.caseId}`} className="ident text-[11.5px] text-ink-3 hover:text-ink">
              {d.id} · {d.caseId}
            </Link>
          </span>
        ))
      ) : (
        <NoDeterminationMark />
      )}
    </>
  )
}

interface BranchItem {
  key: string
  tone: LineTone
  content: ReactNode
  children?: ReactNode
}

/**
 * One level of the tree. The vertical rule is split at each connector so
 * that the segment above a child takes the strongest tone of that child and
 * the siblings after it: a red line always leads somewhere red.
 */
function Branch({ items }: { items: BranchItem[] }) {
  const suffix: LineTone[] = []
  let cur: LineTone = 'neutral'
  for (let i = items.length - 1; i >= 0; i--) {
    if (RANK[items[i]!.tone] > RANK[cur]) cur = items[i]!.tone
    suffix[i] = cur
  }
  return (
    <ul className="min-w-0">
      {items.map((it, i) => {
        const last = i === items.length - 1
        return (
          <li key={it.key} className="relative min-w-0 pl-7">
            <span aria-hidden className={cx('absolute left-0 top-0 h-[18px] border-l', LINE[suffix[i]!])} />
            {!last && <span aria-hidden className={cx('absolute bottom-0 left-0 top-[18px] border-l', LINE[suffix[i + 1]!])} />}
            <span aria-hidden className={cx('absolute left-0 top-[18px] w-5 border-t', LINE[it.tone])} />
            <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5">{it.content}</div>
            {it.children && <div className="min-w-0 pl-2">{it.children}</div>}
          </li>
        )
      })}
    </ul>
  )
}
