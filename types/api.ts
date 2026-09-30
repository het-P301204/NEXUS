import type {
  AffectednessResult,
  AuditEvent,
  AwarenessCriterion,
  CaseLifecycle,
  CaseRelation,
  CaseStatus,
  Comment,
  Component,
  Deployment,
  EscalationRule,
  Evidence,
  ExploitationStatus,
  Iso,
  Notification,
  Organization,
  Permission,
  Product,
  ProductComponent,
  ReportTransition,
  ReportVersion,
  Review,
  RoleId,
  Severity,
  ThreatIntel,
  User,
  Vulnerability,
} from './domain.ts'
import type { CaseAnalysis } from '../lib/engine/analyze.ts'
import type { CaseBundle } from '../lib/engine/bundle.ts'
import type { Deadline } from '../lib/engine/deadlines.ts'
import type { ChainVerification } from '../lib/engine/ledger.ts'
import type { SbomSuggestion } from '../lib/engine/affectedness.ts'
import type { HealthState } from '../lib/engine/analyze.ts'
import type { Analytics } from '../lib/engine/analytics.ts'

/** Shapes exchanged between the API server and the browser. */

export interface SessionResponse {
  user: User
  org: Organization
  permissions: Permission[]
  csrfToken: string
  demoMode: boolean
  expiresAt: Iso
}

export interface Persona {
  id: string
  name: string
  role: RoleId
  title: string
  initials: string
}

export interface NextDeadlineSummary {
  kind: Deadline['kind']
  label: string
  dueAt: Iso
  remainingMs: number
  status: Deadline['status']
}

export interface CaseListItem {
  id: string
  title: string
  cve: string | null
  vulnerabilityId: string
  severity: Severity
  exploitation: ExploitationStatus
  status: CaseStatus
  lifecycle: CaseLifecycle
  products: Array<{ id: string; name: string; version: string }>
  ownerId: string
  tags: string[]
  nextDeadline: NextDeadlineSummary | null
  deadlineStatuses: Array<{ kind: Deadline['kind']; status: Deadline['status'] }>
  affectedness: AffectednessResult
  completeness: { satisfied: number; applicable: number }
  health: { state: HealthState; reason: string }
  qualityErrors: number
  qualityWarnings: number
  createdAt: Iso
  updatedAt: Iso | null
}

export interface ChangeItem {
  seq: number
  at: Iso
  eventType: string
  summary: string
  actorId: string
  category: 'evidence' | 'status' | 'timestamp' | 'affectedness' | 'deadline' | 'review' | 'report' | 'other'
}

export interface CaseDetailResponse {
  bundle: Omit<CaseBundle, 'evidence'> & { evidence: Array<Evidence & { redacted?: boolean }> }
  analysis: CaseAnalysis
  comments: Comment[]
  relations: Array<CaseRelation & { other: { id: string; title: string; status: CaseStatus } }>
  suggestedRelations: Array<{ id: string; title: string; reason: string; status: CaseStatus }>
  ledger: AuditEvent[]
  changes: { since: Iso | null; sinceSeq: number; items: ChangeItem[] }
  sbom: Record<string, SbomSuggestion[]>
  transitions: ReportTransition[]
  canWrite: boolean
}

export interface OverviewResponse {
  now: Iso
  counts: {
    activeClocks: number
    critical: number
    openDeterminations: number
    underInvestigation: number
    evidenceGaps: number
  }
  activeClock: {
    item: CaseListItem
    analysis: Pick<CaseAnalysis, 'clock' | 'deadlines' | 'transitional' | 'status' | 'nextDeadline'>
  } | null
  agenda: Array<AgendaItem>
  attention: Array<{
    kind: 'gap' | 'review' | 'quality' | 'blocked'
    caseId: string
    title: string
    detail: string
    tab: string
    severity: 'info' | 'watch' | 'critical'
  }>
  recent: AuditEvent[]
}

export interface AgendaItem {
  caseId: string
  caseTitle: string
  cve: string | null
  product: string
  ownerId: string
  deadline: Deadline
}

export interface ProductListItem extends Product {
  components: Array<ProductComponent & { component: Component }>
  deployments: Deployment[]
  deploymentCount: number
  affectedCves: Array<{ vulnerabilityId: string; cve: string | null; severity: Severity; exploitation: ExploitationStatus; componentName: string; version: string }>
  riskState: 'clock_running' | 'affected' | 'investigating' | 'clear'
  riskReason: string
  openCases: string[]
}

