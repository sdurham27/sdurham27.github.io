const JIRA_DOMAIN  = 'buildops.atlassian.net';
const JIRA_PROJECT = 'REPORTING';
const PROXY_URL    = 'https://jira-proxy.shrimpwheels.workers.dev';

// Load saved settings on page load
window.addEventListener('DOMContentLoaded', () => {
  const saved = JSON.parse(localStorage.getItem('jiraSettings') || '{}');
  if (saved.email) document.getElementById('jira-email').value = saved.email;
  if (saved.token) document.getElementById('jira-token').value = saved.token;

  // If settings exist, collapse the settings panel
  if (saved.email && saved.token) {
    document.getElementById('settings-section').removeAttribute('open');
    showStatus('settings-status', `Logged in as ${saved.email}`, 'success');
  } else {
    document.getElementById('settings-section').setAttribute('open', '');
  }
});

// Save settings
document.getElementById('save-settings').addEventListener('click', () => {
  const email = document.getElementById('jira-email').value.trim();
  const token = document.getElementById('jira-token').value.trim();

  if (!email || !token) {
    showStatus('settings-status', 'Please enter your email and API token.', 'error');
    return;
  }

  localStorage.setItem('jiraSettings', JSON.stringify({ email, token }));
  showStatus('settings-status', `Logged in as ${email}`, 'success');
  document.getElementById('settings-section').removeAttribute('open');
});

// Submit ticket
document.getElementById('ticket-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const settings = JSON.parse(localStorage.getItem('jiraSettings') || '{}');
  if (!settings.email || !settings.token) {
    showStatus('result', 'Please fill in and save your email and API token first.', 'error');
    document.getElementById('settings-section').setAttribute('open', '');
    return;
  }

  const summary         = document.getElementById('summary').value.trim();
  const taskType        = document.getElementById('reporting-task-type').value;
  const description     = document.getElementById('description').value.trim();
  const customer        = document.getElementById('customer').value.trim();
  const tenantId        = document.getElementById('tenant-id').value.trim();
  const segment         = document.getElementById('customer-segment').value;
  const custStatus      = document.getElementById('customer-status').value;
  const psEnv           = document.getElementById('ps-environment').value;
  const department      = document.getElementById('department').value;

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  hideStatus('result');

  try {
    const credentials = btoa(`${settings.email}:${settings.token}`);
    const url = `${PROXY_URL}/rest/api/3/issue`;

    // Build metadata rows for the description
    const metaRows = [
      ['Reporting Task Type', taskType],
      ['Customer',            customer],
      ['Tenant ID',           tenantId],
      ['Customer Segment',    segment],
      ['Customer Status',     custStatus],
      ['PS Environment',      psEnv],
      ['Department',          department],
    ].filter(([, v]) => v); // omit blank fields

    // ADF content blocks
    const adfContent = [];

    if (metaRows.length) {
      // Table for metadata
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

    const body = {
      fields: {
        project:   { key: JIRA_PROJECT },
        summary:   summary,
        issuetype: { name: 'Task' },
        description: {
          type: 'doc',
          version: 1,
          content: adfContent.length ? adfContent : [{ type: 'paragraph', content: [] }]
        }
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json'
      },
      body: JSON.stringify(body)
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
