# bible-quest-push-cron

Cloudflare Worker that sends Bible Quest daily reading reminders via Web Push.
Scheduled cron runs every 15 minutes, queries a Supabase RPC for due reminders,
and delivers notifications to matching browser push subscriptions.

## Architecture

```
Cloudflare Cron (*/15 * * * *)
        │
        ▼
   ┌────────────────────────────────────────────┐
   │ Worker: handleCron(env)                     │
   │                                            │
   │  1. POST /rest/v1/rpc/process_due_reminders│
   │  2. For each (subscription, reminder):     │
   │     a. encrypt payload (RFC 8291/8292)     │
   │     b. POST to push service                │
   │     c. PATCH active=false (if 410 Gone)    │
   │     d. POST /rpc/mark_reminder_sent        │
   └────────────────────────────────────────────┘
```

Subscription management (`push_subscriptions` table) is handled by the client
app directly via Supabase RLS-protected writes — not by this Worker. As a
result, this Worker has no mutating HTTP endpoints and does not need auth.

## Required Supabase schema

Apply `supabase/migrations/20260721000000_push_subscriptions.sql` from the
parent repo. Defines:
- `push_subscriptions` (id, user_id, endpoint, p256dh, auth, active, …)
- `user_reminders` (id, user_id, reminder_type, scheduled_at, last_sent_at, enabled)
- RPCs: `process_due_reminders()`, `mark_reminder_sent(p_reminder_id uuid)`

## Required environment variables

### Vars (committed in `wrangler.toml`)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VAPID_PUBLIC_KEY` | VAPID public key, base64url |

### Secrets (set via `wrangler secret put`)

| Secret | Description |
|--------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role JWT (bypasses RLS) |
| `VAPID_PRIVATE_KEY` | 32-byte P-256 scalar, base64url-encoded |
| `VAPID_SUBJECT` | `mailto:your@email.com` |

## Deploy

### 1. Authenticate

```bash
cd cloudflare-worker/push-cron
npx wrangler login
```

Browser opens Cloudflare OAuth flow — log in with the account that owns
the `bible-quest-push-cron` subdomain.

### 2. Set secrets

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# paste: <service-role-jwt>

wrangler secret put VAPID_PRIVATE_KEY
# paste: <32-byte-p256-scalar-base64url>

wrangler secret put VAPID_SUBJECT
# paste: mailto:laikaho0919@gmail.com
```

### 3. Deploy

```bash
wrangler deploy
```

Output includes the Worker URL, e.g.:
`https://bible-quest-push-cron.<account-subdomain>.workers.dev`

### 4. Verify

```bash
curl https://bible-quest-push-cron.<account-subdomain>.workers.dev/healthz
# → ok
```

## Local development

```bash
npm install
npm test           # runs round-trip encrypt/decrypt test
npm run dev        # local Worker on http://127.0.0.1:8787
```

`npm run dev` exposes the same cron/HTTP handlers locally. To trigger the
cron manually:

```bash
curl http://127.0.0.1:8787/healthz
```

(Cron triggers are not invoked locally; use `wrangler dev --test-scheduled`
to fire them on demand.)

## Concurrency

The cron sends pushes with a concurrency cap of **10** in-flight HTTP requests
to push services at any moment. With ~1000 due reminders at peak, the cycle
completes in well under Workers' 30s CPU-time limit.

## Failure modes

| Failure | Behavior |
|---------|----------|
| Supabase RPC `process_due_reminders` fails | Cron logs error, returns errors=1. Next tick retries. |
| Push service returns 404/410 (Gone) | Subscription marked `active=false` to stop retries. |
| Push service returns 5xx | Counted as `errors`. Reminder is not marked sent, so next cron tick retries (subject to the 12h dedup in the RPC). |
| `mark_reminder_sent` fails | Logged as warning. Push still reached the user. Next cron tick may re-fire until 12h dedup kicks in. |

## Files

```
src/index.js       — Worker entry point (cron + HTTP /healthz)
src/web-push.js    — Zero-dep RFC 8291 (aes128gcm) + RFC 8292 (VAPID JWT)
test/roundtrip.mjs — Encrypt + decrypt sanity test
wrangler.toml      — Worker name, vars, cron trigger
package.json       — `npm test`, `npm run dev`
```