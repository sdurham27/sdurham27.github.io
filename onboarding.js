/* ================================================================
   BuildOps Customer Onboarding Portal – onboarding.js
   ================================================================ */

'use strict';

// ── Storage Keys ──────────────────────────────────────────────────
const SETTINGS_KEY = 'bo_onboarding_settings';
const TASKS_KEY    = 'bo_onboarding_tasks';

// ── Default Settings ──────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  customerName:  '',
  companyName:   '',
  startDate:     '',
  goLiveDate:    '',
  partners: {
    im:  { name: '', email: '', phone: '' },
    csm: { name: '', email: '', phone: '' },
    ae:  { name: '', email: '', phone: '' },
    ts:  { name: '', email: '', phone: '' },
  }
};

// ── Task Definitions ──────────────────────────────────────────────
const TASK_CATEGORIES = [
  {
    id: 'data',
    name: 'Data Setup',
    color: '#2563eb',
    tasks: [
      { id: 'data-1', label: 'Submit initial data import template to BuildOps team', required: true },
      { id: 'data-2', label: 'Review & approve imported customer records', required: true },
      { id: 'data-3', label: 'Upload equipment & asset list', required: true },
      { id: 'data-4', label: 'Configure service locations and coverage zones', required: true },
      { id: 'data-5', label: 'Set up pricing & labor rate sheets', required: false },
    ]
  },
  {
    id: 'config',
    name: 'System Configuration',
    color: '#8b5cf6',
    tasks: [
      { id: 'cfg-1', label: 'Add team members and assign user roles', required: true },
      { id: 'cfg-2', label: 'Configure service types and job categories', required: true },
      { id: 'cfg-3', label: 'Customize invoice and estimate templates', required: false },
      { id: 'cfg-4', label: 'Set up dispatch board preferences and views', required: false },
      { id: 'cfg-5', label: 'Configure notification & alert settings', required: false },
    ]
  },
  {
    id: 'training',
    name: 'Training',
    color: '#10b981',
    tasks: [
      { id: 'trn-1', label: 'Admin & office staff training session completed', required: true },
      { id: 'trn-2', label: 'Dispatcher training session completed', required: true },
      { id: 'trn-3', label: 'Field technician training session completed', required: true },
      { id: 'trn-4', label: 'Mobile app training for field team completed', required: true },
      { id: 'trn-5', label: 'BuildOps University self-paced modules completed', required: false },
    ]
  },
  {
    id: 'integrations',
    name: 'Integrations & Apps',
    color: '#f59e0b',
    tasks: [
      { id: 'int-1', label: 'Mobile app installed on all technician devices', required: true },
      { id: 'int-2', label: 'Accounting connector installed & authorized', required: true },
      { id: 'int-3', label: 'Test accounting sync completed & verified', required: true },
      { id: 'int-4', label: 'Payment processing configured', required: false },
      { id: 'int-5', label: 'Customer portal set up (if applicable)', required: false },
    ]
  },
  {
    id: 'golive',
    name: 'Go-Live Readiness',
    color: '#ef4444',
    tasks: [
      { id: 'gl-1', label: 'Completed a full test work order end-to-end', required: true },
      { id: 'gl-2', label: 'Reviewed go-live checklist with Implementation Manager', required: true },
      { id: 'gl-3', label: 'Confirmed go-live date with BuildOps team', required: true },
      { id: 'gl-4', label: 'Shared support & escalation contact paths with team', required: true },
      { id: 'gl-5', label: 'Joined BuildOps Community forum & Help Center', required: false },
    ]
  }
];

// All required tasks (flat) for score calculation
const ALL_REQUIRED = TASK_CATEGORIES.flatMap(c => c.tasks.filter(t => t.required));
const ALL_OPTIONAL = TASK_CATEGORIES.flatMap(c => c.tasks.filter(t => !t.required));
const ALL_TASKS    = TASK_CATEGORIES.flatMap(c => c.tasks);

