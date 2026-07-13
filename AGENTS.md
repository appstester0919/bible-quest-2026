# Agent / Contributor Notes — Bible Quest 2026

## Branching strategy: feature branches (no `develop`)

**Production** = `main` branch. Always.

### Workflow

| Task type | Branch name | How to deploy |
|---|---|---|
| Production hotfix | `hotfix/<name>` | merge → main → auto deploy |
| New feature | `feat/<name>` | merge → main when ready |
| Experimental | `exp/<name>` | merge when stable |

### Why no `develop`?

This is a solo project. Git Flow's main+develop split adds:
- Extra sync commits
- Conflict resolution overhead when features diverge
- Mental overhead for the developer

Trunk-based with feature branches + Vercel preview deployments gives
the same "test before merging" benefit with less ceremony.

### How to use this

1. **Make sure you're on `main` and it's clean:**
   ```bash
   git checkout main && git pull
   git status  # should be clean
   ```

2. **Create a feature branch:**
   ```bash
   git checkout -b feat/mascot
   # work, commit, push
   git push -u origin feat/mascot
   ```

3. **Vercel preview deploy (if GitHub integration is active):**
   Push the branch → Vercel auto-builds → URL like
   `feat-mascot-<hash>.vercel.app` — safe to test without
   touching production.

4. **When ready, merge to main:**
   ```bash
   git checkout main
   git merge --no-ff feat/mascot
   git push
   # Vercel auto-deploys to https://bible-quest-2026.vercel.app
   ```

5. **Clean up:**
   ```bash
   git branch -d feat/mascot
   git push origin --delete feat/mascot
   ```

### Production deploy (CLI fallback)

If GitHub integration isn't set up:
```bash
vercel --prod
```

## Deployment

| Environment | URL | Trigger |
|---|---|---|
| Production | https://bible-quest-2026.vercel.app | `git push` to `main` (or `vercel --prod`) |
| Preview | https://feat-name-<hash>.vercel.app | `git push` to a non-main branch |

## Supabase

- Project URL: https://xybrbennsttjttxuxqoq.supabase.co
- DB migrations are SQL files in `docs/migrations/NNN_*.sql`
- Run them manually in the Supabase SQL editor

## Critical reminders

- **NT has 259 chapters** (not 260). OT has 929. Total = 1188.
- **Scope chapter constants** live in `lib/bible/scope.ts` → `SCOPE_CHAPTERS`.
- The XP model is **10 XP per chapter**, level = `floor(sqrt(xp/100)) + 1`.
- All DB constraint changes need a migration file in `docs/migrations/`.
- After schema changes, document them and ask the user to run the migration.