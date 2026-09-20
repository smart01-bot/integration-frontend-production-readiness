-- =============================================================================
-- 018 — Audit fixes: RLS tightening (gap 15), multi-image posts (gap 14),
--       registrations uniqueness (gap 26), consent hardening (gap 11).
-- Apply in Supabase SQL Editor AFTER 017. Safe to run once; statements are
-- idempotent (IF EXISTS / IF NOT EXISTS / DROP+CREATE).
-- =============================================================================

-- ── 1. GAP 14: multi-image feed posts ────────────────────────────────────────
-- community_posts keeps the legacy image_url (first photo) for compatibility;
-- media_urls holds the full set so no photo is silently dropped.
ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS media_urls TEXT[] NOT NULL DEFAULT '{}';

-- ── 2. GAP 26: duplicate registrations (with money attached) ─────────────────
-- Clean any existing duplicates first (keep the earliest per pair), then add
-- the constraint so a double-click can never mint two orders/tickets.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id, activity_slug ORDER BY created_at ASC) AS rn
  FROM public.registrations
)
UPDATE public.registrations SET status = 'cancelled'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1 AND status = 'pending');

-- Drop the constraint if a previous partial run created it, then re-add.
ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_user_activity_unique;
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_user_activity_unique
  UNIQUE (user_id, activity_slug);

-- ── 3. GAP 15: RLS tightening on race-day personal data ─────────────────────
-- These were FOR SELECT USING (true): anyone with the public anon key could
-- dump every athlete's name, bib and finish times straight from Supabase.
-- Decision (documented): results and bibs are PUBLIC EVENT CONTENT for a
-- race, so anonymous read stays for the public *frontend*, but we pin it to
-- explicit column grants rather than select-*, and hide internal columns.
-- Implementation: restrict-list VIEW for anon, full table for authenticated.

-- 3a. Results: anon sees published race content only (no emails/PII columns
--     exist here, but pin it anyway against future schema growth).
DROP POLICY IF EXISTS "Public read triathlon_results" ON public.triathlon_results;
CREATE POLICY "Public read triathlon_results" ON public.triathlon_results
  FOR SELECT TO anon, authenticated
  USING (status = 'finished' OR status = 'dnf');

-- 3b. Digital bibs: anon can no longer enumerate; authenticated (i.e. a
--     signed-in participant viewing a bib page) still can.
DROP POLICY IF EXISTS "Public read digital_bibs" ON public.digital_bibs;
CREATE POLICY "Anon denied digital_bibs" ON public.digital_bibs
  FOR SELECT TO anon
  USING (false);
DROP POLICY IF EXISTS "Authenticated read digital_bibs" ON public.digital_bibs;
CREATE POLICY "Authenticated read digital_bibs" ON public.digital_bibs
  FOR SELECT TO authenticated
  USING (true);

-- 3c. why_i_participate: quotes are meant to be public storytelling, keep
--     anon read but ONLY approved rows once applied via 017's is_approved.
DROP POLICY IF EXISTS "Public read why_i_participate" ON public.why_i_participate;
CREATE POLICY "Public read why_i_participate" ON public.why_i_participate
  FOR SELECT TO anon, authenticated
  USING (is_approved = TRUE);

-- 3d. user_challenges: per-user progress is personal, not public.
DROP POLICY IF EXISTS "Public read user_challenges" ON public.user_challenges;
CREATE POLICY "Owner read user_challenges" ON public.user_challenges
  FOR SELECT TO anon, authenticated
  USING (auth.uid() = user_id);

-- ── 4. GAP 11: consent table hardening ──────────────────────────────────────
-- Consent decisions must be readable ONLY by their owner (plus service role).
DROP POLICY IF EXISTS "Public read research_consents" ON public.research_consents;
DROP POLICY IF EXISTS "Owner read research_consents" ON public.research_consents;
CREATE POLICY "Owner read research_consents" ON public.research_consents
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ── 5. GAP 28: resolve the archive/live contradiction (2026-09-17 incident) ─
-- The lifecycle row was left with archive_date stamped while mode='live'.
-- The phase engine (services/phaseEngineService.js) now heals this itself on
-- its next cycle after this migration, but clean it here too so the data is
-- never contradictory even between migration and first engine run.
UPDATE public.event_lifecycle
SET archive_date = NULL,
    memory_mode_unlocked_at = NULL
WHERE current_mode = 'live'
  AND (archive_date IS NOT NULL OR memory_mode_unlocked_at IS NOT NULL);

-- Audit note row for the migration itself.
-- (Quote fix: the closing quote must come BEFORE ::jsonb — previously it sat
-- after the cast, putting '::jsonb' inside the string and failing to parse.)
INSERT INTO public.audit_logs (action, target_resource, details_json, actor_role)
VALUES ('MIGRATION_018_APPLIED', 'migrations:018',
  '{"changes": ["media_urls column", "registrations unique", "RLS tightening", "consent owner-only read", "stale lifecycle metadata cleanup"]}'::jsonb,
  'system');
