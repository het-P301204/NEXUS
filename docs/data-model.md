# Data model

Types are in [`types/domain.ts`](../types/domain.ts); the schema is in [`server/db.ts`](../server/db.ts).
Objects fall into two families.

- **Recorded** objects are written once and never updated in place. A correction is a new record
  that points at the one it corrects.
- **Derived** objects are computed on every read from recorded ones and never stored, so they cannot
  drift from what they were derived from.

```text
Organization ─┬─ User (role)
              ├─ AwarenessCriterion        (configuration, editable, ledgered)
              ├─ EscalationRule            (configuration, editable, ledgered)
              │
Product ──────┼─ ProductComponent ── Component ── Vulnerability ── ThreatIntel*
   │          │     (version, relation, usage)      │
   └─ Deployment                                     │
                                                     │
Case ─────────┴── vulnerabilityId, productIds[] ─────┘
 ├─ ClockEvent*          OCCURRENCE · DETECTION · VULNERABILITY_AWARENESS · EXPLOITATION_AWARENESS
 │                       · DECISION · EARLY_WARNING_SUBMITTED · NOTIFICATION_SUBMITTED
 │                       · MEASURE_AVAILABLE · FINAL_REPORT_SUBMITTED · CORRECTION(supersedesId)
 ├─ Determination*       per product: 9 step answers → result, VEX status, justification
 ├─ Decision*            outcome, reason, rule trace, rule-set version, evidence
 ├─ Evidence* ── EvidenceLink* ──► clock_event | determination | decision | report | vulnerability
 ├─ ReportVersion* ── ReportTransition*   (stage derived from transitions)
 ├─ Review*              on report / decision / determination
 ├─ Comment*             collaboration, kept out of the ledger
 ├─ CaseRelation
 └─ Notification

AuditEvent*  (seq, prevHash, hash) ── every mutation above

* append-only: UPDATE and DELETE abort in SQLite
```

## Recorded entities

| Entity | Key fields | Notes |
| --- | --- | --- |
| **ClockEvent** | `event_id`, `case_id`, `event_type`, `occurredAt` (asserted), `timezone` (of the source), `actorId`, `source`, `sourceKind`, `evidenceIds`, `criterionId`, `responsibleRole`, `recordedAt` (server), `integrityHash` | The immutable timestamp model. `CORRECTION` events carry `supersedesId` and `correctionReason`. DECISION and submission events are stamped by the server and cannot be corrected. |
| **Determination** | `productId`, `productComponentId`, `answers` (9 × answer, note, evidence), `result`, `vexStatus`, `vexJustification`, `confidence`, `unresolved`, `nextAction`, owner, due, `supersedesId` | The server computes `result` from `answers`. The latest per product is current; earlier ones stay. |
| **Decision** | `outcome`, `nonReportReason`, `suggestedOutcome`, `divergenceReason`, `affectednessResult`, `determinationIds`, `exploitation`, `awarenessEventIds`, `ruleSetVersion`, `ruleTrace`, `rationale`, `confidence`, `evidenceIds`, `supersedesId` | Freezes the rule evaluation it was made against. |
| **Evidence** | `type`, `title`, `source`, `sourceCreatedAt`, `uploadedAt`, `ownerId`, `classification`, `sha256`, `mimeType`, `sizeBytes` | The file is stored content-addressed by `sha256`. |
| **EvidenceLink** | `evidenceId`, `targetType`, `targetId`, `createdAt`, `createdBy` | Additive only. Evidence can support records only in its own case. |
| **ReportVersion** | `kind`, `major.minor`, `generatedBy/At`, `caseStatus`, `decisionId`, `ruleSetVersion`, `evidenceCount`, `evidenceStateHash`, `contentHash`, `content` | A frozen snapshot. Major version when the decision or case status changed since the last version of the kind. |
| **ReportTransition** | `from`, `to`, `actorId`, `at`, `note` | The report's stage is the latest transition's `to`. |
| **Review** | `targetType`, `targetId`, `reviewerId`, `reviewerRole`, `action`, `comment` | APPROVE, REJECT, REQUEST_CHANGES, COMMENT. |
| **AuditEvent** | `seq`, `id`, `at`, `actorId`, `actorRole`, `eventType`, `objectType`, `objectId`, `caseId`, `source`, `summary`, `payload`, `prevHash`, `hash` | Hash chain; payloads carry ids and hashes, never evidence content. |

## Mutable entities

`Case` (title, owner, collaborators, tags, lifecycle, products), `Vulnerability` (exploitation status
changes are ledgered), `Product`, `Component`, `ProductComponent`, `Deployment`, `AwarenessCriterion`,
`EscalationRule`, `Organization`, `Notification.readAt`, `sessions`, `case_review_markers`. Every
change to these is written to the ledger with the fields that changed.

## Derived views

| View | Computed from | By |
| --- | --- | --- |
| Case status (NEW … CLOSED) | lifecycle, clock events, determinations, decisions | `deriveStatus` |
| Clock of Record (5 stages, elapsed times, active stage) | clock events with corrections resolved | `buildClock` |
| Transitional applicability | the two effective awareness instants | `evaluateTransitional` |
| Deadlines (24h, 72h, 14d) | the clock, applicability, the current decision, now | `computeDeadlines` |
| Affectedness evaluation per product | the current determination's answers | `evaluateAffectedness` |
| Reportability suggestion and rule trace | the above plus exploitation status and evidence | `evaluateReportability` |
| Evidence completeness and gaps | evidence, links, events, determinations, decision | `computeCompleteness`, `detectGaps` |
| Data-quality findings | everything above | `checkQuality` |
| Health (READY, INCOMPLETE, BLOCKED, UNDER REVIEW) | quality errors, overdue deadlines, pending reviews, completeness | `deriveHealth` |
| Explanation ("Why this decision?") | everything above | `explain` |

Because deadlines are derived, a correction moves every deadline downstream of the corrected event
on the next read, and the analysis of a case at any past instant can be reproduced by calling
`analyzeCase(bundle, thatInstant)`.
