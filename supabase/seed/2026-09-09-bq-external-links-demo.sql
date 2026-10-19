-- 2026-09-09 — bq_external_links SEED DATA (Round 24)
--
-- Run this in Supabase SQL Editor AFTER applying
-- 20260909000000_bq_external_links.sql.
--
-- Idempotent: each row's id is SHA-1(url) hex[0:32] formatted as UUID.
-- Re-running this is safe (same id → upsert / ON CONFLICT skip).
--
-- Demo rows: 5 well-known Bible / faith resources covering all 4
-- categories (聖經工具 / 靈修材料 / 影音頻道 / 網站). Edit freely.

insert into public.bq_external_links (id, category, title, url, description, is_published, sort_order) values
  ('572fc4ff-3a87-89e0-8acd-e9b9ebfae360', '聖經工具', '信望愛信仰寶庫 (fhl.net)', 'https://bible.fhl.net/', '台灣信望愛信仰寶庫 — 原文編號查經、字典、經文註釋。支援 UNV / CUV / 和合本多版本切換。', true, 1),
  ('a6caf378-0210-cf8a-a507-7924a2181360', '聖經工具', 'Bible Hub (多版本並行)', 'https://biblehub.com/', '多版本英文聖經並排顯示，含原文希臘文 / 希伯來文逐字分析。查原文編號好幫手。', true, 2),
  ('488fac7a-ec5e-2d9e-f347-fd7fcc0b834c', '靈修材料', '靈命日糧 (Our Daily Bread)', 'https://odb.org/', '每日靈修短文，有廣東話 / 普通話 / English 多語版本。適合晨更默想。', true, 1),
  ('b40100ab-044b-857e-ce31-c9f1b19e55c1', '影音頻道', '聖經故事動畫 (The Bible Project)', 'https://bibleproject.com/', '以動畫短片逐卷概述聖經信息。中文配音 / 字幕齊全，視覺化查經入門好幫手。', true, 1),
  ('dfc96567-ec8b-a6a3-2298-021b556c5393', '網站', 'Bible Quest 2026 官方頁', 'https://bible-quest-2026.vercel.app/', '本站。粵語聖經速讀 + 操練版面。', true, 1)
on conflict (id) do update set
  category = excluded.category,
  title = excluded.title,
  url = excluded.url,
  description = excluded.description,
  is_published = excluded.is_published,
  sort_order = excluded.sort_order
;