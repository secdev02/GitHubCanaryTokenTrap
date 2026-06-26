# 🪤 GitHub Canary Token Trap

A GitHub Actions workflow that fires an alert whenever someone uses a bait token to POST to your repository's dispatch endpoint. Ideal for detecting credential theft, unauthorized access, or reconnaissance against your GitHub resources.

---

## How It Works

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

The **bait token** is a deliberately exposed Fine-Grained PAT with minimal permissions. Its only job is to trigger the workflow when used — the credential itself is the canary.

---

## Files

| File | Destination | Purpose |
|------|-------------|---------|
| `canary-trap.yml` | `.github/workflows/canary-trap.yml` | The Actions workflow |
| `canary-trap-page.html` | `docs/canary-trap-page.html` (optional) | Browser-based trap via GitHub Pages |

---

## Setup

### 1. Create the Bait Token

Go to **Settings → Developer settings → Fine-grained personal access tokens → New token**.

| Setting | Value |
|---------|-------|
| Name | Something innocent: `ci-read-token`, `deploy-webhook-key` |
| Expiration | No expiration (or as long as you want the trap active) |
| Repository access | This repository only |
| Repository permissions | **Actions**: Read and write |

> **This token is the canary.** Embed it wherever you want to detect unauthorized access — a fake `.env`, a config file, a deceptive README section, or a public HTML page.

### 2. Add Secrets to the Repository

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Required | Value |
|--------|----------|-------|
| `CANARY_TOKEN_URL` | Yes | Your [Canarytokens.org](https://canarytokens.org) URL (HTTP token type recommended) |
| `CANARY_ALERT_TOKEN` | No | A separate privileged PAT for filing issues — falls back to `GITHUB_TOKEN` |

### 3. Create the Labels

Run once from the repo root:

```bash
gh label create canary   --color "#FF0000" --description "Canary token alert"
gh label create security --color "#FF6600" --description "Security alert"
```

Or create them manually under **Issues → Labels → New label**.

### 4. Copy the Workflow

```bash
mkdir -p .github/workflows
cp canary-trap.yml .github/workflows/canary-trap.yml
git add .github/workflows/canary-trap.yml
git commit -m "Add canary token trap workflow"
git push
```

---

## Triggering

Anyone holding the bait token can fire the trap — no other credentials needed:

```bash
curl -X POST \
  -H "Authorization: Bearer <BAIT_TOKEN>" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/<OWNER>/<REPO>/dispatches \
  -d '{"event_type":"canary-trigger","client_payload":{"source":"readme"}}'
```

A `204 No Content` response means the workflow fired. An issue will appear in the repository within seconds.

### Testing It Yourself

Use your bait token to do a test fire before deploying the trap:

```bash
export BAIT_TOKEN="github_pat_..."
export REPO="your-org/your-repo"

curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $BAIT_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO/dispatches" \
  -d '{"event_type":"canary-trigger","client_payload":{"source":"self-test"}}'
```

Expected output: `204`

---

## Optional: Browser Trap Page

`canary-trap-page.html` is a standalone page you can host on [GitHub Pages](https://pages.github.com/) or any static host. It fires the dispatch directly from the visitor's browser and embeds browser fingerprint data into `client_payload`:

- Referrer URL
- User-agent string
- Screen resolution
- Browser language and timezone
- Timestamp

**To use it:**

1. Open `canary-trap-page.html`
2. Replace the three constants near the top:
   ```js
   const BAIT_TOKEN = 'github_pat_REPLACE_ME';
   const REPO_OWNER = 'your-org';
   const REPO_NAME  = 'your-repo';
   ```
3. Commit and enable GitHub Pages on the `docs/` folder (or root).

> ⚠️ The bait token will be visible in the page source — that is intentional for this use case. Never use a privileged token here.

---

## What You Get When It Fires

A GitHub Issue is automatically created with:

- Trigger timestamp
- Dispatch event type
- Link to the Actions run
- Full `client_payload` JSON (includes any data the caller embedded)
- Remediation checklist

**Example issue title:**
```
🚨 Canary Triggered — 2024-11-14 03:22:41 UTC
```

You also receive an independent out-of-band alert via your Canarytokens.org webhook (email, Slack, Teams, etc.) the moment the workflow starts — before the issue is even filed.

---

## Remediation Checklist

When an alert fires:

- [ ] Identify and revoke the bait token via **Settings → Developer settings → Personal access tokens**
- [ ] Review the GitHub audit log for any other activity from the same token
- [ ] Check `client_payload` for recon data the caller embedded
- [ ] Rotate any secrets that may have been co-located with the bait token
- [ ] Assess whether the attacker accessed anything beyond the dispatch endpoint
- [ ] Close the alert issue once the investigation is complete

---

## Security Notes

- The workflow uses `permissions: issues: write` only — it has no access to repository contents, secrets, or code.
- The bait token has the minimum scope required to fire a dispatch (`Actions: Read and write`). It cannot read code, secrets, or any other resource.
- `client_payload` is attacker-controlled — the workflow treats all values as untrusted display data only.
- The Canarytokens.org ping is non-fatal; if it fails the issue is still filed.

---

## License

MIT
