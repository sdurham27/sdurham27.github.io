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

// ── Searchable select helper ────────────────────────────────────────────────
// Sets a custom-select's value AND refreshes its trigger label.
function setSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  if (typeof el._csUpdate === 'function') el._csUpdate();
}

// ── Option tooltip (hover 1.7 s to reveal full truncated label) ────────────
let _tipEl = null;
let _tipTimer = null;

function _getTip() {
  if (!_tipEl) {
    _tipEl = document.createElement('div');
    _tipEl.className = 'cs-tooltip';
    _tipEl.hidden = true;
    document.body.appendChild(_tipEl);
  }
  return _tipEl;
}

function showOptionTooltip(optEl, text) {
  const tip      = _getTip();
  const optRect  = optEl.getBoundingClientRect();
  const panel    = optEl.closest('.cs-panel');
  const panelRect = panel ? panel.getBoundingClientRect() : optRect;

  tip.textContent = text;
  tip.hidden = false;

  // Default: appear to the right of the panel, vertically centred on the row
  tip.style.top    = (optRect.top + optRect.height / 2) + 'px';
  tip.style.transform = 'translateY(-50%)';
  tip.style.left   = (panelRect.right + 10) + 'px';
  tip.style.right  = 'auto';

  // If it would bleed off the right edge, flip to the left side
  requestAnimationFrame(() => {
    const tipRect = tip.getBoundingClientRect();
    if (tipRect.right > window.innerWidth - 8) {
      tip.style.left  = 'auto';
      tip.style.right = (window.innerWidth - panelRect.left + 10) + 'px';
    }
  });
}

function hideOptionTooltip() {
  clearTimeout(_tipTimer);
  _tipTimer = null;
  if (_tipEl) _tipEl.hidden = true;
}

// ── User project history (Most Used group) ───────────────────────────────────
// On each load, reads the localStorage cache to personalise the "Most Used"
// optgroup BEFORE initCustomSelects() runs. The cache is refreshed in the
// background so next visit picks up any changes.

function getCachedUserProjects() {
  try {
    const raw = localStorage.getItem('jiraToolsUserProjects');
    if (!raw) return null;
    const { timestamp, projects } = JSON.parse(raw);
    if (!projects || Date.now() - timestamp > 86400000) return null; // 24 h TTL
    return projects;
  } catch (_) { return null; }
}

// Replaces the "Most Used" optgroup in project selects with the user's top keys.
function updateMostUsedGroup(keys) {
  if (!keys || !keys.length) return;
  ['discover-project', 'm-project'].forEach(selectId => {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    // Build value → label map from every non-Most-Used optgroup
    const labelMap = {};
    Array.from(sel.querySelectorAll('optgroup')).forEach(g => {
      if (g.label === 'Most Used') return;
      Array.from(g.querySelectorAll('option')).forEach(opt => {
        if (opt.value && !labelMap[opt.value]) labelMap[opt.value] = opt.textContent.trim();
      });
    });
    const group = Array.from(sel.querySelectorAll('optgroup')).find(g => g.label === 'Most Used');
    if (!group) return;
    group.innerHTML = keys
      .filter(k => labelMap[k])
      .map(k => `<option value="${k}">${labelMap[k]}</option>`)
      .join('');
  });
}

// Background: queries recent issues, tallies project usage, saves to cache.
async function fetchUserProjectHistory() {
  const settings = getSettings();
  if (!settings.jiraEmail || !settings.jiraToken) return;
  try {
    const jql = encodeURIComponent(
      '(reporter = currentUser() OR assignee = currentUser()) ORDER BY updated DESC'
    );
    const res = await fetch(
      `${PROXY_URL}/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=project`,
      { headers: jiraHeaders(settings) }
    );
    if (!res.ok) return;
    const data   = await res.json();
    const counts = {};
    for (const issue of (data.issues || [])) {
      const key = issue.fields?.project?.key;
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);
    if (top.length) {
      localStorage.setItem('jiraToolsUserProjects', JSON.stringify({
        timestamp: Date.now(),
        projects:  top,
      }));
    }
  } catch (_) {}
}

