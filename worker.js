const JIRA_BASE      = 'https://buildops.atlassian.net';
const ALLOWED_ORIGIN = 'https://sdurham27.github.io';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
};

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    const url      = new URL(request.url);
    const jiraUrl  = `${JIRA_BASE}${url.pathname}`;
    const body     = await request.text();

    const jiraResponse = await fetch(jiraUrl, {
      method: 'POST',
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body,
    });

    const responseBody = await jiraResponse.text();

    return new Response(responseBody, {
      status:  jiraResponse.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },
};
