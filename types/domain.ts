/**
 * NEXUS domain model.
 *
 * One vocabulary shared by the rule engine, the API server and the browser.
 * Instants are ISO-8601 strings in UTC ("2026-09-30T08:31:22.000Z"); the
 * timezone that accompanies an asserted timestamp is an IANA zone name kept
 * for display and for the record, never used for arithmetic.
 *
 * Two families of object live here:
 *
 *   Recorded   -- written once, never updated in place: clock events,
 *                 determinations, decisions, report versions, audit events.
 *                 A correction is a new record that points at the old one.
 *   Derived    -- computed on read from recorded objects: case status, the
 *                 clock of record, deadlines, completeness, health, data
 *                 quality. Derived objects are never stored, so they cannot
 *                 drift from the records they were derived from.
 */

export type Iso = string

// ---------------------------------------------------------------------------
// Organisation, users, roles
// ---------------------------------------------------------------------------

export type RoleId =
  | 'administrator'
  | 'psirt_lead'
  | 'psirt_analyst'
  | 'security_engineer'
  | 'security_manager'
  | 'compliance_reviewer'
  | 'legal_reviewer'
  | 'executive_approver'
  | 'read_only'

export type Permission =
  | 'case.create'
  | 'case.edit'
  | 'case.assign'
  | 'case.close'
  | 'case.reopen'
  | 'case.archive'
  | 'vulnerability.write'
  | 'product.write'
  | 'determination.record'
  | 'awareness.establish'
  | 'clock.record'
  | 'clock.correct'
  | 'decision.record'
  | 'review.approve'
  | 'report.generate'
  | 'submission.advance'
  | 'submission.submit'
  | 'evidence.read'
  | 'evidence.read_restricted'
  | 'evidence.write'
  | 'ledger.verify'
  | 'comment.write'
  | 'import.commit'
  | 'settings.manage'
  | 'demo.control'

export interface Organization {
  id: string
  name: string
  legalEntity: string
  timezone: string
  memberStatesMadeAvailable: string[]
  csirtCoordinator: string
  demo: boolean
}

export interface User {
  id: string
  name: string
  email: string
  role: RoleId
  title: string
  initials: string
  active: boolean
}

// ---------------------------------------------------------------------------
// Portfolio: products, components, deployments
// ---------------------------------------------------------------------------

export type ProductLifecycle = 'active' | 'maintenance' | 'end_of_support'
export type SbomStatus = 'current' | 'stale' | 'missing'
export type Exposure = 'internet_facing' | 'customer_network' | 'internal' | 'isolated'

export interface Product {
  id: string
  name: string
  version: string
  lifecycle: ProductLifecycle
  ownerId: string
  description: string
  sbomStatus: SbomStatus
  sbomGeneratedAt: Iso | null
  environment: string
  exposure: Exposure
  madeAvailableInEu: boolean
}

export interface Component {
  id: string
  name: string
  purl: string
  ecosystem: string
  supplier: string
}

export type DependencyRelation = 'direct' | 'transitive'

/** A component at a specific version inside a specific product. */
export interface ProductComponent {
  id: string
  productId: string
  componentId: string
  version: string
  relation: DependencyRelation
  /** For a transitive dependency, the product component that pulls it in. */
  viaId: string | null
  /** What the product uses the component for -- the input to reachability. */
  usage: string
}

export interface Deployment {
  id: string
  productId: string
  name: string
  region: string
  count: number
  environment: string
  exposure: Exposure
}

// ---------------------------------------------------------------------------
// Vulnerabilities and threat intelligence
// ---------------------------------------------------------------------------

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

/**
 * Article 3(42): "a vulnerability for which there is reliable evidence that
 * a malicious actor has exploited it in a system without permission of the
 * system owner". CONFIRMED is reserved for that bar; SUSPECTED is anything
 * short of it and does not start an Article 14(1) clock.
 */
export type ExploitationStatus = 'CONFIRMED' | 'SUSPECTED' | 'NOT_OBSERVED' | 'UNKNOWN'

