/**
 * BuildOps Product Announcements Digest
 *
 * Flow:
 *  1. User selects a time window (7d, 2w, 30d, or custom).
 *  2. Optionally narrows to a specific product area.
 *  3. Sends a context-rich prompt to Glean that searches all connected sources
 *     (Slack, Confluence, Jira, release notes, etc.) for product announcements.
 *  4. Returns a bulleted list with a 1-2 sentence blurb and a clickable link
 *     for each announcement, ordered newest-first.
 */

const PROXY_URL       = 'https://jira-proxy.shrimpwheels.workers.dev';
const STORAGE_KEY     = 'buildopsAnnouncementsSettings';
const DEFAULT_BACKEND = 'buildops-be.glean.com';

// ---------------------------------------------------------------------------
// Thinking messages — cycle through these while waiting
// ---------------------------------------------------------------------------
const THINKING_MESSAGES = [
  'Searching all connected sources…',
  'Scanning Slack channels…',
  'Checking release notes…',
  'Looking through Confluence…',
  'Reviewing Jira releases…',
  'Compiling announcements…',
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

const timeChips         = document.getElementById('time-chips');
const customWindowInput = document.getElementById('custom-window');
const areaSelect        = document.getElementById('area-select');
const askBtn            = document.getElementById('ask-btn');

const thinkingArea      = document.getElementById('thinking-area');
const thinkingText      = document.getElementById('thinking-text');
const responseArea      = document.getElementById('response-area');
const responseText      = document.getElementById('response-text');
const followUps         = document.getElementById('follow-ups');
const followUpList      = document.getElementById('follow-up-list');
const newSearchBtn      = document.getElementById('new-search-btn');
const errorArea         = document.getElementById('error-area');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let selectedWindow   = '7d';          // active time chip value
let chatSessionToken = null;
let abortController  = null;
let thinkingInterval = null;

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
// Time window chip selection
// ---------------------------------------------------------------------------
timeChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.time-chip');
  if (!chip) return;

  // Deselect all
  document.querySelectorAll('.time-chip').forEach(c => c.classList.remove('is-selected'));
  chip.classList.add('is-selected');

  selectedWindow = chip.dataset.value;

  // Show/hide custom input
  if (selectedWindow === 'custom') {
    customWindowInput.hidden = false;
    customWindowInput.focus();
  } else {
    customWindowInput.hidden = true;
    customWindowInput.value  = '';
  }
});

// ---------------------------------------------------------------------------
// Resolve the final time window string
// ---------------------------------------------------------------------------
function resolveTimeWindow() {
  if (selectedWindow === 'custom') {
    const val = customWindowInput.value.trim();
    return val || '2w';
  }
  return selectedWindow;
}

// ---------------------------------------------------------------------------
// Build the prompt sent to Glean
// ---------------------------------------------------------------------------
function buildPrompt() {
  const timeWindow  = resolveTimeWindow();
  const productArea = areaSelect.value.trim();

  const areaClause = productArea
    ? `I am specifically interested in announcements related to the "${productArea}" product area only. Exclude announcements from other areas.`
    : 'Include announcements across all BuildOps product areas.';

  return [
    `I am a BuildOps employee. Please find all product announcements, new feature releases, and product updates for BuildOps that were published in the last ${timeWindow}.`,
    ``,
    `Search EVERY connected data source — Slack (especially channels named or related to product, releases, announcements, changelog, launch, shipping, rollout, or updates), Confluence, Notion, Jira release notes, Google Drive, SharePoint, Help Center, and any other integrated tools.`,
    ``,
    areaClause,
    ``,
    `For each announcement you find:`,
    `1. Write a 1-2 sentence plain-English summary explaining what was released and why it matters to BuildOps users.`,
    `2. Include a direct hyperlink to the original source (Slack message, Confluence page, release note, etc.) that the user can click to read more.`,
    `3. Note which source app it came from.`,
    ``,
    `Format your response as a bulleted list ordered newest-first. Each bullet should follow this structure:`,
    `• **[Announcement Title]** — [1-2 sentence summary.]`,
    `  [Source: App Name]  |  [View →](URL)`,
    ``,
    `If you find the same announcement in multiple sources, merge them into one bullet and use the most authoritative link (prefer official release notes or documentation pages over Slack messages).`,
    ``,
    `If no announcements are found, clearly state that and suggest verifying which sources are connected and indexed.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Submit handler
// ---------------------------------------------------------------------------
askBtn.addEventListener('click', () => {
  runSearch();
});

// Also trigger search when pressing Enter in custom window input
customWindowInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runSearch();
});

async function runSearch() {
  const settings = getSettings();

  if (!settings.gleanToken) {
    showError('No Glean API token found. Open settings (⚙) and paste your token.');
    settingsPanel.hidden = false;
    return;
  }

  if (selectedWindow === 'custom' && !customWindowInput.value.trim()) {
    showError('Please enter a custom time window (e.g. 3w, 45d).');
    customWindowInput.focus();
    return;
  }

  chatSessionToken = null;
  await askGlean(buildPrompt());
}

// ---------------------------------------------------------------------------
// Glean API call
// ---------------------------------------------------------------------------
async function askGlean(prompt) {
  const settings = getSettings();
  const backend  = settings.gleanBackend || DEFAULT_BACKEND;

  setLoading(true);
  hideError();

  const payload = {
    messages: [
      {
        author:    'USER',
        fragments: [{ text: prompt }],
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
          const followUpMsg =
            `I am a BuildOps employee asking a follow-up question about product announcements.\n\nQuestion: ${p}`;
          askGlean(followUpMsg);
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
// New search — reset UI
// ---------------------------------------------------------------------------
newSearchBtn.addEventListener('click', () => {
  responseArea.hidden = true;
  followUps.hidden    = true;
  chatSessionToken    = null;
  hideError();
  askBtn.focus();
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function setLoading(on) {
  thinkingArea.hidden = !on;
  askBtn.disabled     = on;

  if (on) {
    startThinkingCycle();
  } else {
    stopThinkingCycle();
  }
}

function startThinkingCycle() {
  let idx = 0;
  thinkingText.textContent = THINKING_MESSAGES[0];
  thinkingInterval = setInterval(() => {
    idx = (idx + 1) % THINKING_MESSAGES.length;
    thinkingText.textContent = THINKING_MESSAGES[idx];
  }, 2500);
}

function stopThinkingCycle() {
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
    thinkingInterval = null;
  }
  thinkingText.textContent = THINKING_MESSAGES[0];
}

function showError(msg) {
  errorArea.textContent = msg;
  errorArea.hidden      = false;
}

function hideError() {
  errorArea.hidden = true;
}

// ---------------------------------------------------------------------------
// Markdown → HTML renderer
// Handles headings, bold, italic, links, code, tables, lists, blockquotes, hr
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

  // Links — render as actual clickable anchors opening in a new tab
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="result-link">$1</a>'
  );

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Tables
  html = renderTables(html);

  // Unordered lists
  html = html.replace(/((?:^[ \t]*[-*•] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n')
      .map(line => `<li>${line.replace(/^[ \t]*[-*•] /, '').trim()}</li>`)
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
