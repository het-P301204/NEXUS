import type { RuleSet } from '../types/domain.ts'

/**
 * The CRA Article 14 rule set, as data.
 *
 * Every number the deadline engine uses comes from here, and every rule the
 * engine evaluates is described here in the same words the Rules page shows.
 * The engine refers to rules by id; changing a duration means publishing a new
 * rule-set version, and every recorded decision keeps the version it was
 * evaluated under.
 *
 * Sources: Regulation (EU) 2024/2847 (Cyber Resilience Act), Article 3(42),
 * Article 14(1)-(2) and Article 71(2). NEXUS encodes these for decision
 * support. The encoding is not legal advice, and it is not a legal
 * determination of compliance.
 */

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS

/**
 * Article 71(2) sets 11 September 2026 as the date from which Article 14
 * applies. The regulation gives a date, not an instant. This rule set reads
 * the boundary as 00:00 in Brussels (CEST, UTC+02:00). The interpretation is
 * written down here rather than left implicit. Any trigger instant within 24
 * hours of it is flagged for counsel review.
 */
export const APPLICATION_INSTANT = '2026-09-10T22:00:00.000Z'

export const DEADLINE_DURATIONS = {
  EARLY_WARNING: 24 * HOUR_MS,
  VULNERABILITY_NOTIFICATION: 72 * HOUR_MS,
  FINAL_REPORT: 14 * DAY_MS,
} as const

/**
 * Operational attention thresholds, in milliseconds remaining. These are not
 * part of the regulation. They set when a running clock turns WATCH and
 * CRITICAL in the interface, and the escalation policy works from them too.
 */
export const ATTENTION_THRESHOLDS = {
  EARLY_WARNING: { watch: 12 * HOUR_MS, critical: 4 * HOUR_MS },
  VULNERABILITY_NOTIFICATION: { watch: 24 * HOUR_MS, critical: 8 * HOUR_MS },
  FINAL_REPORT: { watch: 3 * DAY_MS, critical: 1 * DAY_MS },
} as const

export const BOUNDARY_REVIEW_WINDOW_MS = 24 * HOUR_MS

export const RULE_IDS = {
  awareness: 'R-AWARENESS',
  exploitation: 'R-3-42-EXPLOITATION',
  affectedness: 'R-VEX-AFFECTEDNESS',
  transitional: 'R-71-2-TRANSITIONAL',
  scope: 'R-14-1-SCOPE',
  earlyWarning: 'R-14-2-A-EARLY-WARNING',
  notification: 'R-14-2-B-NOTIFICATION',
  finalReport: 'R-14-2-C-FINAL-REPORT',
} as const

