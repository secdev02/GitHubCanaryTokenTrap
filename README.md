# 🪤 GitHub Canary Token Trap

A GitHub Actions workflow that fires an alert whenever someone triggers your repository's dispatch endpoint. Supports two trigger modes — one using a bait GitHub token, and one using a **completely tokenless Cloudflare Worker** that accepts unauthenticated requests from anyone.

---

## How It Works

**Mode A — Bait Token** _(caller needs a GitHub PAT)_
```
Attacker finds bait token
         │
         ▼
POST /repos/{owner}/{repo}/dispatches
         │
         ▼
  repository_dispatch fires
         │
    ┌────┴─────┐
    ▼          ▼
Canary ping  GitHub Issue filed
(out-of-band  (with full payload
  webhook)     & checklist)
```

**Mode B — Cloudflare Worker** _(no token needed by caller)_
```
Attacker hits public Worker URL (zero credentials required)
         │
         ▼
  Cloudflare Worker
  captures: real IP, country, ASN,
  city, ISP, user-agent, body …
         │
         ▼  (token stored in Worker secrets, never exposed)
POST /repos/{owner}/{repo}/dispatches
         │
         ▼
  repository_dispatch fires
         │
    ┌────┴─────┐
    ▼          ▼
Canary ping  GitHub Issue filed
             (with enriched
              Cloudflare metadata)
```

---

## Files

| File | Destination | Purpose |
|------|-------------|---------|
| `canary-trap.yml` | `.github/workflows/canary-trap.yml` | The Actions workflow (both modes) |
| `canary-relay-worker.js` | Cloudflare Worker | Unauthenticated relay — Mode B |
| `wrangler.toml` | alongside worker | Worker deployment config |
| `canary-trap-page.html` | `docs/canary-trap-page.html` | Optional browser-based trap page |

---

## Setup — GitHub Actions Workflow (required for both modes)

