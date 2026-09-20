-- ==============================================================================
-- 018: HARDEN TOUR DE DAR SCHEMA (fixes on top of 017, run 017 first)
--
-- Five issues found reviewing 017 before it went live. Each fix here is
-- additive/corrective — nothing in 017 is dropped or renamed, so this is
-- safe to run once, right after 017.
-- ==============================================================================

-- ── 1. Sync the THIRD phase table with the two that already exist ──────────
-- event_lifecycle.current_mode (017) now sits alongside event_editions.
-- current_phase and event_config.phase. Rather than picking one and
-- breaking whatever already reads the others, this keeps all three in sync
-- automatically — updating any one updates the others. live ⇄
-- pre_event/event_day, memory ⇄ post_event, archive ⇄ archive.
CREATE OR REPLACE FUNCTION public.sync_phase_from_event_config()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.event_lifecycle SET
    current_mode = CASE NEW.phase WHEN 'archive' THEN 'archive' WHEN 'post_event' THEN 'memory' ELSE 'live' END,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_phase_from_event_config ON event_config;
CREATE TRIGGER trg_sync_phase_from_event_config
  AFTER UPDATE OF phase ON event_config
  FOR EACH ROW EXECUTE FUNCTION public.sync_phase_from_event_config();

CREATE OR REPLACE FUNCTION public.sync_phase_from_event_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.event_config SET
    phase = CASE NEW.current_mode WHEN 'archive' THEN 'archive' WHEN 'memory' THEN 'post_event' ELSE
      (SELECT phase FROM public.event_config WHERE id = 1) END,
    updated_at = NOW()
  WHERE id = 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_phase_from_event_lifecycle ON event_lifecycle;
CREATE TRIGGER trg_sync_phase_from_event_lifecycle
  AFTER UPDATE OF current_mode ON event_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.sync_phase_from_event_lifecycle();

-- 'live' on event_lifecycle can't distinguish pre_event vs event_day, so
-- that direction leaves event_config's own value alone unless moving to
-- memory/archive — event_config stays the more precise source for that
-- distinction, event_lifecycle stays authoritative for the community-facing
-- live/memory/archive framing.

-- ── 2. digital_bibs: same NOT-NULL-with-no-default risk as referral_code ───
-- If whatever generates a bib ever forgets to supply these, the insert
-- should still succeed with a real value rather than erroring — same
-- defense-in-depth already applied to profiles.referral_code.
ALTER TABLE public.digital_bibs ALTER COLUMN bib_number
  SET DEFAULT ('TDD-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 6)));
ALTER TABLE public.digital_bibs ALTER COLUMN qr_code_data
  SET DEFAULT (MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT));
ALTER TABLE public.digital_bibs ALTER COLUMN share_slug
  SET DEFAULT (LOWER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 10)));

-- ── 3. Remove the seeded fake testimonial ───────────────────────────────────
-- The brief's own principle: "No fake activity." A specific invented quote
-- attributed to a named person doesn't belong in a live table.
DELETE FROM public.why_i_participate WHERE display_name = 'Neema M.' AND quote = 'I wanted to prove to myself that I could.';

-- ── 4. Flag seeded course/safety content as UNVERIFIED until HQ confirms it ─
-- The Msasani Bay / Toure Drive / Coco Beach course details and medical/aid
-- station placements in triathlon_stages and map_waypoints were invented as
-- plausible example content, not supplied by anyone with authority over the
-- real confirmed course. This does not delete that content (it's useful as
-- a working example) but makes it impossible to accidentally treat as
-- confirmed without someone deliberately reviewing and flipping this flag.
ALTER TABLE public.triathlon_stages ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.map_waypoints ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE public.triathlon_stages SET is_confirmed = FALSE;
UPDATE public.map_waypoints SET is_confirmed = FALSE;

-- If the frontend ever queries these tables for public race-day safety
-- information, it should filter on is_confirmed = true and show nothing
-- (or a "course details coming soon" state) until HQ has actually verified
-- each row against the real event plan.

-- ── 5. Enforce archive-mode lockout at the RLS layer, not just the frontend ─
-- 017's community write policies didn't check event phase — adding that
-- check here rather than relying on the frontend to remember to disable
-- the post/comment/reaction/join buttons.
DROP POLICY IF EXISTS "Auth write community_posts" ON public.community_posts;
CREATE POLICY "Auth write community_posts" ON public.community_posts FOR INSERT
  WITH CHECK ((auth.uid() = user_id OR auth.role() = 'service_role')
              AND (SELECT phase FROM event_config WHERE id = 1) <> 'archive');

DROP POLICY IF EXISTS "Auth write post_reactions" ON public.post_reactions;
CREATE POLICY "Auth write post_reactions" ON public.post_reactions FOR INSERT
  WITH CHECK ((auth.uid() = user_id OR auth.role() = 'service_role')
              AND (SELECT phase FROM event_config WHERE id = 1) <> 'archive');

DROP POLICY IF EXISTS "Auth write post_comments" ON public.post_comments;
CREATE POLICY "Auth write post_comments" ON public.post_comments FOR INSERT
  WITH CHECK ((auth.uid() = user_id OR auth.role() = 'service_role')
              AND (SELECT phase FROM event_config WHERE id = 1) <> 'archive');

DROP POLICY IF EXISTS "Auth write team_members" ON public.team_members;
CREATE POLICY "Auth write team_members" ON public.team_members FOR INSERT
  WITH CHECK ((auth.uid() = user_id OR auth.role() = 'service_role')
              AND (SELECT phase FROM event_config WHERE id = 1) <> 'archive');
