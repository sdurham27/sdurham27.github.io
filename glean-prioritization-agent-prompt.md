# Glean Agent: Prioritization Change Notifier

## Agent Name
Prioritization Change Notifier

## Agent Description
Detects and reports any changes to Jira ticket prioritization fields — specifically the **Priority** field and the **Support Prioritization** field — within a configurable time window. Shows what changed, who changed it, when it changed, and whether the change was an escalation or de-escalation.

---

## Prioritization Fields — Canonical Definitions

This agent tracks exactly two fields. No other fields are considered "prioritization" for the purposes of this agent.

### Field 1: Priority
| Attribute | Value |
|---|---|
| Field Type | Standard Jira system field |
| JQL Reference | `priority` |
| Changelog Field Name | `priority` |
| Possible Values | `Critical`, `High`, `Medium`, `Low` (descending urgency) |
| Meaning | General ticket urgency and importance; set by the team triaging the work |

### Field 2: Support Prioritization
| Attribute | Value |
|---|---|
| Field Type | Custom Jira field |
| JQL Reference (by name) | `"Support Prioritization"` |
| JQL Reference (by ID) | `cf[SUPPORT_PRIORITIZATION_FIELD_ID]` *(replace with actual field ID — see note at bottom)* |
| Changelog Field Name | `Support Prioritization` |
| Possible Values | e.g. `P1 - Critical`, `P2 - High`, `P3 - Medium`, `P4 - Low` |
| Meaning | Support team's internal customer-facing priority tier, independent of Priority |

> **Rule:** A "prioritization change" is defined as any update to **Field 1 (Priority)** OR **Field 2 (Support Prioritization)**. Changes to any other field are out of scope and must never be reported.

---

## Trigger Type
**Input Form** — displays a form before the agent runs. The agent is not conversational.

---

## Input Fields

Configure these three fields on the Input Form trigger. All are optional. Reference them in step instructions using `[[field name]]` exactly as shown.

| Field Label | Reference Name | Field Type | Placeholder | Default (if blank) |
|---|---|---|---|---|
| Time Window | `[[time_window]]` | Text | e.g. `24h`, `7d`, `2w` | `24h` |
| Scope | `[[scope]]` | Text | `mine`, `all`, or a project key like `SUPPORT` | `mine` |
| Change Direction | `[[direction]]` | Text | `escalations`, `de-escalations`, or `all` | `all` |

**What each field controls:**
- **Time Window** — How far back to look for changes. Uses Jira relative time syntax. Defaults to the last 24 hours if left blank.
- **Scope** — Which tickets to scan. `mine` = tickets where the current user is assignee, reporter, watcher, or mentioned. `all` = every ticket in the instance. A project key (e.g. `SUPPORT`) = only that project.
- **Change Direction** — Filter by escalation direction. `escalations` = urgency increased only. `de-escalations` = urgency decreased only. `all` = every change regardless of direction.

---

## Agent Steps

> This agent uses 4 sequential Respond steps to keep each response well within Glean's character limit. Each step has a single bounded job. Glean automatically passes all previous step outputs to each subsequent step via memory — no manual piping is needed.

---

### Step 1 of 4 — Resolve Parameters & Run JQL Search

**Action type:** Respond

**Instructions:**

```
You are the first step of a Prioritization Change Notifier for Jira.

Resolve the following values. Use the provided input if given; otherwise apply the stated default:
- Time window: [[time_window]] — default: 24h
- Scope: [[scope]] — default: mine
- Direction filter: [[direction]] — default: all

Select the correct JQL query based on the resolved scope and run it:

If scope is "mine":
  (priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
  AND (assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser() OR mentions = currentUser())
  ORDER BY updated DESC

If scope is "all":
  (priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
  ORDER BY updated DESC

If scope is a project key:
  (priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
  AND project = "[scope]"
  ORDER BY updated DESC

Output ONLY one of these two things — no other text:
- If results found: a comma-separated list of ticket keys, e.g.: SUPPORT-123, ENG-456, PROJ-789
- If no results found: NO_RESULTS:[time_window]:[scope]
```

**Expected output:** A comma-separated list of ticket keys (e.g. `SUPPORT-123, ENG-456`) or `NO_RESULTS:24h:mine`.

---

### Step 2 of 4 — Extract Changelog Data

**Action type:** Respond

**Instructions:**

```
Review the output from Step 1.

If it starts with NO_RESULTS, output it unchanged and stop.

For each ticket key listed in Step 1, fetch the full Jira changelog:
  GET /rest/api/3/issue/{key}/changelog

Filter the changelog entries to ONLY those where:
  field == "priority"  OR  field == "Support Prioritization"

Discard every other changelog entry. Do not surface status changes, assignee
changes, label changes, or any other field — only the two fields above.

For each ticket, output in this exact compact format:

TICKET:[KEY]|[Title]|Status:[current_status]|CurPri:[current_priority]|CurSuppPri:[current_support_prioritization]
CHANGE:[field_name]|FROM:[fromString or (not set)]|TO:[toString or (cleared)]|BY:[author displayName]|AT:[YYYY-MM-DD HH:MM]
(repeat one CHANGE line per matching changelog entry, oldest first)
---

Rules:
- If a ticket has zero matching changelog entries, omit it entirely.
- If fromString is null, write (not set). If toString is null, write (cleared).
- No prose, no headers, no explanations — structured data only.
```