// ── Knowledge Base Articles ───────────────────────────────────────
const KB_ARTICLES = [
  {
    title: 'Getting Started Guide',
    desc:  'Overview of your first steps in BuildOps',
    icon:  '🚀',
    color: '#2563eb',
    url:   'https://help.buildops.com/en/collections/getting-started',
    tags:  ['start', 'setup', 'begin', 'overview']
  },
  {
    title: 'Work Order Management',
    desc:  'Create, assign, and complete work orders',
    icon:  '📋',
    color: '#7c3aed',
    url:   'https://help.buildops.com/en/collections/work-orders',
    tags:  ['work order', 'job', 'ticket', 'assign', 'complete']
  },
  {
    title: 'Dispatch & Scheduling',
    desc:  'Schedule jobs and manage your dispatch board',
    icon:  '📅',
    color: '#0891b2',
    url:   'https://help.buildops.com/en/collections/dispatch-scheduling',
    tags:  ['dispatch', 'schedule', 'calendar', 'board']
  },
  {
    title: 'Invoicing & Payments',
    desc:  'Send invoices and collect payments',
    icon:  '💳',
    color: '#059669',
    url:   'https://help.buildops.com/en/collections/invoicing-payments',
    tags:  ['invoice', 'payment', 'billing', 'collect']
  },
  {
    title: 'Mobile App',
    desc:  'iOS & Android app for field technicians',
    icon:  '📱',
    color: '#d97706',
    url:   'https://help.buildops.com/en/collections/mobile-app',
    tags:  ['mobile', 'app', 'ios', 'android', 'field', 'technician']
  },
  {
    title: 'Accounting Integration',
    desc:  'Connect QuickBooks, Sage, NetSuite & more',
    icon:  '🔗',
    color: '#dc2626',
    url:   'https://help.buildops.com/en/collections/accounting-integrations',
    tags:  ['accounting', 'quickbooks', 'sage', 'netsuite', 'sync', 'integration']
  },
  {
    title: 'Customer Management',
    desc:  'Manage customers, contacts & properties',
    icon:  '👥',
    color: '#7c3aed',
    url:   'https://help.buildops.com/en/collections/customers',
    tags:  ['customer', 'client', 'contact', 'property']
  },
  {
    title: 'Estimates & Proposals',
    desc:  'Create and send professional estimates',
    icon:  '📝',
    color: '#0891b2',
    url:   'https://help.buildops.com/en/collections/estimates',
    tags:  ['estimate', 'proposal', 'quote']
  },
  {
    title: 'Reports & Analytics',
    desc:  'Track performance with built-in dashboards',
    icon:  '📊',
    color: '#059669',
    url:   'https://help.buildops.com/en/collections/reports',
    tags:  ['report', 'analytics', 'dashboard', 'kpi', 'data']
  },
  {
    title: 'Technician Management',
    desc:  'Manage technician profiles, skills & hours',
    icon:  '🔧',
    color: '#d97706',
    url:   'https://help.buildops.com/en/collections/technicians',
    tags:  ['technician', 'tech', 'field', 'employee', 'skill']
  },
  {
    title: 'Settings & Configuration',
    desc:  'Company settings, roles & permissions',
    icon:  '⚙️',
    color: '#6b7280',
    url:   'https://help.buildops.com/en/collections/settings',
    tags:  ['settings', 'config', 'permission', 'role', 'admin']
  },
  {
    title: 'Data Import & Migration',
    desc:  'Import customers, equipment & historical data',
    icon:  '📥',
    color: '#2563eb',
    url:   'https://help.buildops.com/en/collections/data-import',
    tags:  ['import', 'data', 'migration', 'upload', 'csv']
  },
];

