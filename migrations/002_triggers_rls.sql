-- ==============================================================================
-- TOUR DE DAR 2026 — CONSOLIDATED TRIGGERS & RLS (002_triggers_rls.sql)
--
-- This file defines:
--   1. Helper security functions (role resolution, staff check)
--   2. Auth signup linking trigger (auth.users -> profiles)
--   3. Profile escalation protection
--   4. Registrations -> Orders & Tickets synchronization triggers
--   5. Product variants & stock synchronization triggers
--   6. Event phase 3-way synchronization (event_config <-> event_lifecycle)
--   7. audit_log compatibility view & INSTEAD OF trigger
--   8. Row-Level Security (RLS) policies for frontend anon/authenticated access
--
-- Apply in Supabase SQL Editor AFTER 001_schema.sql.
-- ==============================================================================

-- ==============================================================================
-- 1. HELPER FUNCTIONS
-- ==============================================================================

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

CREATE OR REPLACE FUNCTION public.increment_challenge_completion(challenge_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.challenges
  SET completion_count = completion_count + 1
  WHERE id = challenge_id;
$$;

-- ==============================================================================
-- 2. AUTH SIGNUP TRIGGER (auth.users -> profiles)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_ref_code TEXT;
  v_role     TEXT;
  v_phone    TEXT;
BEGIN
  v_ref_code := 'TDR' || UPPER(SUBSTRING(MD5(NEW.id::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 8));
  v_role     := COALESCE(NEW.raw_user_meta_data->>'role', 'participant');
  v_phone    := COALESCE(NEW.raw_user_meta_data->>'phone', NEW.raw_user_meta_data->>'phone_number', NULL);

  -- Case 1: Update existing guest-checkout profile if email matches
  UPDATE public.profiles
  SET
    auth_user_id  = NEW.id,
    role          = COALESCE(role, v_role),
    phone         = COALESCE(phone, v_phone),
    phone_number  = COALESCE(phone_number, v_phone),
    referral_code = COALESCE(referral_code, v_ref_code)
  WHERE email = NEW.email
    AND auth_user_id IS NULL;

  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- Case 2: Brand new profile
  INSERT INTO public.profiles (
    id,
    auth_user_id,
    full_name,
    email,
    phone_number,
    phone,
    role,
    referral_code
  )
  VALUES (
    NEW.id,
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    v_phone,
    v_phone,
    v_role,
    v_ref_code
  )
  ON CONFLICT (email) DO UPDATE
    SET auth_user_id  = EXCLUDED.auth_user_id,
        referral_code = COALESCE(public.profiles.referral_code, EXCLUDED.referral_code);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ==============================================================================
-- 3. PROFILE ESCALATION PREVENTION
-- ==============================================================================

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

DROP TRIGGER IF EXISTS trg_prevent_self_role_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_self_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_role_escalation();

-- ==============================================================================
-- 4. REGISTRATIONS -> ORDERS & TICKETS PIPELINE
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.registration_to_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref_id        UUID;
  v_title         TEXT;
  v_edition_id    UUID;
  v_phone         TEXT;
  v_order_number  TEXT;
  v_order_id      UUID;
BEGIN
  -- Look up in race_categories (triathlon) first, fall back to activities (legacy)
  SELECT id, name INTO v_ref_id, v_title FROM public.race_categories WHERE slug = NEW.activity_slug LIMIT 1;
  IF v_ref_id IS NULL THEN
    SELECT id, title INTO v_ref_id, v_title FROM public.activities WHERE slug = NEW.activity_slug LIMIT 1;
  END IF;

  SELECT id INTO v_edition_id FROM public.event_editions ORDER BY year DESC LIMIT 1;
  SELECT COALESCE(phone_number, phone) INTO v_phone FROM public.profiles WHERE id = NEW.user_id;

  v_order_number := 'TDR-2026-' || LPAD((10000 + floor(random() * 90000))::TEXT, 5, '0');

  INSERT INTO public.orders (
    order_number, profile_id, user_id, edition_id, status,
    subtotal_tsh, discount_tsh, total_tsh, currency, billing_phone,
    source_registration_id
  ) VALUES (
    v_order_number, NEW.user_id, NEW.user_id, v_edition_id,
    CASE NEW.status WHEN 'paid' THEN 'paid' WHEN 'cancelled' THEN 'cancelled' ELSE 'pending' END,
    COALESCE(NEW.amount_tsh, 0), 0, COALESCE(NEW.amount_tsh, 0), 'TZS',
    COALESCE(v_phone, 'unknown'), NEW.id
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, item_type, reference_id, description, quantity, unit_price_tsh, subtotal_tsh)
  VALUES (v_order_id, 'activity_ticket', v_ref_id, COALESCE(v_title, NEW.activity_slug), 1,
          COALESCE(NEW.amount_tsh, 0), COALESCE(NEW.amount_tsh, 0));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registration_to_order ON public.registrations;
CREATE TRIGGER trg_registration_to_order
  AFTER INSERT ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.registration_to_order();

CREATE OR REPLACE FUNCTION public.registration_status_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id      UUID;
  v_category_id   UUID;
  v_bib           TEXT;
BEGIN
  SELECT id INTO v_order_id FROM public.orders WHERE source_registration_id = NEW.id LIMIT 1;
  IF v_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.orders SET
    status = CASE NEW.status WHEN 'paid' THEN 'paid' WHEN 'cancelled' THEN 'cancelled' ELSE status END,
    updated_at = NOW()
  WHERE id = v_order_id;

  -- Issue ticket once payment completes
  IF NEW.payment_status = 'completed' AND OLD.payment_status IS DISTINCT FROM 'completed' THEN
    -- Find category reference
    SELECT reference_id INTO v_category_id FROM public.order_items
    WHERE order_id = v_order_id AND item_type = 'activity_ticket' LIMIT 1;

    -- If category_id doesn't exist in race_categories, attempt lookup by slug
    IF NOT EXISTS (SELECT 1 FROM public.race_categories WHERE id = v_category_id) THEN
      SELECT id INTO v_category_id FROM public.race_categories WHERE slug = NEW.activity_slug LIMIT 1;
    END IF;

    v_bib := COALESCE(NEW.bib_number, 'TDR-' || UPPER(SUBSTRING(MD5(NEW.id::TEXT), 1, 6)));
    IF NEW.bib_number IS NULL THEN
      UPDATE public.registrations SET bib_number = v_bib WHERE id = NEW.id;
    END IF;

    INSERT INTO public.tickets (order_id, profile_id, activity_id, bib_number, qr_verification_token, source_registration_id)
    SELECT v_order_id, NEW.user_id, v_category_id, v_bib,
           UPPER(MD5(RANDOM()::TEXT || NEW.id::TEXT || clock_timestamp()::TEXT)), NEW.id
    WHERE NOT EXISTS (SELECT 1 FROM public.tickets WHERE source_registration_id = NEW.id);
  END IF;

  -- Gate check-in sync
  IF NEW.status = 'checked_in' AND OLD.status IS DISTINCT FROM 'checked_in' THEN
    UPDATE public.tickets SET checked_in = TRUE, checked_in_at = NOW()
    WHERE source_registration_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registration_status_sync ON public.registrations;
CREATE TRIGGER trg_registration_status_sync
  AFTER UPDATE ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.registration_status_sync();

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

DROP TRIGGER IF EXISTS trg_protect_registration_columns ON public.registrations;
CREATE TRIGGER trg_protect_registration_columns
  BEFORE UPDATE ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.protect_registration_columns();

-- ==============================================================================
-- 5. MERCHANDISE & INVENTORY TRIGGERS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.product_to_variants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_edition_id UUID;
  v_size       TEXT;
  v_sizes      TEXT[];
BEGIN
  SELECT id INTO v_edition_id FROM public.event_editions ORDER BY year DESC LIMIT 1;
  IF v_edition_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_sizes := NEW.sizes;
  IF v_sizes IS NULL OR array_length(v_sizes, 1) IS NULL THEN
    v_sizes := ARRAY['One Size'];
  END IF;

  FOREACH v_size IN ARRAY v_sizes
  LOOP
    INSERT INTO public.product_variants (edition_id, product_name, variant_type, price_tsh, stock_quantity, product_id)
    VALUES (v_edition_id, NEW.name, v_size, NEW.price_public, 50, NEW.id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_to_variants ON public.products;
CREATE TRIGGER trg_product_to_variants
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.product_to_variants();

CREATE OR REPLACE FUNCTION public.sync_product_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD.product_id;
  ELSE
    v_product_id := NEW.product_id;
  END IF;

  IF v_product_id IS NOT NULL THEN
    UPDATE public.products SET stock = (
      SELECT COALESCE(SUM(GREATEST(stock_quantity - reserved_quantity, 0)), 0)
      FROM public.product_variants WHERE product_id = v_product_id
    ), updated_at = NOW()
    WHERE id = v_product_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_stock ON public.product_variants;
CREATE TRIGGER trg_sync_product_stock
  AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_stock();

-- ==============================================================================
-- 6. PHASE SYNCHRONIZATION TRIGGERS (event_config <-> event_lifecycle)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.sync_phase_from_event_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_mode TEXT;
BEGIN
  target_mode := CASE NEW.phase WHEN 'archive' THEN 'archive' WHEN 'post_event' THEN 'memory' ELSE 'live' END;

  UPDATE public.event_lifecycle SET
    current_mode = target_mode,
    updated_at = NOW()
  WHERE current_mode IS DISTINCT FROM target_mode;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_phase_from_event_config ON public.event_config;
CREATE TRIGGER trg_sync_phase_from_event_config
  AFTER UPDATE OF phase ON public.event_config
  FOR EACH ROW EXECUTE FUNCTION public.sync_phase_from_event_config();

CREATE OR REPLACE FUNCTION public.sync_phase_from_event_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_phase TEXT;
BEGIN
  target_phase := CASE NEW.current_mode WHEN 'archive' THEN 'archive' WHEN 'memory' THEN 'post_event' ELSE
    (SELECT phase FROM public.event_config WHERE id = 1) END;

  UPDATE public.event_config SET
    phase = target_phase,
    updated_at = NOW()
  WHERE id = 1 AND phase IS DISTINCT FROM target_phase;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_phase_from_event_lifecycle ON public.event_lifecycle;
CREATE TRIGGER trg_sync_phase_from_event_lifecycle
  AFTER UPDATE OF current_mode ON public.event_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.sync_phase_from_event_lifecycle();

-- ==============================================================================
-- 7. AUDIT LOG COMPATIBILITY VIEW
-- ==============================================================================

CREATE OR REPLACE VIEW public.audit_log AS
SELECT
  id,
  action,
  target_resource AS table_name,
  details_json->>'record_id' AS record_id,
  actor_profile_id AS actor_id,
  details_json->>'actor_email' AS actor_email,
  details_json AS metadata,
  created_at
FROM public.audit_logs;

CREATE OR REPLACE FUNCTION public.trg_audit_log_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_logs (
    action,
    target_resource,
    details_json,
    actor_profile_id,
    actor_role
  ) VALUES (
    NEW.action,
    COALESCE(NEW.table_name, 'unknown'),
    jsonb_build_object(
      'record_id', NEW.record_id,
      'actor_email', NEW.actor_email,
      'metadata', NEW.metadata
    ),
    NEW.actor_id,
    'admin'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_log_insert ON public.audit_log;
CREATE TRIGGER trg_audit_log_insert
  INSTEAD OF INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log_insert();

-- ==============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Enable RLS across all relevant tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.volunteer_shifts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.event_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triathlon_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.why_i_participate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_bibs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triathlon_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_waypoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_impact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_consents ENABLE ROW LEVEL SECURITY;

-- 8.1 PROFILES
DROP POLICY IF EXISTS profiles_select_own_or_staff ON public.profiles;
CREATE POLICY profiles_select_own_or_staff ON public.profiles
  FOR SELECT USING (id = public.current_profile_id() OR public.is_volunteer_or_staff());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (id = public.current_profile_id()) WITH CHECK (id = public.current_profile_id());

DROP POLICY IF EXISTS profiles_update_staff ON public.profiles;
CREATE POLICY profiles_update_staff ON public.profiles
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

-- 8.2 REGISTRATIONS
DROP POLICY IF EXISTS registrations_select_authenticated ON public.registrations;
CREATE POLICY registrations_select_authenticated ON public.registrations
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS registrations_insert_own ON public.registrations;
CREATE POLICY registrations_insert_own ON public.registrations
  FOR INSERT WITH CHECK (user_id = public.current_profile_id() AND status = 'pending' AND payment_status = 'pending');

DROP POLICY IF EXISTS registrations_update_staff ON public.registrations;
CREATE POLICY registrations_update_staff ON public.registrations
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS registrations_checkin_volunteer ON public.registrations;
CREATE POLICY registrations_checkin_volunteer ON public.registrations
  FOR UPDATE USING (public.current_role() = 'volunteer')
  WITH CHECK (public.current_role() = 'volunteer' AND status = 'checked_in');

-- 8.3 SPONSORS & PARTNERS
DROP POLICY IF EXISTS sponsors_select_own_or_staff ON public.sponsors;
CREATE POLICY sponsors_select_own_or_staff ON public.sponsors
  FOR SELECT USING (user_id = public.current_profile_id() OR public.is_staff());

DROP POLICY IF EXISTS sponsors_write_staff ON public.sponsors;
CREATE POLICY sponsors_write_staff ON public.sponsors
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS sponsor_assets_select_owner_or_staff ON public.sponsor_assets;
CREATE POLICY sponsor_assets_select_owner_or_staff ON public.sponsor_assets
  FOR SELECT USING (public.is_staff() OR sponsor_id IN (SELECT id FROM public.sponsors WHERE user_id = public.current_profile_id()));

DROP POLICY IF EXISTS partners_select_own_or_staff ON public.partners;
CREATE POLICY partners_select_own_or_staff ON public.partners
  FOR SELECT USING (user_id = public.current_profile_id() OR public.is_staff());

DROP POLICY IF EXISTS partners_write_staff ON public.partners;
CREATE POLICY partners_write_staff ON public.partners
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS partner_deliverables_select_owner_or_staff ON public.partner_deliverables;
CREATE POLICY partner_deliverables_select_owner_or_staff ON public.partner_deliverables
  FOR SELECT USING (public.is_staff() OR partner_id IN (SELECT id FROM public.partners WHERE user_id = public.current_profile_id()));

DROP POLICY IF EXISTS partner_deliverables_write_staff ON public.partner_deliverables;
CREATE POLICY partner_deliverables_write_staff ON public.partner_deliverables
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

-- 8.4 ORDERS & PRODUCTS
DROP POLICY IF EXISTS orders_select_own_or_staff ON public.orders;
CREATE POLICY orders_select_own_or_staff ON public.orders
  FOR SELECT USING (user_id = public.current_profile_id() OR profile_id = public.current_profile_id() OR public.is_staff());

DROP POLICY IF EXISTS orders_write_staff ON public.orders;
CREATE POLICY orders_write_staff ON public.orders
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS products_select_public ON public.products;
CREATE POLICY products_select_public ON public.products
  FOR SELECT USING (true);

DROP POLICY IF EXISTS products_write_staff ON public.products;
CREATE POLICY products_write_staff ON public.products
  FOR UPDATE USING (public.is_staff()) WITH CHECK (public.is_staff());

-- 8.5 EVENT CONFIG & AUDIT LOGS
DROP POLICY IF EXISTS event_config_select_public ON public.event_config;
CREATE POLICY event_config_select_public ON public.event_config
  FOR SELECT USING (true);

DROP POLICY IF EXISTS event_config_write_staff ON public.event_config;
CREATE POLICY event_config_write_staff ON public.event_config
  FOR ALL USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS audit_log_select_staff ON public.audit_logs;
CREATE POLICY audit_log_select_staff ON public.audit_logs
  FOR SELECT USING (public.is_staff());

DROP POLICY IF EXISTS audit_log_insert_staff ON public.audit_logs;
CREATE POLICY audit_log_insert_staff ON public.audit_logs
  FOR INSERT WITH CHECK (public.is_staff());

-- 8.6 SHIFTS
DROP POLICY IF EXISTS shifts_select_authenticated ON public.shifts;
CREATE POLICY shifts_select_authenticated ON public.shifts
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS volunteer_shifts_select_own_or_staff ON public.volunteer_shifts;
CREATE POLICY volunteer_shifts_select_own_or_staff ON public.volunteer_shifts
  FOR SELECT USING (volunteer_id = public.current_profile_id() OR public.is_staff());

DROP POLICY IF EXISTS volunteer_shifts_insert_own ON public.volunteer_shifts;
CREATE POLICY volunteer_shifts_insert_own ON public.volunteer_shifts
  FOR INSERT WITH CHECK (volunteer_id = public.current_profile_id());

DROP POLICY IF EXISTS volunteer_shifts_delete_own ON public.volunteer_shifts;
CREATE POLICY volunteer_shifts_delete_own ON public.volunteer_shifts
  FOR DELETE USING (volunteer_id = public.current_profile_id());

-- 8.7 TRIATHLON & COMMUNITY PUBLIC READ POLICIES
DROP POLICY IF EXISTS "Public read event_lifecycle" ON public.event_lifecycle;
CREATE POLICY "Public read event_lifecycle" ON public.event_lifecycle FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read triathlon_stages" ON public.triathlon_stages;
CREATE POLICY "Public read triathlon_stages" ON public.triathlon_stages FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read race_categories" ON public.race_categories;
CREATE POLICY "Public read race_categories" ON public.race_categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read teams" ON public.teams;
CREATE POLICY "Public read teams" ON public.teams FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read team_members" ON public.team_members;
CREATE POLICY "Public read team_members" ON public.team_members FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read community_posts" ON public.community_posts;
CREATE POLICY "Public read community_posts" ON public.community_posts FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Public read post_reactions" ON public.post_reactions;
CREATE POLICY "Public read post_reactions" ON public.post_reactions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read post_comments" ON public.post_comments;
CREATE POLICY "Public read post_comments" ON public.post_comments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read why_i_participate" ON public.why_i_participate;
CREATE POLICY "Public read why_i_participate" ON public.why_i_participate FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read challenges" ON public.challenges;
CREATE POLICY "Public read challenges" ON public.challenges FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read user_challenges" ON public.user_challenges;
CREATE POLICY "Public read user_challenges" ON public.user_challenges FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read digital_bibs" ON public.digital_bibs;
CREATE POLICY "Public read digital_bibs" ON public.digital_bibs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read triathlon_results" ON public.triathlon_results;
CREATE POLICY "Public read triathlon_results" ON public.triathlon_results FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read map_waypoints" ON public.map_waypoints;
CREATE POLICY "Public read map_waypoints" ON public.map_waypoints FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read race_photos" ON public.race_photos;
CREATE POLICY "Public read race_photos" ON public.race_photos FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read community_impact" ON public.community_impact;
CREATE POLICY "Public read community_impact" ON public.community_impact FOR SELECT USING (true);

-- 8.8 COMMUNITY WRITES WITH ARCHIVE-MODE LOCKOUT
DROP POLICY IF EXISTS "Auth write community_posts" ON public.community_posts;
CREATE POLICY "Auth write community_posts" ON public.community_posts FOR INSERT
  WITH CHECK ((auth.uid() = user_id OR auth.role() = 'service_role')
              AND (SELECT phase FROM public.event_config WHERE id = 1) <> 'archive');

DROP POLICY IF EXISTS "Auth write post_reactions" ON public.post_reactions;
CREATE POLICY "Auth write post_reactions" ON public.post_reactions FOR INSERT
  WITH CHECK ((auth.uid() = user_id OR auth.role() = 'service_role')
              AND (SELECT phase FROM public.event_config WHERE id = 1) <> 'archive');

DROP POLICY IF EXISTS "Auth write post_comments" ON public.post_comments;
CREATE POLICY "Auth write post_comments" ON public.post_comments FOR INSERT
  WITH CHECK ((auth.uid() = user_id OR auth.role() = 'service_role')
              AND (SELECT phase FROM public.event_config WHERE id = 1) <> 'archive');

DROP POLICY IF EXISTS "Auth write team_members" ON public.team_members;
CREATE POLICY "Auth write team_members" ON public.team_members FOR INSERT
  WITH CHECK ((auth.uid() = user_id OR auth.role() = 'service_role')
              AND (SELECT phase FROM public.event_config WHERE id = 1) <> 'archive');

DROP POLICY IF EXISTS "Auth write teams" ON public.teams;
CREATE POLICY "Auth write teams" ON public.teams FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Auth write why_i_participate" ON public.why_i_participate;
CREATE POLICY "Auth write why_i_participate" ON public.why_i_participate FOR INSERT
  WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Auth write user_challenges" ON public.user_challenges;
CREATE POLICY "Auth write user_challenges" ON public.user_challenges FOR ALL
  USING (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Auth write research_consents" ON public.research_consents;
CREATE POLICY "Auth write research_consents" ON public.research_consents FOR ALL
  USING (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Auth report posts" ON public.post_reports;
CREATE POLICY "Auth report posts" ON public.post_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Read own reports" ON public.post_reports;
CREATE POLICY "Read own reports" ON public.post_reports FOR SELECT
  USING (auth.uid() = reporter_id OR auth.role() = 'service_role');

-- 8.9 DEFAULT-DENY ON SENSITIVE BACKEND-ONLY TABLES
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
    'sponsor_deliverables', 'partner_clearances', 'event_editions'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;
