/**
 * BuildOps Accounting Integration Assistant
 *
 * Lets users select an ERP from a dropdown, type a question, and get
 * an answer from Glean about the BuildOps integration with that system.
 *
 * The selected ERP is injected as context into each Glean request so the
 * AI focuses its answer on the relevant integration.
 */

const PROXY_URL      = 'https://jira-proxy.shrimpwheels.workers.dev';
const STORAGE_KEY    = 'buildopsAccountingSettings';
const DEFAULT_BACKEND = 'buildops-be.glean.com';

// ---------------------------------------------------------------------------
// ERP metadata — quick-question chips and description blurbs per system
// ---------------------------------------------------------------------------
const ERP_META = {
  'QuickBooks Online': {
    description: 'Cloud-based accounting for small-to-mid-size field service businesses. Widely used BuildOps integration.',
    chips: ['How do I set up the QBO integration?', 'How does invoice sync work?', 'How is job costing handled?', 'Why isn\'t my customer syncing?'],
  },
  'QuickBooks Desktop (Pro / Premier / Enterprise)': {
    description: 'On-premise QuickBooks via Web Connector or IIF export. Setup differs from QBO.',
    chips: ['How does QBD sync differ from QBO?', 'What is the Web Connector setup?', 'How do I export invoices to QBD?', 'What are the sync limitations?'],
  },
  'Xero': {
    description: 'Cloud accounting popular with smaller contractors and service businesses.',
    chips: ['How do I connect BuildOps to Xero?', 'How do invoices sync to Xero?', 'How are contacts mapped?', 'Does Xero support job costing?'],
  },
  'Sage Intacct': {
    description: 'Enterprise cloud ERP with strong job cost and project accounting features.',
    chips: ['How is job costing set up in Intacct?', 'How do dimensions map from BuildOps?', 'How does invoice sync work?', 'What GL accounts do I need to configure?'],
  },
  'NetSuite (Oracle)': {
    description: 'Enterprise ERP with robust financials and project management. Common in larger BuildOps customers.',
    chips: ['How does the NetSuite integration work?', 'How are work orders mapped to NetSuite jobs?', 'How do invoices sync to NetSuite?', 'What are the prerequisites?'],
  },
  'Microsoft Dynamics 365 Business Central': {
    description: 'Microsoft\'s cloud ERP for mid-market businesses, often used alongside Microsoft 365.',
    chips: ['How do I set up the Business Central integration?', 'How do customers sync?', 'How are invoices pushed to BC?', 'What fields are mapped?'],
  },
  'Acumatica': {
    description: 'Cloud ERP popular with construction and field service companies for project and job cost accounting.',
    chips: ['How does the Acumatica integration work?', 'How is job cost data synced?', 'How do service orders map to Acumatica?', 'What are the configuration steps?'],
  },
  'Sage 100 Contractor': {
    description: 'On-premise ERP designed for contractors, with job costing and project management built in.',
    chips: ['How does BuildOps connect to Sage 100 Contractor?', 'How is job cost data pushed?', 'What sync methods are available?', 'What are the known limitations?'],
  },
  'Sage 300 CRE (Timberline)': {
    description: 'On-premise ERP for mid-to-large construction companies with deep job cost accounting.',
    chips: ['How does the Sage 300 CRE integration work?', 'How is job cost data exported?', 'How do customers sync?', 'What fields are supported?'],
  },
  'Foundation Software': {
    description: 'Accounting and job cost software purpose-built for construction contractors.',
    chips: ['How does BuildOps integrate with Foundation?', 'How is job costing handled?', 'How do invoices sync?', 'What are the setup steps?'],
  },
  'Spectrum (Viewpoint)': {
    description: 'ERP for construction companies with strong project management and job cost modules.',
    chips: ['How does the Spectrum integration work?', 'How are service orders mapped?', 'How does job cost sync?', 'What are the prerequisites?'],
  },
  'ComputerEase': {
    description: 'Accounting software for construction contractors, common in mechanical and electrical trades.',
    chips: ['How does BuildOps integrate with ComputerEase?', 'How do invoices sync?', 'How is job costing handled?', 'What are known limitations?'],
  },
  'Procore Financials': {
    description: 'Financial module within the Procore construction management platform.',
    chips: ['How does BuildOps work with Procore Financials?', 'How do contracts sync?', 'How are invoices pushed?', 'What fields are supported?'],
  },
  'Viewpoint Vista': {
    description: 'Enterprise ERP for large construction companies, part of the Trimble portfolio.',
    chips: ['How does the Vista integration work?', 'How is job cost data handled?', 'How do customers sync?', 'What are the setup requirements?'],
  },
  'Jonas Construction Software': {
    description: 'ERP designed for mechanical, electrical, plumbing, and HVAC contractors.',
    chips: ['How does BuildOps integrate with Jonas?', 'How are invoices synced?', 'How is job costing supported?', 'What are the current limitations?'],
  },
};

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
const questionInput     = document.getElementById('question-input');
const quickChips        = document.getElementById('quick-chips');
const chipsList         = document.getElementById('chips-list');
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
let chatSessionToken  = null;   // carries conversation context across turns
let abortController   = null;

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
// ERP dropdown — update description and quick-question chips
// ---------------------------------------------------------------------------
erpSelect.addEventListener('change', () => {
  const erp  = erpSelect.value;
  const meta = ERP_META[erp];

  // Update description blurb
  erpDescription.textContent = meta ? meta.description : '';

  // Update chip bar
  chipsList.innerHTML = '';
  if (meta && meta.chips.length) {
    meta.chips.forEach(text => {
      const btn = document.createElement('button');
      btn.className   = 'chip';
      btn.textContent = text;
      btn.addEventListener('click', () => {
        questionInput.value = text;
        updateAskButton();
      });
      chipsList.appendChild(btn);
    });
    quickChips.hidden = false;
  } else {
    quickChips.hidden = true;
  }

  // Reset conversation when ERP changes
  chatSessionToken = null;
  updateAskButton();
});