// ── Product Announcements ─────────────────────────────────────────
const ANNOUNCEMENTS = [
  {
    tag:   'Feature',
    type:  'feature',
    date:  'Feb 2026',
    title: 'AI-Powered Dispatch Suggestions',
    desc:  'The dispatch board now recommends technician assignments based on skills, location, and live schedule — cutting average dispatch time by 40%.'
  },
  {
    tag:   'Mobile',
    type:  'improvement',
    date:  'Jan 2026',
    title: 'Mobile App 5.0 – Offline-First Redesign',
    desc:  'Complete UX overhaul with improved offline sync, faster photo capture, and a redesigned job checklist experience for field techs.'
  },
  {
    tag:   'Integration',
    type:  'integration',
    date:  'Dec 2025',
    title: 'Real-Time Accounting Sync',
    desc:  'QuickBooks Online, Sage Intacct, and NetSuite integrations now sync invoices, payments, and customers in real-time — no more manual exports.'
  },
  {
    tag:   'Feature',
    type:  'feature',
    date:  'Nov 2025',
    title: 'Customer Self-Service Portal',
    desc:  'Give your customers a branded portal to view estimates, approve quotes, pay invoices, and request new service — all without a phone call.'
  },
];

// ── Quick Links ───────────────────────────────────────────────────
const QUICK_LINKS = [
  { label: 'Help Center',        icon: '📚', color: '#2563eb', url: 'https://help.buildops.com' },
  { label: 'BuildOps University', icon: '🎓', color: '#7c3aed', url: 'https://university.buildops.com' },
  { label: 'Support Ticket',     icon: '🎫', color: '#059669', url: 'https://help.buildops.com/en/articles/submit-a-ticket' },
  { label: 'Community Forum',    icon: '💬', color: '#0891b2', url: 'https://community.buildops.com' },
  { label: 'Release Notes',      icon: '📣', color: '#d97706', url: 'https://help.buildops.com/en/collections/release-notes' },
  { label: 'System Status',      icon: '🟢', color: '#10b981', url: 'https://status.buildops.com' },
  { label: 'Product Announcements', icon: '🔔', color: '#8b5cf6', url: 'announcements.html' },
  { label: 'Mobile App (iOS)',   icon: '📱', color: '#6b7280', url: 'https://apps.apple.com/us/app/buildops/id1234567890' },
];

// ── State ─────────────────────────────────────────────────────────
let settings   = loadSettings();
let taskStates = loadTaskStates(); // { taskId: true/false }

// ── Init ──────────────────────────────────────────────────────────
function init() {
  applyURLParams();
  renderAll();
  setupEventListeners();
}