// ── Custom Searchable Select ────────────────────────────────────────────────
// Converts every .select-wrapper on the page into a searchable dropdown.
// The native <select> stays in the DOM (hidden) so existing JS that reads
// .value still works without modification. Call once after DOMContentLoaded.
function initCustomSelects() {
  // Close all open panels (used by document click + scroll handlers)
  function closeAll() {
    document.querySelectorAll('.cs-panel').forEach(p => {
      if (!p.hidden) {
        p.hidden = true;
        const trigger = p._trigger;
        if (trigger) {
          trigger.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
        }
      }
    });
  }

  document.addEventListener('scroll', closeAll, true);
  window.addEventListener('resize', closeAll);

  document.querySelectorAll('.select-wrapper').forEach(wrapper => {
    const nativeSel = wrapper.querySelector('select');
    if (!nativeSel) return;

    // Hide native select and its sibling arrow
    nativeSel.style.display = 'none';
    const oldArrow = wrapper.querySelector('.select-arrow');
    if (oldArrow) oldArrow.style.display = 'none';

    // ── Build trigger button ──────────────────────────────────────
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const valueSpan = document.createElement('span');
    valueSpan.className = 'cs-value is-placeholder';

    const arrowNS = 'http://www.w3.org/2000/svg';
    const arrowSvg = document.createElementNS(arrowNS, 'svg');
    arrowSvg.setAttribute('viewBox', '0 0 24 24');
    arrowSvg.setAttribute('width', '16');
    arrowSvg.setAttribute('height', '16');
    arrowSvg.setAttribute('fill', 'currentColor');
    arrowSvg.classList.add('cs-trigger-arrow');
    const arrowPath = document.createElementNS(arrowNS, 'path');
    arrowPath.setAttribute('d', 'M7 10l5 5 5-5z');
    arrowSvg.appendChild(arrowPath);

    trigger.appendChild(valueSpan);
    trigger.appendChild(arrowSvg);

    // ── Build panel ───────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.className = 'cs-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'listbox');
    panel._trigger = trigger; // back-reference for closeAll()

    const searchWrap = document.createElement('div');
    searchWrap.className = 'cs-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'cs-search';
    searchInput.placeholder = 'Search…';
    searchInput.setAttribute('autocomplete', 'off');
    searchWrap.appendChild(searchInput);
    panel.appendChild(searchWrap);

    const list = document.createElement('div');
    list.className = 'cs-list';

    // ── Populate options from native select ───────────────────────
    const optionData = []; // { value, label, el, groupEl }

    const placeholderOpt = nativeSel.querySelector('option[value=""]');
    const placeholderText = placeholderOpt ? placeholderOpt.textContent.trim() : '— Select —';

    for (const child of nativeSel.children) {
      if (child.tagName === 'OPTGROUP') {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'cs-group-label';
        groupDiv.textContent = child.label;
        list.appendChild(groupDiv);

        for (const opt of child.children) {
          const optEl = makeOptionEl(opt.textContent.trim());
          optionData.push({ value: opt.value, label: opt.textContent.trim(), el: optEl, groupEl: groupDiv });
          list.appendChild(optEl);
        }
      } else if (child.tagName === 'OPTION' && child.value) {
        const optEl = makeOptionEl(child.textContent.trim());
        optionData.push({ value: child.value, label: child.textContent.trim(), el: optEl, groupEl: null });
        list.appendChild(optEl);
      }
    }

    const noResults = document.createElement('div');
    noResults.className = 'cs-no-results';
    noResults.textContent = 'No matches found';
    noResults.hidden = true;
    list.appendChild(noResults);

    panel.appendChild(list);
    wrapper.appendChild(trigger);
    wrapper.appendChild(panel);

    // ── Display sync ──────────────────────────────────────────────
    function updateDisplay() {
      const val = nativeSel.value;
      const found = optionData.find(o => o.value === val);
      if (val && found) {
        valueSpan.textContent = found.label;
        valueSpan.classList.remove('is-placeholder');
      } else {
        valueSpan.textContent = placeholderText;
        valueSpan.classList.add('is-placeholder');
      }
      optionData.forEach(o => o.el.classList.toggle('is-selected', o.value === val));
    }

    // Expose so setSelectValue() can call it
    nativeSel._csUpdate = updateDisplay;
    updateDisplay();

    // ── Panel positioning (fixed, escapes all overflow ancestors) ─
    function positionPanel() {
      const rect = trigger.getBoundingClientRect();
      const panelH = 360; // search + list max height estimate
      const spaceBelow = window.innerHeight - rect.bottom - 6;
      const spaceAbove = rect.top - 6;

      panel.style.width = rect.width + 'px';
      panel.style.left  = rect.left + 'px';
      panel.style.right = 'auto';

      if (spaceBelow >= panelH || spaceBelow >= spaceAbove) {
        panel.style.top    = (rect.bottom + 4) + 'px';
        panel.style.bottom = 'auto';
      } else {
        panel.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        panel.style.top    = 'auto';
      }
    }

    // ── Open / close ──────────────────────────────────────────────
    function openPanel() {
      closeAll();
      panel.hidden = false;
      trigger.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      positionPanel();
      searchInput.value = '';
      filterOptions('');
      // Scroll selected item into view
      const sel = optionData.find(o => o.value === nativeSel.value);
      if (sel) sel.el.scrollIntoView({ block: 'nearest' });
      searchInput.focus();
    }

    function closePanel() {
      panel.hidden = true;
      trigger.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      focusedIdx = -1;
      optionData.forEach(o => o.el.classList.remove('is-focused'));
      hideOptionTooltip();
    }

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      panel.hidden ? openPanel() : closePanel();
    });

    panel.addEventListener('click', e => e.stopPropagation());

    document.addEventListener('click', e => {
      if (!wrapper.contains(e.target) && !panel.contains(e.target)) closePanel();
    });

    // ── Select option ─────────────────────────────────────────────
    function selectValue(value) {
      nativeSel.value = value;
      nativeSel.dispatchEvent(new Event('change', { bubbles: true }));
      updateDisplay();
      closePanel();
      trigger.focus();
    }

    optionData.forEach(o => {
      o.el.addEventListener('click', () => selectValue(o.value));

      // Show full label as tooltip after 1 s if text is truncated
      o.el.addEventListener('mouseenter', () => {
        clearTimeout(_tipTimer);
        _tipTimer = setTimeout(() => {
          if (o.el.scrollWidth > o.el.clientWidth) {
            showOptionTooltip(o.el, o.label);
          }
        }, 1000);
      });
      o.el.addEventListener('mouseleave', hideOptionTooltip);
    });

    // ── Search filtering ──────────────────────────────────────────
    function filterOptions(query) {
      const q = query.toLowerCase().trim();
      const groupsWithVisible = new Set();
      let anyVisible = false;

      optionData.forEach(o => {
        const match = !q ||
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q);
        o.el.hidden = !match;
        if (match) {
          anyVisible = true;
          if (o.groupEl) groupsWithVisible.add(o.groupEl);
        }
      });

      list.querySelectorAll('.cs-group-label').forEach(g => {
        g.hidden = !groupsWithVisible.has(g);
      });

      noResults.hidden = anyVisible;
      focusedIdx = -1;
      optionData.forEach(o => o.el.classList.remove('is-focused'));
    }

    searchInput.addEventListener('input', e => filterOptions(e.target.value));

    // ── Keyboard navigation ───────────────────────────────────────
    let focusedIdx = -1;

    function visibleOptions() {
      return optionData.filter(o => !o.el.hidden);
    }

    function moveFocus(dir) {
      const visible = visibleOptions();
      if (!visible.length) return;
      optionData.forEach(o => o.el.classList.remove('is-focused'));
      focusedIdx = Math.max(0, Math.min(visible.length - 1, focusedIdx + dir));
      visible[focusedIdx].el.classList.add('is-focused');
      visible[focusedIdx].el.scrollIntoView({ block: 'nearest' });
    }

    searchInput.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown')  { e.preventDefault(); moveFocus(1); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); moveFocus(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const visible = visibleOptions();
        if (focusedIdx >= 0 && visible[focusedIdx]) selectValue(visible[focusedIdx].value);
        else if (visible.length === 1)               selectValue(visible[0].value);
      }
      else if (e.key === 'Escape') { closePanel(); trigger.focus(); }
      else if (e.key === 'Tab')    { closePanel(); }
    });

    trigger.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        panel.hidden ? openPanel() : closePanel();
      } else if (e.key === 'Escape') {
        closePanel();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (panel.hidden) openPanel();
        moveFocus(1);
      }
    });
  });
}

