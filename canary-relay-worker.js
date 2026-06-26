/**
 * CANARY RELAY — Cloudflare Worker
 * ─────────────────────────────────
 * Accepts unauthenticated GET or POST requests from anyone, collects
 * Cloudflare-enriched metadata (real IP, country, ASN, etc.), then
 * forwards a repository_dispatch event to GitHub on the caller's behalf.
 *
 * The GitHub token never leaves this Worker — callers only ever see
 * the Worker's public URL.
 *
 * DEPLOY
 * ──────
 * 1. Install Wrangler:       npm install -g wrangler
 * 2. Authenticate:           wrangler login
 * 3. Create the Worker:      wrangler init canary-relay  (choose "Hello World")
 * 4. Replace worker.js with this file.
 * 5. Set secrets (never put these in wrangler.toml):
 *      wrangler secret put GITHUB_TOKEN   ← your relay PAT (Actions: read+write only)
 *      wrangler secret put GITHUB_OWNER   ← org or username
 *      wrangler secret put GITHUB_REPO    ← repository name
 * 6. Deploy:                 wrangler deploy
 *
 * Your public bait URL will be:
 *   https://canary-relay.<your-subdomain>.workers.dev
 *
 * OPTIONAL CUSTOM DOMAIN
 * ──────────────────────
 * In the Cloudflare dashboard → Workers → canary-relay → Triggers → Custom Domains
 * e.g. https://api.yoursite.com/webhook  ← embed this as the bait
 *
 * FREE TIER LIMITS
 * ────────────────
 * 100,000 requests / day — more than enough for a canary trap.
 */

export default {
  async fetch(request, env) {

    // ── Respond to any method so the URL looks like a live endpoint ──────────
    // HEAD / OPTIONS / GET all return 200 to avoid dead-link scanners ignoring it.
    const method = request.method.toUpperCase();

    // ── Collect Cloudflare-enriched request metadata ─────────────────────────
    // These headers are injected by Cloudflare's edge — they cannot be spoofed
    // by the caller and are far more reliable than X-Forwarded-For.
    const cf      = request.cf ?? {};
    const headers = request.headers;

    const callerInfo = {
      ip:           headers.get('CF-Connecting-IP')    ?? 'unknown',
      country:      headers.get('CF-IPCountry')        ?? cf.country        ?? 'unknown',
      city:         cf.city                            ?? 'unknown',
      region:       cf.region                          ?? 'unknown',
      asn:          cf.asn                             ?? 'unknown',
      org:          cf.asOrganization                  ?? 'unknown',
      isp:          cf.isp                             ?? 'unknown',
      userAgent:    headers.get('User-Agent')          ?? 'none',
      referer:      headers.get('Referer')             ?? 'none',
      contentType:  headers.get('Content-Type')        ?? 'none',
      method:       method,
      url:          request.url,
      timestamp:    new Date().toISOString(),
      tlsVersion:   cf.tlsVersion                      ?? 'unknown',
      httpProtocol: cf.httpProtocol                    ?? 'unknown',
    };

    // ── Parse any body the caller sent ───────────────────────────────────────
    let callerBody = null;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      try {
        callerBody = await request.json();
      } catch {
        try {
          callerBody = { raw: await request.text() };
        } catch {
          callerBody = null;
        }
      }
    }

    // ── Build the GitHub dispatch payload ────────────────────────────────────
    const dispatchPayload = {
      event_type: 'canary-trigger',
      client_payload: {
        caller:      callerInfo,
        callerBody:  callerBody,
      },
    };

    // ── Fire the GitHub repository dispatch ──────────────────────────────────
    // This is the only place the GitHub token is used.
    // Use waitUntil so the Worker returns immediately to the caller
    // while the GitHub request continues in the background.
    const githubRequest = fetch(
      'https://api.github.com/repos/'
        + encodeURIComponent(env.GITHUB_OWNER)
        + '/'
        + encodeURIComponent(env.GITHUB_REPO)
        + '/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization':        'Bearer ' + env.GITHUB_TOKEN,
          'Accept':               'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type':         'application/json',
          'User-Agent':           'canary-relay/1.0',
        },
        body: JSON.stringify(dispatchPayload),
      }
    );

    // waitUntil keeps the Worker alive until the fetch completes,
    // even after we've already returned the response to the caller.
    const ctx = globalThis.__workerContext;
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(githubRequest);
    } else {
      // Fallback: await directly (adds ~200ms to response time, still fine)
      await githubRequest;
    }

    // ── Return a plausible-looking response ───────────────────────────────────
    // Match whatever the bait context expects — a JSON API response,
    // a plain 200, or a redirect. Adjust to taste.
    return new Response(
      JSON.stringify({ status: 'ok', received: true }),
      {
        status: 200,
        headers: {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': '*',   // allow browser-based triggers
        },
      }
    );
  },
};
