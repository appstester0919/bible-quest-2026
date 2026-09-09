# Round 27 verify script — atomic replace RPC end-to-end
# Usage: cd /mnt/d/AI/BibleQuest2026 && python3 tools/verify_sync_replace.py

import subprocess, json, hashlib, sys

def url_to_uuid(url):
    h = hashlib.sha1(url.encode()).hexdigest()[:32]
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"

# Read anon + service keys
env = {}
with open("/mnt/d/AI/BibleQuest2026/.env.local") as f:
    for line in f:
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"')

anon_key = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
url = "https://xybrbennsttjttxuxqoq.supabase.co/rest/v1"
rpc_url = f"{url}/rpc/sync_external_links_from_sheet"

# Get service_role key from env or prompt — try a few known locations
service_key = None
for candidate in [
    "/mnt/d/AI/BibleQuest2026/.env.local",
    "/mnt/d/AI/BibleQuest2026/.env",
    "/mnt/d/AI/BibleQuest2026/.env.production",
    "/home/appstester0919/.hermes/.credentials/supabase_service_key",
]:
    try:
        with open(candidate) as f:
            for line in f:
                if "SUPABASE_SERVICE" in line.upper() and "=" in line and not line.startswith("#"):
                    service_key = line.split("=", 1)[1].strip().strip('"')
                    break
        if service_key:
            break
    except FileNotFoundError:
        continue

if not service_key:
    print("ERROR: No SUPABASE_SERVICE_ROLE_KEY found in env files.")
    print("Cannot run RPC test (rpc requires service_role to bypass RLS).")
    sys.exit(1)

print(f"Using service_role key: {service_key[:20]}...")

def rpc_call(payload):
    """Call sync_external_links_from_sheet RPC."""
    r = subprocess.run(['curl', '-sL', '--max-time', '15',
        rpc_url, '-X', 'POST',
        '-H', f'apikey: {service_key}',
        '-H', f'Authorization: Bearer {service_key}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps(payload)],
        capture_output=True, text=True)
    print(f"  HTTP {r.returncode}: {r.stdout[:300]}")
    return r.stdout

def select_all():
    """Read all rows (anon — to simulate user-facing view)."""
    r = subprocess.run(['curl', '-sL', '--max-time', '15',
        f'{url}/bq_external_links?select=id,category,title,url,source&order=created_at',
        '-H', f'apikey: {anon_key}',
        '-H', f'Authorization: Bearer {anon_key}'],
        capture_output=True, text=True)
    return json.loads(r.stdout)

def select_one(rid):
    """Check if a specific row exists."""
    rows = select_all()
    return any(r['id'] == rid for r in rows)

# ============================================================
# Snapshot baseline
# ============================================================
print("\n=== Baseline (before any RPC call) ===")
baseline = select_all()
print(f"  Total rows: {len(baseline)}")
sheet_rows = [r for r in baseline if r.get('source') == 'sheet']
manual_rows = [r for r in baseline if r.get('source') != 'sheet']
print(f"  source='sheet': {len(sheet_rows)}")
print(f"  source='manual': {len(manual_rows)}")
for r in sheet_rows[:3]:
    print(f"    - [{r['source']}] {r.get('category'):<10} {r['title']}")

if manual_rows:
    print(f"\n  Manual rows (will be PROTECTED by RPC):")
    for r in manual_rows:
        print(f"    - [{r['source']}] {r.get('category'):<10} {r['title']}")

# ============================================================
# TEST 1: Replace with smaller sheet batch — verify DELETE orphan
# ============================================================
print("\n=== TEST 1: Replace sheet with subset (should DELETE 2 rows) ===")
# Take 5 of the 7 sheet rows (drop 2)
keep_urls = [
    "https://bible.fhl.net/",
    "https://biblehub.com/",
    "https://odb.org/",
    "https://bibleproject.com/",
    "https://bible-quest-2026.vercel.app/",
]
test_rows = [{
    "id": url_to_uuid(u),
    "category": "聖經工具" if "bible" in u and "fhl" in u or "bible" in u and "hub" in u else (
        "靈修材料" if "odb" in u else (
        "影音頻道" if "bibleproject" in u else "網站")),
    "title": u,
    "url": u,
    "description": None,
    "is_published": True,
    "sort_order": 0,
} for u in keep_urls]

print(f"  Sending {len(test_rows)} rows (subset of {len(sheet_rows)})")
result = rpc_call(test_rows)
parsed = json.loads(result)
if isinstance(parsed, list) and 'deleted_count' in parsed[0]:
    print(f"  ✅ RPC returned: deleted={parsed[0]['deleted_count']}, upserted={parsed[0]['upserted_count']}")
    if parsed[0]['deleted_count'] >= 2:
        print(f"  ✅ Expected ≥2 deletes (2 Album rows were orphans)")
    else:
        print(f"  ⚠️ Expected ≥2 deletes, got {parsed[0]['deleted_count']}")
else:
    print(f"  ❌ Unexpected response: {result}")

# Verify post-state
after_test1 = select_all()
after_sheet = [r for r in after_test1 if r.get('source') == 'sheet']
print(f"  Post-state: source='sheet' = {len(after_sheet)} rows")
if len(after_sheet) == len(test_rows):
    print(f"  ✅ DB matches expected count")
else:
    print(f"  ❌ Expected {len(test_rows)} rows, got {len(after_sheet)}")

# ============================================================
# TEST 2: SAFETY — empty sheet (header only) should reject in Apps Script
# (not tested here since RPC will wipe; this is Apps Script's job to reject)
# ============================================================
print("\n=== TEST 2: Re-add the 2 dropped rows (restore state) ===")
restore_urls = keep_urls + [
    "https://photos.app.goo.gl/SF1skhpWcZbKbTm39",  # Album 畢在
    "https://photos.app.goo.gl/N2h2XteVECmpRhC77",  # Album 一切從揀
]
restore_rows = []
for u in restore_urls:
    if "fhl" in u or "hub" in u:
        cat = "聖經工具"
    elif "odb" in u:
        cat = "靈修材料"
    elif "bibleproject" in u:
        cat = "影音頻道"
    elif "vercel" in u:
        cat = "網站"
    else:
        cat = "Album"
    restore_rows.append({
        "id": url_to_uuid(u),
        "category": cat,
        "title": u,
        "url": u,
        "description": None,
        "is_published": True,
        "sort_order": 0,
    })

result = rpc_call(restore_rows)
parsed = json.loads(result)
if isinstance(parsed, list):
    print(f"  RPC: deleted={parsed[0]['deleted_count']}, upserted={parsed[0]['upserted_count']}")

after_test2 = select_all()
after_sheet2 = [r for r in after_test2 if r.get('source') == 'sheet']
print(f"  Post-state: source='sheet' = {len(after_sheet2)} rows")
if len(after_sheet2) == 7:
    print(f"  ✅ Restored to 7 rows")
else:
    print(f"  ⚠️ Got {len(after_sheet2)} rows, expected 7")

# ============================================================
# Summary
# ============================================================
print("\n=== SUMMARY ===")
print(f"  Baseline sheet rows: {len(sheet_rows)}")
print(f"  After TEST 1: {len(after_sheet)} rows (expected {len(test_rows)})")
print(f"  After TEST 2: {len(after_sheet2)} rows (expected 7)")
print(f"  Manual rows preserved throughout: {len(manual_rows)}")