### 1. Add Secrets to the Repository

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Required | Value |
|--------|----------|-------|
| `CANARY_TOKEN_URL` | Yes | Your [Canarytokens.org](https://canarytokens.org) URL (HTTP token type recommended) |
| `CANARY_ALERT_TOKEN` | No | A privileged PAT for filing issues — falls back to `GITHUB_TOKEN` if omitted |

### 2. Create the Labels

```bash
gh label create canary   --color "#FF0000" --description "Canary token alert"
gh label create security --color "#FF6600" --description "Security alert"
```

Or create them manually under **Issues → Labels → New label**.

### 3. Copy the Workflow

```bash
mkdir -p .github/workflows
cp canary-trap.yml .github/workflows/canary-trap.yml
git add .github/workflows/canary-trap.yml
git commit -m "Add canary token trap workflow"
git push
```

---

## Mode A — Bait Token Trigger

The bait token is a deliberately exposed Fine-Grained PAT. Its only job is to trigger the workflow when used — the credential itself is the canary.

### Create the Bait Token

Go to **Settings → Developer settings → Fine-grained personal access tokens → New token**.

| Setting | Value |
|---------|-------|
| Name | Something innocent: `ci-read-token`, `deploy-webhook-key` |
| Expiration | No expiration (or however long you want the trap active) |
| Repository access | This repository only |
| Repository permissions | **Actions**: Read and write |

> **This token is the canary.** Embed it wherever you want to detect unauthorized access — a fake `.env`, a config file, a deceptive README section, or a leaked credential store.

### Triggering (Mode A)

Anyone holding the bait token can fire the trap:

```bash
curl -X POST \
  -H "Authorization: Bearer <BAIT_TOKEN>" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/<OWNER>/<REPO>/dispatches \
  -d '{"event_type":"canary-trigger","client_payload":{"source":"readme"}}'
```

Expected response: `204 No Content`

---

## Mode B — Cloudflare Worker (No Token Required)

The Worker is a free, public HTTPS endpoint that accepts requests from anyone with no credentials. It captures Cloudflare-enriched metadata and fires the GitHub dispatch internally using a token stored securely in Worker secrets — never visible to callers.

### Why This Is Better for Some Traps

| | Bait Token | Cloudflare Worker |
|---|---|---|
| Caller needs credentials | ✅ GitHub PAT | ❌ Nothing |
| Works in a browser | Only via JS with exposed token | ✅ Plain fetch/form |
| Captures real IP | ✗ GitHub hides it | ✅ CF-Connecting-IP (unspoofable) |
| Captures country / ASN / ISP | ✗ | ✅ Cloudflare GeoIP |
| Token ever exposed to caller | ✅ By design | ❌ Never |
| Cost | Free | Free (100k req/day) |

### Deploy the Worker

**Prerequisites:** Node.js installed, a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

```bash
npm install -g wrangler
wrangler login
```

Create a new Worker project and replace the generated `worker.js` with `canary-relay-worker.js`:

```bash
wrangler init canary-relay
cp canary-relay-worker.js canary-relay/src/worker.js
cp wrangler.toml canary-relay/wrangler.toml
cd canary-relay
```

Store your secrets — these are encrypted and never appear in code or logs:

```bash
# A relay PAT: Fine-Grained, Actions: read+write only, this repo only
wrangler secret put GITHUB_TOKEN

# Your GitHub org or username
wrangler secret put GITHUB_OWNER

# Repository name
wrangler secret put GITHUB_REPO
```

Deploy:

```bash
wrangler deploy
```

Your bait URL is now live at:
```
https://canary-relay.<your-subdomain>.workers.dev
```

### Optional: Custom Domain

A custom domain makes the bait URL far more convincing. In the Cloudflare dashboard:

**Workers & Pages → canary-relay → Settings → Domains & Routes → Add Custom Domain**

Examples of convincing bait URLs:
- `https://hooks.yourcompany.com/deploy`
- `https://api.yourproject.io/webhook`
- `https://notify.yourservice.com/event`

### Triggering (Mode B)

No token. No headers. Any HTTP client works:

```bash
# Basic trigger — zero credentials
curl -X POST https://canary-relay.<your-subdomain>.workers.dev

# With a body (will appear in the filed issue)
curl -X POST https://canary-relay.<your-subdomain>.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"source":"self-test"}'
```

Expected response: `{"status":"ok","received":true}`

Even a browser navigation to the URL (GET request) will fire the trap.

### What the Worker Captures

Because requests pass through Cloudflare's edge before reaching the Worker, the following metadata is collected and included in the GitHub issue — none of it can be spoofed by the caller:

| Field | Source |
|-------|--------|
| Real IP address | `CF-Connecting-IP` header (Cloudflare-injected) |
| Country | Cloudflare GeoIP |
| City & region | Cloudflare GeoIP |
| ASN | Cloudflare network data |
| ISP / organisation | Cloudflare network data |
| TLS version | Cloudflare handshake info |
| HTTP protocol | HTTP/1.1 vs HTTP/2 vs HTTP/3 |
| User-Agent | Request header |
| Referer | Request header |
| Request method & URL | Request metadata |
| Request body | Parsed JSON or raw text |

---

## Testing Either Mode

### Test Mode A (bait token)

```bash
export BAIT_TOKEN="github_pat_..."
export REPO="your-org/your-repo"

curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer $BAIT_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO/dispatches" \
  -d '{"event_type":"canary-trigger","client_payload":{"source":"self-test"}}'
```

Expected: `204`

### Test Mode B (Cloudflare Worker)

```bash
curl -s -X POST https://canary-relay.<your-subdomain>.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"source":"self-test"}'
```

Expected: `{"status":"ok","received":true}`

In both cases, a `🚨 Canary Triggered` issue should appear in the repository within ~30 seconds and your Canarytokens.org alert should fire independently.

### Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| Mode A: `401 Unauthorized` | Bait token is wrong or expired |
| Mode A: `404 Not Found` | Wrong owner/repo in the URL |
| Mode A: `422 Unprocessable Entity` | `event_type` must be exactly `canary-trigger` |
| Mode B: Worker returns error | Check `wrangler tail` logs for the GitHub API response |
| `204` / `200` but no issue | Labels don't exist yet, or `CANARY_ALERT_TOKEN` lacks issues permission |
| No canary ping but issue filed | External ping failed — check the `Ping Canary Token` step in the Actions run |

---

## Optional: Browser Trap Page

`canary-trap-page.html` can be hosted on GitHub Pages or any static host. It fires the dispatch from the visitor's browser and embeds fingerprint data into `client_payload`.

**With Mode A** — set the three constants in the HTML source (bait token is visible, that's intentional):
```js
const BAIT_TOKEN = 'github_pat_REPLACE_ME';
const REPO_OWNER = 'your-org';
const REPO_NAME  = 'your-repo';
```

**With Mode B** — replace the fetch target with your Worker URL instead:
```js
const response = await fetch('https://canary-relay.<your-subdomain>.workers.dev', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(clientPayload),
});
```
No token needed in the HTML at all.

---

## What You Get When It Fires

A GitHub Issue is automatically created with:

- Trigger timestamp
- Dispatch event type and workflow run link
- Full `client_payload` JSON — includes Cloudflare metadata in Mode B
- Remediation checklist

**Example issue title:**
```
🚨 Canary Triggered — 2024-11-14 03:22:41 UTC
```

You also receive an independent out-of-band alert via Canarytokens.org (email, Slack, Teams, etc.) the moment the workflow starts — before the issue is even filed.

---

## Remediation Checklist

When an alert fires:

- [ ] Identify which bait was triggered (token, Worker URL, or page)
- [ ] If Mode A: revoke the bait token via **Settings → Developer settings → Personal access tokens**
- [ ] If Mode B: rotate `GITHUB_TOKEN` in Worker secrets (`wrangler secret put GITHUB_TOKEN`)
- [ ] Review the GitHub audit log for any other activity associated with the token
- [ ] Check `client_payload` for recon data the caller embedded
- [ ] Rotate any secrets co-located with the bait
- [ ] Assess whether the attacker accessed anything beyond the trigger endpoint
- [ ] Close the alert issue once the investigation is complete

---

## Security Notes

- The Actions workflow uses `permissions: issues: write` only — no access to code, secrets, or other resources.
- The Mode A bait token has the minimum scope to fire a dispatch (`Actions: Read and write`). It cannot read code or secrets.
- The Mode B Worker stores the real GitHub token as an encrypted Cloudflare secret — it is never transmitted to callers or visible in Worker source code.
- `client_payload` is attacker-controlled in both modes — the workflow treats all values as untrusted display data only.
- The Canarytokens.org ping is non-fatal; if it fails the issue is still filed.

---

## License

MIT