export interface ComponentListItem extends Component {
  usedBy: Array<{ productId: string; productName: string; version: string; relation: string }>
  vulnerabilities: Array<{ id: string; cve: string | null; affectedVersions: string }>
}

export interface GraphNode {
  id: string
  kind: 'vulnerability' | 'component' | 'version' | 'product' | 'deployment' | 'determination'
  label: string
  sublabel: string
  state: 'affected' | 'not_affected' | 'under_investigation' | 'exploited' | 'neutral' | 'clock'
  meta: Record<string, string>
}

export interface GraphEdge {
  from: string
  to: string
  kind: string
  highlighted: boolean
}

export interface GraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface EvidenceListItem extends Evidence {
  redacted?: boolean
  links: Array<{ targetType: string; targetId: string }>
  caseTitle: string | null
}

export interface EvidenceChainNode {
  id: string
  kind: 'evidence' | 'clock_event' | 'determination' | 'decision' | 'report'
  label: string
  detail: string
  at: Iso | null
}

export interface EvidenceDetailResponse {
  evidence: Evidence & { redacted?: boolean }
  links: Array<{ targetType: string; targetId: string }>
  chain: EvidenceChainNode[][]
  integrity: { present: boolean; ok: boolean; observed: string | null; checkedAt: Iso }
  preview: string | null
}

export interface ReportDetailResponse {
  report: ReportVersion
  transitions: ReportTransition[]
  reviews: Review[]
  approval: { policy: string; satisfied: boolean; approvals: Array<{ reviewerId: string; role: RoleId; at: Iso }> }
  versions: Array<Pick<ReportVersion, 'id' | 'major' | 'minor' | 'generatedAt' | 'generatedBy' | 'stage' | 'caseStatus' | 'contentHash'>>
  latestOfKind: boolean
}

export interface LedgerResponse {
  entries: AuditEvent[]
  head: { seq: number; hash: string; at: Iso | null }
  lastVerification: { at: Iso; actorId: string; ok: boolean; checked: number; headSeq: number } | null
}

export interface VerifyResponse {
  result: ChainVerification
  verifiedAt: Iso
}

export interface TamperSimulationResponse {
  simulation: true
  target: { seq: number; id: string; field: string; original: string; altered: string }
  result: ChainVerification
}

export interface SystemStatus {
  ruleEngine: { state: 'operational' | 'degraded'; detail: string }
  ledger: { state: 'verified' | 'exception' | 'unverified'; detail: string; at: Iso | null }
  deadlineEngine: { state: 'operational' | 'degraded'; detail: string }
  dataIntegrity: { state: 'verified' | 'exception'; detail: string }
  ruleSetVersion: string
}

export interface SettingsResponse {
  org: Organization
  criteria: AwarenessCriterion[]
  escalation: EscalationRule[]
  evidencePolicy: { maxUploadBytes: number; allowedTypes: Array<{ label: string; mime: string; extensions: string[] }> }
  demoMode: boolean
}

export interface NotificationsResponse {
  stored: Notification[]
  escalations: Array<{
    id: string
    caseId: string
    caseTitle: string
    deadlineLabel: string
    dueAt: Iso
    level: EscalationRule['level']
    label: string
    targetRole: EscalationRule['targetRole']
    firesAt: Iso
  }>
}

export interface SearchResult {
  kind: 'case' | 'vulnerability' | 'product' | 'component' | 'evidence'
  id: string
  label: string
  sublabel: string
  href: string
}

export interface ImportPreview {
  token: string
  kind: 'vulnerabilities' | 'products' | 'components'
  format: 'csv' | 'json'
  valid: Array<{ row: number; summary: string }>
  warnings: Array<{ row: number; message: string }>
  errors: Array<{ row: number; message: string }>
  canCommit: boolean
}

export interface VulnerabilityDetail extends Vulnerability {
  intel: ThreatIntel[]
  cases: Array<{ id: string; title: string; status: CaseStatus }>
  componentName: string | null
  exposure: Array<{ productId: string; productName: string; version: string; inRange: boolean | null }>
}

export type AnalyticsResponse = Analytics & { demoData: boolean }
