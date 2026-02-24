/**
 * BuildOps Jira Tools
 *
 * Three tools in one page:
 *  1. Discover Tickets  – Glean agent searches Gmail / Slack / Gong / Notes
 *                         and surfaces actionable ticket suggestions.
 *  2. Ticket Details    – Look up one or more Jira tickets by key and display
 *                         priority, urgency, ownership, and the user's role.
 *  3. My Updates        – Shows recent changes (status, assignee, comments)
 *                         on tickets the current user is involved in.
 */

const PROXY_URL         = 'https://jira-proxy.shrimpwheels.workers.dev';
const JIRA_DOMAIN       = 'buildops.atlassian.net';
const DEFAULT_BACKEND   = 'buildops-be.glean.com';
const STORAGE_KEY       = 'jiraToolsSettings';

// ── Helpers ────────────────────────────────────────────────────────────────

function getSettings() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
}

function makeCredentials(email, token) {
  return btoa(`${email}:${token}`);
}

function jiraHeaders(settings) {
  const creds = makeCredentials(settings.jiraEmail, settings.jiraToken);
  return {
    'Authorization': `Basic ${creds}`,
    'Accept':        'application/json',
    'Content-Type':  'application/json',
  };
}

function gleanHeaders(settings) {
  const backend = settings.gleanBackend || DEFAULT_BACKEND;
  return {
    'Authorization':   `Bearer ${settings.gleanToken}`,
    'Content-Type':    'application/json',
    'Accept':          'application/json',
    'X-Glean-Backend': backend,
    ...(settings.jiraEmail ? { 'X-Glean-ActAs': settings.jiraEmail } : {}),
  };
}

function showEl(id)  { const e = document.getElementById(id); if (e) e.hidden = false; }
function hideEl(id)  { const e = document.getElementById(id); if (e) e.hidden = true;  }
function setHTML(id, html) { const e = document.getElementById(id); if (e) e.innerHTML = html; }

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)   return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Simple ADF (Atlassian Document Format) → plain text extractor
function adfToText(node, depth) {
  depth = depth || 0;
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (!node.content) return '';
  const parts = node.content.map(n => adfToText(n, depth + 1));
  const joined = parts.join('');
  if (node.type === 'paragraph' && depth > 0) return joined + '\n';
  if (node.type === 'bulletList' || node.type === 'orderedList') return joined;
  if (node.type === 'listItem') return '• ' + joined.trim() + '\n';
  if (node.type === 'hardBreak') return '\n';
  return joined;
}