// ── Load / Save ───────────────────────────────────────────────────
function loadSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), JSON.parse(stored));
    }
  } catch (_) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadTaskStates() {
  try {
    const stored = localStorage.getItem(TASKS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (_) { /* ignore */ }
  return {};
}

function saveTaskStates() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(taskStates));
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ── URL Param Overrides ───────────────────────────────────────────
function applyURLParams() {
  const p = new URLSearchParams(location.search);
  if (p.get('name'))    settings.customerName = p.get('name');
  if (p.get('company')) settings.companyName  = p.get('company');
  if (p.get('golive'))  settings.goLiveDate   = p.get('golive');
  if (p.get('start'))   settings.startDate    = p.get('start');
  if (p.get('im'))      settings.partners.im.name  = p.get('im');
  if (p.get('imemail')) settings.partners.im.email = p.get('imemail');
  if (p.get('csm'))     settings.partners.csm.name  = p.get('csm');
  if (p.get('csmemail'))settings.partners.csm.email = p.get('csmemail');
}

// ── Render All ────────────────────────────────────────────────────
function renderAll() {
  const score = calculateHealthScore();
  renderWelcomeBanner(score);
  renderHealthScore(score);
  renderActionItems();
  renderTasks();
  renderPartners();
  renderKnowledgeBase();
  renderAnnouncements();
  renderQuickLinks();
}

// ── Health Score ──────────────────────────────────────────────────
function calculateHealthScore() {
  const reqDone = ALL_REQUIRED.filter(t => taskStates[t.id]).length;
  const optDone = ALL_OPTIONAL.filter(t => taskStates[t.id]).length;
  const reqTotal = ALL_REQUIRED.length;
  const optTotal = ALL_OPTIONAL.length;

  // Required tasks are 85% of score; optional tasks are 15%
  const reqScore = reqTotal > 0 ? (reqDone / reqTotal) * 85 : 0;
  const optScore = optTotal > 0 ? (optDone / optTotal) * 15 : 0;

  return {
    score:    Math.round(reqScore + optScore),
    reqDone,  reqTotal,
    optDone,  optTotal,
    allDone:  ALL_TASKS.filter(t => taskStates[t.id]).length,
    allTotal: ALL_TASKS.length,
  };
}

// ── Welcome Banner ────────────────────────────────────────────────
function renderWelcomeBanner(scoreData) {
  const name    = settings.customerName || null;
  const company = settings.companyName  || null;

  const nameEl = document.getElementById('welcome-name');
  const compEl = document.getElementById('welcome-company');

  if (name || company) {
    nameEl.textContent = name ? `Welcome, ${name}!` : `Welcome!`;
    compEl.textContent = company || '';
  } else {
    nameEl.textContent = 'Welcome to BuildOps!';
    compEl.textContent = 'Open Portal Setup (top right) to configure your onboarding dashboard.';
  }

  // Progress
  const pct = scoreData.allTotal > 0 ? Math.round((scoreData.allDone / scoreData.allTotal) * 100) : 0;
  document.getElementById('welcome-progress-fill').style.width = pct + '%';
  document.getElementById('welcome-progress-label').textContent = pct + '% complete';

  // Stats
  document.getElementById('wstat-tasks').textContent =
    `${scoreData.allDone} / ${scoreData.allTotal}`;

  // Days onboarding
  if (settings.startDate) {
    const start = new Date(settings.startDate);
    const today = new Date();
    const days = Math.floor((today - start) / 86400000);
    document.getElementById('wstat-start').textContent = days < 0 ? 'Upcoming' : `${days}`;
  } else {
    document.getElementById('wstat-start').textContent = '—';
  }

  // Go-live countdown
  const glCard = document.getElementById('wstat-golive-card');
  if (settings.goLiveDate) {
    const gl    = new Date(settings.goLiveDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    gl.setHours(0, 0, 0, 0);
    const diff = Math.round((gl - today) / 86400000);
    const glEl = document.getElementById('wstat-golive');
    if (diff > 0) {
      glEl.textContent = diff;
      glCard.classList.add('highlight');
    } else if (diff === 0) {
      glEl.textContent = 'Today!';
      glCard.style.background = 'rgba(16,185,129,0.12)';
      glCard.style.borderColor = 'rgba(16,185,129,0.35)';
    } else {
      glEl.textContent = 'Launched';
      glCard.style.background = 'rgba(16,185,129,0.08)';
    }
  } else {
    document.getElementById('wstat-golive').textContent = '—';
  }
}

// ── Health Score Gauge ────────────────────────────────────────────
function renderHealthScore(scoreData) {
  const { score, reqDone, reqTotal, optDone, optTotal } = scoreData;

  // Gauge arc: circumference = 2π × 50 = 314.16
  const circ  = 314.16;
  const arc   = document.getElementById('gauge-arc');
  const offset = circ * (1 - score / 100);
  arc.style.strokeDashoffset = offset;

  // Color by score
  let color, status;
  if (score >= 90)      { color = '#10b981'; status = 'Excellent — Ready for Go-Live!'; }
  else if (score >= 70) { color = '#2563eb'; status = 'On Track'; }
  else if (score >= 40) { color = '#f59e0b'; status = 'In Progress'; }
  else                  { color = '#ef4444'; status = 'Getting Started'; }

  arc.style.stroke = color;
  document.getElementById('health-score-val').textContent = score;
  document.getElementById('health-score-val').style.color = color;
  document.getElementById('health-status').textContent = status;
  document.getElementById('health-status').style.color = color;

  document.getElementById('hb-required-count').textContent = `${reqDone} / ${reqTotal}`;
  document.getElementById('hb-optional-count').textContent = `${optDone} / ${optTotal}`;
}

// ── Action Items ──────────────────────────────────────────────────
function renderActionItems() {
  const incomplete = [];

  for (const cat of TASK_CATEGORIES) {
    for (const task of cat.tasks) {
      if (task.required && !taskStates[task.id]) {
        incomplete.push({ ...task, category: cat.name, categoryColor: cat.color });
      }
    }
  }

  const list  = document.getElementById('action-list');
  const empty = document.getElementById('action-empty');
  const badge = document.getElementById('actions-count');

  list.innerHTML = '';
  badge.textContent = incomplete.length;

  if (incomplete.length === 0) {
    empty.hidden = false;
    badge.style.background = 'var(--success)';
    return;
  }

  empty.hidden = true;
  badge.style.background = '';

  // Show top 6 action items with priority
  const shown = incomplete.slice(0, 6);
  shown.forEach((task, i) => {
    const priority = i < 2 ? 'high' : i < 4 ? 'med' : 'low';
    const priorityLabel = i < 2 ? 'HIGH' : i < 4 ? 'MED' : 'LOW';

    const li = document.createElement('li');
    li.className = 'action-item';
    li.innerHTML = `
      <div class="action-num">${i + 1}</div>
      <div class="action-content">
        <div class="action-text">${escHtml(task.label)}</div>
        <div class="action-category" style="color:${task.categoryColor}">${escHtml(task.category)}</div>
      </div>
      <span class="action-priority priority-${priority}">${priorityLabel}</span>
    `;
    // Clicking an action item marks it done
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => {
      taskStates[task.id] = true;
      saveTaskStates();
      renderAll();
    });
    list.appendChild(li);
  });

  if (incomplete.length > 6) {
    const li = document.createElement('li');
    li.style.cssText = 'font-size:0.78rem;color:var(--text-muted);padding:6px 12px;';
    li.textContent = `+${incomplete.length - 6} more — see Onboarding Checklist below`;
    list.appendChild(li);
  }
}

// ── Onboarding Checklist ──────────────────────────────────────────
function renderTasks() {
  const container = document.getElementById('tasks-container');
  container.innerHTML = '';

  TASK_CATEGORIES.forEach((cat, catIdx) => {
    const done  = cat.tasks.filter(t => taskStates[t.id]).length;
    const total = cat.tasks.length;
    const pct   = Math.round((done / total) * 100);
    const isOpen = catIdx === 0; // First category open by default if fresh

    const catEl = document.createElement('div');
    catEl.className = 'task-category';
    catEl.innerHTML = `
      <div class="task-category-header" data-cat="${cat.id}">
        <div class="task-cat-left">
          <div class="task-cat-stripe" style="background:${cat.color}"></div>
          <span class="task-cat-name">${escHtml(cat.name)}</span>
        </div>
        <div class="task-cat-right">
          <span class="task-cat-progress">${done} / ${total}</span>
          <svg class="task-cat-chevron ${isOpen ? 'open' : ''}" viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
          </svg>
        </div>
      </div>
      <div class="task-cat-bar-wrap">
        <div class="task-cat-bar" style="width:${pct}%;background:${cat.color}"></div>
      </div>
      <div class="task-items ${isOpen ? 'expanded' : ''}">
        ${cat.tasks.map(task => `
          <div class="task-item ${taskStates[task.id] ? 'checked' : ''}" data-task="${task.id}">
            <div class="task-checkbox">
              <svg viewBox="0 0 24 24" fill="white" width="10" height="10">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
            </div>
            <span class="task-label">${escHtml(task.label)}</span>
            <span class="task-badge ${task.required ? 'badge-required' : 'badge-optional'}">
              ${task.required ? 'Required' : 'Optional'}
            </span>
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(catEl);
  });

  // Category toggle
  container.querySelectorAll('.task-category-header').forEach(header => {
    header.addEventListener('click', () => {
      const items   = header.closest('.task-category').querySelector('.task-items');
      const chevron = header.querySelector('.task-cat-chevron');
      const isOpen  = items.classList.contains('expanded');
      items.classList.toggle('expanded', !isOpen);
      chevron.classList.toggle('open', !isOpen);
    });
  });

  // Task item toggle
  container.querySelectorAll('.task-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.task;
      taskStates[id] = !taskStates[id];
      saveTaskStates();
      renderAll();
    });
  });
}

