const JIRA_DOMAIN  = 'buildops.atlassian.net';
const JIRA_PROJECT = 'REPORTING';
const PROXY_URL    = 'https://jira-proxy.shrimpwheels.workers.dev';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showStatus(id, message, type) {
  const el = document.getElementById(id);
  el.style.display = '';
  el.innerHTML = message;
  el.className = type;
}

function hideStatus(id) {
  const el = document.getElementById(id);
  el.style.display = 'none';
  el.className = '';
}

function makeCredentials(email, token) {
  return btoa(`${email}:${token}`);
}

// Sets a <select> value; silently ignores if the value isn't a valid option.
function setSelect(id, value) {
  if (!value) return;
  const el = document.getElementById(id);
  for (const opt of el.options) {
    if (opt.value.toLowerCase() === value.toLowerCase()) {
      el.value = opt.value;
      return;
    }
  }
  // Fallback: try a partial match (case-insensitive contains)
  for (const opt of el.options) {
    if (opt.value.toLowerCase().includes(value.toLowerCase())) {
      el.value = opt.value;
      return;
    }
  }
}

// ─── On load ─────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  // Restore saved credentials
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

  // Pre-fill from URL params (Glean integration)
  const params = new URLSearchParams(window.location.search);

  const textMap = {
    summary:     'summary',
    description: 'description',
    customer:    'customer',
    tenantId:    'tenant-id',
  };
  for (const [param, id] of Object.entries(textMap)) {
    const val = params.get(param);
    if (val) document.getElementById(id).value = val;
  }

  const selectMap = {
    taskType: 'reporting-task-type',
    segment:  'customer-segment',
    status:   'customer-status',
    env:      'ps-environment',
    dept:     'department',
  };
  for (const [param, id] of Object.entries(selectMap)) {
    setSelect(id, params.get(param));
  }
});

// ─── Save settings (fetches Jira accountId) ──────────────────────────────────

document.getElementById('save-settings').addEventListener('click', async () => {
  const email = document.getElementById('jira-email').value.trim();
  const token = document.getElementById('jira-token').value.trim();

  if (!email || !token) {
    showStatus('settings-status', 'Please enter your email and API token.', 'error');
    return;
  }

  const btn = document.getElementById('save-settings');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const credentials = makeCredentials(email, token);
    const res = await fetch(`${PROXY_URL}/rest/api/3/myself`, {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Accept':        'application/json',
      },
    });

    if (!res.ok) {
      showStatus('settings-status', 'Could not verify credentials. Check your email and token.', 'error');
      return;
    }

    const me = await res.json();
    const accountId   = me.accountId;
    const displayName = me.displayName || email;

    localStorage.setItem('jiraSettings', JSON.stringify({ email, token, accountId, displayName }));
    showStatus('settings-status', `Logged in as ${displayName}`, 'success');
    document.getElementById('settings-section').removeAttribute('open');
  } catch (err) {
    showStatus('settings-status', `Save failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Settings';
  }
});

// ─── Submit ticket ────────────────────────────────────────────────────────────

document.getElementById('ticket-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const settings = JSON.parse(localStorage.getItem('jiraSettings') || '{}');
  if (!settings.email || !settings.token) {
    showStatus('result', 'Please fill in and save your email and API token first.', 'error');
    document.getElementById('settings-section').setAttribute('open', '');
    return;
  }

  const summary     = document.getElementById('summary').value.trim();
  const taskType    = document.getElementById('reporting-task-type').value;
  const description = document.getElementById('description').value.trim();
  const customer    = document.getElementById('customer').value.trim();
  const tenantId    = document.getElementById('tenant-id').value.trim();
  const segment     = document.getElementById('customer-segment').value;
  const custStatus  = document.getElementById('customer-status').value;
  const psEnv       = document.getElementById('ps-environment').value;
  const department  = document.getElementById('department').value;

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  hideStatus('result');

  try {
    const credentials = makeCredentials(settings.email, settings.token);
    const url = `${PROXY_URL}/rest/api/3/issue`;

    // Build metadata rows for the description table
    const metaRows = [
      ['Reporting Task Type', taskType],
      ['Customer',            customer],
      ['Tenant ID',           tenantId],
      ['Customer Segment',    segment],
      ['Customer Status',     custStatus],
      ['PS Environment',      psEnv],
      ['Department',          department],
    ].filter(([, v]) => v);

    const adfContent = [];

    if (metaRows.length) {
      adfContent.push({
        type: 'table',
        attrs: { isNumberColumnEnabled: false, layout: 'default' },
        content: metaRows.map(([label, value]) => ({
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              attrs: {},
              content: [{ type: 'paragraph', content: [{ type: 'text', text: label, marks: [{ type: 'strong' }] }] }]
            },
            {
              type: 'tableCell',
              attrs: {},
              content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }]
            }
          ]
        }))
      });
    }

    if (description) {
      adfContent.push({
        type: 'paragraph',
        content: [{ type: 'text', text: description }]
      });
    }

    const fields = {
      project:   { key: JIRA_PROJECT },
      summary:   summary,
      issuetype: { name: 'Task' },
      description: {
        type: 'doc',
        version: 1,
        content: adfContent.length ? adfContent : [{ type: 'paragraph', content: [] }]
      },
      customfield_14840: { value: taskType },
      customfield_10297: customer,
      customfield_11388: tenantId ? [tenantId] : [],
      customfield_12016: { value: segment },
      customfield_12444: { value: custStatus },
      customfield_11785: { value: psEnv },
      customfield_10596: { value: department },
    };

    // Assign to the person creating the ticket
    if (settings.accountId) {
      fields.assignee = { accountId: settings.accountId };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json'
      },
      body: JSON.stringify({ fields })
    });

    const data = await response.json();

    if (response.ok) {
      const ticketUrl = `https://${JIRA_DOMAIN}/browse/${data.key}`;
      showStatus('result', `Ticket created! <a href="${ticketUrl}" target="_blank">${data.key} →</a>`, 'success');
      document.getElementById('ticket-form').reset();
    } else {
      const message = data.errorMessages?.join(', ') || JSON.stringify(data.errors) || 'Unknown error';
      showStatus('result', `Error: ${message}`, 'error');
    }
  } catch (err) {
    showStatus('result', `Request failed: ${err.message}. Check your email and API token.`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Ticket';
  }
});
