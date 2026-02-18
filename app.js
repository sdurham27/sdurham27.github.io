const JIRA_DOMAIN  = 'buildops.atlassian.net';
const JIRA_PROJECT = 'REPORTING';

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

  const summary     = document.getElementById('summary').value.trim();
  const description = document.getElementById('description').value.trim();
  const issueType   = document.getElementById('issue-type').value;
  const priority    = document.getElementById('priority').value;

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  hideStatus('result');

  try {
    const credentials = btoa(`${settings.email}:${settings.token}`);
    const url = `https://${JIRA_DOMAIN}/rest/api/3/issue`;

    const body = {
      fields: {
        project:   { key: JIRA_PROJECT },
        summary:   summary,
        issuetype: { name: issueType },
        priority:  { name: priority },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: description
                ? [{ type: 'text', text: description }]
                : []
            }
          ]
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
  el.innerHTML = message;
  el.className = type;
}

function hideStatus(id) {
  const el = document.getElementById(id);
  el.style.display = 'none';
  el.className = '';
}