// ── Partners ──────────────────────────────────────────────────────
const PARTNER_DEFS = [
  { key: 'im',  role: 'Implementation Manager', color: '#2563eb', bg: '#1e3a5f' },
  { key: 'csm', role: 'Customer Success Manager', color: '#10b981', bg: '#1a3d32' },
  { key: 'ae',  role: 'Account Executive',        color: '#8b5cf6', bg: '#2d1f47' },
  { key: 'ts',  role: 'Training Specialist',      color: '#f59e0b', bg: '#3d2f0f' },
];

function renderPartners() {
  const grid = document.getElementById('partners-grid');
  grid.innerHTML = '';

  PARTNER_DEFS.forEach(def => {
    const p = settings.partners[def.key] || {};
    const hasData = !!(p.name || p.email);
    const initials = p.name
      ? p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
      : def.role.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

    const card = document.createElement('div');
    card.className = 'partner-card';
    card.innerHTML = `
      <div class="partner-role-badge" style="background:${def.bg};color:${def.color};border:1px solid ${def.color}33">
        ${escHtml(def.role)}
      </div>
      <div class="partner-identity">
        <div class="partner-avatar" style="background:${def.bg};color:${def.color};border:2px solid ${def.color}55">
          ${initials}
        </div>
        <div class="partner-info">
          ${hasData
            ? `<div class="partner-name">${escHtml(p.name || 'Unassigned')}</div>`
            : `<div class="partner-placeholder">Not yet assigned</div>`}
          ${p.email ? `<div style="font-size:0.72rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;">${escHtml(p.email)}</div>` : ''}
        </div>
      </div>
      <div class="partner-actions">
        ${p.email ? `
          <a class="partner-action-btn" href="mailto:${escAttr(p.email)}">
            <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
            Email
          </a>` : ''}
        ${p.phone ? `
          <a class="partner-action-btn" href="tel:${escAttr(p.phone.replace(/\s/g, ''))}">
            <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
            Call
          </a>` : ''}
        ${!p.email && !p.phone ? `
          <button class="partner-action-btn" onclick="document.getElementById('settings-toggle').click()">
            + Add Contact
          </button>` : ''}
      </div>
    `;
    grid.appendChild(card);
  });
}

