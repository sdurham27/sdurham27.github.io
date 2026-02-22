/**
 * BuildOps Accounting Integration Assistant
 *
 * Flow:
 *  1. User selects an ERP from the dropdown (only systems connected to BuildOps).
 *  2. Topic toggles appear — user picks one or more: General Knowledge,
 *     Integration Paths, Installation Tips, Basic Setup, Troubleshooting,
 *     Sync Errors.
 *  3. An optional free-text field lets them add extra context.
 *  4. The Ask button sends a context-rich prompt to Glean that covers every
 *     selected topic with the right framing for that ERP.
 */

const PROXY_URL       = 'https://jira-proxy.shrimpwheels.workers.dev';
const STORAGE_KEY     = 'buildopsAccountingSettings';
const DEFAULT_BACKEND = 'buildops-be.glean.com';

// ---------------------------------------------------------------------------
// ERP metadata — only systems currently connected to BuildOps
// ---------------------------------------------------------------------------
const ERP_META = {
  'QuickBooks Online': {
    description: 'Cloud-based accounting widely used by BuildOps customers. Supports real-time sync for customers, invoices, and payments.',
  },
  'Sage Intacct': {
    description: 'Enterprise cloud ERP with multi-dimensional job costing. Common with larger mechanical and electrical contractors.',
  },
  'NetSuite (Oracle)': {
    description: 'Enterprise cloud ERP for complex financials and project accounting. Used by larger BuildOps enterprise customers.',
  },
  'QuickBooks Desktop (Enterprise)': {
    description: 'On-premise QuickBooks Enterprise, connected via the QuickBooks Web Connector. Setup and sync behavior differ from QBO.',
  },
  'Sage 300 CRE (Timberline)': {
    description: 'On-premise construction ERP with deep job cost, phase, and department tracking. Popular with mid-to-large contractors.',
  },
  'Foundation Software': {
    description: 'On-premise accounting and job cost software purpose-built for construction contractors.',
  },
  'Spectrum (Viewpoint)': {
    description: 'On-premise ERP for construction companies with strong project management and job cost modules.',
  },
};

// ---------------------------------------------------------------------------
// Topic definitions — each drives specific framing in the Glean prompt
// ---------------------------------------------------------------------------
const TOPICS = [
  {
    id:    'general',
    label: 'General Knowledge',
    prompt:
      'Provide a clear overview of how the BuildOps integration with {ERP} works — ' +
      'what data flows between the two systems, the overall architecture, and any high-level ' +
      'concepts the user should understand before diving deeper.',
  },
  {
    id:    'paths',
    label: 'Integration Paths',
    prompt:
      'Show the exact field-level mapping between BuildOps and {ERP} in both directions. ' +
      'For each BuildOps concept (Customer, Job / Work Order, Invoice, Line Item, Cost Code, ' +
      'Payment, Vendor, etc.), show the corresponding {ERP} object and field name. ' +
      'For example: "BuildOps Job # → {ERP} Project ID" or "BuildOps Customer → {ERP} Client". ' +
      'Call out any cases where {ERP} has structures that BuildOps must accommodate ' +
      '(e.g. phases, departments, cost types, sub-jobs) and explain how BuildOps handles them. ' +
      'Use a table format where possible.',
  },
  {
    id:    'installation',
    label: 'Installation Tips',
    prompt:
      'Walk through the installation steps to connect BuildOps with {ERP}, including: ' +
      'prerequisites, required credentials or API keys, where to install any connector software, ' +
      'firewall or network requirements for on-premise systems, and common pitfalls to avoid ' +
      'during the initial connection.',
  },
  {
    id:    'setup',
    label: 'Basic Setup',
    prompt:
      'Explain the post-installation configuration required to get the BuildOps + {ERP} integration ' +
      'fully operational. Cover: GL account mapping, customer / vendor sync settings, job or project ' +
      'creation settings, invoice sync direction, tax configuration, and any {ERP}-specific settings ' +
      'that must be enabled. Use numbered steps where possible.',
  },
  {
    id:    'troubleshoot',
    label: 'Troubleshooting',
    prompt:
      'Help diagnose and resolve common integration problems between BuildOps and {ERP}. ' +
      'Cover frequent failure scenarios — records not syncing, duplicate records, missing field ' +
      'values, authentication failures — and explain how to identify the root cause and fix each one.',
  },
  {
    id:    'sync-errors',
    label: 'Sync Errors',
    prompt:
      'List and explain the specific sync error codes and messages that appear in BuildOps ' +
      'when syncing with {ERP}. For each error, explain what caused it and provide the exact ' +
      'steps to resolve it. Include guidance on where to find sync logs in BuildOps and how to ' +
      'retry failed records.',
  },
];

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const settingsToggle    = document.getElementById('settings-toggle');
const settingsPanel     = document.getElementById('settings-panel');
const gleanEmailInput   = document.getElementById('glean-email');
const gleanTokenInput   = document.getElementById('glean-token');
const gleanBackendInput = document.getElementById('glean-backend');
const saveSettingsBtn   = document.getElementById('save-settings');
const settingsStatus    = document.getElementById('settings-status');

