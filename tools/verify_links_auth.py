# Round-26 verify script - confirms authenticated user can read bq_external_links
# Run after applying the GRANT fix.
# Usage: cd /mnt/d/AI/BibleQuest2026 && python3 tools/verify_links_auth.py

import subprocess, json

with open("/mnt/d/AI/BibleQuest2026/.env.local") as f:
    env = {}
    for line in f:
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"')
anon_key = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]

print("=== Logging in as apkhlai ===")
r = subprocess.run(["curl", "-sL", "--max-time", "15",
    "https://xybrbennsttjttxuxqoq.supabase.co/auth/v1/token?grant_type=password",
    "-X", "POST",
    "-H", f"apikey: {anon_key}",
    "-H", "Content-Type: application/json",
    "-d", json.dumps({"email": "apkhlai@cityu.edu.hk", "password": "MasterTesting0919"})],
    capture_output=True, text=True)

auth = json.loads(r.stdout)
if "access_token" not in auth:
    print(f"  FAIL: {r.stdout[:500]}")
    raise SystemExit(1)
print(f"  OK as {auth['user']['email']}")

print()
print("=== Authenticated SELECT bq_external_links ===")
url = "https://xybrbennsttjttxuxqoq.supabase.co/rest/v1/bq_external_links"
r = subprocess.run(["curl", "-sL", "--max-time", "15",
    f"{url}?select=id,category,title&is_published=eq.true&limit=20",
    "-H", f"apikey: {anon_key}",
    "-H", f"Authorization: Bearer {auth['access_token']}"],
    capture_output=True, text=True)

if r.stdout.startswith("{") and '"code":"42501"' in r.stdout:
    print(f"  STILL 42501: {r.stdout[:300]}")
    print("  Run: grant select on public.bq_external_links to authenticated;")
    raise SystemExit(2)

data = json.loads(r.stdout)
print(f"  Authenticated user sees {len(data)} rows:")
for row in data:
    print(f"    - {row.get('category'):<10} {row.get('title')}")