// ── Knowledge Base ────────────────────────────────────────────────
function renderKnowledgeBase(filter) {
  const grid  = document.getElementById('kb-grid');
  const query = (filter || '').toLowerCase().trim();
  grid.innerHTML = '';

  const filtered = query
    ? KB_ARTICLES.filter(a =>
        a.title.toLowerCase().includes(query) ||
        a.desc.toLowerCase().includes(query) ||
        a.tags.some(tag => tag.includes(query))
      )
    : KB_ARTICLES;

  filtered.forEach(article => {
    const card = document.createElement('a');
    card.className = 'kb-card';
    card.href   = article.url;
    card.target = '_blank';
    card.rel    = 'noopener noreferrer';
    card.innerHTML = `
      <div class="kb-card-icon" style="background:${article.color}18;color:${article.color};font-size:1.1rem">
        ${article.icon}
      </div>
      <div class="kb-card-title">${escHtml(article.title)}</div>
      <div class="kb-card-desc">${escHtml(article.desc)}</div>
    `;
    grid.appendChild(card);
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:span 3;font-size:0.82rem;color:var(--text-muted);padding:12px 0;">No articles match "${escHtml(query)}" — <a href="https://help.buildops.com" target="_blank" style="color:var(--accent)">search the full Help Center ↗</a></div>`;
  }
}

// ── Announcements ─────────────────────────────────────────────────
function renderAnnouncements() {
  const list = document.getElementById('announcement-list');
  list.innerHTML = '';

  ANNOUNCEMENTS.forEach(ann => {
    const card = document.createElement('div');
    card.className = 'announcement-card';
    card.innerHTML = `
      <div class="ann-header">
        <span class="ann-tag ann-tag-${ann.type}">${escHtml(ann.tag)}</span>
        <span class="ann-date">${escHtml(ann.date)}</span>
      </div>
      <div class="ann-title">${escHtml(ann.title)}</div>
      <div class="ann-desc">${escHtml(ann.desc)}</div>
    `;
    list.appendChild(card);
  });
}

// ── Quick Links ───────────────────────────────────────────────────
function renderQuickLinks() {
  const row = document.getElementById('quick-links-row');
  row.innerHTML = '';

  QUICK_LINKS.forEach(link => {
    const a = document.createElement('a');
    a.className = 'quick-link-btn';
    a.href   = link.url;
    a.target = link.url.startsWith('http') ? '_blank' : '_self';
    a.rel    = 'noopener noreferrer';
    a.innerHTML = `
      <div class="quick-link-icon" style="background:${link.color}18;font-size:1rem">
        ${link.icon}
      </div>
      ${escHtml(link.label)}
    `;
    row.appendChild(a);
  });
}

// ── Event Listeners ───────────────────────────────────────────────
function setupEventListeners() {
  // Settings modal open / close
  document.getElementById('settings-toggle').addEventListener('click', openSettingsModal);
  document.getElementById('modal-close').addEventListener('click', closeSettingsModal);
  document.getElementById('modal-cancel').addEventListener('click', closeSettingsModal);
  document.getElementById('modal-save').addEventListener('click', handleSaveSettings);
  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSettingsModal();
  });

  // Partners edit button
  document.getElementById('partners-edit-btn').addEventListener('click', openSettingsModal);

  // Reset tasks
  document.getElementById('reset-tasks-btn').addEventListener('click', () => {
    if (confirm('Reset all task checkboxes? This cannot be undone.')) {
      taskStates = {};
      saveTaskStates();
      renderAll();
    }
  });

  // KB search
  const kbSearch = document.getElementById('kb-search');
  let kbTimer;
  kbSearch.addEventListener('input', () => {
    clearTimeout(kbTimer);
    kbTimer = setTimeout(() => renderKnowledgeBase(kbSearch.value), 200);
  });
}