const erpSelect         = document.getElementById('erp-select');
const erpDescription    = document.getElementById('erp-description');
const topicsGroup       = document.getElementById('topics-group');
const topicToggles      = document.getElementById('topic-toggles');
const questionGroup     = document.getElementById('question-group');
const questionInput     = document.getElementById('question-input');
const askBtn            = document.getElementById('ask-btn');

const thinkingArea      = document.getElementById('thinking-area');
const responseArea      = document.getElementById('response-area');
const responseText      = document.getElementById('response-text');
const followUps         = document.getElementById('follow-ups');
const followUpList      = document.getElementById('follow-up-list');
const newQuestionBtn    = document.getElementById('new-question-btn');
const errorArea         = document.getElementById('error-area');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let selectedTopics   = new Set();   // set of topic IDs
let chatSessionToken = null;        // carries conversation context across turns
let abortController  = null;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function loadSettings() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  gleanEmailInput.value   = saved.gleanEmail   || '';
  gleanTokenInput.value   = saved.gleanToken   || '';
  gleanBackendInput.value = saved.gleanBackend || DEFAULT_BACKEND;
}

function getSettings() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
}

saveSettingsBtn.addEventListener('click', () => {
  const settings = {
    gleanEmail:   gleanEmailInput.value.trim(),
    gleanToken:   gleanTokenInput.value.trim(),
    gleanBackend: gleanBackendInput.value.trim() || DEFAULT_BACKEND,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  settingsStatus.textContent = 'Saved!';
  settingsStatus.className   = 'settings-status success';
  setTimeout(() => { settingsStatus.textContent = ''; }, 2000);
});

settingsToggle.addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});

// ---------------------------------------------------------------------------
// ERP dropdown — show topics section and update description blurb
// ---------------------------------------------------------------------------
erpSelect.addEventListener('change', () => {
  const erp  = erpSelect.value;
  const meta = ERP_META[erp];

  erpDescription.textContent = meta ? meta.description : '';

  // Reveal topic toggles and question textarea once an ERP is chosen
  topicsGroup.hidden   = !erp;
  questionGroup.hidden = !erp;

  // Clear topic selection when ERP changes
  selectedTopics.clear();
  document.querySelectorAll('.topic-toggle').forEach(btn => {
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('is-selected');
  });

  // Reset conversation when switching ERP
  chatSessionToken = null;
  updateAskButton();
});

// ---------------------------------------------------------------------------
// Topic toggles — multi-select pills
// ---------------------------------------------------------------------------
topicToggles.addEventListener('click', (e) => {
  const btn = e.target.closest('.topic-toggle');
  if (!btn) return;

  const topic    = btn.dataset.topic;
  const pressed  = btn.getAttribute('aria-pressed') === 'true';
  const nowOn    = !pressed;

  btn.setAttribute('aria-pressed', String(nowOn));
  btn.classList.toggle('is-selected', nowOn);

  if (nowOn) {
    selectedTopics.add(topic);
  } else {
    selectedTopics.delete(topic);
  }

  updateAskButton();
});

// ---------------------------------------------------------------------------
// Ask button — enabled when ERP + at least one topic are selected
// ---------------------------------------------------------------------------
function updateAskButton() {
  askBtn.disabled = !(erpSelect.value && selectedTopics.size > 0);
}

