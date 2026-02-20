const JIRA_DOMAIN = 'buildops.atlassian.net';
const PROXY_URL   = 'https://jira-proxy.shrimpwheels.workers.dev';

// Known org-wide custom field IDs (same across all BuildOps Jira projects)
const CF = {
  customer:      'customfield_10297',
  tenantId:      'customfield_11388', // array type
  segment:       'customfield_12016', // { value }
  // REPORTING-specific
  reportingType: 'customfield_14840', // { value }
  custStatus:    'customfield_12444', // { value }
  psEnv:         'customfield_11785', // { value }
  department:    'customfield_10596', // { value }
};

// Which section to show for each ticket type
const SECTIONS = {
  REPORTING:    'REPORTING',
  DT:           'DT',
  SIP_QUESTION: 'SIP',
  SIP_FER:      'SIP',
  DV:           'DV',
  BUOP:         'BUOP',
};

// ─── Field meta cache ─────────────────────────────────────────────────────────

const metaCache = {};

async function getFieldMeta(projectKey, issueTypeName, credentials) {
  const cacheKey = `${projectKey}:${issueTypeName}`;
  if (metaCache[cacheKey]) return metaCache[cacheKey];

  try {
    const url = `${PROXY_URL}/rest/api/3/issue/createmeta`
              + `?projectKeys=${encodeURIComponent(projectKey)}`
              + `&issuetypeNames=${encodeURIComponent(issueTypeName)}`
              + `&expand=projects.issuetypes.fields`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Basic ${credentials}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return {};

    const data   = await res.json();
    const fields = data.projects?.[0]?.issuetypes?.[0]?.fields || {};

    // Build lowercase-name → { id, schema, allowedValues, ... } lookup
    const lookup = {};
    for (const [id, field] of Object.entries(fields)) {
      const name = field.name?.toLowerCase();
      if (name) lookup[name] = { id, ...field };
    }

    metaCache[cacheKey] = lookup;
    return lookup;
  } catch {
    return {};
  }
}

function findId(meta, ...names) {
  for (const name of names) {
    const hit = meta[name.toLowerCase()];
    if (hit) return hit.id;
  }
  return null;
}

// ─── ADF helpers ──────────────────────────────────────────────────────────────

function adfDoc(content) {
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

function adfParagraph(text) {
  if (!text) return { type: 'paragraph', content: [] };
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function adfHeading(text, level = 3) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}

function adfTable(rows) {
  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: rows.map(([label, value]) => ({
      type: 'tableRow',
      content: [
        {
          type: 'tableHeader', attrs: {},
          content: [{ type: 'paragraph', content: [{ type: 'text', text: label, marks: [{ type: 'strong' }] }] }],
        },
        {
          type: 'tableCell', attrs: {},
          content: [adfParagraph(value || '—')],
        },
      ],
    })),
  };
}

// ─── General helpers ──────────────────────────────────────────────────────────

