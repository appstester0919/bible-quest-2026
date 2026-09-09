// tools/external-links-sync.gs
// =============================================================
// Bible Quest 2026 — 外網連結 sheet → Supabase sync (REPLACE pattern)
//
// Round 27 (2026-09-09) — change from upsert-only to replace:
//   - Sheet additions are reflected in DB (as before)
//   - Sheet edits are reflected in DB (as before)
//   - Sheet DELETIONS now also remove the row from DB ← NEW
//   - Safety check: if sheet appears empty (header only), abort to
//     avoid wiping the entire DB due to accidental header corruption.
//
// Architecture:
//   Apps Script onChange → parse sheet → call Postgres RPC
//   `sync_external_links_from_sheet(jsonb)` which does both DELETE
//   orphans + UPSERT incoming in one transaction (SECURITY DEFINER
//   bypasses RLS for the atomic transaction).
//
// DEPLOY INSTRUCTIONS (for KH LAI / sheet owner):
// 1. Open your Google Sheet "Bible Quest 外網連結"
// 2. Extensions → Apps Script → paste this code
// 3. Project Settings (gear icon) → Script Properties:
//      - SUPABASE_URL = https://xybrbennsttjttxuxqoq.supabase.co
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
// auto-fires syncExternalLinks → atomic replace of DB sheet-sourced rows.
// =============================================================

const SHEET_NAME = 'Links'            // tab name in your sheet
const SUPABASE_RPC = 'sync_external_links_from_sheet'

// =============================================================
// Main entry — atomic DELETE orphans + UPSERT sheet rows
// =============================================================

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
      logSync_('SKIP: only header row present')
      return
    }

    const parsed = parseSheet_(data)
    if (!parsed) return  // error already logged

    // SAFETY CHECK: if user accidentally deletes all data rows, don't wipe DB.
    // We allow the wipe only if sheet had previous data AND user explicitly
    // emptied it (rare). Most sheet-empty events are mistakes.
    if (parsed.rows.length === 0 && data.length > 1) {
      // All rows got filtered out (e.g. every row missing title/url)
      // → likely header corruption or wrong sheet. Reject.
      logSync_(
        'REJECTED: sheet has ' + (data.length - 1) + ' data rows but 0 valid. ' +
        'Possible header corruption or wrong sheet tab. Aborting to avoid DB wipe.'
      )
      MailApp.sendEmail(
        Session.getActiveUser().getEmail(),
        'DuoBible Links sync REJECTED (data rows invalid)',
        'Sheet "' + SHEET_NAME + '" has ' + (data.length - 1) + ' data rows but ' +
        '0 valid rows after parsing. Sync aborted to avoid wiping DB.\n\n' +
        'Check that your header row uses: category | title | url | description | published\n' +
        'And that data rows have non-empty title and url columns.'
      )
      return
    }

    const SUPABASE_URL = PropertiesService.getScriptProperties().getProperty('SUPABASE_URL')
    const SUPABASE_KEY = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY')
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      logSync_('ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY not set in Script Properties')
      return
    }

    // Single atomic RPC call: DELETE orphans + UPSERT sheet rows in one transaction
    const result = callSyncRpc_(SUPABASE_URL, SUPABASE_KEY, parsed.rows)
    if (result.ok) {
      logSync_(
        'OK: synced ' + parsed.rows.length + ' sheet rows. ' +
        'Deleted ' + result.deleted + ' orphan(s), upserted ' + result.upserted + '.'
      )
    } else {
      logSync_('FAILED: ' + result.error)
    }
  } catch (err) {
    logSync_('EXCEPTION: ' + (err.message || err))
  } finally {
    lock.releaseLock()
  }
}

// =============================================================
// Sheet parser — converts raw sheet rows to normalized objects
// =============================================================

function parseSheet_(data) {
  const headers = data[0].map(h => String(h).toLowerCase().trim())
  const col = {
    category: headers.indexOf('category'),
    title: headers.indexOf('title'),
    url: headers.indexOf('url'),
    description: headers.indexOf('description'),
    published: headers.indexOf('published'),
    sort_order: headers.indexOf('sort_order'),
  }
  if (col.title === -1 || col.url === -1) {
    logSync_('ERROR: required columns title/url missing. Header should be: category | title | url | description | published')
    return null
  }

  const rows = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]
    const title = String(r[col.title] || '').trim()
    const url = String(r[col.url] || '').trim()
    if (!title || !url) continue

    rows.push({
      // Deterministic id derived from URL → re-syncs upsert cleanly.
      // URL edits become a NEW row (deliberate trade-off).
      id: hashUrl_(url),
      category: col.category !== -1
        ? String(r[col.category] || '').trim() || '其他'
        : '其他',
      title,
      url,
      description: col.description !== -1
        ? String(r[col.description] || '').trim() || null
        : null,
      is_published: col.published !== -1
        ? parsePublished_(r[col.published])
        : true,
      sort_order: col.sort_order !== -1
        ? parseInt(r[col.sort_order], 10) || 0
        : 0,
    })
  }
  return { rows: rows }
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

// =============================================================
// Supabase RPC call — atomic DELETE orphans + UPSERT incoming
// =============================================================

function callSyncRpc_(url, key, rows) {
  // POST to /rest/v1/rpc/<function_name> with the function args as a JSON
  // OBJECT whose key matches the function's parameter name (PostgREST RPC
  // convention for jsonb params — bare arrays return PGRST202). The function
  // signature is `sync_external_links_from_sheet(incoming_rows jsonb)`, so
  // body must be `{"incoming_rows": [...]}`.
  const resp = UrlFetchApp.fetch(`${url}/rest/v1/rpc/${SUPABASE_RPC}`, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
    },
    payload: JSON.stringify({ incoming_rows: rows }),
    muteHttpExceptions: true,
  })

  const code = resp.getResponseCode()
  const body = resp.getContentText()

  if (code >= 200 && code < 300) {
    // Response: [{ deleted_count: N, upserted_count: M }]
    let deleted = 0, upserted = 0
    try {
      const parsed = JSON.parse(body)
      if (Array.isArray(parsed) && parsed.length > 0) {
        deleted = parsed[0].deleted_count || 0
        upserted = parsed[0].upserted_count || 0
      }
    } catch (e) {
      // parse failure — log but don't fail
    }
    return { ok: true, deleted: deleted, upserted: upserted }
  }

  return {
    ok: false,
    error: `HTTP ${code}: ${body.slice(0, 400)}`,
  }
}

// =============================================================
// Audit logging — writes to _LOG tab with timestamp + message
// =============================================================

function logSync_(msg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  let logSheet = ss.getSheetByName('_LOG')
  if (!logSheet) {
    logSheet = ss.insertSheet('_LOG')
    logSheet.appendRow(['timestamp', 'message'])
  }
  logSheet.appendRow([new Date().toISOString(), msg])
}