// ---------------------------------------------------------------------------
// Ask button state
// ---------------------------------------------------------------------------
function updateAskButton() {
  askBtn.disabled = !(erpSelect.value && questionInput.value.trim());
}

questionInput.addEventListener('input', updateAskButton);

// ---------------------------------------------------------------------------
// Ask Glean
// ---------------------------------------------------------------------------
askBtn.addEventListener('click', () => {
  const erp      = erpSelect.value;
  const question = questionInput.value.trim();
  if (!erp || !question) return;

  // Build a context-enriched prompt so Glean focuses on the right integration
  const contextualQuestion =
    `I am a BuildOps employee asking about the BuildOps integration with ${erp}.\n\n` +
    `Question: ${question}`;

  askGlean(contextualQuestion, erp);
});

async function askGlean(contextualQuestion, erp) {
  const settings = getSettings();

  if (!settings.gleanToken) {
    showError('No Glean API token found. Open settings (⚙) and paste your token.');
    settingsPanel.hidden = false;
    return;
  }

  // Switch to loading state
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

    // Render the markdown response as HTML
    responseText.innerHTML = renderMarkdown(rawText);
    responseArea.hidden    = false;

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
            `I am a BuildOps employee asking about the BuildOps integration with ${erp}.\n\n` +
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
// New question — reset response and allow asking again
// ---------------------------------------------------------------------------
newQuestionBtn.addEventListener('click', () => {
  responseArea.hidden = true;
  followUps.hidden    = true;
  questionInput.value = '';
  questionInput.focus();
  chatSessionToken = null;  // start a fresh conversation
  updateAskButton();
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function setLoading(on) {
  thinkingArea.hidden = !on;
  askBtn.disabled     = on;
  if (!on) {
    // Re-evaluate button state based on form contents
    updateAskButton();
  }
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
  // Escape raw HTML in input to prevent XSS
  let html = escapeHtml(md);

  // Fenced code blocks  (``` ... ```)
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code  (`...`)
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headings  (## Heading)
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

  // Tables (header | cell | cell rows)
  html = renderTables(html);

  // Unordered lists  (- item or * item)
  html = html.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(line =>
      `<li>${line.replace(/^[ \t]*[-*+] /, '').trim()}</li>`
    ).join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists  (1. item)
  html = html.replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(line =>
      `<li>${line.replace(/^[ \t]*\d+\. /, '').trim()}</li>`
    ).join('');
    return `<ol>${items}</ol>`;
  });

  // Paragraphs — wrap consecutive non-empty, non-block lines
  html = html.split(/\n{2,}/).map(chunk => {
    chunk = chunk.trim();
    if (!chunk) return '';
    // Already a block element — don't wrap
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|table|hr|p)/.test(chunk)) return chunk;
    // Single line-break inside paragraph → <br>
    return `<p>${chunk.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return html;
}

function renderTables(html) {
  // Match markdown table blocks: header | separator | rows
  return html.replace(
    /((?:^\|.+\|\n?)+)/gm,
    (block) => {
      const lines = block.trim().split('\n').filter(l => l.trim());
      if (lines.length < 2) return block;

      // Check second line is a separator (---|---|...)
      if (!/^\|[\s\-|:]+\|$/.test(lines[1].trim())) return block;

      const headerCells = parseTableRow(lines[0]);
      const bodyRows    = lines.slice(2);

      const thead = `<thead><tr>${headerCells.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
      const tbody = bodyRows.map(row => {
        const cells = parseTableRow(row);
        return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
      }).join('');

      return `<table>${thead}<tbody>${tbody}</tbody></table>`;
    }
  );
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
