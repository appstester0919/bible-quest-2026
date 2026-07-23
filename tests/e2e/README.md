# E2E Regression Tests

End-to-end tests that exercise the deployed web app via Playwright + WSL Chrome CDP attach.

## Prerequisites

1. **WSL host must have `aidc` running** — this launches Chrome with CDP at `http://127.0.0.1:9222`.
   ```bash
   aidc   # on WSL host
   ```

2. **System Python** (NOT hermes venv — Playwright SDK is installed under `/home/appstester0919/.local/lib/python3.12/site-packages/`).
   ```bash
   /usr/bin/python3 -c "import playwright; print(playwright.__file__)"
   # → /home/appstester0919/.local/lib/python3.12/site-packages/playwright/__init__.py
   ```

3. **Sandbox can reach WSL Chrome's CDP endpoint at 127.0.0.1:9222.**
   ```bash
   curl -s http://127.0.0.1:9222/json/version
   ```

## Running

```bash
/usr/bin/python3 tests/e2e/test_identity_switching.py
```

Exits 0 on success, 1 on failure. Output is verbose — every step prints ✅ / ❌.

## What `test_identity_switching.py` covers

1. **DB pre-check**: queries Supabase REST to confirm starting identity is in {Uni, High, Prim}.
2. **CDP pre-check**: confirms `aidc` Chrome is reachable at `:9222`.
3. **Login**: fills the `/login` form as `apkhlai@cityu.edu.hk`.
4. **Settings page**: confirms `<body data-identity>` is server-rendered to the user's current identity.
5. **Cycle through all 3 identities** (High → Prim → Uni):
   - Click the visible `<label>` containing the identity's display text
   - Wait 10s for `saveIdentity` server action + `window.location.reload()`
   - Verify `<body data-identity>` updated
   - Verify `getComputedStyle(body).backgroundImage` contains the right `identity-bg/<X>.jpg`
   - Verify DB persisted the change (direct REST query)
6. **Final state**: leaves DB as Uni (the test's last click).

## When to run

- Before any deploy that touches `app/layout.tsx`, `app/globals.css`, `lib/identity.ts`, or `app/(main)/settings/`.
- After applying migration 016 to a new Supabase project.
- After updating `aidc` persistent profile.

## Adding new tests

Pattern:
1. Use `page.evaluate(...)` to read DOM/computed style, NOT server `console.log`.
2. Use `page.locator("label").filter(has_text="...").first.click()` for `<sr-only>` radios (visible label click is what users do).
3. Wait ≥10s after click for server actions + reload.
4. Always cross-check with a direct DB query — UI changes can lie.

See the [browser-debug-with-playwright skill](../../.hermes/skills/software-development/browser-debug-with-playwright/SKILL.md) for more patterns.
