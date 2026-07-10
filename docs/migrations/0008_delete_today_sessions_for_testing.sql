-- Migration 0008: Delete today's reading sessions for testing
-- Run this to reset today's reading so you can test the calendar
-- uncomplete/re-complete cycle.
-- Status: idempotent

-- Delete reading sessions for today (2026-07-10) for the user's enrollment
DELETE FROM reading_sessions
WHERE date_local = '2026-07-10'
  AND enrollment_id = 'db0b61c1-26e2-4b74-96da-bb721bcce697';
