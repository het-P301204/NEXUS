import type { GraphEdge, GraphNode, GraphResponse } from '../../types/api.ts'
import type { AffectednessResult } from '../../types/domain.ts'
import { compareVersions, inRange } from '../../lib/engine/versions.ts'

/**
 * The relationship graph as paths. The server sends a flat node and edge
 * list; this module turns it into CVE -> component -> version -> product
 * paths so that a selection or a filter follows the reasoning rather than
 * raw connectivity. A version outside a vulnerability's range is not on that
 * vulnerability's path, and a determination belongs to the path of the CVE
 * it was recorded for, not to every CVE of the same product.
 */

export const COLUMNS: Array<GraphNode['kind']> = ['vulnerability', 'component', 'version', 'product', 'deployment', 'determination']

export const COLUMN_LABELS: Record<GraphNode['kind'], string> = {
  vulnerability: 'CVE',
  component: 'Component',
  version: 'Version',
  product: 'Product',
  deployment: 'Deployment',
  determination: 'Determination',
}

export interface DetInfo {
  productId: string
  vulnId: string | null
  caseId: string
  result: AffectednessResult
}

export interface GPath {
  v: string | null
  c: string | null
  ver: string | null
  p: string | null
  deps: string[]
  dets: string[]
  range: boolean | null
  affected: boolean
  nodes: string[]
  edges: string[]
}

export interface GraphModel {
  byId: Map<string, GraphNode>
  edges: GraphEdge[]
  out: Map<string, GraphEdge[]>
  inc: Map<string, GraphEdge[]>
  paths: GPath[]
  det: Map<string, DetInfo>
  /** version node id -> component node id */
  versionOf: Map<string, string>
  /** `${productId}|${vulnId}` -> determination node ids */
  detsFor: Map<string, string[]>
}

export const edgeKey = (from: string, to: string) => `${from}>${to}`

function detResult(n: GraphNode): AffectednessResult {
  return n.state === 'affected' ? 'AFFECTED' : n.state === 'not_affected' ? 'NOT_AFFECTED' : 'UNDER_INVESTIGATION'
}

