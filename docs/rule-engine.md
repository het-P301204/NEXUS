# Rule engine

The rule set is data ([`rules/cra-article14.ts`](../rules/cra-article14.ts)): ids, versions,
effective dates, citations, human-readable IF/THEN lines, durations and attention thresholds. The
engine ([`lib/engine/`](../lib/engine)) evaluates it. Every recorded decision stores the rule-set
version and the full trace it was evaluated under.

Encoded from Regulation (EU) 2024/2847: Art. 3(42) (actively exploited vulnerability), Art. 14(1)–(2)
(notification obligations and deadlines) and Art. 71(2) (Article 14 applies from 11 September 2026).
This is an engineering encoding for decision support, not legal advice.

## Evaluation order

```text
INPUT ─ clock events · determinations · exploitation status · evidence · products
  │
  ▼
R-AWARENESS            vulnerability awareness  +  exploitation awareness   (each against a criterion)
  │                    awareness instant = exploitation awareness (implies vulnerability awareness)
  ▼
R-3-42-EXPLOITATION    CONFIRMED  AND  exploitation evidence on the case    → established
  │
  ▼
R-VEX-AFFECTEDNESS     per product: nine-step walk → AFFECTED | NOT_AFFECTED | UNDER_INVESTIGATION
  │                    aggregate over products made available in the EU
  ▼
R-71-2-TRANSITIONAL    both awareness dates < 2026-09-10T22:00:00Z  → not applicable
  │                    otherwise                                    → applicable
  ▼
R-14-1-SCOPE           at least one product made available in the EU
  │
  ▼
OUTCOME                decisive negatives first, then all-positive, else PENDING
  │
  ▼
R-14-2-A / B / C       deadlines from the clock start (24h, 72h) and from measure availability (14d)
```

## Suggested outcome

```text
IF exploitation = NOT_OBSERVED                        THEN not required (no active exploitation)
ELSE IF both awareness dates precede application      THEN not required (transitional)
ELSE IF no product is made available in the EU        THEN not required (scope)
ELSE IF every in-scope product is NOT AFFECTED        THEN not required (not affected)
ELSE IF exploitation established
     AND applicability = true
     AND some in-scope product is AFFECTED            THEN REPORT
ELSE                                                  PENDING, listing what is unresolved
```

A suggestion never stops a clock. Only a **recorded decision** of *do not report* makes the
deadlines NOT_APPLICABLE, and only once it is **in force**:

- its decision record has been **approved** by Compliance or Legal. Not reporting is the
  higher-risk decision, so it does not take effect on the word of the person who recorded it;
- **no awareness has been recorded or corrected since**. Exploitation confirmed after a "no active
  exploitation" decision reopens the question: the clock runs, the case cannot be closed, and a
  blocking data-quality error asks for a new decision.

Until then a running clock keeps running, including while affectedness is under investigation. A
deadline already met by a submission stays COMPLETED whatever is decided afterwards.

## Deadlines

| Rule | IF | THEN |
| --- | --- | --- |
| `R-14-2-A-EARLY-WARNING` | active exploitation confirmed AND awareness established AND applicability true | Early warning deadline = awareness + 24 hours |
| `R-14-2-B-NOTIFICATION` | the same | Vulnerability notification deadline = awareness + 72 hours |
| `R-14-2-C-FINAL-REPORT` | reporting applicable AND corrective or mitigating measure available recorded | Final report deadline = measure available + 14 days |

Each deadline carries a `calculation` array that the UI shows under **Why this deadline?**: the rule,
the start event (with the correction that superseded it, if any), the awareness arithmetic, the
source, the due instant and the remaining time.

Statuses: `ON_TRACK`, `WATCH`, `CRITICAL`, `OVERDUE`, `COMPLETED`, `COMPLETED_LATE`,
`PENDING_START`, `NOT_APPLICABLE`, `BLOCKED`. The WATCH and CRITICAL thresholds are operational,
not statutory: 12h/4h for the early warning, 24h/8h for the notification and 3d/1d for the final
report.

## The application boundary

Article 71(2) gives a date. The rule set reads it as **00:00 CEST on 11 September 2026 =
2026-09-10T22:00:00Z**. An instant exactly at the boundary is "on or after". A trigger within 24
hours either side is flagged `nearBoundary`, with a counsel-review note in the reasoning. The
interpretation is a single constant, `APPLICATION_INSTANT`, and changing it means publishing a new
rule-set version.

## Affectedness walk

```text
step 8 exploitation demonstrated = YES ─────────────────────────────► AFFECTED (+ contradictions)
steps 1–5, in order:
    unanswered / UNKNOWN ──────────────────────────────────────────► UNDER INVESTIGATION
    NO ─► candidate NOT AFFECTED (justification of that step)
step 6 (if 1–5 all YES):
    unanswered / UNKNOWN ──────────────────────────────────────────► UNDER INVESTIGATION
    YES ─► candidate NOT AFFECTED (inline_mitigations_already_exist)
    NO ─────────────────────────────────────────────────────────────► AFFECTED
candidate NOT AFFECTED:
    step 9 validation ≠ YES ───────────────────────────────────────► UNDER INVESTIGATION
    deciding answer has no evidence ───────────────────────────────► UNDER INVESTIGATION
    otherwise ─────────────────────────────────────────────────────► NOT AFFECTED
step 7 compensating control = YES ─► action statement only; result unchanged
```

## Self-test

`server/selftest.ts` runs known-answer vectors (both dates pre-application, split dates, no
exploitation awareness, unknown version, not-affected without validation, 24h/72h/14d arithmetic,
an approved non-report decision stops the clock) behind the system-status panel. The panel reports the rule and deadline
engines as *operational* only when every vector passes.