function makeOptionEl(label) {
  const div = document.createElement('div');
  div.className = 'cs-option';
  div.setAttribute('role', 'option');
  div.textContent = label;
  return div;
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Project Custom Fields ────────────────────────────────────────────────────
// Stores {fieldId: {name, type, value, label}} for the selected discover project.
// Populated by loadProjectCustomFields(); consumed by buildDiscoverPrompt()
// and the Jira ticket-create payload.

let projectCustomFieldValues = {};

// Called by inline oninput/onchange handlers on dynamically-rendered field inputs
function updateCustomFieldValue(fieldId, value, label) {
  if (projectCustomFieldValues[fieldId]) {
    projectCustomFieldValues[fieldId].value = value;
    projectCustomFieldValues[fieldId].label = label || value;
  }
}

async function loadProjectCustomFields(projectKey, prefillParams) {
  const container = document.getElementById('discover-custom-fields');
  const loading   = document.getElementById('discover-fields-loading');
  container.innerHTML = '';
  projectCustomFieldValues = {};

  const settings = getSettings();
  if (!settings.jiraEmail || !settings.jiraToken) return;

  loading.hidden = false;

  try {
    const res = await fetch(
      `${PROXY_URL}/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes.fields`,
      { headers: jiraHeaders(settings) }
    );
    if (!res.ok) return;

    const data    = await res.json();
    const project = (data.projects || []).find(p => p.key === projectKey);
    if (!project) return;

    // Fields to skip — complex widgets, internal Jira mechanics, or fields
    // already handled elsewhere (customfield_10297 = Customer Name → m-customer)
    const SKIP_NAMES   = /sprint|epic link|epic name|story point|rank|flagged|team|business value|parent link|development|release notes?|sla|start date|actual (start|end)|customer request|feature link|fix version/i;
    const SKIP_CUSTOMS = /gh-sprint|gh-epic|gh-ranking|com\.pyxis/i;
    const SKIP_IDS     = new Set(['customfield_10297']);

    const seen   = new Set();
    const fields = [];

    for (const issueType of (project.issuetypes || [])) {
      for (const [fieldId, fieldDef] of Object.entries(issueType.fields || {})) {
        if (!fieldId.startsWith('customfield_')) continue;
        if (seen.has(fieldId) || SKIP_IDS.has(fieldId)) continue;

        const schema     = fieldDef.schema || {};
        const schemaType = schema.type;
        const custom     = schema.custom || '';
        const name       = fieldDef.name || fieldId;

        if (SKIP_NAMES.test(name))     continue;
        if (SKIP_CUSTOMS.test(custom)) continue;
        // Only surface types we can render as a simple input or select
        if (!['string', 'number', 'option'].includes(schemaType)) continue;

        seen.add(fieldId);
        fields.push({
          id:            fieldId,
          name,
          type:          schemaType,
          required:      fieldDef.required || false,
          allowedValues: fieldDef.allowedValues || null,
        });
        if (fields.length >= 8) break;
      }
      if (fields.length >= 8) break;
    }

    if (!fields.length) return;

    const rows = fields.map(f => {
      let inputHtml;
      if (f.type === 'option' && f.allowedValues && f.allowedValues.length) {
        const opts = f.allowedValues.map(v =>
          `<option value="${escapeHtml(v.id)}" data-label="${escapeHtml(v.value || v.name || '')}">${escapeHtml(v.value || v.name || '')}</option>`
        ).join('');
        inputHtml = `<select class="cfield-select" data-field-id="${f.id}"
          onchange="updateCustomFieldValue('${f.id}', this.value, this.options[this.selectedIndex].dataset.label)">
          <option value="">— optional —</option>
          ${opts}
        </select>`;
      } else {
        const inputType = f.type === 'number' ? 'number' : 'text';
        inputHtml = `<input type="${inputType}" class="cfield-input" data-field-id="${f.id}" placeholder="optional"
          oninput="updateCustomFieldValue('${f.id}', this.value, this.value)" />`;
      }
      const suffix = f.required
        ? ' <span class="req">*</span>'
        : ' <span class="label-hint">(optional)</span>';
      return `<div class="field-group">
        <label>${escapeHtml(f.name)}${suffix}</label>
        ${inputHtml}
      </div>`;
    });

    container.innerHTML = `<div class="custom-fields-section">
      <div class="custom-fields-header">
        <span class="custom-fields-title">Project Fields</span>
        <span class="custom-fields-desc">Pre-fill values used when creating tickets for this project</span>
      </div>
      <div class="custom-fields-grid">${rows.join('')}</div>
    </div>`;

    for (const f of fields) {
      projectCustomFieldValues[f.id] = { name: f.name, type: f.type, value: '', label: '' };
    }

    if (prefillParams) prefillCustomFieldsFromParams(prefillParams);
  } catch (_) {
    // Silently fail — form is still usable without project-specific fields
  } finally {
    loading.hidden = true;
  }
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
    updateConnectNotice();
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

// ── Connect notice: shows/hides based on whether Jira creds are saved ────────
function updateConnectNotice() {
  const s      = getSettings();
  const notice = document.getElementById('discover-connect-notice');
  if (notice) notice.hidden = !!(s.jiraEmail && s.jiraToken);
}

// ── Generate Agent Prompt ────────────────────────────────────────────────────
// Queries Jira createmeta for each major project, extracts custom fields and
// their exact allowed values, then produces a ready-to-paste Glean system prompt.

async function generateAgentPrompt() {
  const settings = getSettings();
  const btn    = document.getElementById('gen-prompt-btn');
  const status = document.getElementById('gen-prompt-status');

  if (!settings.jiraEmail || !settings.jiraToken) {
    status.textContent = 'Jira credentials required — save settings first.';
    status.className   = 'settings-status error';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Fetching Jira data…';
  status.textContent = '';
  status.className   = 'settings-status';

  const KEY_PROJECTS = [
    'SERVICE', 'MOBILE', 'PLATFORM', 'FINOS', 'REPORTING', 'IX',
    'CE', 'ANALYTICS', 'IP', 'QE', 'AI', 'CSOPS', 'REVOPS', 'CRM', 'API',
  ];

  const projectMeta = {};
  await Promise.all(KEY_PROJECTS.map(async key => {
    try {
      const res = await fetch(
        `${PROXY_URL}/rest/api/3/issue/createmeta?projectKeys=${key}&expand=projects.issuetypes.fields`,
        { headers: jiraHeaders(settings) }
      );
      if (!res.ok) return;
      const data = await res.json();
      const proj = (data.projects || []).find(p => p.key === key);
      if (proj) projectMeta[key] = proj;
    } catch (_) {}
  }));

  if (!Object.keys(projectMeta).length) {
    status.textContent = 'Could not fetch project data. Check credentials.';
    status.className   = 'settings-status error';
    btn.disabled    = false;
    btn.textContent = 'Generate Agent Prompt';
    return;
  }

  document.getElementById('prompt-output').value = buildAgentPromptText(projectMeta);
  document.getElementById('prompt-modal').classList.remove('hidden');
  btn.disabled    = false;
  btn.textContent = 'Regenerate';
}

function buildAgentPromptText(projectMeta) {
  const SKIP_NAMES   = /sprint|epic link|epic name|story point|rank|flagged|team|business value|parent link|development|release notes?|sla|start date|actual (start|end)|customer request|feature link|fix version/i;
  const SKIP_CUSTOMS = /gh-sprint|gh-epic|gh-ranking|com\.pyxis/i;
  const SKIP_IDS     = new Set(['customfield_10297']); // customer name handled via ?customer= param

  // Build per-project field reference section
  const projectSections = [];
  for (const [key, proj] of Object.entries(projectMeta).sort((a, b) => a[0].localeCompare(b[0]))) {
    const issueTypes = [...new Set((proj.issuetypes || []).map(it => it.name).filter(Boolean))];
    const seen = new Set();
    const customFields = [];

    for (const issueType of (proj.issuetypes || [])) {
      for (const [fieldId, fieldDef] of Object.entries(issueType.fields || {})) {
        if (!fieldId.startsWith('customfield_')) continue;
        if (seen.has(fieldId) || SKIP_IDS.has(fieldId)) continue;
        const schema = fieldDef.schema || {};
        const name   = fieldDef.name || fieldId;
        if (SKIP_NAMES.test(name))              continue;
        if (SKIP_CUSTOMS.test(schema.custom || '')) continue;
        if (!['string', 'number', 'option'].includes(schema.type)) continue;
        seen.add(fieldId);
        customFields.push({
          name, type: schema.type,
          allowedValues: fieldDef.allowedValues || null,
          required: fieldDef.required || false,
        });
        if (customFields.length >= 12) break;
      }
      if (customFields.length >= 12) break;
    }

    const lines = [`#### ${key} — ${proj.name}`];
    lines.push(`**Issue types:** ${issueTypes.join(' | ')}`);
    if (customFields.length) {
      lines.push('**Custom fields (use ONLY these exact values):**');
      for (const cf of customFields) {
        const reqTag = cf.required ? ' *(required)*' : '';
        if (cf.type === 'option' && cf.allowedValues?.length) {
          const opts = cf.allowedValues.map(v => v.value || v.name || '').filter(Boolean);
          lines.push(`- **${cf.name}**${reqTag}: \`${opts.join('` | `')}\``);
        } else {
          lines.push(`- **${cf.name}**${reqTag}: [${cf.type} — enter value]`);
        }
      }
    }
    projectSections.push(lines.join('\n'));
  }

  const fieldRef  = projectSections.join('\n\n');
  const base      = 'https://sdurham27.github.io/jira-tools.html';
  const generated = new Date().toLocaleDateString();

  return `# Glean Agent: Jira Ticket Creator
## System Prompt

You are a Jira ticket discovery assistant for **BuildOps**, a SaaS platform for commercial contractors (HVAC, plumbing, electrical, mechanical). Search recent Gmail, Slack, Gong call recordings, and internal documents to find actionable items that should become Jira tickets — then present each as a pre-filled creation link.

---

### How This Works

1. Search the last 14 days (or as specified) of Gmail, Slack, Gong, and Docs
2. Identify items that are actionable, specific, and not obviously already tracked
3. For each item, build a pre-filled URL (format below) and present it as a clickable link
4. Sort by priority: Critical → High → Medium → Low; max 10 suggestions

---

### URL Format

\`${base}?project={KEY}&summary={text}&taskType={type}&priority={level}&description={text}&customer={name}&source={src}&sourceDate={YYYY-MM-DD}\`

**IMPORTANT field constraints:**
- \`project\` — Jira project key. Use the routing guide below.
- \`summary\` — Concise title, max 80 chars, URL-encoded.
- \`taskType\` — MUST be EXACTLY one of: \`Bug\` | \`Story\` | \`Task\` | \`Improvement\`
  Do NOT put custom descriptions here (e.g. "Create a new report" is WRONG here).
- \`priority\` — MUST be EXACTLY one of: \`Critical\` | \`High\` | \`Medium\` | \`Low\`
- \`description\` — 2–4 sentence description, URL-encoded.
- \`customer\` — Account/customer name. Omit if internal.
- \`source\` — \`Gmail\` | \`Slack\` | \`Gong\` | \`Notes\`
- \`sourceDate\` — \`YYYY-MM-DD\`

For project-specific custom fields, append them using the **exact parameter names and values** from the Project Field Reference below.

---

### Project Routing

Projects are organized by functional area. Use the key that matches where the work belongs:

**Field Service & Mobile**
| Project | Use when |
|---|---|
| \`SERVICE\` | Field service jobs, work orders, scheduling, dispatch, web app bugs |
| \`MOBILE\` | iOS or Android app bugs or requests |
| \`IP\` | Inventory, parts, purchasing |
| \`ASSETS\` | Asset tracking and management |
| \`LE\` | Labor and equipment |

**Financial & Accounting**
| Project | Use when |
|---|---|
| \`FINOS\` | Invoicing, payments, financial OS features |
| \`ACCT\` | Accounting integrations |

**Reporting & Data**
| Project | Use when |
|---|---|
| \`REPORTING\` | Reports, dashboards, data exports |
| \`ANALYTICS\` | Data analytics, insights, BI |

**Customer Commitments & Services**
| Project | Use when |
|---|---|
| \`CC\` | Promises or commitments made to customers |
| \`PSR\` | Professional services requests |
| \`IX\` | Implementation and customer onboarding |
| \`CE\` | Customer engineering, custom integrations |

**Platform, API & Infrastructure**
| Project | Use when |
|---|---|
| \`PLATFORM\` | Core infrastructure, auth, performance, platform bugs |
| \`API\` | Public/open API issues or feature requests |
| \`FS\` | Foundational services |
| \`DV\` | DevOps, CI/CD, infrastructure |
| \`DEVEX\` | Developer experience, internal tooling |

**Product & AI**
| Project | Use when |
|---|---|
| \`AI\` | AI features and capabilities |
| \`CRM\` | Sales & CRM features |

**Quality & Operations**
| Project | Use when |
|---|---|
| \`QE\` | Quality engineering, test automation |
| \`CSOPS\` | CS operations, internal CS tools |
| \`REVOPS\` | Revenue operations |

When in doubt: \`SERVICE\` for customer-facing web bugs, \`PLATFORM\` for infrastructure, \`CC\` for customer commitments, \`IX\` for onboarding blockers.

---

### Project Field Reference
*Auto-generated from Jira on ${generated}. Use ONLY these exact values.*

The customer name is always passed via \`customer=\` — do not duplicate it here.
For each project, use the listed custom field names as URL parameters when you know the value.

${fieldRef}

---

### Priority Guidelines

| Priority | When |
|---|---|
| **Critical** | Production down, customer blocker, SLA breach, churn risk |
| **High** | Customer-impacting bug, overdue commitment, strategic account request |
| **Medium** | Enhancement, non-urgent bug, internal improvement |
| **Low** | Nice-to-have, low-impact, future idea |

---

### Output Format

Present each item as:

**{N}. {emoji} {Type} — {Priority} | {Customer or "Internal"}**
**{Summary}**

{2–3 sentence description}

[➕ Create this ticket]({pre-filled URL})

---

**Example:**

**1. 🐛 Bug — High | Acme Corp**
**Mobile app crashes when saving work orders with photos**

Acme Corp's ops manager reported on a Gong call that the mobile app crashes when saving work orders with photo attachments. Reproduced on both iOS and Android. Blocking their field crew from completing work orders.

[➕ Create this ticket](${base}?project=MOBILE&summary=Mobile+app+crashes+saving+work+orders+with+photos&taskType=Bug&priority=High&customer=Acme+Corp&source=Gong&sourceDate=2024-02-18&description=Mobile+app+crashes+when+saving+work+orders+with+photo+attachments.+Reproduced+on+iOS+and+Android.)

---

### Behavior Rules

- **Exact values only.** For any option/dropdown field, use ONLY the values from the Project Field Reference above.
- **taskType is a Jira issue type**, not a description. Use Bug / Story / Task / Improvement only.
- **Don't hallucinate.** Only suggest tickets based on content you actually found.
- **No duplicates.** Skip items that appear already tracked in Jira.
- **One ticket per issue.** Merge duplicate reports from multiple sources into one.
- **Always include the link.** Every suggestion MUST have a working pre-filled URL.
`;
}

// Restore settings on load
window.addEventListener('DOMContentLoaded', () => {
  // Personalise "Most Used" from cache BEFORE building the custom select UI
  updateMostUsedGroup(getCachedUserProjects());

  // Initialize all searchable dropdowns before restoring any values
  initCustomSelects();

  const saved = getSettings();
  if (saved.jiraEmail)    document.getElementById('jira-email').value    = saved.jiraEmail;
  if (saved.jiraToken)    document.getElementById('jira-token').value    = saved.jiraToken;
  if (saved.gleanToken)   document.getElementById('glean-token').value   = saved.gleanToken;
  if (saved.gleanBackend) document.getElementById('glean-backend').value = saved.gleanBackend;

  // Show settings panel for first-time setup; always update connect notice
  if (!saved.jiraEmail || !saved.jiraToken) {
    document.getElementById('settings-panel').hidden = false;
  }
  updateConnectNotice();

  // "Open Settings" button inside the connect notice
  document.getElementById('discover-open-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').hidden = false;
    document.getElementById('settings-toggle').scrollIntoView({ behavior: 'smooth' });
  });

  // Project picker → reveal extra fields + load project-specific custom fields
  document.getElementById('discover-project').addEventListener('change', () => {
    const projectKey  = document.getElementById('discover-project').value;
    const extraFields = document.getElementById('discover-extra-fields');

    if (!projectKey) {
      extraFields.hidden = true;
      document.getElementById('discover-custom-fields').innerHTML = '';
      projectCustomFieldValues = {};
      return;
    }

    extraFields.hidden = false;
    loadProjectCustomFields(projectKey);
  });

  // ── URL param pre-fill (Glean agent opens this page with fields encoded) ──
  const urlParams  = readUrlParams();
  const hasParams  = Object.values(urlParams).some(Boolean);

  if (hasParams) {
    // Show the source banner if the agent passed source info
    if (urlParams.source || urlParams.sourceDate) {
      const parts  = [urlParams.source, urlParams.sourceDate].filter(Boolean);
      const detail = parts.length ? ` — ${parts.join(' · ')}` : '';
      document.getElementById('glean-source-detail').textContent = detail;
      showEl('glean-source-banner');
    }

    // Pre-fill the core form fields
    if (urlParams.summary)     document.getElementById('create-summary').value     = urlParams.summary;
    if (urlParams.customer)    document.getElementById('create-customer').value    = urlParams.customer;
    if (urlParams.description) document.getElementById('create-description').value = urlParams.description;

    const normType = normalizeIssueType(urlParams.taskType);
    if (normType) setSelectValue('create-type', normType);

    const normPrio = normalizePriority(urlParams.priority);
    if (normPrio) setSelectValue('create-priority', normPrio);

    // Select project and reveal extra fields (also triggers custom field load + fuzzy prefill)
    if (urlParams.project) {
      setSelectValue('discover-project', urlParams.project);
      document.getElementById('discover-extra-fields').hidden = false;
      loadProjectCustomFields(urlParams.project, urlParams);
    }
  }

  // Background: refresh project history cache so next visit has personalised Most Used
  fetchUserProjectHistory();
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
// TOOL 1 — CREATE TICKET (URL param-driven, pre-filled by Glean agent)
// ══════════════════════════════════════════════════════════════════════════════

// Parse URL query params from the Glean agent link
function readUrlParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    project:     p.get('project')     || '',
    summary:     p.get('summary')     || '',
    taskType:    p.get('taskType')    || p.get('type') || '',
    priority:    p.get('priority')    || '',
    description: p.get('description') || '',
    customer:    p.get('customer')    || '',
    source:      p.get('source')      || '',
    sourceDate:  p.get('sourceDate')  || '',
    tenantId:    p.get('tenantId')    || '',
    segment:     p.get('segment')     || '',
    env:         p.get('env')         || '',
    dept:        p.get('dept')        || '',
    status:      p.get('status')      || '',
  };
}

// Map a free-text issue type string to a Jira issue type name
function normalizeIssueType(str) {
  const s = (str || '').toLowerCase().trim();
  if (s.includes('bug'))                                             return 'Bug';
  if (s.includes('story') || s.includes('feature') || s.includes('request')) return 'Story';
  if (s.includes('improv'))                                         return 'Improvement';
  if (s.includes('task') || s.includes('support') || s)            return 'Task';
  return '';
}

// Map a free-text priority string to a Jira priority name
function normalizePriority(str) {
  const s = (str || '').toLowerCase().trim();
  if (s.includes('critical') || s === 'p0' || s === 'highest') return 'Critical';
  if (s.includes('high')     || s === 'p1')                    return 'High';
  if (s.includes('medium')   || s === 'p2' || s.includes('moderate')) return 'Medium';
  if (s.includes('low')      || s === 'p3' || s === 'lowest')  return 'Low';
  return '';
}

// Fuzzy-match URL params to loaded Jira custom field names, pre-filling values
function prefillCustomFieldsFromParams(params) {
  const FUZZY_MAP = [
    { param: 'tenantId', re: /tenant/i },
    { param: 'segment',  re: /segment/i },
    { param: 'env',      re: /environ/i },
    { param: 'dept',     re: /depart/i },
    { param: 'status',   re: /status/i },
  ];

  for (const [fieldId, cf] of Object.entries(projectCustomFieldValues)) {
    for (const { param, re } of FUZZY_MAP) {
      if (!re.test(cf.name) || !params[param]) continue;
      const val   = params[param];
      const input = document.querySelector(`[data-field-id="${fieldId}"]`);
      if (!input) break;

      if (input.tagName === 'SELECT') {
        const opts  = Array.from(input.options);
        const match = opts.find(o => o.text.toLowerCase() === val.toLowerCase())
                   || opts.find(o => o.text.toLowerCase().includes(val.toLowerCase()));
        if (match) {
          input.value = match.value;
          cf.value    = match.value;
          cf.label    = match.dataset.label || match.text;
        }
      } else {
        input.value = val;
        cf.value    = val;
        cf.label    = val;
      }
      break;
    }
  }
}

// ── Direct ticket creation handler ─────────────────────────────────────────

document.getElementById('create-btn').addEventListener('click', async () => {
  const settings = getSettings();
  if (!settings.jiraEmail || !settings.jiraToken) {
    showEl('create-error');
    document.getElementById('create-error').textContent =
      'Please save your Jira credentials in Settings first.';
    document.getElementById('settings-panel').hidden = false;
    return;
  }

  const summary   = document.getElementById('create-summary').value.trim();
  const project   = document.getElementById('discover-project').value.trim();
  const issueType = document.getElementById('create-type').value;
  const priority  = document.getElementById('create-priority').value;
  const customer  = document.getElementById('create-customer').value.trim();
  const desc      = document.getElementById('create-description').value.trim();

  if (!summary || !project) {
    showEl('create-error');
    document.getElementById('create-error').textContent =
      'Summary and Project are required.';
    return;
  }

  const btn = document.getElementById('create-btn');
  btn.disabled = true;
  btn.innerHTML = '<span style="opacity:0.6">Creating…</span>';
  hideEl('create-error');
  hideEl('create-success');

  try {
    const adfContent = desc
      ? [{ type: 'paragraph', content: [{ type: 'text', text: desc }] }]
      : [];

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

    if (customer)           fields.customfield_10297 = customer;
    if (settings.accountId) fields.reporter          = { accountId: settings.accountId };

    // Include any project-specific custom fields (loaded + fuzzy-prefilled)
    for (const [fieldId, cf] of Object.entries(projectCustomFieldValues)) {
      if (!cf.value) continue;
      if (cf.type === 'option') {
        fields[fieldId] = { id: cf.value };
      } else if (cf.type === 'number') {
        const n = parseFloat(cf.value);
        if (!isNaN(n)) fields[fieldId] = n;
      } else {
        fields[fieldId] = cf.value;
      }
    }

    const res  = await fetch(`${PROXY_URL}/rest/api/3/issue`, {
      method:  'POST',
      headers: jiraHeaders(settings),
      body:    JSON.stringify({ fields }),
    });
    const data = await res.json();

    if (res.ok) {
      const ticketUrl  = `https://${JIRA_DOMAIN}/browse/${data.key}`;
      const successEl  = document.getElementById('create-success');
      successEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
        Ticket created: <a href="${ticketUrl}" target="_blank">${data.key} →</a>`;
      showEl('create-success');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg> Created`;
    } else {
      const msg = data.errorMessages?.join(', ') || JSON.stringify(data.errors) || 'Unknown error';
      throw new Error(msg);
    }
  } catch (err) {
    showEl('create-error');
    document.getElementById('create-error').textContent = `Error: ${err.message}`;
    btn.disabled  = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Create in Jira`;
  }
});

// ── Modal (kept for reference; no longer triggered from Tab 1) ──────────────

function closeModal() {
  document.getElementById('create-modal').classList.add('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('create-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('create-modal')) closeModal();
});

// ── Generate Agent Prompt modal ──────────────────────────────────────────────

document.getElementById('gen-prompt-btn').addEventListener('click', generateAgentPrompt);

function closePromptModal() {
  document.getElementById('prompt-modal').classList.add('hidden');
}

document.getElementById('prompt-modal-close').addEventListener('click', closePromptModal);
document.getElementById('prompt-modal-close-btn').addEventListener('click', closePromptModal);
document.getElementById('prompt-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('prompt-modal')) closePromptModal();
});

document.getElementById('copy-prompt-btn').addEventListener('click', () => {
  const ta  = document.getElementById('prompt-output');
  const btn = document.getElementById('copy-prompt-btn');
  ta.select();
  document.execCommand('copy');
  const orig = btn.innerHTML;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg> Copied!`;
  setTimeout(() => { btn.innerHTML = orig; }, 2000);
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
    const url    = `${PROXY_URL}/rest/api/3/search/jql?jql=${jql}&maxResults=25&fields=${fields}&expand=changelog`;

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