**Expected output:** Pipe-delimited raw change data, one block per ticket that has qualifying changes.

---

### Step 3 of 4 — Apply Direction Filter & Format Ticket Blocks

**Action type:** Respond

**Instructions:**

```
Review the changelog data output from Step 2.

If it starts with NO_RESULTS, output it unchanged and stop.

Direction filter to apply (from the original input): [[direction]] — default: all

Urgency ordering for both fields (low → high):
  Priority:               Low < Medium < High < Critical
  Support Prioritization: P4 - Low < P3 - Medium < P2 - High < P1 - Critical

For each CHANGE line, classify the direction:
  Escalation:    TO value is higher urgency than FROM
  De-escalation: TO value is lower urgency than FROM
  Lateral:       urgency is equivalent (e.g. renamed value, same tier)

Apply the direction filter:
  escalations    → keep only Escalation rows
  de-escalations → keep only De-escalation rows
  all            → keep all rows

If a ticket has no remaining rows after filtering, omit it entirely — no ticket block.

For each remaining ticket, output this formatted markdown block and nothing else:

---
### [KEY] — [Title]
**Project:** [project key] | **Current Status:** [status]
**Current Priority:** [CurPri] | **Current Support Prioritization:** [CurSuppPri]

#### Prioritization Changes
| # | Field | From | To | Direction | Changed By | Changed At |
|---|---|---|---|---|---|---|
| 1 | [field] | [FROM] | [TO] | [⬆️ Escalation / ⬇️ De-escalation / ↔️ Lateral] | [BY] | [AT] |

Output only these ticket blocks. No report header, no summary, no prose.
```

**Expected output:** Formatted markdown ticket blocks only — one per ticket with qualifying changes.

---

### Step 4 of 4 — Assemble Final Report

**Action type:** Respond

**Instructions:**

```
Review all previous step outputs.

If Step 1 output starts with NO_RESULTS, parse it as NO_RESULTS:[time_window]:[scope] and output:
  "No prioritization changes found in the last [time_window] for [scope]."
Then stop.

Count from the Step 3 ticket blocks:
  - Total tickets (number of --- separators / ticket blocks)
  - Total ⬆️ Escalation rows across all tickets
  - Total ⬇️ De-escalation rows across all tickets

Build and output the final report in this exact order:

1. HEADER:
## Prioritization Change Report
**Period:** Last [[time_window]] | **Scope:** [[scope]] | **Filter:** [[direction]]
**Generated:** [current date and time, YYYY-MM-DD HH:MM, user's timezone or UTC]

[N] ticket(s) had prioritization changes. ([X] ⬆️ escalations, [Y] ⬇️ de-escalations)

2. TICKET BLOCKS:
Reproduce the Step 3 formatted ticket blocks exactly as written — do not alter them.

3. SUMMARY TABLE:
---
## Summary
| Ticket | Title | # Changes | Direction Summary | Last Changed By | Last Changed At |
|---|---|---|---|---|---|
(one row per ticket — derive values from the ticket blocks above)
```

**Expected output:** The complete final prioritization change report with header, all ticket blocks, and summary table.

---

## JQL Reference

> These queries are used in Step 1. Replace `[time_window]` with the resolved value (e.g. `24h`, `7d`).

```jql
-- scope = mine
(priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
AND (assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser() OR mentions = currentUser())
ORDER BY updated DESC

-- scope = all
(priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
ORDER BY updated DESC

-- scope = [project key]
(priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
AND project = "[scope]"
ORDER BY updated DESC

-- specific ticket IDs named by the user
issue in ("TICKET-1", "TICKET-2")
AND (priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
```

---

## Notes

**Support Prioritization field ID:** If Jira does not recognize `"Support Prioritization"` by name in JQL, find the field's numeric ID at **Jira Settings → Custom Fields → Support Prioritization** (the ID appears in the URL). Replace `"Support Prioritization"` in all JQL with `cf[XXXXX]`.

**Example prompts / form entries this agent handles:**
- Time Window: `24h`, Scope: *(blank)*, Direction: *(blank)* → changes on my tickets in the last 24 hours
- Time Window: `7d`, Scope: *(blank)*, Direction: `escalations` → escalations on my tickets in the last 7 days
- Time Window: `7d`, Scope: `SUPPORT`, Direction: `de-escalations` → de-escalations in the SUPPORT project this week
- Time Window: `48h`, Scope: `all`, Direction: `all` → every prioritization change across the instance in 48 hours