export const RULE_SET: RuleSet = {
  id: 'CRA-ART14',
  version: '2026.09-r4',
  title: 'EU Cyber Resilience Act -- Article 14 vulnerability reporting',
  publishedAt: '2026-09-08T09:00:00.000Z',
  applicationInstant: APPLICATION_INSTANT,
  applicationInstantBasis:
    'Article 71(2): Article 14 applies from 11 September 2026. The regulation states a date, not an instant; this rule set reads the boundary as 00:00 CEST (UTC+02:00), which is 2026-09-10T22:00:00Z. A trigger instant within 24 hours of the boundary is flagged for counsel review.',
  rules: [
    {
      id: RULE_IDS.awareness,
      title: 'Manufacturer awareness',
      version: '1.3',
      effectiveFrom: '2026-09-08T09:00:00.000Z',
      status: 'ACTIVE',
      citation: 'Art. 14(1) "that it becomes aware of"; organisation awareness criteria',
      description:
        'Awareness is established when one of the organisation\'s configured awareness criteria is met and recorded with its evidence. There are two awareness events: awareness of the vulnerability and awareness of its active exploitation. The reporting clock starts at exploitation awareness, which includes awareness of the vulnerability.',
      conditions: [
        'vulnerability awareness = recorded against an active criterion',
        'exploitation awareness = recorded against an active criterion',
      ],
      outcomes: [
        'awareness of an actively exploited vulnerability = the exploitation-awareness instant',
        'clock start = that instant; a vulnerability-awareness record dated later cannot move it',
      ],
      notes: [
        'Awareness events are immutable. A wrong timestamp is corrected by a correction event that preserves the original.',
        'Detection is not awareness. A scanner hit or an inbound report starts the investigation, not the clock.',
        'Exploitation awareness dated before vulnerability awareness is a data-quality error: the record contradicts itself and must be corrected. Until it is, the clock runs from exploitation awareness (the stricter reading) and applicability uses the later date (the conservative one).',
        'A decision not to report stops the clocks only once its decision record is approved, and only while no awareness has been recorded or corrected after it.',
      ],
    },
    {
      id: RULE_IDS.exploitation,
      title: 'Active exploitation',
      version: '1.0',
      effectiveFrom: '2026-09-08T09:00:00.000Z',
      status: 'ACTIVE',
      citation: 'Art. 3(42) "actively exploited vulnerability"',
      description:
        'A vulnerability is actively exploited when there is reliable evidence that a malicious actor has exploited it in a system without the permission of the system owner. SUSPECTED does not meet that bar and does not start an Article 14(1) clock.',
      conditions: ['exploitation status = CONFIRMED', 'AND exploitation evidence linked'],
      outcomes: ['active exploitation = established'],
      notes: [
        'Good-faith testing, research and disclosure without malicious motive is not active exploitation.',
      ],
    },
    {
      id: RULE_IDS.affectedness,
      title: 'Product affectedness (VEX)',
      version: '1.1',
      effectiveFrom: '2026-09-08T09:00:00.000Z',
      status: 'ACTIVE',
      citation: 'Art. 14(1) "contained in the product"; OpenVEX / CISA VEX status vocabulary',
      description:
        'Affectedness is evaluated per product through nine ordered questions. Finding a vulnerable component does not make a product affected; an UNKNOWN answer makes it UNDER INVESTIGATION, never NOT AFFECTED.',
      conditions: [
        'component present AND vulnerable version AND functionality enabled',
        'AND feature reachable AND exploit path exists',
        'AND configuration does not mitigate',
      ],
      outcomes: [
        'AFFECTED -- or NOT AFFECTED with a VEX justification -- or UNDER INVESTIGATION',
      ],
      notes: [
        'NOT AFFECTED is recorded only when product-specific validation is complete and the deciding answer has evidence.',
        'A compensating control reduces risk but does not change affectedness. It is recorded as an action statement.',
        'Exploitation demonstrated against the product decides AFFECTED. Any answer that contradicts it is raised as a data-quality error.',
      ],
    },
    {
      id: RULE_IDS.transitional,
      title: 'Transitional application (two-date rule)',
      version: '1.0',
      effectiveFrom: '2026-09-08T09:00:00.000Z',
      status: 'ACTIVE',
      citation: 'Art. 71(2) -- Article 14 applies from 11 September 2026',
      description:
        'Article 14 applies to actively exploited vulnerabilities the manufacturer becomes aware of from the application date. Two awareness dates are evaluated independently. A manufacturer aware of both the vulnerability and its exploitation before the application date has no Article 14 obligation. A manufacturer aware of the vulnerability before, but of its exploitation after, does.',
      conditions: [
        'vulnerability awareness < application instant',
        'AND exploitation awareness < application instant',
      ],
      outcomes: [
        'THEN applicability = false (both dates precede application)',
        'ELSE applicability = true',
      ],
      notes: [
        'Only the later of the two awareness instants decides applicability.',
        'A trigger instant within 24 hours of the boundary is flagged for counsel review.',
      ],
    },
    {
      id: RULE_IDS.scope,
      title: 'Product made available in the EU',
      version: '1.0',
      effectiveFrom: '2026-09-08T09:00:00.000Z',
      status: 'ACTIVE',
      citation: 'Art. 14(1); Art. 2 scope -- products with digital elements made available on the market',
      description:
        'The obligation attaches to a product with digital elements made available on the Union market, wherever the manufacturer is established. A product not made available in the EU does not create an Article 14 obligation.',
      conditions: ['product made available in EU = true'],
      outcomes: ['product in scope = true'],
      notes: [],
    },
    {
      id: RULE_IDS.earlyWarning,
      title: 'Early warning notification',
      version: '1.0',
      effectiveFrom: '2026-09-08T09:00:00.000Z',
      status: 'ACTIVE',
      citation: 'Art. 14(2)(a) -- without undue delay and in any event within 24 hours',
      description:
        'An early warning notification is due without undue delay, and in any event within 24 hours of the manufacturer becoming aware of the actively exploited vulnerability. Where applicable it indicates the Member States where the product has been made available.',
      conditions: [
        'active exploitation = confirmed',
        'AND awareness = established',
        'AND applicability = true',
      ],
      outcomes: ['Early Warning Deadline = Awareness + 24 hours'],
      notes: ['24 hours is the outer limit. The obligation is "without undue delay".'],
    },
    {
      id: RULE_IDS.notification,
      title: 'Vulnerability notification',
      version: '1.0',
      effectiveFrom: '2026-09-08T09:00:00.000Z',
      status: 'ACTIVE',
      citation: 'Art. 14(2)(b) -- without undue delay and in any event within 72 hours',
      description:
        'A vulnerability notification is due within 72 hours of awareness, unless the information has already been provided. It gives general information about the product, the nature of the exploit and the vulnerability, any corrective or mitigating measures taken, and those users can take.',
      conditions: [
        'active exploitation = confirmed',
        'AND awareness = established',
        'AND applicability = true',
      ],
      outcomes: ['Vulnerability Notification Deadline = Awareness + 72 hours'],
      notes: [],
    },
    {
      id: RULE_IDS.finalReport,
      title: 'Final report',
      version: '1.0',
      effectiveFrom: '2026-09-08T09:00:00.000Z',
      status: 'ACTIVE',
      citation: 'Art. 14(2)(c) -- no later than 14 days after a corrective or mitigating measure is available',
      description:
        'The final report clock does not start at awareness. It starts when a corrective or mitigating measure is available, and stays pending until that event is recorded.',
      conditions: [
        'reporting applicable = true',
        'AND corrective or mitigating measure available = recorded',
      ],
      outcomes: ['Final Report Deadline = Measure available + 14 days'],
      notes: ['Until the measure-available event is recorded there is no final-report deadline to compute.'],
    },
  ],
}