function val(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function makeCredentials(email, token) {
  return btoa(`${email}:${token}`);
}

function showStatus(id, html, type) {
  const el = document.getElementById(id);
  el.innerHTML  = html;
  el.className  = type;
  el.style.display = '';
}

function hideStatus(id) {
  const el = document.getElementById(id);
  el.style.display = 'none';
  el.className = '';
}

function setSelect(id, value) {
  if (!value) return;
  const el = document.getElementById(id);
  if (!el) return;
  // Exact match first
  for (const opt of el.options) {
    if (opt.value.toLowerCase() === value.toLowerCase()) { el.value = opt.value; return; }
  }
  // Partial match
  for (const opt of el.options) {
    if (opt.value.toLowerCase().includes(value.toLowerCase())) { el.value = opt.value; return; }
  }
}

function cleanFields(fields) {
  for (const k of Object.keys(fields)) {
    if (fields[k] === undefined || fields[k] === null || fields[k] === '') delete fields[k];
    if (Array.isArray(fields[k]) && fields[k].length === 0) delete fields[k];
  }
  return fields;
}

// ─── Payload builders ─────────────────────────────────────────────────────────

async function buildREPORTING(settings) {
  const summary  = val('summary');
  const taskType = val('r-task-type');
  const customer = val('r-customer');
  const tenantId = val('r-tenant-id');
  const segment  = val('r-segment');
  const status   = val('r-status');
  const env      = val('r-env');
  const dept     = val('r-dept');
  const desc     = val('r-description');

  const metaRows = [
    ['Reporting Task Type', taskType],
    ['Customer',            customer],
    ['Tenant ID',           tenantId],
    ['Customer Segment',    segment],
    ['Customer Status',     status],
    ['PS Environment',      env],
    ['Department',          dept],
  ].filter(([, v]) => v);

  const adfContent = [];
  if (metaRows.length) adfContent.push(adfTable(metaRows));
  if (desc)            adfContent.push(adfParagraph(desc));

  const fields = {
    project:     { key: 'REPORTING' },
    summary,
    issuetype:   { name: 'Task' },
    description: adfDoc(adfContent),
    [CF.reportingType]: taskType  ? { value: taskType } : undefined,
    [CF.customer]:      customer  || undefined,
    [CF.tenantId]:      tenantId  ? [tenantId] : undefined,
    [CF.segment]:       segment   ? { value: segment } : undefined,
    [CF.custStatus]:    status    ? { value: status }  : undefined,
    [CF.psEnv]:         env       ? { value: env }     : undefined,
    [CF.department]:    dept      ? { value: dept }    : undefined,
  };

  if (settings.accountId) fields.assignee = { accountId: settings.accountId };
  return { fields: cleanFields(fields) };
}

async function buildDT(settings) {
  const credentials = makeCredentials(settings.email, settings.token);
  const meta        = await getFieldMeta('DT', 'Task', credentials);

  const summary  = val('summary');
  const customer = val('dt-customer');
  const tenantId = val('dt-tenant-id');
  const segment  = val('dt-segment');
  const taskType = val('dt-task-type');
  const empCount = val('dt-employee-count');
  const priority = val('dt-priority');
  const urgency  = val('dt-urgency');
  const delivery = val('dt-delivery-date');
  const desc     = val('dt-description');

  const metaRows = [
    ['Customer',               customer],
    ['Tenant ID',              tenantId],
    ['Customer Segment',       segment],
    ['Data Task Type',         taskType],
    ['Employee Count',         empCount],
    ['Business Impact',        priority],
    ['Urgency',                urgency],
    ['Customer Delivery Date', delivery],
  ].filter(([, v]) => v);

  const adfContent = [];
  if (metaRows.length) adfContent.push(adfTable(metaRows));
  if (desc) { adfContent.push(adfHeading('Task Description')); adfContent.push(adfParagraph(desc)); }

  const fields = {
    project:     { key: 'DT' },
    summary,
    issuetype:   { name: 'Task' },
    description: adfDoc(adfContent),
    [CF.customer]: customer || undefined,
    [CF.tenantId]: tenantId ? [tenantId] : undefined,
    [CF.segment]:  segment  ? { value: segment } : undefined,
  };

  // Discovered custom fields
  const dtTaskTypeId  = findId(meta, 'data task type', 'task type');
  const empCountId    = findId(meta, 'employee count');
  const urgencyId     = findId(meta, 'urgency');
  const deliveryId    = findId(meta, 'customer delivery date', 'delivery date');

  if (dtTaskTypeId && taskType)  fields[dtTaskTypeId] = { value: taskType };
  if (empCountId   && empCount)  fields[empCountId]   = { value: empCount };
  if (urgencyId    && urgency)   fields[urgencyId]    = { value: urgency };
  if (delivery) {
    if (deliveryId) fields[deliveryId] = delivery;
    else            fields.duedate     = delivery;
  }
  if (priority) fields.priority = { name: priority };
  if (settings.accountId) fields.assignee = { accountId: settings.accountId };

  return { fields: cleanFields(fields) };
}

async function buildSIP(ticketType, settings) {
  const credentials = makeCredentials(settings.email, settings.token);
  const issueType   = ticketType === 'SIP_QUESTION' ? 'Product Question' : 'Feature Escalation Request';
  const meta        = await getFieldMeta('SIP', issueType, credentials);

  const summary  = val('summary');
  const customer = val('sip-customer');
  const problem  = val('sip-problem');
  const context  = val('sip-context');
  const impact   = val('sip-impact');
  const tried    = val('sip-tried');
  const refLink  = val('sip-ref-link');

  const adfContent = [];
  if (customer) adfContent.push(adfTable([['Customer', customer]]));

  const sections = [
    ['Problem Statement',          problem],
    ['Customer Context',           context],
    ['Impact & Urgency',           impact],
    ['What Has Already Been Tried', tried],
    ['Reference Document / Link',  refLink],
  ].filter(([, v]) => v);

  for (const [heading, text] of sections) {
    adfContent.push(adfHeading(heading));
    adfContent.push(adfParagraph(text));
  }

  const fields = {
    project:     { key: 'SIP' },
    summary,
    issuetype:   { name: issueType },
    description: adfDoc(adfContent),
  };

  // Try to map to discovered custom fields if they exist
  const problemId = findId(meta, 'problem statement');
  const contextId = findId(meta, 'customer context');
  const impactId  = findId(meta, 'impact & urgency', 'impact and urgency', 'impact');
  const triedId   = findId(meta, 'what has already been tried', 'already tried');

  if (problemId && problem)  fields[problemId] = problem;
  if (contextId && context)  fields[contextId] = context;
  if (impactId  && impact)   fields[impactId]  = impact;
  if (triedId   && tried)    fields[triedId]   = tried;
  if (customer)              fields[CF.customer] = customer;
  if (settings.accountId)    fields.assignee = { accountId: settings.accountId };

  return { fields: cleanFields(fields) };
}

async function buildDV(settings) {
  const credentials = makeCredentials(settings.email, settings.token);
  const meta        = await getFieldMeta('DV', 'Task', credentials);

  const summary    = val('summary');
  const ticketType = val('dv-ticket-type');
  const desc       = val('dv-description');

  const adfContent = [];
  if (ticketType) adfContent.push(adfTable([['Ticket Type', ticketType]]));
  if (desc) { adfContent.push(adfHeading('Details')); adfContent.push(adfParagraph(desc)); }

  const fields = {
    project:     { key: 'DV' },
    summary,
    issuetype:   { name: 'Task' },
    description: adfDoc(adfContent),
  };

  const ttId = findId(meta, 'ticket type', 'type');
  if (ttId && ticketType) fields[ttId] = { value: ticketType };
  if (settings.accountId) fields.assignee = { accountId: settings.accountId };

  return { fields: cleanFields(fields) };
}

async function buildBUOP(settings) {
  const credentials = makeCredentials(settings.email, settings.token);
  const meta        = await getFieldMeta('BUOP', 'Bug', credentials);

  const summary    = val('summary');
  const squad      = val('buop-squad');
  const severity   = val('buop-severity');
  const priority   = val('buop-priority');
  const tenantName = val('buop-tenant-name');
  const tenantId   = val('buop-tenant-id');
  const issueDesc  = val('buop-issue-desc');
  const steps      = val('buop-steps');
  const expected   = val('buop-expected');
  const actual     = val('buop-actual');

  const metaRows = [
    ['Tenant Name', tenantName],
    ['Tenant ID',   tenantId],
    ['Squad',       squad],
    ['Severity',    severity],
  ].filter(([, v]) => v);

  const adfContent = [];
  if (metaRows.length) adfContent.push(adfTable(metaRows));

  for (const [heading, text] of [
    ['Issue Description',  issueDesc],
    ['Steps to Reproduce', steps],
    ['Expected Behaviour', expected],
    ['Actual Behaviour',   actual],
  ].filter(([, v]) => v)) {
    adfContent.push(adfHeading(heading));
    adfContent.push(adfParagraph(text));
  }

  const fields = {
    project:     { key: 'BUOP' },
    summary,
    issuetype:   { name: 'Bug' },
    description: adfDoc(adfContent),
  };

  if (priority) fields.priority = { name: priority };
  if (tenantId) fields[CF.tenantId] = [tenantId];

  // Discovered squad field (may be multi-select)
  const squadId    = findId(meta, 'squad');
  const severityId = findId(meta, 'severity');
  if (squadId && squad) {
    const isArray = meta['squad']?.schema?.type === 'array';
    fields[squadId] = isArray ? [{ value: squad }] : { value: squad };
  }
  if (severityId && severity) fields[severityId] = { value: severity };
  if (settings.accountId) fields.assignee = { accountId: settings.accountId };

  return { fields: cleanFields(fields) };
}

// ─── DOMContentLoaded ─────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  // Restore saved settings
  const saved = JSON.parse(localStorage.getItem('jiraSettings') || '{}');
  if (saved.email) document.getElementById('jira-email').value = saved.email;
  if (saved.token) document.getElementById('jira-token').value = saved.token;

  if (saved.email && saved.token) {
    document.getElementById('settings-section').removeAttribute('open');
    const name = saved.displayName ? ` (${saved.displayName})` : '';
    showStatus('settings-status', `Logged in as ${saved.email}${name}`, 'success');
  } else {
    document.getElementById('settings-section').setAttribute('open', '');
  }

  // Hide form until a type is selected
  document.getElementById('ticket-form').style.display = 'none';

  // URL param pre-fill
  const p = new URLSearchParams(window.location.search);

  // Ticket type
  const typeParam = p.get('type');
  if (typeParam && document.querySelector(`#ticket-type option[value="${typeParam}"]`)) {
    document.getElementById('ticket-type').value = typeParam;
    showSection(typeParam);
    prefillFields(p, typeParam);
  }
});

