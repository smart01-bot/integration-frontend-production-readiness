-- ==============================================================================
-- 015: ALIGN EVENT DATES TO THE FRONTEND CALENDAR
--
-- The frontend (tourderotary-dsm) hardcodes the event calendar in
-- src/lib/constants.ts (EVENT_DATE = 2026-11-01T06:00:00+03:00, "1 November
-- 2026") and src/lib/phase.ts (EVENT_END = 2026-11-01T18:00:00+03:00).
-- Migration 014 seeded event_editions.event_date = 2026-10-18 and left
-- event_config.event_date NULL, so:
--   - the backend phase engine derived the phase from the wrong date, and
--   - event_config carried no date for any DB-driven countdown.
--
-- This migration aligns both rows with what the frontend displays so the
-- phase engine, countdowns, and race-day windows agree across the stack.
-- Idempotent: safe to re-run.
-- ==============================================================================

UPDATE public.event_editions
SET event_date = '2026-11-01 06:00:00+03'
WHERE year = 2026;

UPDATE public.event_editions
SET config_json = COALESCE(config_json, '{}'::jsonb) || '{"event_day_duration_hours": 12}'::jsonb
WHERE year = 2026
  AND (config_json IS NULL OR NOT (config_json ? 'event_day_duration_hours'));

INSERT INTO public.event_config (id, phase, event_date, updated_at)
VALUES (1, 'pre_event', '2026-11-01 06:00:00+03', NOW())
ON CONFLICT (id) DO UPDATE
SET event_date = EXCLUDED.event_date;

-- Keep the existing phase (should still be pre_event on 2026-09-15); the
-- phase engine re-derives it automatically if the date shift ever crosses a
-- boundary.
SELECT
  year, title, event_date, current_phase
FROM public.event_editions
WHERE year = 2026;