export function buildModel(g: GraphResponse): GraphModel {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const out = new Map<string, GraphEdge[]>()
  const inc = new Map<string, GraphEdge[]>()
  for (const e of g.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    ;(out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e)
    ;(inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push(e)
  }
  const kids = (id: string, kind: GraphNode['kind']) => (out.get(id) ?? []).map((e) => e.to).filter((t) => byId.get(t)?.kind === kind)

  const vulns = g.nodes.filter((n) => n.kind === 'vulnerability')
  const vulnByLabel = new Map(vulns.map((v) => [v.label, v.id]))

  const versionOf = new Map<string, string>()
  for (const n of g.nodes) {
    if (n.kind !== 'component') continue
    for (const ver of kids(n.id, 'version')) versionOf.set(ver, n.id)
  }

  const det = new Map<string, DetInfo>()
  const detsFor = new Map<string, string[]>()
  for (const n of g.nodes) {
    if (n.kind !== 'determination') continue
    const productId = (inc.get(n.id) ?? []).map((e) => e.from).find((f) => byId.get(f)?.kind === 'product')
    if (!productId) continue
    // Sublabel is "<case id> · <CVE or vulnerability id>".
    const vulnLabel = n.sublabel.split(' · ')[1]?.trim() ?? ''
    const vulnId = vulnByLabel.get(vulnLabel) ?? null
    det.set(n.id, { productId, vulnId, caseId: n.meta.case ?? n.sublabel.split(' · ')[0] ?? '', result: detResult(n) })
    if (vulnId) {
      const k = `${productId}|${vulnId}`
      ;(detsFor.get(k) ?? detsFor.set(k, []).get(k)!).push(n.id)
    }
  }

  const paths: GPath[] = []
  const seen = new Set<string>()
  const add = (v: string | null, c: string | null, ver: string | null, p: string | null, range: boolean | null, extraDets?: string[]) => {
    const key = [v, c, ver, p, extraDets?.join(',')].join('|')
    if (seen.has(key)) return
    seen.add(key)
    const deps = p ? kids(p, 'deployment') : []
    const dets = extraDets ?? (v && p ? (detsFor.get(`${p}|${v}`) ?? []) : [])
    const nodes = [v, c, ver, p, ...deps, ...dets].filter((x): x is string => !!x)
    const edges: string[] = []
    if (v && c) edges.push(edgeKey(v, c))
    if (c && ver) edges.push(edgeKey(c, ver))
    if (ver && p) edges.push(edgeKey(ver, p))
    if (p) for (const d of deps) edges.push(edgeKey(p, d))
    if (p) for (const d of dets) edges.push(edgeKey(p, d))
    paths.push({ v, c, ver, p, deps, dets, range, affected: dets.some((d) => det.get(d)?.result === 'AFFECTED'), nodes, edges })
  }

  const coveredVerProduct = new Set<string>()
  const coveredDets = new Set<string>()
  const componentsOnPath = new Set<string>()
  const productsOnPath = new Set<string>()

  for (const v of vulns) {
    const comps = kids(v.id, 'component')
    const range = v.meta.range ?? ''
    for (const c of comps) {
      let any = false
      for (const ver of kids(c, 'version')) {
        const version = byId.get(ver)?.meta.version ?? ''
        const r = inRange(version, range)
        if (r === false) continue
        for (const p of kids(ver, 'product')) {
          add(v.id, c, ver, p, r)
          any = true
          coveredVerProduct.add(edgeKey(ver, p))
          for (const d of detsFor.get(`${p}|${v.id}`) ?? []) coveredDets.add(d)
          productsOnPath.add(p)
        }
      }
      componentsOnPath.add(c)
      if (!any) add(v.id, c, null, null, null)
    }
    if (comps.length === 0) add(v.id, null, null, null, null)
  }
  for (const ver of versionOf.keys()) {
    const c = versionOf.get(ver)!
    for (const p of kids(ver, 'product')) {
      if (coveredVerProduct.has(edgeKey(ver, p))) continue
      add(null, c, ver, p, null)
      productsOnPath.add(p)
      componentsOnPath.add(c)
    }
  }
  for (const n of g.nodes) {
    if (n.kind === 'component' && !componentsOnPath.has(n.id)) add(null, n.id, null, null, null)
    if (n.kind === 'product' && !productsOnPath.has(n.id)) add(null, null, null, n.id, null)
  }
  // A determination recorded for a product whose SBOM does not show the
  // component still belongs on its CVE's path.
  for (const [id, d] of det) {
    if (coveredDets.has(id)) continue
    add(d.vulnId, null, null, d.productId, null, [id])
  }

  return { byId, edges: g.edges.filter((e) => byId.has(e.from) && byId.has(e.to)), out, inc, paths, det, versionOf, detsFor }
}

export interface Filter {
  vulnId: string
  onlyAffected: boolean
}

/** The paths a filter keeps, or null when nothing is filtered. */
export function filterPaths(m: GraphModel, f: Filter): GPath[] | null {
  if (!f.vulnId && !f.onlyAffected) return null
  return m.paths.filter((p) => (!f.vulnId || p.v === f.vulnId) && (!f.onlyAffected || p.affected))
}

export function unionOf(paths: GPath[]): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>()
  const edges = new Set<string>()
  for (const p of paths) {
    for (const n of p.nodes) nodes.add(n)
    for (const e of p.edges) edges.add(e)
  }
  return { nodes, edges }
}

export type EdgeTone = 'red' | 'amber' | 'neutral'

