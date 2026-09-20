-- ==============================================================================
-- 009: ROW-LEVEL SECURITY
--
-- Context: the frontend (tourderotary-dsm) does NOT go through this Express
-- API for most reads/writes — it calls Supabase directly from the browser
-- with NEXT_PUBLIC_SUPABASE_ANON_KEY (see src/lib/supabase/queries/*.ts).
-- That means this backend's auth()/rbac() middleware never runs for those
-- calls, and until now, no migration in this repo enabled RLS on any table
-- — so every table was fully readable and writable by anyone holding the
-- anon key, which is necessarily public (it ships in the frontend bundle).
--
-- This migration is the actual authorization boundary for that access
-- pattern. It does NOT change how the Express backend talks to the
-- database — the backend connects with SUPABASE_SERVICE_ROLE_KEY, and
-- Supabase's service_role always bypasses RLS by design, so every
-- controller in this repo keeps working exactly as before.
--
-- Policy shape used throughout:
--   - `public.current_profile_id()` / `public.current_role()` resolve the
--     caller's profiles row the same way middleware/auth.js does — by
--     auth_user_id OR id, since 007_link_auth_signups_to_profiles.sql
--     documents that profiles.id is not always auth.uid() (the
--     guest-checkout-then-signup edge case).
--   - Tables the frontend never touches directly (payments, tickets,
--     digital_collectibles, orders line items, etc.) get RLS enabled with
--     NO policies — default-deny for anon/authenticated, still fully
--     usable by the backend's service-role connection.
-- ==============================================================================

-- ── Helper functions ─────────────────────────────────────────────────────────
-- SECURITY DEFINER + fixed search_path: these need to read `profiles`
-- themselves regardless of the caller's own RLS restrictions, or every
-- policy that calls them would recurse into (and be blocked by) RLS on
-- profiles. This is the standard Supabase pattern for role-lookup helpers.

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles
  WHERE auth_user_id = auth.uid() OR id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles
  WHERE auth_user_id = auth.uid() OR id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_role() IN ('admin', 'hq_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_volunteer_or_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_role() IN ('admin', 'hq_admin', 'volunteer');
$$;

-- ── profiles ───────────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own_or_staff ON profiles
  FOR SELECT
  USING (
    id = public.current_profile_id()
    OR public.is_volunteer_or_staff()  -- gate check-in scanner needs name/email lookup by bib code
  );

CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE
  USING (id = public.current_profile_id())
  WITH CHECK (id = public.current_profile_id());

CREATE POLICY profiles_update_staff ON profiles
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- A plain UPDATE policy on `profiles` would let a participant PATCH their
-- own `role` column straight to 'admin' — updateProfile() in the frontend
-- only ever sends full_name, but nothing at the database level stopped a
-- crafted request from sending more. RLS is row-level, not column-level,
-- so this has to be a trigger.
CREATE OR REPLACE FUNCTION public.prevent_self_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only staff can change a profile role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_role_escalation ON profiles;
CREATE TRIGGER trg_prevent_self_role_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_role_escalation();

-- ── registrations ─────────────────────────────────────────────────────────
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

-- getImpactStats() in sponsor.ts reads this table broadly and its own
-- comment says the numbers are "visible to all sponsors" — there's no PII
-- in this table (user_id is a UUID FK, not a name/email), so any
-- authenticated role reading it is an acceptable, deliberate trade-off.
-- Anonymous/unauthenticated requests are still denied.
CREATE POLICY registrations_select_authenticated ON registrations
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY registrations_insert_own ON registrations
  FOR INSERT
  WITH CHECK (
    user_id = public.current_profile_id()
    AND status = 'pending'
    AND payment_status = 'pending'
  );

CREATE POLICY registrations_update_staff ON registrations
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- Volunteers need to flip status to 'checked_in' on ANY participant's row
-- (that's the gate scanner) but must not be able to touch anything else on
-- that row — a broad UPDATE policy can't express "only this column
-- changed", so it's enforced by trigger below, same pattern as profiles.
CREATE POLICY registrations_checkin_volunteer ON registrations
  FOR UPDATE
  USING (public.current_role() = 'volunteer')
  WITH CHECK (public.current_role() = 'volunteer' AND status = 'checked_in');

CREATE OR REPLACE FUNCTION public.protect_registration_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_staff() THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.activity_slug IS DISTINCT FROM OLD.activity_slug
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.amount_tsh IS DISTINCT FROM OLD.amount_tsh
     OR NEW.bib_number IS DISTINCT FROM OLD.bib_number
  THEN
    RAISE EXCEPTION 'Only staff may change fields other than status';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_registration_columns ON registrations;
CREATE TRIGGER trg_protect_registration_columns
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.protect_registration_columns();

-- ── sponsors ──────────────────────────────────────────────────────────────
ALTER TABLE sponsors ENABLE ROW LEVEL SECURITY;

CREATE POLICY sponsors_select_own_or_staff ON sponsors
  FOR SELECT
  USING (user_id = public.current_profile_id() OR public.is_staff());

CREATE POLICY sponsors_write_staff ON sponsors
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
-- No INSERT policy for non-staff: the frontend has no sponsor self-signup
-- write path today (only admin.ts creates/edits sponsors) — service role
-- or a staff-only policy can be added if that changes.

-- ── sponsor_assets ────────────────────────────────────────────────────────
ALTER TABLE sponsor_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY sponsor_assets_select_owner_or_staff ON sponsor_assets
  FOR SELECT
  USING (
    public.is_staff()
    OR sponsor_id IN (SELECT id FROM sponsors WHERE user_id = public.current_profile_id())
  );

-- ── partners ──────────────────────────────────────────────────────────────
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY partners_select_own_or_staff ON partners
  FOR SELECT
  USING (user_id = public.current_profile_id() OR public.is_staff());

CREATE POLICY partners_write_staff ON partners
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ── partner_deliverables ──────────────────────────────────────────────────
ALTER TABLE partner_deliverables ENABLE ROW LEVEL SECURITY;

-- hq_notes is documented in the frontend types as "partners can read, not
-- write" — matched here by giving partners SELECT only, no UPDATE policy.
CREATE POLICY partner_deliverables_select_owner_or_staff ON partner_deliverables
  FOR SELECT
  USING (
    public.is_staff()
    OR partner_id IN (SELECT id FROM partners WHERE user_id = public.current_profile_id())
  );

CREATE POLICY partner_deliverables_write_staff ON partner_deliverables
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ── orders ────────────────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_own_or_staff ON orders
  FOR SELECT
  USING (user_id = public.current_profile_id() OR public.is_staff());

CREATE POLICY orders_write_staff ON orders
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ── products ──────────────────────────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Merch catalogue is meant to be publicly browsable (homepage merch
-- preview, participant merch page) — readable by anyone, writable by
-- staff only (updateProductStock in admin.ts).
CREATE POLICY products_select_public ON products
  FOR SELECT
  USING (true);

CREATE POLICY products_write_staff ON products
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ── event_config ──────────────────────────────────────────────────────────
-- Two separate bugs found cross-checking this table against what the
-- frontend actually sends, both unrelated to RLS but fixed here since we're
-- already touching this table:
--
-- 1. updated_by: admin.ts's setEventPhase() writes `updated_by: actorId` on
--    every call, but no migration ever defined that column.
-- 2. id type: event_config.id is `UUID DEFAULT uuid_generate_v4()`, but
--    setEventPhase() always does `.upsert({ id: 1, ... }, { onConflict:
--    'id' })` — the frontend was written assuming a singleton row keyed by
--    the literal integer 1. Upserting id:1 against a UUID column throws
--    "invalid input syntax for type uuid" — this call has never been able
--    to succeed. Converting id to an INTEGER singleton (collapsing to
--    whichever existing row was most recently updated, if any) makes the
--    column match what every caller already assumes.
ALTER TABLE event_config ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

DO $$
DECLARE
  keep_row RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_config' AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    SELECT phase, event_date, updated_by, updated_at INTO keep_row
    FROM event_config ORDER BY updated_at DESC NULLS LAST LIMIT 1;

    DELETE FROM event_config;

    ALTER TABLE event_config DROP CONSTRAINT IF EXISTS event_config_pkey;
    ALTER TABLE event_config ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE event_config ALTER COLUMN id TYPE INTEGER USING NULL;
    ALTER TABLE event_config ALTER COLUMN id SET DEFAULT 1;
    ALTER TABLE event_config ADD CONSTRAINT event_config_pkey PRIMARY KEY (id);
    ALTER TABLE event_config ADD CONSTRAINT event_config_singleton CHECK (id = 1);

    INSERT INTO event_config (id, phase, event_date, updated_by, updated_at)
    VALUES (
      1,
      COALESCE(keep_row.phase, 'pre_event'),
      keep_row.event_date,
      keep_row.updated_by,
      COALESCE(keep_row.updated_at, NOW())
    );
  END IF;
END $$;

ALTER TABLE event_config ENABLE ROW LEVEL SECURITY;

-- Phase banner reads this even for logged-out visitors on the public site.
CREATE POLICY event_config_select_public ON event_config
  FOR SELECT
  USING (true);

CREATE POLICY event_config_write_staff ON event_config
  FOR ALL
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ── audit_logs ─────────────────────────────────────────────────────────────
-- Staff-only, and no UPDATE/DELETE policy at all for anyone — the audit
-- trail should only ever grow, and only via an authenticated staff action.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select_staff ON audit_logs
  FOR SELECT
  USING (public.is_staff());

CREATE POLICY audit_log_insert_staff ON audit_logs
  FOR INSERT
  WITH CHECK (public.is_staff());

-- ── shifts ────────────────────────────────────────────────────────────────
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY shifts_select_authenticated ON shifts
  FOR SELECT
  USING (auth.role() = 'authenticated');
-- No write policy from the client: shift creation/editing has no frontend
-- write path today; staff manage shifts via the backend/service role.

-- ── volunteer_shifts ──────────────────────────────────────────────────────
ALTER TABLE volunteer_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY volunteer_shifts_select_own_or_staff ON volunteer_shifts
  FOR SELECT
  USING (volunteer_id = public.current_profile_id() OR public.is_staff());

CREATE POLICY volunteer_shifts_insert_own ON volunteer_shifts
  FOR INSERT
  WITH CHECK (volunteer_id = public.current_profile_id());

CREATE POLICY volunteer_shifts_delete_own ON volunteer_shifts
  FOR DELETE
  USING (volunteer_id = public.current_profile_id());

-- ── Default-deny hardening for everything else ───────────────────────────
-- These tables are never touched directly by the frontend (confirmed by
-- grepping tourderotary-dsm's src/lib/supabase/queries/*.ts) — only by this
-- backend's service-role connection, which bypasses RLS regardless. Turning
-- RLS on with zero policies makes that the enforced behavior rather than an
-- assumption: if any of these ever gets a stray client-side call added
-- later, it fails closed instead of silently working.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activities', 'tickets', 'payments', 'digital_collectibles',
    'order_items', 'product_variants', 'promo_codes', 'refund_requests',
    'inventory_reservations', 'participant_wishlist', 'referrals',
    'campaigns', 'communication_queue', 'communication_templates',
    'newsletter_subscribers', 'social_shares', 'incidents',
    'evaluation_surveys', 'site_content', 'volunteer_assignments',
    'sponsor_deliverables', 'partner_clearances', 'event_editions',
    'audit_logs'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;