// ── Settings Modal ────────────────────────────────────────────────
function openSettingsModal() {
  // Populate form fields
  setVal('s-customer-name', settings.customerName);
  setVal('s-company-name',  settings.companyName);
  setVal('s-start-date',    settings.startDate);
  setVal('s-golive-date',   settings.goLiveDate);

  const p = settings.partners;
  setVal('s-im-name',  p.im.name);   setVal('s-im-email',  p.im.email);  setVal('s-im-phone',  p.im.phone);
  setVal('s-csm-name', p.csm.name);  setVal('s-csm-email', p.csm.email); setVal('s-csm-phone', p.csm.phone);
  setVal('s-ae-name',  p.ae.name);   setVal('s-ae-email',  p.ae.email);  setVal('s-ae-phone',  p.ae.phone);
  setVal('s-ts-name',  p.ts.name);   setVal('s-ts-email',  p.ts.email);  setVal('s-ts-phone',  p.ts.phone);

  document.getElementById('settings-modal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSettingsModal() {
  document.getElementById('settings-modal').hidden = true;
  document.body.style.overflow = '';
}

function handleSaveSettings() {
  settings.customerName = getVal('s-customer-name');
  settings.companyName  = getVal('s-company-name');
  settings.startDate    = getVal('s-start-date');
  settings.goLiveDate   = getVal('s-golive-date');

  settings.partners.im.name  = getVal('s-im-name');
  settings.partners.im.email = getVal('s-im-email');
  settings.partners.im.phone = getVal('s-im-phone');

  settings.partners.csm.name  = getVal('s-csm-name');
  settings.partners.csm.email = getVal('s-csm-email');
  settings.partners.csm.phone = getVal('s-csm-phone');

  settings.partners.ae.name  = getVal('s-ae-name');
  settings.partners.ae.email = getVal('s-ae-email');
  settings.partners.ae.phone = getVal('s-ae-phone');

  settings.partners.ts.name  = getVal('s-ts-name');
  settings.partners.ts.email = getVal('s-ts-email');
  settings.partners.ts.phone = getVal('s-ts-phone');

  saveSettings();
  closeSettingsModal();
  renderAll();
}

// ── Helpers ───────────────────────────────────────────────────────
function getVal(id)      { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val || ''; }

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
