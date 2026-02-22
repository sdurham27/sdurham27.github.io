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

## Input Variables

| Field Label | Variable | Placeholder | Default |
|---|---|---|---|
| Time Window | `{{time_window}}` | e.g. `24h`, `7d`, `2w` | `24h` |
| Scope | `{{scope}}` | `mine`, `all`, or a project key | `mine` |
| Change Direction | `{{direction}}` | `escalations`, `de-escalations`, `all` | `all` |

---

## Agent Steps Configuration

> **Why 4 steps?** This agent is split into 4 sequential Respond steps so that each step produces a small, bounded output and no single step approaches Glean's 8,000-character response limit. Configure each numbered block below as a separate Respond step in the agent builder, in order.

---

### Step 1 of 4 — Resolve Parameters & Run JQL Search

**Step type:** Respond

**Step prompt:**

```
You are the first step of a Prioritization Change Notifier for Jira.

Resolve the following input values (apply the default if the variable is blank):
- time_window: {{time_window}} → default: 24h
- scope: {{scope}} → default: mine
- direction: {{direction}} → default: all

Select and run the correct JQL query from the list below based on scope:

scope = mine:
  (priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
  AND (assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser() OR mentions = currentUser())
  ORDER BY updated DESC

scope = all:
  (priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
  ORDER BY updated DESC

scope = [project key]:
  (priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
  AND project = "[scope]"
  ORDER BY updated DESC

Then output ONLY one of the following — no other text:
- If tickets found: a comma-separated list of ticket keys, e.g.: SUPPORT-123, ENG-456, PROJ-789
- If no tickets found: exactly this token → NO_RESULTS:[time_window]:[scope]
```

**Expected output:** A comma-separated list of ticket keys, or `NO_RESULTS:24h:mine`.

---

### Step 2 of 4 — Extract Changelog Data

**Step type:** Respond

**Step prompt:**

```
Step 1 output: [paste Step 1 output here]

If the input starts with NO_RESULTS, output it unchanged and stop.

For each ticket key in the list, fetch the full Jira changelog:
  GET /rest/api/3/issue/{key}/changelog

Filter changelog entries to ONLY those where:
  field == "priority"  OR  field == "Support Prioritization"

Discard every other changelog entry. Do not report on status, assignee, labels, or any other field.

For each ticket, output in this exact format (no extra text):

TICKET:[KEY]|[Title]|Status:[current_status]|CurPri:[current_priority_value]|CurSuppPri:[current_support_prioritization_value]
CHANGE:[field_name]|FROM:[fromString or (not set)]|TO:[toString or (cleared)]|BY:[author displayName]|AT:[YYYY-MM-DD HH:MM]
(one CHANGE line per matching changelog entry, oldest first)
---

Rules:
- If a ticket has zero matching changelog entries after filtering, omit it entirely — no TICKET line.
- If fromString is null, write (not set). If toString is null, write (cleared).
- Do not add any prose, headers, or explanations.
```

**Expected output:** Structured pipe-delimited raw data blocks, one per ticket with changes.

---

### Step 3 of 4 — Apply Direction Filter & Format Ticket Blocks

**Step type:** Respond

**Step prompt:**

```
Step 2 output: [paste Step 2 output here]
Direction filter: {{direction}} (default: all)

If the input starts with NO_RESULTS, output it unchanged and stop.

Urgency ordering (low → high):
  Priority:              Low < Medium < High < Critical
  Support Prioritization: P4 - Low < P3 - Medium < P2 - High < P1 - Critical

For each CHANGE line, classify the direction:
  - Escalation: TO value is higher urgency than FROM value
  - De-escalation: TO value is lower urgency than FROM value
  - Lateral: urgency equivalent (e.g. renamed value, same tier)

Apply filter:
  direction = escalations    → keep only Escalation changes
  direction = de-escalations → keep only De-escalation changes
  direction = all            → keep all changes

If a ticket has no remaining changes after filtering, omit it entirely.

For each remaining ticket, output this formatted block:

---
### [KEY] — [Title]
**Project:** [project key] | **Current Status:** [status]
**Current Priority:** [CurPri] | **Current Support Prioritization:** [CurSuppPri]

#### Prioritization Changes
| # | Field | From | To | Direction | Changed By | Changed At |
|---|---|---|---|---|---|---|
| 1 | [field] | [FROM] | [TO] | [⬆️ Escalation / ⬇️ De-escalation / ↔️ Lateral] | [BY] | [AT] |

Output only these blocks. No prose, no summary, no header.
```

**Expected output:** Formatted markdown ticket blocks only — one per ticket that has qualifying changes.

---

### Step 4 of 4 — Assemble Final Report

**Step type:** Respond

**Step prompt:**

```
Step 3 output: [paste Step 3 output here]

If the input starts with NO_RESULTS, parse the token as NO_RESULTS:[time_window]:[scope] and output:
  "No prioritization changes found in the last [time_window] for [scope]."
Then stop.

Count from Step 3 output:
  - Total tickets (count --- separators)
  - Total ⬆️ Escalation rows across all tickets
  - Total ⬇️ De-escalation rows across all tickets

Build the final report in this order:

1. HEADER (write this first):
## Prioritization Change Report
**Period:** Last {{time_window}} | **Scope:** {{scope}} | **Filter:** {{direction}}
**Generated:** [current date and time, YYYY-MM-DD HH:MM, user's timezone or UTC]

[N] ticket(s) had prioritization changes. ([X] ⬆️ escalations, [Y] ⬇️ de-escalations)

2. TICKET BLOCKS (paste Step 3 output exactly as-is, no modifications)

3. SUMMARY TABLE (append after all ticket blocks):
---
## Summary
| Ticket | Title | # Changes | Direction Summary | Last Changed By | Last Changed At |
|---|---|---|---|---|---|
(one row per ticket — derive values from the ticket blocks above)
```

**Expected output:** The complete final prioritization change report with header, ticket blocks, and summary table.

---

## JQL Reference

> Use these in Step 1. Replace `[time_window]` with the resolved value (e.g. `24h`, `7d`).

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

-- specific ticket IDs (when user names exact tickets in their message)
issue in ("TICKET-1", "TICKET-2")
AND (priority changed AFTER "-[time_window]" OR "Support Prioritization" changed AFTER "-[time_window]")
```

---

## Notes

**Support Prioritization field ID:** If Jira does not recognize `"Support Prioritization"` by name in JQL, find the field's numeric ID by going to **Jira Settings → Custom Fields → Support Prioritization** (the ID appears in the URL), then replace `"Support Prioritization"` in all JQL with `cf[XXXXX]`.

**Example prompts this agent handles:**
- "What priority changes happened today?" *(defaults: 24h / mine / all)*
- "Show me all escalations in the last 7 days"
- "Did any SUPPORT tickets get de-escalated this week?"
- "Were there any priority changes on SUPPORT-123 or ENG-456?"