// ─── Ticket type switching ────────────────────────────────────────────────────

document.getElementById('ticket-type').addEventListener('change', (e) => {
  const type = e.target.value;
  showSection(type);

  // Kick off createmeta prefetch in background (warms cache before submit)
  const saved = JSON.parse(localStorage.getItem('jiraSettings') || '{}');
  if (saved.email && saved.token) {
    const credentials = makeCredentials(saved.email, saved.token);
    const prefetchMap = {
      DT:           ['DT',   'Task'],
      SIP_QUESTION: ['SIP',  'Product Question'],
      SIP_FER:      ['SIP',  'Feature Escalation Request'],
      DV:           ['DV',   'Task'],
      BUOP:         ['BUOP', 'Bug'],
    };
    if (prefetchMap[type]) {
      getFieldMeta(...prefetchMap[type], credentials); // fire-and-forget
    }
  }
});

function showSection(type) {
  // Hide all sections
  document.querySelectorAll('.ticket-section').forEach(s => s.style.display = 'none');

  const sectionId = SECTIONS[type];
  if (!sectionId) return;

  document.getElementById(`section-${sectionId}`).style.display = '';
  document.getElementById('ticket-form').style.display = '';
}

// ─── URL param pre-fill ───────────────────────────────────────────────────────

function prefillFields(p, type) {
  // Common
  if (p.get('summary')) document.getElementById('summary').value = p.get('summary');

  if (type === 'REPORTING') {
    setSelect('r-task-type', p.get('taskType'));
    if (p.get('description')) document.getElementById('r-description').value = p.get('description');
    if (p.get('customer'))    document.getElementById('r-customer').value    = p.get('customer');
    if (p.get('tenantId'))    document.getElementById('r-tenant-id').value   = p.get('tenantId');
    setSelect('r-segment', p.get('segment'));
    setSelect('r-status',  p.get('status'));
    setSelect('r-env',     p.get('env'));
    setSelect('r-dept',    p.get('dept'));
  }

  if (type === 'DT') {
    if (p.get('customer'))    document.getElementById('dt-customer').value     = p.get('customer');
    if (p.get('tenantId'))    document.getElementById('dt-tenant-id').value    = p.get('tenantId');
    setSelect('dt-segment',       p.get('segment'));
    setSelect('dt-task-type',     p.get('dtTaskType'));
    setSelect('dt-employee-count',p.get('employeeCount'));
    setSelect('dt-priority',      p.get('dtPriority'));
    setSelect('dt-urgency',       p.get('dtUrgency'));
    if (p.get('dtDelivery'))  document.getElementById('dt-delivery-date').value = p.get('dtDelivery');
    if (p.get('description')) document.getElementById('dt-description').value   = p.get('description');
  }

  if (type === 'SIP_QUESTION' || type === 'SIP_FER') {
    if (p.get('customer'))   document.getElementById('sip-customer').value  = p.get('customer');
    if (p.get('sipProblem')) document.getElementById('sip-problem').value   = p.get('sipProblem');
    if (p.get('sipContext')) document.getElementById('sip-context').value   = p.get('sipContext');
    if (p.get('sipImpact'))  document.getElementById('sip-impact').value    = p.get('sipImpact');
    if (p.get('sipTried'))   document.getElementById('sip-tried').value     = p.get('sipTried');
    if (p.get('sipRef'))     document.getElementById('sip-ref-link').value  = p.get('sipRef');
  }

  if (type === 'DV') {
    setSelect('dv-ticket-type', p.get('dvTicketType'));
    if (p.get('description')) document.getElementById('dv-description').value = p.get('description');
  }

  if (type === 'BUOP') {
    if (p.get('squad'))      document.getElementById('buop-squad').value      = p.get('squad');
    setSelect('buop-severity', p.get('severity'));
    setSelect('buop-priority', p.get('priority'));
    if (p.get('tenantName')) document.getElementById('buop-tenant-name').value = p.get('tenantName');
    if (p.get('tenantId'))   document.getElementById('buop-tenant-id').value   = p.get('tenantId');
    if (p.get('issueDesc'))  document.getElementById('buop-issue-desc').value  = p.get('issueDesc');
    if (p.get('steps'))      document.getElementById('buop-steps').value       = p.get('steps');
    if (p.get('expected'))   document.getElementById('buop-expected').value    = p.get('expected');
    if (p.get('actual'))     document.getElementById('buop-actual').value      = p.get('actual');
  }
}