// ---------------------------------------------------------------------------
// Build the contextual prompt for Glean
// ---------------------------------------------------------------------------
function buildPrompt(erp) {
  const topicIds = [...selectedTopics];
  const topicDefs = TOPICS.filter(t => topicIds.includes(t.id));
  const topicLabels = topicDefs.map(t => t.label).join(', ');

  const lines = [
    `I am a BuildOps employee. I need help with the BuildOps integration with ${erp}.`,
    ``,
    `Please address the following topic(s): ${topicLabels}.`,
    ``,
  ];

  if (topicDefs.length === 1) {
    // Single topic — inject its framing inline
    lines.push(topicDefs[0].prompt.replace(/\{ERP\}/g, erp));
  } else {
    // Multiple topics — add a labelled section for each
    topicDefs.forEach(t => {
      lines.push(`## ${t.label}`);
      lines.push(t.prompt.replace(/\{ERP\}/g, erp));
      lines.push('');
    });
  }

  const extra = questionInput.value.trim();
  if (extra) {
    lines.push('');
    lines.push(`Additional context from the user: ${extra}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Ask Glean
// ---------------------------------------------------------------------------
askBtn.addEventListener('click', () => {
  const erp = erpSelect.value;
  if (!erp || selectedTopics.size === 0) return;
  askGlean(buildPrompt(erp), erp);
});

async function askGlean(contextualQuestion, erp) {
  const settings = getSettings();

  if (!settings.gleanToken) {
    showError('No Glean API token found. Open settings (⚙) and paste your token.');
    settingsPanel.hidden = false;
    return;
  }

  setLoading(true);
  hideError();

  const backend = settings.gleanBackend || DEFAULT_BACKEND;

  const payload = {
    messages: [
      {
        author:    'USER',
        fragments: [{ text: contextualQuestion }],
      },
    ],
    stream:   false,
    saveChat: false,
  };

  if (chatSessionToken) {
    payload.chatSessionTrackingToken = chatSessionToken;
  }

  abortController = new AbortController();

  try {
    const res = await fetch(`${PROXY_URL}/glean/rest/api/v1/chat`, {
      method: 'POST',
      signal: abortController.signal,
      headers: {
        'Authorization':   `Bearer ${settings.gleanToken}`,
        'Content-Type':    'application/json',
        'Accept':          'application/json',
        'X-Glean-Backend': backend,
        ...(settings.gleanEmail ? { 'X-Glean-ActAs': settings.gleanEmail } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      let detail = body;
      try { detail = JSON.parse(body).message || body; } catch (_) {}
      throw new Error(`Glean returned ${res.status}: ${detail}`);
    }

    const data = await res.json();

    if (data.chatSessionTrackingToken) {
      chatSessionToken = data.chatSessionTrackingToken;
    }

    const messages  = data.messages || [];
    const aiMessage = messages.slice().reverse().find(m => m.author === 'GLEAN_AI')
                   || messages[messages.length - 1];

    if (!aiMessage) {
      throw new Error('Glean returned no response. Check your token and backend URL.');
    }

    const rawText = (aiMessage.fragments || [])
      .filter(f => typeof f.text === 'string')
      .map(f => f.text)
      .join('\n')
      .trim();

    if (!rawText) {
      throw new Error('Glean response was empty.');
    }

    responseText.innerHTML = renderMarkdown(rawText);
    responseArea.hidden    = false;
    responseArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Follow-up prompts
    const prompts = aiMessage.followUpPrompts || data.followUpPrompts || [];
    if (prompts.length > 0) {
      followUpList.innerHTML = '';
      prompts.slice(0, 4).forEach(p => {
        const li  = document.createElement('li');
        const btn = document.createElement('button');
        btn.textContent = p;
        btn.className   = 'follow-up-btn';
        btn.addEventListener('click', () => {
          const followUp =
            `I am a BuildOps employee asking a follow-up question about the BuildOps + ${erp} integration.\n\n` +
            `Question: ${p}`;
          askGlean(followUp, erp);
        });
        li.appendChild(btn);
        followUpList.appendChild(li);
      });
      followUps.hidden = false;
    } else {
      followUps.hidden = true;
    }

  } catch (err) {
    if (err.name === 'AbortError') return;
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

// ---------------------------------------------------------------------------
// New question — reset for a fresh query
// ---------------------------------------------------------------------------
newQuestionBtn.addEventListener('click', () => {
  responseArea.hidden = true;
  followUps.hidden    = true;
  questionInput.value = '';
  chatSessionToken    = null;

  // Clear topic selection
  selectedTopics.clear();
  document.querySelectorAll('.topic-toggle').forEach(btn => {
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('is-selected');
  });

  updateAskButton();
  erpSelect.focus();
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function setLoading(on) {
  thinkingArea.hidden = !on;
  askBtn.disabled     = on;
  if (!on) updateAskButton();
}

function showError(msg) {
  errorArea.textContent = msg;
  errorArea.hidden      = false;
}

function hideError() {
  errorArea.hidden = true;
}

// ---------------------------------------------------------------------------
// Simple Markdown → HTML renderer
// Handles headings, bold, italic, code, pre, tables, lists, blockquotes, hr
// ---------------------------------------------------------------------------
function renderMarkdown(md) {
  let html = escapeHtml(md);

  // Fenced code blocks
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
    `<pre><code>${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm,  '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,   '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm,    '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,         '<em>$1</em>');
  html = html.replace(/__(.+?)__/g,         '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g,           '<em>$1</em>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Tables
  html = renderTables(html);

  // Unordered lists
  html = html.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n')
      .map(line => `<li>${line.replace(/^[ \t]*[-*+] /, '').trim()}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n')
      .map(line => `<li>${line.replace(/^[ \t]*\d+\. /, '').trim()}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  });

  // Paragraphs
  html = html.split(/\n{2,}/).map(chunk => {
    chunk = chunk.trim();
    if (!chunk) return '';
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|table|hr|p)/.test(chunk)) return chunk;
    return `<p>${chunk.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return html;
}

function renderTables(html) {
  return html.replace(/((?:^\|.+\|\n?)+)/gm, (block) => {
    const lines = block.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return block;
    if (!/^\|[\s\-|:]+\|$/.test(lines[1].trim())) return block;

    const headerCells = parseTableRow(lines[0]);
    const bodyRows    = lines.slice(2);
    const thead = `<thead><tr>${headerCells.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
    const tbody = bodyRows
      .map(row => `<tr>${parseTableRow(row).map(c => `<td>${c}</td>`).join('')}</tr>`)
      .join('');
    return `<table>${thead}<tbody>${tbody}</tbody></table>`;
  });
}

function parseTableRow(row) {
  return row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadSettings();
updateAskButton();
