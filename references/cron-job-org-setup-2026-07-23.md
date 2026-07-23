# cron-job.org setup for Bible Quest push reminders

**Why this exists**: GitHub Actions `schedule` cron triggers are unreliable in
practice. They silently skip ticks when the repo has light activity or when
GitHub's scheduler is degraded. We observed this on 2026-07-23 — schedule
runs at 04:00/04:15/04:30 UTC all missing after a successful 03:45 UTC run.

**Solution**: cron-job.org is a free dedicated cron service (no rate limits,
1-minute resolution, reliable delivery, email alerts on failure). We use it
to POST to our existing Vercel `/api/push/cron-relay` endpoint every 15
minutes. Same code path, same auth, same response shape. Just a more
reliable trigger source.

---

## Pre-flight checklist

Before you set up cron-job.org, confirm these are in place:

- [x] Vercel deployment live: `https://bible-quest-2026.vercel.app`
- [x] Vercel env var `CRON_RELAY_TOKEN` set (same value as GH Actions secret)
- [x] GitHub Actions workflow `.github/workflows/cron-push.yml` works on
      manual trigger (verified 2026-07-23, run #29980170688)
- [x] `/api/push/cron-relay` returns `{"ok": true, ...}` on authenticated POST

---

## Setup steps

### 1. Create a cron-job.org account

Go to https://cron-job.org/en/ and click **Sign up**.

Use your real email — the service sends failure alerts there, and you want to
know if/when cron delivery breaks.

### 2. Create a new cron job

After login → **Cronjobs** → **Create cronjob** (top right).

Fill in these fields:

| Field | Value |
|---|---|
| **Title** | `Bible Quest push reminders` |
| **URL** | `https://bible-quest-2026.vercel.app/api/push/cron-relay` |
| **Method** | `POST` (not GET!) |
| **Request headers** (Advanced section, toggle on) | `Authorization: Bearer <YOUR_CRON_RELAY_TOKEN>` and `Content-Type: application/json` |
| **Request body** (Advanced section) | `{"limit": 200}` |
| **Schedule** | `Every 15 minutes` (use the dropdown; it expands to show "0,15,30,45") |
| **Timeout** | `60 seconds` |
| **Save responses** | `On failure` (so you can debug if something breaks) |
| **Notifications** | Enable **Failure notifications** to your email |

**Where to get `CRON_RELAY_TOKEN`**: this is the same value as:
- GitHub Actions secret `CRON_RELAY_TOKEN` (in repo Settings → Secrets)
- Vercel env var `CRON_RELAY_TOKEN` (in Vercel project Settings → Environment Variables)

If you don't remember the value, you can:
1. Check GitHub: `gh secret list -R appstester0919/bible-quest-2026` (won't show value, but confirms it exists)
2. Check Vercel: project Settings → Environment Variables → `CRON_RELAY_TOKEN`
3. If both lost, regenerate with `openssl rand -base64 32` and update BOTH places

### 3. Test the cron job immediately

Don't wait 15 minutes — use the **Run now** button (or **Execute** in some
versions) to trigger the job manually right after creating it.

You should see:
- HTTP status `200`
- Response body similar to:
  ```json
  {"ok":true,"attempted":1,"sent":1,"expired":0,"errors":0,"due_count":1,"duration_ms":1284,"results":[...]}
  ```
  OR
  ```json
  {"ok":true,"attempted":0,"sent":0,"expired":0,"errors":0,"due_count":0,"duration_ms":50,"results":[]}
  ```
  (zero is fine — just means no reminder is due in this 15-min window)

If you see `401 unauthorized`:
- The token in cron-job.org header doesn't match the Vercel env var
- Regenerate one, update both places, re-run

If you see `500`:
- Check the **Response body** tab in cron-job.org for the actual error
- Common cause: Vercel env vars `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` not set

### 4. Verify the schedule fires

After ~15 minutes (or just wait for the next :00/:15/:30/:45 tick), check:

- **cron-job.org → Cronjobs → your job → History**: should show successful runs
- **Vercel → Logs → Functions → `/api/push/cron-relay`**: should show recent invocations

### 5. Set up failure alerts (optional but recommended)

cron-job.org → Account → Notifications:
- **Failure notifications**: ON
- **Max notifications per cronjob**: 5 per day (so a sustained outage doesn't spam)

---

## Optional: disable GH Actions schedule (cleanup)

Once cron-job.org is reliably delivering every 15 minutes, you can disable
the GH Actions schedule to save CI minutes. Edit
`.github/workflows/cron-push.yml`:

```yaml
on:
  # schedule:
  #   - cron: '*/15 * * * *'
  workflow_dispatch:  # Keep this for manual fallback
```

**DO NOT** remove the workflow file entirely — keep `workflow_dispatch` as a
manual fallback in case cron-job.org has an outage. You can trigger it from
GitHub UI → Actions → bible-quest-push-cron → Run workflow.

---

## Troubleshooting

### "401 unauthorized" on every run
- Token mismatch. Update `CRON_RELAY_TOKEN` on cron-job.org header to match
  Vercel env var exactly (case-sensitive).

### "500 SUPABASE_SERVICE_ROLE_KEY not set"
- Vercel env var missing. Add in Vercel project Settings → Environment Variables
  → Production. Trigger a redeploy for the new env var to take effect.

### Schedule drift / skipped runs
- cron-job.org has 99%+ uptime. If you see a missed run, check their status
  page: https://cron-job.org/en/status/ — usually just a few minutes delay.

### Push not arriving on user's device
- Cloud side verified (`sent: 1, status: 201`) but no notification popup:
  use `tools/verify_push_device_side.py` to attach via CDP and inspect SW
  push event data.

### Want to stop pushes temporarily
- Pause the cronjob in cron-job.org UI (no need to delete it).
- Or set `enabled_reminder = false` in `web_push_subscriptions` table for
  specific users.

---

## Why not Vercel Cron?

Vercel Cron requires a Pro plan ($20/month) for sub-daily invocation. The
Hobby plan caps at 2 invocations/day. We need 96 invocations/day (every 15
min × 24). cron-job.org is free and works with the existing Hobby plan.

---

## Verification recipe (after initial setup)

```bash
# 1. Confirm cron-job.org is hitting Vercel (check 1-2 minutes after next tick)
#    https://vercel.com/<account>/bible-quest-2026/logs → filter to cron-relay

# 2. Or use curl from WSL to inspect recent Vercel function logs
#    (requires Vercel token in ~/.hermes/.credentials or env)
#    vercel logs --prod --follow
#    then look for "POST /api/push/cron-relay" entries

# 3. Confirm Supabase web_push_subscriptions.last_notified_at updates
#    (use Supabase dashboard table editor)
```

---

## File locations

- Vercel route: `app/api/push/cron-relay/route.ts`
- SQL RPC: `supabase/migrations/20260721000000_push_subscriptions.sql` (function `process_due_reminders`)
- GH Actions workflow (fallback only): `.github/workflows/cron-push.yml`
- This document: `references/cron-job-org-setup-2026-07-23.md`