// ─── Save settings ────────────────────────────────────────────────────────────

document.getElementById('save-settings').addEventListener('click', async () => {
  const email = document.getElementById('jira-email').value.trim();
  const token = document.getElementById('jira-token').value.trim();

  if (!email || !token) {
    showStatus('settings-status', 'Please enter your email and API token.', 'error');
    return;
  }

  const btn = document.getElementById('save-settings');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    const credentials = makeCredentials(email, token);
    const res = await fetch(`${PROXY_URL}/rest/api/3/myself`, {
      headers: { 'Authorization': `Basic ${credentials}`, 'Accept': 'application/json' },
    });

    if (!res.ok) {
      showStatus('settings-status', 'Could not verify credentials. Check your email and token.', 'error');
      return;
    }

    const me          = await res.json();
    const accountId   = me.accountId;
    const displayName = me.displayName || email;

    localStorage.setItem('jiraSettings', JSON.stringify({ email, token, accountId, displayName }));
    showStatus('settings-status', `Logged in as ${displayName}`, 'success');
    document.getElementById('settings-section').removeAttribute('open');
  } catch (err) {
    showStatus('settings-status', `Save failed: ${err.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save Settings';
  }
});

// ─── Form submit ──────────────────────────────────────────────────────────────

document.getElementById('ticket-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const settings = JSON.parse(localStorage.getItem('jiraSettings') || '{}');
  if (!settings.email || !settings.token) {
    showStatus('result', 'Please save your email and API token in Settings first.', 'error');
    document.getElementById('settings-section').setAttribute('open', '');
    return;
  }

  const ticketType = document.getElementById('ticket-type').value;
  if (!ticketType) {
    showStatus('result', 'Please select a ticket type.', 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled    = true;
  btn.textContent = 'Creating…';
  hideStatus('result');

  try {
    let payload;
    switch (ticketType) {
      case 'REPORTING':    payload = await buildREPORTING(settings);        break;
      case 'DT':           payload = await buildDT(settings);               break;
      case 'SIP_QUESTION':
      case 'SIP_FER':      payload = await buildSIP(ticketType, settings);  break;
      case 'DV':           payload = await buildDV(settings);               break;
      case 'BUOP':         payload = await buildBUOP(settings);             break;
      default:
        showStatus('result', 'Unknown ticket type.', 'error');
        return;
    }

    const credentials = makeCredentials(settings.email, settings.token);
    const res = await fetch(`${PROXY_URL}/rest/api/3/issue`, {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (res.ok) {
      const url = `https://${JIRA_DOMAIN}/browse/${data.key}`;
      showStatus('result', `Ticket created! <a href="${url}" target="_blank">${data.key} →</a>`, 'success');
      document.getElementById('ticket-form').reset();
      document.getElementById('ticket-form').style.display = 'none';
      document.getElementById('ticket-type').value = '';
    } else {
      const msg = data.errorMessages?.join(', ') || JSON.stringify(data.errors) || 'Unknown error';
      showStatus('result', `Error: ${msg}`, 'error');
    }
  } catch (err) {
    showStatus('result', `Request failed: ${err.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Create Ticket';
  }
});
