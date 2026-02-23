# Glean Agent: Report Ticket Creator

## Agent Name
Report Ticket Creator

## Agent Description
Gathers all information needed for a Reporting Jira ticket and opens the Jira Report Ticket Creator pre-filled and ready to submit — so you only need to press Create Ticket.

---

## Trigger Type
**Input Form** — displays a form before the agent runs. The agent collects all required fields upfront and immediately produces a pre-filled link.

---

## Input Fields

Configure these fields on the Input Form trigger. Reference them in step instructions using `[[field_name]]` exactly as shown.

| Field Label | Reference Name | Field Type | Placeholder / Options | Required |
|---|---|---|---|---|
| Summary | `[[summary]]` | Text | Short description of the ticket | Yes |
| Reporting Task Type | `[[task_type]]` | Dropdown | Create a new report / Edit an existing report / Create a new dashboard / Edit an existing dashboard / Discovery | Yes |
| Description | `[[description]]` | Text (multi-line) | Full details, context, requirements, etc. | No |
| Customer | `[[customer]]` | Text | Customer name | No |
| Tenant ID | `[[tenant_id]]` | Text | e.g. 12345 | No |
| Customer Segment | `[[segment]]` | Dropdown | 1 - Strategic / 2 - Enterprise / 3 - Mid-Market / 4 - Corporate | No |
| Customer Status | `[[status]]` | Dropdown | 1 - Onboarding / 2 - Live / 3 - Pre-Sale | No |
| PS Environment | `[[env]]` | Dropdown | Training / Live | No |
| Department | `[[dept]]` | Dropdown | Customer Success / Implementation / Support / EPD | No |

---

## Agent Steps

> This agent uses a single Respond step. It constructs the pre-filled URL and returns a clickable link — no Jira API calls are made here; the actual ticket is created when the user clicks "Create Ticket" in the tool.

---

### Step 1 of 1 — Build Pre-Filled Ticket Link

**Action type:** Respond

**Instructions:**

```
You are the Report Ticket Creator assistant. Your only job is to construct
a pre-filled URL for the Jira Report Ticket Creator tool and present it to
the user so they can open it and press Create Ticket.

The base URL is:
  https://sdurham27.github.io/jira-report-tickets.html

Build the URL by appending query parameters for every non-empty input field.
Use standard URL percent-encoding for all values (spaces → %20, etc.).

Parameter mapping — use these exact parameter names:
  [[summary]]     → summary
  [[task_type]]   → taskType
  [[description]] → description
  [[customer]]    → customer
  [[tenant_id]]   → tenantId
  [[segment]]     → segment
  [[status]]      → status
  [[env]]         → env
  [[dept]]        → dept

Rules:
- Only include a parameter if the corresponding field has a non-empty value.
- Always include summary and taskType (they are required).
- URL-encode every value. Do not include raw spaces or special characters.

After constructing the URL, output ONLY the following — no extra prose:

---
### Your Jira Report Ticket is ready to submit

| Field | Value |
|---|---|
| Summary | [[summary]] |
| Task Type | [[task_type]] |
| Customer | [[customer]] *(or — if blank)* |
| Tenant ID | [[tenant_id]] *(or — if blank)* |
| Segment | [[segment]] *(or — if blank)* |
| Status | [[status]] *(or — if blank)* |
| Environment | [[env]] *(or — if blank)* |
| Department | [[dept]] *(or — if blank)* |

**[Open pre-filled ticket creator →](CONSTRUCTED_URL)**

> Click the link above to open the ticket creator with all fields pre-filled.
> Review the details, then press **Create Ticket** to submit to Jira.
---

Replace CONSTRUCTED_URL with the actual encoded URL you built.
For any field that was left blank, show — in the table instead of an empty cell.
```

---

## Example Output

Given inputs:
- Summary: `Acme Corp – Daily Job Cost Report`
- Task Type: `Create a new report`
- Customer: `Acme Corp`
- Tenant ID: `98765`
- Segment: `2 - Enterprise`
- Status: `2 - Live`
- Environment: `Live`
- Department: `Customer Success`

The agent produces:

```
### Your Jira Report Ticket is ready to submit

| Field | Value |
|---|---|
| Summary | Acme Corp – Daily Job Cost Report |
| Task Type | Create a new report |
| Customer | Acme Corp |
| Tenant ID | 98765 |
| Segment | 2 - Enterprise |
| Status | 2 - Live |
| Environment | Live |
| Department | Customer Success |

**[Open pre-filled ticket creator →](https://sdurham27.github.io/jira-report-tickets.html?summary=Acme%20Corp%20%E2%80%93%20Daily%20Job%20Cost%20Report&taskType=Create%20a%20new%20report&customer=Acme%20Corp&tenantId=98765&segment=2%20-%20Enterprise&status=2%20-%20Live&env=Live&dept=Customer%20Success)**

> Click the link above to open the ticket creator with all fields pre-filled.
> Review the details, then press **Create Ticket** to submit to Jira.
```

---

## Notes

- **No Jira credentials required** — this agent never calls Jira directly. Credentials are stored locally in the ticket creator tool (browser localStorage).
- **URL param reference** — the ticket creator at `https://sdurham27.github.io/jira-report-tickets.html` accepts these query params: `summary`, `taskType`, `description`, `customer`, `tenantId`, `segment`, `status`, `env`, `dept`. All values should be URL-encoded.
- **Data sources:** None — this agent constructs a URL from form input only. No Glean search or Jira connector calls are needed.