// Very simple markdown renderer (reused from accounting.js pattern)
function renderMarkdown(md) {
  let h = escapeHtml(md);
  h = h.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^### (.+)$/gm,  '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm,   '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm,    '<h1>$1</h1>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  h = h.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g,         '<em>$1</em>');
  h = h.replace(/^---+$/gm, '<hr>');
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  h = h.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, block => {
    const items = block.trim().split('\n')
      .map(l => `<li>${l.replace(/^[ \t]*[-*+] /, '').trim()}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  h = h.replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, block => {
    const items = block.trim().split('\n')
      .map(l => `<li>${l.replace(/^[ \t]*\d+\. /, '').trim()}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  h = h.split(/\n{2,}/).map(chunk => {
    chunk = chunk.trim();
    if (!chunk) return '';
    if (/^<(h[1-6]|ul|ol|pre|blockquote|table|hr)/.test(chunk)) return chunk;
    return `<p>${chunk.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return h;
}

// ── Priority / Urgency helpers ──────────────────────────────────────────────

function priorityClass(priority) {
  const p = (priority || '').toLowerCase();
  if (p === 'critical' || p === 'highest') return 'critical';
  if (p === 'high')   return 'high';
  if (p === 'medium' || p === 'moderate') return 'medium';
  return 'low';
}

function computeUrgency(fields) {
  const priority  = (fields.priority?.name  || 'medium').toLowerCase();
  const due       = fields.due;
  const labels    = (fields.labels || []).map(l => l.toLowerCase());
  const descText  = adfToText(fields.description).toLowerCase();
  const urgencyKw = ['urgent', 'asap', 'blocker', 'production down', 'sla breach', 'p0', 'p1'];

  let score = 0;
  if (priority === 'critical' || priority === 'highest') score += 4;
  else if (priority === 'high')   score += 3;
  else if (priority === 'medium' || priority === 'moderate') score += 2;
  else score += 1;

  // Due date proximity
  if (due) {
    const daysUntilDue = (new Date(due) - Date.now()) / 86400000;
    if (daysUntilDue < 0)  score += 2; // overdue
    else if (daysUntilDue < 2) score += 1;
  }

  // Urgency keywords in labels or description
  const hasUrgentKw = labels.some(l => urgencyKw.includes(l)) ||
                      urgencyKw.some(kw => descText.includes(kw));
  if (hasUrgentKw) score += 1;

  if (score >= 5) return { label: 'Critical', cls: 'critical' };
  if (score >= 4) return { label: 'High',     cls: 'high' };
  if (score >= 3) return { label: 'Medium',   cls: 'medium' };
  return           { label: 'Low',      cls: 'low' };
}

function getMyRole(fields, myAccountId) {
  if (!myAccountId) return null;
  const isAssignee = fields.assignee?.accountId === myAccountId;
  const isReporter = fields.reporter?.accountId === myAccountId;
  if (isAssignee && isReporter) return 'Assignee & Reporter';
  if (isAssignee) return 'Assignee';
  if (isReporter) return 'Reporter';
  return 'Involved';
}

function statusBadgeClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'done' || s === 'resolved' || s === 'closed') return 'badge-status-done';
  if (s.includes('progress') || s.includes('review')) return 'badge-status-inprogress';
  if (s === 'open' || s === 'to do' || s === 'backlog') return 'badge-status-open';
  return 'badge-status-other';
}

function typeBadgeClass(type) {
  const t = (type || '').toLowerCase();
  if (t === 'bug')         return 'badge-bug';
  if (t === 'story')       return 'badge-story';
  if (t === 'task')        return 'badge-task';
  if (t.includes('feature') || t.includes('request')) return 'badge-feature';
  if (t === 'support' || t.includes('support')) return 'badge-support';
  if (t === 'improvement') return 'badge-improvement';
  return 'badge-task';
}

// ── Settings ────────────────────────────────────────────────────────────────

document.getElementById('settings-toggle').addEventListener('click', () => {
  const panel = document.getElementById('settings-panel');
  panel.hidden = !panel.hidden;
});

document.getElementById('save-settings').addEventListener('click', async () => {
  const jiraEmail    = document.getElementById('jira-email').value.trim();
  const jiraToken    = document.getElementById('jira-token').value.trim();
  const gleanToken   = document.getElementById('glean-token').value.trim();
  const gleanBackend = document.getElementById('glean-backend').value.trim() || DEFAULT_BACKEND;

  const status = document.getElementById('settings-status');

  if (!jiraEmail || !jiraToken) {
    status.textContent = 'Jira email and API token are required.';
    status.className   = 'settings-status error';
    return;
  }

  const btn = document.getElementById('save-settings');
  btn.disabled   = true;
  btn.textContent = 'Verifying…';
  status.textContent = '';
  status.className   = 'settings-status';

  try {
    const creds = makeCredentials(jiraEmail, jiraToken);
    const res   = await fetch(`${PROXY_URL}/rest/api/3/myself`, {
      headers: { 'Authorization': `Basic ${creds}`, 'Accept': 'application/json' },
    });

    if (!res.ok) {
      status.textContent = 'Jira credentials invalid. Check your email and API token.';
      status.className   = 'settings-status error';
      return;
    }

    const me = await res.json();
    const settings = {
      jiraEmail, jiraToken, gleanToken, gleanBackend,
      accountId:   me.accountId,
      displayName: me.displayName || jiraEmail,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    status.textContent = `Verified as ${settings.displayName}`;
    status.className   = 'settings-status success';

    setTimeout(() => { document.getElementById('settings-panel').hidden = true; }, 1200);
  } catch (err) {
    status.textContent = `Verification failed: ${err.message}`;
    status.className   = 'settings-status error';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save & Verify';
  }
});

// Restore settings on load
window.addEventListener('DOMContentLoaded', () => {
  const saved = getSettings();
  if (saved.jiraEmail)    document.getElementById('jira-email').value    = saved.jiraEmail;
  if (saved.jiraToken)    document.getElementById('jira-token').value    = saved.jiraToken;
  if (saved.gleanToken)   document.getElementById('glean-token').value   = saved.gleanToken;
  if (saved.gleanBackend) document.getElementById('glean-backend').value = saved.gleanBackend;

  if (!saved.jiraEmail || !saved.jiraToken) {
    document.getElementById('settings-panel').hidden = false;
  }
});

// ── Tab Navigation ──────────────────────────────────────────────────────────

let currentTab = 'discover';

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === currentTab) return;
    currentTab = tab;

    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('hidden', p.id !== `panel-${tab}`);
    });

    // Auto-load updates when switching to that tab
    if (tab === 'updates' && !document.getElementById('updates-results').innerHTML) {
      loadUpdates();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 1 — DISCOVER TICKETS (Glean)
// ══════════════════════════════════════════════════════════════════════════════

// Delimiter format Glean is instructed to use (see agent prompt)
const TICKET_START = '---TICKET---';
const TICKET_END   = '---END TICKET---';

function buildDiscoverPrompt(days, source, customer) {
  const sourceText = source === 'all'
    ? 'Gmail, Slack, Gong call recordings and notes, and internal documents'
    : { gmail: 'Gmail', slack: 'Slack', gong: 'Gong call recordings and notes', notes: 'notes and internal documents' }[source] || 'all data sources';

  const customerFilter = customer
    ? `\nFocus specifically on communications and documents related to the customer: "${customer}".`
    : '';

  return `You are a Jira ticket discovery assistant for BuildOps, a field service management software company. Search through the last ${days} days of ${sourceText} to identify actionable items that should become Jira tickets but likely haven't been tracked yet.${customerFilter}

Look for:
1. **Bugs** – Software defects or errors reported by customers or mentioned internally
2. **Feature Requests** – New capabilities or improvements requested by customers or the sales team
3. **Customer Issues** – Problems a customer is experiencing that need engineering or support attention
4. **Action Items** – Specific commitments or follow-ups from meetings, calls, or email threads
5. **Improvements** – Process or product improvements identified in recent discussions

For each potential ticket, return it in EXACTLY this format (do not vary the field names or delimiters):

${TICKET_START}
TITLE: [Concise ticket title, max 100 characters]
TYPE: [Bug / Story / Task / Feature Request / Improvement / Support]
PRIORITY: [Critical / High / Medium / Low]
CUSTOMER: [Customer name, or "Internal" if no specific customer]
SOURCE: [Gmail / Slack / Gong / Notes / Other]
SOURCE_DATE: [YYYY-MM-DD or approximate date]
DESCRIPTION: [2–4 sentences describing the issue or request clearly]
CONTEXT: [1–2 sentences on why this needs a ticket and any urgency signals]
${TICKET_END}

Rules:
- Only suggest tickets for clearly actionable items
- Do not suggest items that are too vague or already obviously tracked
- Sort by priority (Critical first, then High, Medium, Low)
- Return a maximum of 10 ticket suggestions
- If no actionable items are found, say so clearly — do not invent tickets

Begin searching now.`;
}

function parseDiscoveredTickets(text) {
  const tickets = [];
  let remaining = text;
  let start;
  while ((start = remaining.indexOf(TICKET_START)) !== -1) {
    const end = remaining.indexOf(TICKET_END, start);
    if (end === -1) break;
    const block = remaining.slice(start + TICKET_START.length, end).trim();
    remaining   = remaining.slice(end + TICKET_END.length);
    const t = {};
    for (const line of block.split('\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const key = line.slice(0, colon).trim().toUpperCase();
      const val = line.slice(colon + 1).trim();
      t[key] = val;
    }
    if (t.TITLE) tickets.push(t);
  }
  return tickets;
}

function renderDiscoveredTicket(t, idx, defaultProject) {
  const typeClass  = typeBadgeClass(t.TYPE || '');
  const prioClass  = 'badge-' + priorityClass(t.PRIORITY || 'medium');
  const project    = defaultProject || '';

  return `<div class="discover-card" id="dcard-${idx}">
    <div class="discover-card-header">
      <div class="discover-card-title-group">
        <div class="discover-card-badges">
          <span class="badge ${typeClass}">${escapeHtml(t.TYPE || 'Task')}</span>
          <span class="badge ${prioClass}">${escapeHtml(t.PRIORITY || 'Medium')}</span>
        </div>
        <div class="discover-card-title">${escapeHtml(t.TITLE || '')}</div>
        <div class="discover-card-meta">
          ${t.CUSTOMER ? `<span>Customer: <strong>${escapeHtml(t.CUSTOMER)}</strong></span>` : ''}
          ${t.SOURCE ? `<span>Source: ${escapeHtml(t.SOURCE)}${t.SOURCE_DATE ? ` (${escapeHtml(t.SOURCE_DATE)})` : ''}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="discover-card-body">
      ${t.DESCRIPTION ? `<div class="discover-field">
        <div class="discover-field-label">Description</div>
        <div class="discover-field-value">${escapeHtml(t.DESCRIPTION)}</div>
      </div>` : ''}
      ${t.CONTEXT ? `<div class="discover-field">
        <div class="discover-field-label">Context &amp; Urgency</div>
        <div class="discover-field-value">${escapeHtml(t.CONTEXT)}</div>
      </div>` : ''}
    </div>
    <div class="discover-card-footer" id="dcard-footer-${idx}">
      <span></span>
      <button class="action-btn" onclick="openCreateModal(${idx})">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        Create in Jira
      </button>
    </div>
  </div>`;
}

// Global store for discovered tickets (so modal can access them)
let discoveredTickets = [];

document.getElementById('discover-btn').addEventListener('click', async () => {
  const settings = getSettings();
  if (!settings.gleanToken) {
    showEl('discover-error');
    document.getElementById('discover-error').textContent =
      'No Glean API token. Open Settings (⚙) and add your token.';
    document.getElementById('settings-panel').hidden = false;
    return;
  }

  const days           = document.getElementById('discover-days').value;
  const source         = document.getElementById('discover-source').value;
  const customer       = document.getElementById('discover-customer').value.trim();
  const defaultProject = document.getElementById('discover-project').value.trim();

  const btn = document.getElementById('discover-btn');
  btn.disabled = true;
  hideEl('discover-error');
  setHTML('discover-results', '');
  showEl('discover-thinking');

  try {
    const prompt = buildDiscoverPrompt(days, source, customer);
    const payload = {
      messages: [{ author: 'USER', fragments: [{ text: prompt }] }],
      stream:   false,
      saveChat: false,
    };

    const res = await fetch(`${PROXY_URL}/glean/rest/api/v1/chat`, {
      method:  'POST',
      headers: gleanHeaders(settings),
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      let detail = body;
      try { detail = JSON.parse(body).message || body; } catch (_) {}
      throw new Error(`Glean returned ${res.status}: ${detail}`);
    }

    const data     = await res.json();
    const messages = data.messages || [];
    const aiMsg    = messages.slice().reverse().find(m => m.author === 'GLEAN_AI') ||
                     messages[messages.length - 1];

    if (!aiMsg) throw new Error('No response from Glean. Check your token and backend URL.');

    const rawText = (aiMsg.fragments || [])
      .filter(f => typeof f.text === 'string')
      .map(f => f.text)
      .join('\n')
      .trim();

    discoveredTickets = parseDiscoveredTickets(rawText);

    const resultsEl = document.getElementById('discover-results');

    if (discoveredTickets.length === 0) {
      // No structured tickets — render raw response as fallback
      resultsEl.innerHTML = `
        <div class="response-card">
          <div class="response-card-label">Glean Response</div>
          <div class="response-text">${renderMarkdown(rawText)}</div>
        </div>`;
    } else {
      const cardsHtml = `
        <div class="results-header">${discoveredTickets.length} ticket suggestion${discoveredTickets.length !== 1 ? 's' : ''} found</div>
        ${discoveredTickets.map((t, i) => renderDiscoveredTicket(t, i, defaultProject)).join('')}`;
      resultsEl.innerHTML = cardsHtml;
    }

  } catch (err) {
    showEl('discover-error');
    document.getElementById('discover-error').textContent = err.message;
  } finally {
    hideEl('discover-thinking');
    btn.disabled = false;
  }
});

// ── Create-in-Jira Modal ────────────────────────────────────────────────────

let currentModalIdx = null;

function openCreateModal(idx) {
  const t       = discoveredTickets[idx];
  const project = document.getElementById('discover-project').value.trim();

  document.getElementById('m-summary').value  = t.TITLE || '';
  document.getElementById('m-project').value  = project || '';
  document.getElementById('m-customer').value = (t.CUSTOMER && t.CUSTOMER.toLowerCase() !== 'internal') ? t.CUSTOMER : '';
  document.getElementById('m-description').value = [
    t.DESCRIPTION || '',
    t.CONTEXT     ? `\n\nContext: ${t.CONTEXT}` : '',
    t.SOURCE      ? `\n\nSource: ${t.SOURCE}${t.SOURCE_DATE ? ` (${t.SOURCE_DATE})` : ''}` : '',
  ].join('').trim();

  // Set type
  const typeMap = {
    'bug': 'Bug', 'story': 'Story', 'task': 'Task',
    'feature request': 'Story', 'improvement': 'Improvement', 'support': 'Task',
  };
  const mappedType = typeMap[(t.TYPE || 'task').toLowerCase()] || 'Task';
  document.getElementById('m-type').value = mappedType;

  // Set priority
  const prioMap = { 'critical': 'Critical', 'high': 'High', 'medium': 'Medium', 'low': 'Low' };
  document.getElementById('m-priority').value = prioMap[(t.PRIORITY || 'medium').toLowerCase()] || 'Medium';

  hideEl('modal-status');
  document.getElementById('modal-status').className = 'modal-status';
  document.getElementById('modal-status').textContent = '';
  document.getElementById('modal-create-btn').disabled   = false;
  document.getElementById('modal-create-btn').textContent = 'Create Ticket';
  document.getElementById('modal-create-btn').innerHTML  = `
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
    Create Ticket`;

  currentModalIdx = idx;
  document.getElementById('create-modal').hidden = false;
}

function closeModal() {
  document.getElementById('create-modal').hidden = true;
  currentModalIdx = null;
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);

// Close on overlay click
document.getElementById('create-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('create-modal')) closeModal();
});

document.getElementById('modal-create-btn').addEventListener('click', async () => {
  const settings = getSettings();
  if (!settings.jiraEmail || !settings.jiraToken) {
    const st = document.getElementById('modal-status');
    st.textContent = 'Please save your Jira credentials in Settings first.';
    st.className   = 'modal-status error';
    showEl('modal-status');
    return;
  }

  const summary  = document.getElementById('m-summary').value.trim();
  const project  = document.getElementById('m-project').value.trim();
  const issueType= document.getElementById('m-type').value;
  const priority = document.getElementById('m-priority').value;
  const customer = document.getElementById('m-customer').value.trim();
  const desc     = document.getElementById('m-description').value.trim();

  if (!summary || !project) {
    const st = document.getElementById('modal-status');
    st.textContent = 'Summary and Project Key are required.';
    st.className   = 'modal-status error';
    showEl('modal-status');
    return;
  }

  const btn = document.getElementById('modal-create-btn');
  btn.disabled = true;
  btn.innerHTML = `<span style="opacity:0.6">Creating…</span>`;
  hideEl('modal-status');

  try {
    const adfContent = [];

    if (desc) {
      adfContent.push({
        type: 'paragraph',
        content: [{ type: 'text', text: desc }],
      });
    }

    const fields = {
      project:     { key: project },
      summary,
      issuetype:   { name: issueType },
      priority:    { name: priority },
      description: {
        type: 'doc', version: 1,
        content: adfContent.length ? adfContent : [{ type: 'paragraph', content: [] }],
      },
    };

    if (customer) fields.customfield_10297 = customer;
    if (settings.accountId) fields.reporter = { accountId: settings.accountId };

    const res  = await fetch(`${PROXY_URL}/rest/api/3/issue`, {
      method:  'POST',
      headers: jiraHeaders(settings),
      body:    JSON.stringify({ fields }),
    });
    const data = await res.json();

    if (res.ok) {
      const ticketUrl = `https://${JIRA_DOMAIN}/browse/${data.key}`;
      const st = document.getElementById('modal-status');
      st.innerHTML   = `Ticket created! <a href="${ticketUrl}" target="_blank">${data.key} →</a>`;
      st.className   = 'modal-status success';
      showEl('modal-status');

      btn.innerHTML  = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg> Created`;

      // Mark the card as created
      if (currentModalIdx !== null) {
        const card = document.getElementById(`dcard-${currentModalIdx}`);
        if (card) {
          card.classList.add('created');
          const footer = document.getElementById(`dcard-footer-${currentModalIdx}`);
          if (footer) {
            footer.innerHTML = `<span class="created-label">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
              Created: <a href="${ticketUrl}" target="_blank" style="color:var(--success)">${data.key}</a>
            </span>`;
          }
        }
      }
    } else {
      const msg = data.errorMessages?.join(', ') || JSON.stringify(data.errors) || 'Unknown error';
      throw new Error(msg);
    }
  } catch (err) {
    const st = document.getElementById('modal-status');
    st.textContent = `Error: ${err.message}`;
    st.className   = 'modal-status error';
    showEl('modal-status');
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Create Ticket`;
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 2 — TICKET DETAILS (Jira REST API)
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('lookup-btn').addEventListener('click', async () => {
  const raw = document.getElementById('ticket-ids-input').value.trim();
  if (!raw) return;

  const settings = getSettings();
  if (!settings.jiraEmail || !settings.jiraToken) {
    showEl('lookup-error');
    document.getElementById('lookup-error').textContent =
      'Please save your Jira credentials in Settings first.';
    document.getElementById('settings-panel').hidden = false;
    return;
  }

  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);

  const btn = document.getElementById('lookup-btn');
  btn.disabled = true;
  hideEl('lookup-error');
  setHTML('lookup-results', '');
  showEl('lookup-thinking');

  const results = [];

  for (const id of ids) {
    try {
      const res = await fetch(
        `${PROXY_URL}/rest/api/3/issue/${encodeURIComponent(id)}?fields=summary,issuetype,status,priority,assignee,reporter,description,comment,customfield_10297,due,labels,watches`,
        { headers: jiraHeaders(settings) }
      );

      if (res.status === 404) {
        results.push({ key: id, error: 'Ticket not found.' });
        continue;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg  = body.errorMessages?.[0] || `HTTP ${res.status}`;
        results.push({ key: id, error: msg });
        continue;
      }

      const data = await res.json();
      results.push({ key: id, issue: data });
    } catch (err) {
      results.push({ key: id, error: err.message });
    }
  }

  hideEl('lookup-thinking');
  btn.disabled = false;

  if (!results.length) return;

  const myAccountId = settings.accountId;

  const html = results.map(r => {
    if (r.error) {
      return `<div class="ticket-card">
        <div class="ticket-card-header">
          <div class="ticket-key-row"><span class="ticket-key">${escapeHtml(r.key)}</span></div>
          <div class="ticket-title" style="color:var(--error-text)">${escapeHtml(r.error)}</div>
        </div>
      </div>`;
    }

    const { key, issue } = r;
    const f = issue.fields;
    const urgency   = computeUrgency(f);
    const myRole    = getMyRole(f, myAccountId);
    const prioName  = f.priority?.name  || 'Unknown';
    const prioClass = priorityClass(prioName);
    const status    = f.status?.name    || 'Unknown';
    const issueType = f.issuetype?.name || 'Task';
    const assignee  = f.assignee?.displayName  || 'Unassigned';
    const reporter  = f.reporter?.displayName  || 'Unknown';
    const customer  = f.customfield_10297 || null;

    const ticketUrl = `https://${JIRA_DOMAIN}/browse/${encodeURIComponent(key)}`;
    const headerTitle = customer
      ? `${escapeHtml(key)} | ${escapeHtml(customer)} — ${escapeHtml(f.summary)}`
      : `${escapeHtml(key)} — ${escapeHtml(f.summary)}`;

    return `<div class="ticket-card">
      <div class="ticket-card-header">
        <div class="ticket-key-row">
          <span class="ticket-key"><a href="${ticketUrl}" target="_blank">${escapeHtml(key)}</a></span>
          ${customer ? `<span class="ticket-customer">${escapeHtml(customer)}</span>` : ''}
        </div>
        <div class="ticket-title">${escapeHtml(f.summary)}</div>
        <div class="ticket-badges">
          <span class="badge ${typeBadgeClass(issueType)}">${escapeHtml(issueType)}</span>
          <span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span>
        </div>
      </div>

      <div class="ticket-grid">
        <div class="ticket-field">
          <div class="ticket-field-label">Priority</div>
          <div class="ticket-field-value ticket-urgency-${prioClass}">${escapeHtml(prioName)}</div>
        </div>
        <div class="ticket-field">
          <div class="ticket-field-label">Urgency</div>
          <div class="ticket-field-value ticket-urgency-${urgency.cls}">${urgency.label}</div>
        </div>
        <div class="ticket-field">
          <div class="ticket-field-label">Assigned To</div>
          <div class="ticket-field-value ${assignee === 'Unassigned' ? 'muted' : ''}">${escapeHtml(assignee)}</div>
        </div>
        <div class="ticket-field">
          <div class="ticket-field-label">Reporter</div>
          <div class="ticket-field-value">${escapeHtml(reporter)}</div>
        </div>
        ${myRole ? `<div class="ticket-field">
          <div class="ticket-field-label">My Role</div>
          <div class="ticket-field-value">${escapeHtml(myRole)}</div>
        </div>` : ''}
        ${f.due ? `<div class="ticket-field">
          <div class="ticket-field-label">Due Date</div>
          <div class="ticket-field-value ${new Date(f.due) < Date.now() ? 'ticket-urgency-critical' : ''}">${escapeHtml(f.due)}</div>
        </div>` : ''}
      </div>

      <div class="ticket-card-footer">
        <a href="${ticketUrl}" target="_blank">View in Jira →</a>
      </div>
    </div>`;
  }).join('');

  document.getElementById('lookup-results').innerHTML =
    `<div class="results-header">${results.length} ticket${results.length !== 1 ? 's' : ''}</div>${html}`;
});

// Also trigger lookup on Enter key
document.getElementById('ticket-ids-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('lookup-btn').click();
});

// ══════════════════════════════════════════════════════════════════════════════
// TOOL 3 — MY UPDATES (Jira changelog + comments)
// ══════════════════════════════════════════════════════════════════════════════

// Tracked fields to surface in changelog
const TRACKED_FIELDS = new Set(['status', 'assignee', 'priority', 'resolution', 'summary']);

let currentUpdateDays = 7;

document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentUpdateDays = parseInt(chip.dataset.days, 10);
    loadUpdates();
  });
});

document.getElementById('refresh-updates-btn').addEventListener('click', loadUpdates);

async function loadUpdates() {
  const settings = getSettings();
  if (!settings.jiraEmail || !settings.jiraToken) {
    showEl('updates-error');
    document.getElementById('updates-error').textContent =
      'Please save your Jira credentials in Settings first.';
    document.getElementById('settings-panel').hidden = false;
    return;
  }

  hideEl('updates-error');
  setHTML('updates-results', '');
  showEl('updates-thinking');

  try {
    const days = currentUpdateDays;
    const jql  = encodeURIComponent(
      `(assignee = currentUser() OR reporter = currentUser()) AND updated >= -${days}d ORDER BY updated DESC`
    );
    const fields = 'summary,status,priority,assignee,reporter,issuetype,updated,comment,customfield_10297';
    const url    = `${PROXY_URL}/rest/api/3/search?jql=${jql}&maxResults=25&fields=${fields}&expand=changelog`;

    const res  = await fetch(url, { headers: jiraHeaders(settings) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.errorMessages?.[0] || `Jira returned ${res.status}`);
    }

    const data   = await res.json();
    const issues = data.issues || [];

    hideEl('updates-thinking');

    if (!issues.length) {
      document.getElementById('updates-results').innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="currentColor" width="40" height="40">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <p>No updates found in the last ${days === 1 ? '24 hours' : `${days} days`}.</p>
        </div>`;
      return;
    }

    const cutoff = Date.now() - days * 86400000;
    const myId   = settings.accountId;

    const cards = issues.map(issue => {
      const key = issue.key;
      const f   = issue.fields;
      const ticketUrl = `https://${JIRA_DOMAIN}/browse/${key}`;

      // Collect relevant changelog entries after the cutoff
      const histories = (issue.changelog?.histories || [])
        .filter(h => new Date(h.created).getTime() >= cutoff)
        .sort((a, b) => new Date(b.created) - new Date(a.created));

      const relevantChanges = [];
      for (const h of histories) {
        for (const item of (h.items || [])) {
          if (TRACKED_FIELDS.has(item.field.toLowerCase())) {
            relevantChanges.push({
              field:      item.field,
              from:       item.fromString,
              to:         item.toString,
              author:     h.author?.displayName || 'Unknown',
              created:    h.created,
            });
          }
        }
      }

      // Most recent update time (either changelog or comment)
      const lastUpdated = f.updated;

      // Get most recent comment
      const comments     = (f.comment?.comments || []).filter(c =>
        new Date(c.updated || c.created).getTime() >= cutoff
      );
      const latestComment = comments.length
        ? comments.reduce((a, b) =>
            new Date(a.updated || a.created) > new Date(b.updated || b.created) ? a : b)
        : null;

      // Skip issues with no changes and no comments in the window
      if (!relevantChanges.length && !latestComment) return '';

      const changesHtml = relevantChanges.length ? `
        <div class="update-change-list">
          ${relevantChanges.map(c => `
            <div class="update-change-item">
              <span class="update-change-field">${escapeHtml(c.field)}</span>
              <span class="update-change-from">${escapeHtml(c.from || '—')}</span>
              <span class="update-change-arrow">→</span>
              <span class="update-change-to">${escapeHtml(c.to || '—')}</span>
              <span style="font-size:0.75rem;color:var(--text-muted);margin-left:auto">${escapeHtml(c.author)} · ${timeAgo(c.created)}</span>
            </div>`).join('')}
        </div>` : '';

      let commentHtml = '';
      if (latestComment) {
        const commentText = typeof latestComment.body === 'string'
          ? latestComment.body
          : adfToText(latestComment.body).trim();
        const truncated = commentText.length > 400
          ? commentText.slice(0, 400) + '…'
          : commentText;
        const commentTime = latestComment.updated || latestComment.created;
        commentHtml = `
          <div>
            <div class="update-comment-label" style="margin-bottom:6px">Latest Comment</div>
            <div class="update-comment">
              <div class="update-comment-meta">
                <strong>${escapeHtml(latestComment.author?.displayName || 'Unknown')}</strong>
                · ${timeAgo(commentTime)}
              </div>
              <div class="update-comment-body">${escapeHtml(truncated)}</div>
            </div>
          </div>`;
      }

      const myRole = getMyRole(f, myId);

      return `<div class="update-card">
        <div class="update-card-header">
          <div class="update-card-title-wrap">
            <div class="update-card-key">
              <a href="${ticketUrl}" target="_blank">${escapeHtml(key)}</a>
              ${myRole ? `<span style="font-size:0.7rem;font-weight:400;color:var(--text-muted);margin-left:8px">(${escapeHtml(myRole)})</span>` : ''}
            </div>
            <div class="update-card-title">${escapeHtml(f.summary)}</div>
          </div>
          <div class="update-card-time">${timeAgo(lastUpdated)}</div>
        </div>
        <div class="update-card-body">
          ${changesHtml}
          ${commentHtml}
        </div>
      </div>`;
    }).filter(Boolean);

    if (!cards.length) {
      document.getElementById('updates-results').innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="currentColor" width="40" height="40">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <p>No notable updates found in the last ${days === 1 ? '24 hours' : `${days} days`}. Status changes, reassignments, and new comments will appear here.</p>
        </div>`;
      return;
    }

    document.getElementById('updates-results').innerHTML =
      `<div class="results-header">${cards.length} ticket${cards.length !== 1 ? 's' : ''} with recent activity</div>
       ${cards.join('')}`;

  } catch (err) {
    hideEl('updates-thinking');
    showEl('updates-error');
    document.getElementById('updates-error').textContent = err.message;
  }
}