export interface Vulnerability {
  id: string
  cve: string | null
  title: string
  cwe: string | null
  cvssScore: number | null
  cvssVector: string | null
  severity: Severity
  description: string
  componentId: string | null
  affectedVersions: string
  fixedVersion: string | null
  exploitability: string
  exploitation: ExploitationStatus
  source: string
  discoveredAt: Iso
  vendorAdvisory: string | null
  threatIntelReference: string | null
  createdAt: Iso
  createdBy: string
}

export type IntelConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ThreatIntel {
  id: string
  vulnerabilityId: string
  source: string
  observedExploitation: boolean
  firstObserved: Iso | null
  confidence: IntelConfidence
  indicator: string
  reference: string
  analystId: string
  recordedAt: Iso
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export type CaseStatus =
  | 'NEW'
  | 'INVESTIGATING'
  | 'AWARENESS_ESTABLISHED'
  | 'DETERMINATION_PENDING'
  | 'REPORTABLE'
  | 'NOT_REPORTABLE'
  | 'SUBMITTED'
  | 'CLOSED'

export type CaseLifecycle = 'open' | 'closed' | 'archived'

export interface Case {
  id: string
  title: string
  vulnerabilityId: string
  ownerId: string
  collaboratorIds: string[]
  tags: string[]
  lifecycle: CaseLifecycle
  lifecycleReason: string | null
  productIds: string[]
  createdAt: Iso
  createdBy: string
  summary: string
}

export type CaseRelationType =
  | 'RELATED_CVE'
  | 'RELATED_PRODUCT'
  | 'RELATED_ADVISORY'
  | 'RELATED_INCIDENT'
  | 'RELATED_CORRECTIVE_MEASURE'
  | 'DUPLICATE_OF'

export interface CaseRelation {
  id: string
  caseId: string
  relatedCaseId: string
  relation: CaseRelationType
  note: string
  createdBy: string
  createdAt: Iso
}

// ---------------------------------------------------------------------------
// Clock of Record
// ---------------------------------------------------------------------------

export type ClockEventType =
  | 'OCCURRENCE'
  | 'DETECTION'
  | 'VULNERABILITY_AWARENESS'
  | 'EXPLOITATION_AWARENESS'
  | 'DECISION'
  | 'EARLY_WARNING_SUBMITTED'
  | 'NOTIFICATION_SUBMITTED'
  | 'MEASURE_AVAILABLE'
  | 'FINAL_REPORT_SUBMITTED'
  | 'CORRECTION'

/**
 * How authoritative the timestamp source is. A system of record (ticketing,
 * SIEM, mail server) outranks a document, which outranks an analyst's
 * recollection. NEXUS's own clock is authoritative only for the moments
 * it witnesses directly -- a decision being recorded, a submission being made.
 */
export type TimestampSourceKind =
  | 'system_of_record'
  | 'external_document'
  | 'analyst_attestation'
  | 'nexus_server'

export interface ClockEvent {
  id: string
  caseId: string
  type: ClockEventType
  /** The asserted instant at which the event happened. */
  occurredAt: Iso
  /** IANA zone of the source that asserted the instant. */
  timezone: string
  actorId: string
  source: string
  sourceKind: TimestampSourceKind
  evidenceIds: string[]
  /** Awareness events: the organisation criterion that was met. */
  criterionId: string | null
  responsibleRole: RoleId | null
  /** For CORRECTION: the event whose timestamp or details this corrects. */
  supersedesId: string | null
  correctionReason: string | null
  /** Links to the record this event witnesses (decision, report). */
  decisionId: string | null
  reportId: string | null
  note: string
  /** Server time at which NEXUS recorded the event. Never client-supplied. */
  recordedAt: Iso
  /** SHA-256 over the canonical event content. */
  integrityHash: string
}

// ---------------------------------------------------------------------------
// Awareness criteria (organisation configuration)
// ---------------------------------------------------------------------------

export type AwarenessScope = 'vulnerability' | 'exploitation'

export interface AwarenessCriterion {
  id: string
  label: string
  description: string
  scope: AwarenessScope
  responsibleRole: RoleId
  requiredEvidenceTypes: EvidenceType[]
  active: boolean
}

// ---------------------------------------------------------------------------
// Affectedness (VEX-aligned determination)
// ---------------------------------------------------------------------------

export type Answer = 'YES' | 'NO' | 'UNKNOWN'

export type AffectednessStepId =
  | 'component_present'
  | 'vulnerable_version'
  | 'functionality_enabled'
  | 'feature_reachable'
  | 'exploit_path'
  | 'configuration_mitigates'
  | 'compensating_control'
  | 'exploitation_demonstrated'
  | 'product_validation'

export interface StepAnswer {
  answer: Answer | null
  note: string
  evidenceIds: string[]
}

export type AffectednessResult = 'AFFECTED' | 'NOT_AFFECTED' | 'UNDER_INVESTIGATION'

/** CycloneDX / OpenVEX status vocabulary. */
export type VexStatus = 'affected' | 'not_affected' | 'under_investigation' | 'fixed'

/** OpenVEX / CISA minimum-requirements justifications for not_affected. */
export type VexJustification =
  | 'component_not_present'
  | 'vulnerable_code_not_present'
  | 'vulnerable_code_not_in_execute_path'
  | 'vulnerable_code_cannot_be_controlled_by_adversary'
  | 'inline_mitigations_already_exist'

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface Determination {
  id: string
  caseId: string
  productId: string
  productComponentId: string | null
  answers: Record<AffectednessStepId, StepAnswer>
  result: AffectednessResult
  vexStatus: VexStatus
  vexJustification: VexJustification | null
  rationale: string
  analystId: string
  recordedAt: Iso
  confidence: Confidence
  unresolved: string
  nextAction: string
  nextActionOwnerId: string | null
  nextActionDue: Iso | null
  supersedesId: string | null
}

// ---------------------------------------------------------------------------
// Reportability decision
// ---------------------------------------------------------------------------

export type DecisionOutcome = 'REPORT' | 'DO_NOT_REPORT'

export type NonReportReason =
  | 'NOT_AFFECTED'
  | 'NO_ACTIVE_EXPLOITATION'
  | 'TRANSITIONAL_PRE_APPLICATION'
  | 'NOT_MADE_AVAILABLE_IN_EU'
  | 'OTHER'

export interface Decision {
  id: string
  caseId: string
  outcome: DecisionOutcome
  nonReportReason: NonReportReason | null
  /** What the rule evaluation suggested at the moment the decision was made. */
  suggestedOutcome: DecisionOutcome | 'PENDING'
  divergenceReason: string | null
  affectednessResult: AffectednessResult
  determinationIds: string[]
  exploitation: ExploitationStatus
  exploitationBasis: string
  awarenessEventIds: string[]
  ruleSetVersion: string
  ruleTrace: RuleTrace
  rationale: string
  analystId: string
  decidedAt: Iso
  confidence: Confidence
  unresolved: string
  evidenceIds: string[]
  supersedesId: string | null
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type EvidenceType =
  | 'SBOM'
  | 'VEX'
  | 'SCANNER_RESULT'
  | 'EXPLOIT_EVIDENCE'
  | 'INCIDENT_RECORD'
  | 'EMAIL'
  | 'TICKET'
  | 'LOG'
  | 'SCREENSHOT'
  | 'VENDOR_ADVISORY'
  | 'ANALYST_NOTE'
  | 'POLICY'
  | 'CONFIGURATION'
  | 'THREAT_INTELLIGENCE'
  | 'CUSTOMER_COMMUNICATION'
  | 'SUBMISSION_RECEIPT'

export type EvidenceClassification = 'internal' | 'restricted'

export interface Evidence {
  id: string
  caseId: string | null
  type: EvidenceType
  title: string
  description: string
  source: string
  /** When the artifact itself was created, per its source. */
  sourceCreatedAt: Iso | null
  /** Server time of upload. */
  uploadedAt: Iso
  ownerId: string
  classification: EvidenceClassification
  sha256: string
  fileName: string | null
  mimeType: string | null
  sizeBytes: number
  /** Stored object present on disk (false for inline, text-only evidence). */
  hasFile: boolean
}

export type EvidenceTargetType =
  | 'clock_event'
  | 'determination'
  | 'decision'
  | 'report'
  | 'vulnerability'
  | 'case'

export interface EvidenceLink {
  evidenceId: string
  targetType: EvidenceTargetType
  targetId: string
}

// ---------------------------------------------------------------------------
// Reports, submission, reviews
// ---------------------------------------------------------------------------

export type ReportKind =
  | 'EARLY_WARNING'
  | 'VULNERABILITY_NOTIFICATION'
  | 'FINAL_REPORT'
  | 'DECISION_RECORD'

export type SubmissionStage =
  | 'DRAFT'
  | 'INTERNAL_REVIEW'
  | 'APPROVED'
  | 'READY'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'CLOSED'

export interface ReportVersion {
  id: string
  caseId: string
  kind: ReportKind
  major: number
  minor: number
  title: string
  generatedBy: string
  generatedAt: Iso
  caseStatus: CaseStatus
  /** The decision in force when the version was generated. */
  decisionId: string | null
  ruleSetVersion: string
  evidenceCount: number
  evidenceStateHash: string
  contentHash: string
  stage: SubmissionStage
  submissionReference: string | null
  content: ReportContent
}

export interface ReportTransition {
  id: string
  reportId: string
  from: SubmissionStage
  to: SubmissionStage
  actorId: string
  at: Iso
  note: string
}

export type ReviewAction = 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'COMMENT'
export type ReviewTargetType = 'decision' | 'report' | 'determination'

export interface Review {
  id: string
  caseId: string
  targetType: ReviewTargetType
  targetId: string
  reviewerId: string
  reviewerRole: RoleId
  action: ReviewAction
  comment: string
  createdAt: Iso
}

// ---------------------------------------------------------------------------
// Collaboration and notifications
// ---------------------------------------------------------------------------

export interface Comment {
  id: string
  caseId: string
  authorId: string
  body: string
  createdAt: Iso
  relatedEventId: string | null
  relatedEvidenceId: string | null
  mentions: string[]
}

export type NotificationSeverity = 'info' | 'watch' | 'critical'

export interface Notification {
  id: string
  userId: string
  kind: string
  severity: NotificationSeverity
  title: string
  body: string
  caseId: string | null
  link: string | null
  createdAt: Iso
  readAt: Iso | null
}

export interface EscalationRule {
  id: string
  /** Minutes before the deadline at which this step fires. 0 = at deadline. */
  offsetMinutes: number
  targetRole: RoleId | 'owner'
  level: NotificationSeverity
  label: string
  active: boolean
}

// ---------------------------------------------------------------------------
// Audit ledger
// ---------------------------------------------------------------------------

export interface AuditEvent {
  seq: number
  id: string
  at: Iso
  actorId: string
  actorRole: RoleId | 'system'
  eventType: string
  objectType: string
  objectId: string
  caseId: string | null
  source: 'ui' | 'api' | 'import' | 'system' | 'demo'
  summary: string
  payload: Record<string, unknown>
  prevHash: string
  hash: string
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type RuleStatus = 'ACTIVE' | 'DRAFT' | 'SUPERSEDED'

export interface RuleDefinition {
  id: string
  title: string
  version: string
  effectiveFrom: Iso
  status: RuleStatus
  citation: string
  description: string
  /** Human-readable IF lines. */
  conditions: string[]
  /** Human-readable THEN lines. */
  outcomes: string[]
  notes: string[]
}

export interface RuleSet {
  id: string
  version: string
  title: string
  publishedAt: Iso
  /** The instant at which Article 14 obligations begin to apply. */
  applicationInstant: Iso
  applicationInstantBasis: string
  rules: RuleDefinition[]
}

export interface RuleTraceStep {
  ruleId: string
  label: string
  inputs: Record<string, string | null>
  result: string
  detail: string
  state: 'pass' | 'fail' | 'pending' | 'info'
}

export interface RuleTrace {
  ruleSetVersion: string
  evaluatedAt: Iso
  steps: RuleTraceStep[]
}

// ---------------------------------------------------------------------------
// Report content snapshot (what a report version freezes)
// ---------------------------------------------------------------------------

export interface ReportSection {
  id: string
  title: string
  /** Plain-text paragraphs; never HTML. Rendered escaped. */
  paragraphs: string[]
  /** Optional key/value rows. */
  facts?: Array<[string, string]>
  /** Optional table. */
  table?: { columns: string[]; rows: string[][] }
}

export interface ReportContent {
  heading: string
  subheading: string
  organization: string
  caseId: string
  generatedAt: Iso
  ruleSetVersion: string
  disclaimer: string
  sections: ReportSection[]
}
