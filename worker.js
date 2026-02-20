const JIRA_BASE      = 'https://buildops.atlassian.net';
const ALLOWED_ORIGIN = 'https://sdurham27.github.io';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Glean-Backend, X-Scio-Actas',
};

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    // -------------------------------------------------------------------
    // Route /glean/* → Glean backend
    //
    // The caller passes the Glean backend hostname via X-Glean-Backend so
    // the worker can forward to the right tenant without hardcoding it.
    // Example: /glean/api/v1/chat  →  https://buildops-be.glean.com/api/v1/chat
    // -------------------------------------------------------------------
    if (path.startsWith('/glean/')) {
      const gleanBackend = request.headers.get('X-Glean-Backend') || 'buildops-be.glean.com';
      const gleanPath    = path.slice('/glean'.length);   // keep leading /
      const gleanUrl     = `https://${gleanBackend}${gleanPath}${url.search}`;
      const auth         = request.headers.get('Authorization') || '';
      const actAs        = request.headers.get('X-Scio-Actas')  || '';
      const body         = request.method !== 'GET' ? await request.text() : undefined;

      const upstreamHeaders = {
        'Authorization': auth,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      };
      if (actAs) upstreamHeaders['X-Scio-Actas'] = actAs;

      let upstream;
      try {
        upstream = await fetch(gleanUrl, {
          method: request.method,
          headers: upstreamHeaders,
          body,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Worker fetch failed', detail: String(err) }), {
          status:  502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const responseBody = await upstream.text();
      return new Response(responseBody, {
        status:  upstream.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // -------------------------------------------------------------------
    // Default: route everything else → Jira
    // -------------------------------------------------------------------
    const jiraUrl = `${JIRA_BASE}${path}${url.search}`;
    const auth    = request.headers.get('Authorization') || '';

    if (request.method === 'GET') {
      const jiraResponse = await fetch(jiraUrl, {
        method:  'GET',
        headers: { 'Authorization': auth, 'Accept': 'application/json' },
      });
      const responseBody = await jiraResponse.text();
      return new Response(responseBody, {
        status:  jiraResponse.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    const body = await request.text();
    const jiraResponse = await fetch(jiraUrl, {
      method:  'POST',
      headers: {
        'Authorization': auth,
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
