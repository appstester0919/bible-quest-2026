// tools/external-links-sync.gs
// =============================================================
// Bible Quest 2026 — 外網連結 sheet → Supabase sync
// Round 24 (2026-09-09)
//
// DEPLOY INSTRUCTIONS (for KH LAI / sheet owner):
// 1. Open your Google Sheet "Bible Quest 外網連結"
// 2. Extensions → Apps Script → paste this code
// 3. Project Settings (gear icon) → Script Properties:
//      - SUPABASE_URL = https://xybrbennsttjttxoq.supabase.co
//      - SUPABASE_SERVICE_KEY = <service_role key from Supabase
//        dashboard Settings → API>  ← NEVER commit this key.
// 4. Triggers (clock icon, left sidebar) → Add Trigger:
//      - Choose which function to run: syncExternalLinks
//      - Which deployment: Head
//      - Event source: From spreadsheet
//      - Event type: On change
//      - Save. Authorize when prompted.
//
// Once installed, any edit to the sheet (insert/update/delete row)
// auto-fires syncExternalLinks → full-sheet PostgREST upsert.
// =============================================================

const SHEET_NAME = 'Links'            // tab name in your sheet
const SUPABASE_TABLE = 'bq_external_links'

function syncExternalLinks(e) {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(30000)) {
    logSync_('SKIP: another sync in progress')
    return
  }

  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
    if (!sheet) {
      logSync_('ERROR: sheet "' + SHEET_NAME + '" not found')
      return
    }

    const data = sheet.getDataRange().getValues()
    if (data.length < 2) {
      logSync_('SKIP: only header row')
      return
    }

    const headers = data[0].map(h => String(h).toLowerCase().trim())
    const col = {
      category: headers.indexOf('category'),
      title: headers.indexOf('title'),
      url: headers.indexOf('url'),
      description: headers.indexOf('description'),
      published: headers.indexOf('published'),
    }
    if (col.title === -1 || col.url === -1) {
      logSync_('ERROR: required columns title/url missing')
      return
    }

    const rows = []
    for (let i = 1; i < data.length; i++) {
      const r = data[i]
      const title = String(r[col.title] || '').trim()
      const url = String(r[col.url] || '').trim()
      if (!title || !url) continue

      rows.push({
        // Deterministic id derived from URL → re-syncs upsert cleanly.
        // URL edits become a NEW row (deliberate trade-off; see header).
        id: hashUrl_(url),
        category: col.category !== -1 ? String(r[col.category] || '').trim() || '其他' : '其他',
        title,
        url,
        description: col.description !== -1 ? String(r[col.description] || '').trim() || null : null,
        is_published: col.published !== -1 ? parsePublished_(r[col.published]) : true,
      })
    }

    const SUPABASE_URL = PropertiesService.getScriptProperties().getProperty('SUPABASE_URL')
    const SUPABASE_KEY = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY')
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      logSync_('ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY not set in Script Properties')
      return
    }

    let ok = 0, fail = 0
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500)
      const result = upsertBatch_(SUPABASE_URL, SUPABASE_KEY, batch)
      ok += result.ok
      fail += result.fail
    }
    logSync_(`OK: synced ${ok} rows, ${fail} failed`)
  } catch (err) {
    logSync_('EXCEPTION: ' + (err.message || err))
  } finally {
    lock.releaseLock()
  }
}

function parsePublished_(v) {
  if (typeof v === 'boolean') return v
  const s = String(v || '').toLowerCase().trim()
  if (s === '' || s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === '✓' || s === 'v') return true
  return false
}

function hashUrl_(url) {
  // Stable hash for use as primary key. Same URL → same id → clean upsert.
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, url)
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('').slice(0, 32)
}

function upsertBatch_(url, key, rows) {
  const resp = UrlFetchApp.fetch(`${url}/rest/v1/${SUPABASE_TABLE}`, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Prefer: 'resolution=merge-duplicates',
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  })
  const code = resp.getResponseCode()
  if (code >= 200 && code < 300) return { ok: rows.length, fail: 0 }
  logSync_(`UPSERT FAILED HTTP ${code}: ${resp.getContentText().slice(0, 300)}`)
  return { ok: 0, fail: rows.length }
}

function logSync_(msg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  let logSheet = ss.getSheetByName('_LOG')
  if (!logSheet) {
    logSheet = ss.insertSheet('_LOG')
    logSheet.appendRow(['timestamp', 'message'])
  }
  logSheet.appendRow([new Date().toISOString(), msg])
}