/** Red where the path ends in an AFFECTED determination; amber where the server flags it (in range, exploited). */
export function edgeTones(m: GraphModel): Map<string, EdgeTone> {
  const red = new Set<string>()
  for (const p of m.paths) {
    if (!p.affected) continue
    for (const e of p.edges) {
      const to = e.split('>')[1] ?? ''
      if (m.byId.get(to)?.kind === 'deployment') continue
      red.add(e)
    }
  }
  const tones = new Map<string, EdgeTone>()
  for (const e of m.edges) {
    const k = edgeKey(e.from, e.to)
    tones.set(k, red.has(k) ? 'red' : e.highlighted ? 'amber' : 'neutral')
  }
  return tones
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface Box {
  id: string
  col: number
  x: number
  y: number
  w: number
  h: number
  /** Lanes are reserved channels in the deployment column that carry product -> determination edges. */
  lane: boolean
}

export interface Layout {
  boxes: Map<string, Box>
  colX: number[]
  colW: number[]
  width: number
  height: number
}

const SEV_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

/** Pool-adjacent-violators: the closest non-decreasing sequence to `a` in least squares. */
function isotonic(a: number[]): number[] {
  const blocks: Array<{ sum: number; count: number; start: number }> = []
  a.forEach((value, i) => {
    blocks.push({ sum: value, count: 1, start: i })
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!
      const prev = blocks[blocks.length - 2]!
      if (prev.sum / prev.count <= last.sum / last.count) break
      prev.sum += last.sum
      prev.count += last.count
      blocks.pop()
    }
  })
  const out = new Array<number>(a.length)
  for (const b of blocks) for (let k = b.start; k < b.start + b.count; k++) out[k] = b.sum / b.count
  return out
}

/**
 * Place a column's nodes as close as possible to their desired centres while
 * keeping their order and a minimum gap. Exact in least squares.
 */
function place(desired: number[], heights: number[], gaps: number[]): number[] {
  const n = desired.length
  const offset: number[] = []
  let acc = 0
  for (let i = 0; i < n; i++) {
    offset.push(acc)
    acc += heights[i]! + (gaps[i] ?? 0)
  }
  const target = desired.map((c, i) => c - heights[i]! / 2 - offset[i]!)
  const u = isotonic(target).map((x) => Math.max(0, x))
  return u.map((x, i) => x + offset[i]!)
}

export interface LayoutOptions {
  colW: number[]
  gapX: number[]
  padX: number
  nodeH: number
  versionH: number
  laneH: number
  gapY: number
  groupGapY: number
}

export function layoutGraph(m: GraphModel, visible: Set<string>, visibleEdges: Set<string> | null, opt: LayoutOptions): Layout {
  const edgeOn = (from: string, to: string) => visible.has(from) && visible.has(to) && (!visibleEdges || visibleEdges.has(edgeKey(from, to)))
  const outOf = (id: string) => (m.out.get(id) ?? []).filter((e) => edgeOn(e.from, e.to)).map((e) => e.to)
  const intoOf = (id: string) => (m.inc.get(id) ?? []).filter((e) => edgeOn(e.from, e.to)).map((e) => e.from)
  const cols: string[][] = COLUMNS.map((k) => [...visible].filter((id) => m.byId.get(id)?.kind === k))
  const node = (id: string) => m.byId.get(id)!
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.POSITIVE_INFINITY)
  const kind = (id: string) => m.byId.get(id)?.kind

  // Ordering: a few barycentre sweeps between versions and products, the
  // only many-to-many layer; the other layers are trees and follow.
  let products = [...cols[3]!].sort((a, b) => node(a).label.localeCompare(node(b).label) || -(compareVersions(node(a).sublabel, node(b).sublabel) ?? 0))
  let components = [...cols[1]!].sort((a, b) => node(a).label.localeCompare(node(b).label))
  let versions: string[] = []
  const componentOfVersion = (ver: string) => m.versionOf.get(ver) ?? ''
  for (let iter = 0; iter < 4; iter++) {
    const pIdx = new Map(products.map((p, i) => [p, i]))
    const verKey = new Map(cols[2]!.map((ver) => [ver, mean(outOf(ver).filter((t) => kind(t) === 'product').map((p) => pIdx.get(p) ?? 0))]))
    const compKey = new Map(components.map((c, i) => {
      const ks = outOf(c).filter((t) => kind(t) === 'version').map((v) => verKey.get(v) ?? Number.POSITIVE_INFINITY).filter(Number.isFinite)
      return [c, ks.length ? mean(ks) : 1e6 + i]
    }))
    components = [...components].sort((a, b) => compKey.get(a)! - compKey.get(b)!)
    const cIdx = new Map(components.map((c, i) => [c, i]))
    versions = [...cols[2]!].sort((a, b) => {
      const ca = cIdx.get(componentOfVersion(a)) ?? 1e6
      const cb = cIdx.get(componentOfVersion(b)) ?? 1e6
      if (ca !== cb) return ca - cb
      const ka = verKey.get(a)!
      const kb = verKey.get(b)!
      if (Number.isFinite(ka) && Number.isFinite(kb) && ka !== kb) return ka - kb
      return compareVersions(node(a).meta.version ?? '', node(b).meta.version ?? '') ?? 0
    })
    const vIdx = new Map(versions.map((v, i) => [v, i]))
    const prevIdx = new Map(products.map((p, i) => [p, i]))
    const pKey = new Map(products.map((p) => {
      const ks = intoOf(p).filter((f) => kind(f) === 'version').map((v) => vIdx.get(v) ?? 0)
      return [p, ks.length ? mean(ks) : 1e6 + prevIdx.get(p)!]
    }))
    products = [...products].sort((a, b) => pKey.get(a)! - pKey.get(b)!)
  }
  const cIdx = new Map(components.map((c, i) => [c, i]))
  const pIdx = new Map(products.map((p, i) => [p, i]))
  const vulns = [...cols[0]!].sort((a, b) => {
    const ka = Math.min(...outOf(a).map((c) => cIdx.get(c) ?? 1e6), 1e6)
    const kb = Math.min(...outOf(b).map((c) => cIdx.get(c) ?? 1e6), 1e6)
    return ka - kb || (SEV_RANK[node(a).meta.severity ?? ''] ?? 9) - (SEV_RANK[node(b).meta.severity ?? ''] ?? 9) || node(a).label.localeCompare(node(b).label)
  })
  const vulnIdx = new Map(vulns.map((v, i) => [v, i]))
  const productOf = (id: string) => intoOf(id).find((f) => kind(f) === 'product') ?? ''
  const deployments = [...cols[4]!].sort((a, b) => (pIdx.get(productOf(a)) ?? 1e6) - (pIdx.get(productOf(b)) ?? 1e6) || node(a).label.localeCompare(node(b).label))
  const dets = [...cols[5]!].sort((a, b) => {
    const pa = pIdx.get(productOf(a)) ?? 1e6
    const pb = pIdx.get(productOf(b)) ?? 1e6
    const va = vulnIdx.get(m.det.get(a)?.vulnId ?? '') ?? 1e6
    const vb = vulnIdx.get(m.det.get(b)?.vulnId ?? '') ?? 1e6
    return pa - pb || va - vb || a.localeCompare(b)
  })
  // One lane per product that has visible determinations, placed after its deployments.
  const laneProducts = products.filter((p) => outOf(p).some((t) => kind(t) === 'determination'))
  const depCol: Array<{ id: string; lane: boolean; group: string }> = []
  for (const p of products) {
    for (const d of deployments.filter((x) => productOf(x) === p)) depCol.push({ id: d, lane: false, group: p })
    if (laneProducts.includes(p)) depCol.push({ id: `LANE:${p}`, lane: true, group: p })
  }
  for (const d of deployments) if (!depCol.some((x) => x.id === d)) depCol.push({ id: d, lane: false, group: '' })

  const ordered: Array<Array<{ id: string; lane: boolean; group: string }>> = [
    vulns.map((id) => ({ id, lane: false, group: outOf(id)[0] ?? '' })),
    components.map((id) => ({ id, lane: false, group: '' })),
    versions.map((id) => ({ id, lane: false, group: componentOfVersion(id) })),
    products.map((id) => ({ id, lane: false, group: '' })),
    depCol,
    dets.map((id) => ({ id, lane: false, group: productOf(id) })),
  ]

  const colX: number[] = []
  let x = opt.padX
  for (let i = 0; i < COLUMNS.length; i++) {
    colX.push(x)
    x += opt.colW[i]! + (opt.gapX[i] ?? 0)
  }
  const width = x - (opt.gapX[COLUMNS.length - 1] ?? 0) + opt.padX

  const boxes = new Map<string, Box>()
  const heightOf = (col: number, lane: boolean) => (lane ? opt.laneH : col === 2 ? opt.versionH : opt.nodeH)
  const centre = (id: string) => {
    const b = boxes.get(id)
    return b ? b.y + b.h / 2 : null
  }
  const neighbours = (col: number, id: string, lane: boolean): string[] => {
    if (lane) return [id.slice(5)]
    if (col === 5) return intoOf(id).filter((f) => kind(f) === 'product')
    if (col === 4) return intoOf(id).filter((f) => kind(f) === 'product')
    return [...outOf(id), ...intoOf(id)]
  }
  const placeColumn = (col: number, stack: boolean) => {
    const list = ordered[col]!
    if (list.length === 0) return
    const heights = list.map((it) => heightOf(col, it.lane))
    const gaps = list.map((it, i) => {
      const next = list[i + 1]
      if (!next) return 0
      return next.group !== it.group && (col === 2 || col === 4 || col === 5 || col === 0) ? opt.groupGapY : opt.gapY
    })
    let desired: number[]
    if (stack) {
      desired = []
      let acc = 0
      list.forEach((_, i) => {
        desired.push(acc + heights[i]! / 2)
        acc += heights[i]! + gaps[i]!
      })
    } else {
      desired = []
      let last = 0
      list.forEach((it) => {
        const cs = neighbours(col, it.id, it.lane).map(centre).filter((c): c is number => c !== null)
        const d = cs.length ? mean(cs) : last
        desired.push(d)
        last = d
      })
    }
    const tops = place(desired, heights, gaps)
    list.forEach((it, i) => boxes.set(it.id, { id: it.id, col, x: colX[col]!, y: tops[i]!, w: opt.colW[col]!, h: heights[i]!, lane: it.lane }))
  }

  const anchor = ordered[2]!.length ? 2 : ordered[3]!.length ? 3 : ordered.findIndex((c) => c.length > 0)
  if (anchor >= 0) {
    placeColumn(anchor, true)
    for (let c = anchor - 1; c >= 0; c--) placeColumn(c, false)
    for (let c = anchor + 1; c < COLUMNS.length; c++) placeColumn(c, false)
  }
  let height = 0
  for (const b of boxes.values()) height = Math.max(height, b.y + b.h)
  return { boxes, colX, colW: opt.colW, width, height }
}

/** A smooth cubic between two columns; product -> determination edges run through the product's lane. */
export function edgePath(l: Layout, from: string, to: string, fromKind: string, toKind: string): string | null {
  const a = l.boxes.get(from)
  const b = l.boxes.get(to)
  if (!a || !b) return null
  const x1 = a.x + a.w
  const y1 = a.y + a.h / 2
  const x2 = b.x
  const y2 = b.y + b.h / 2
  if (fromKind === 'product' && toKind === 'determination') {
    const lane = l.boxes.get(`LANE:${from}`)
    if (lane) {
      const lx1 = lane.x
      const lx2 = lane.x + lane.w
      const ly = lane.y + lane.h / 2
      const m1 = (x1 + lx1) / 2
      const m2 = (lx2 + x2) / 2
      return `M${x1},${y1} C${m1},${y1} ${m1},${ly} ${lx1},${ly} L${lx2},${ly} C${m2},${ly} ${m2},${y2} ${x2},${y2}`
    }
  }
  const mx = (x1 + x2) / 2
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
}
