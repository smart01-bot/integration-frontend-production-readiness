-- ==============================================================================
-- 014: COMPLETE FRONTEND & BACKEND SYNC SCHEMA + ALL TEST ACCOUNTS
-- (All UUIDs strictly conform to RFC 4122 hex digits [0-9a-f])
-- ==============================================================================

-- ── 1. SCHEMA REPAIRS ─────────────────────────────────────────────────────────

-- 1.1 Give referral_code a solid default generator if none is provided
ALTER TABLE public.profiles 
  ALTER COLUMN referral_code 
  SET DEFAULT ('TDR' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 8)));

-- 1.2 Ensure phone and phone_number are populated
UPDATE public.profiles 
SET phone = phone_number 
WHERE phone IS NULL AND phone_number IS NOT NULL;

-- 1.3 Backfill any existing NULL referral codes
UPDATE public.profiles
SET referral_code = ('TDR' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || id::TEXT), 1, 8)))
WHERE referral_code IS NULL;

-- ── 2. REBUILD SIGNUP TRIGGER ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_ref_code TEXT;
  v_role     TEXT;
BEGIN
  v_ref_code := 'TDR' || UPPER(SUBSTRING(MD5(NEW.id::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 8));
  v_role     := COALESCE(NEW.raw_user_meta_data->>'role', 'participant');

  -- Update existing guest-checkout profile if email matches
  UPDATE public.profiles
  SET
    auth_user_id  = NEW.id,
    role          = COALESCE(role, v_role),
    referral_code = COALESCE(referral_code, v_ref_code)
  WHERE email = NEW.email
    AND auth_user_id IS NULL;

  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- Brand new profile
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
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.raw_user_meta_data->>'phone_number', NULL),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.raw_user_meta_data->>'phone_number', NULL),
    v_role,
    v_ref_code
  )
  ON CONFLICT (email) DO UPDATE
    SET auth_user_id  = EXCLUDED.auth_user_id,
        referral_code = COALESCE(public.profiles.referral_code, EXCLUDED.referral_code);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ── 3. AUDIT_LOG VIEW FOR FRONTEND COMPATIBILITY ──────────────────────────────
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_log_insert ON public.audit_log;
CREATE TRIGGER trg_audit_log_insert
  INSTEAD OF INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log_insert();

-- ── 4. BASELINE EVENT DATA (SAFE / DYNAMIC) ───────────────────────────────────

-- 4.1 Ensure Event Edition exists
INSERT INTO public.event_editions (year, slug, title, current_phase, event_date, location_name)
VALUES (
  2026,
  'tdr-2026',
  'Tour de Rotary Dar es Salaam 2026',
  'pre_event',
  '2026-10-18 06:00:00+03',
  'Dar es Salaam, Tanzania'
)
ON CONFLICT (year) DO UPDATE
SET current_phase = EXCLUDED.current_phase,
    event_date = EXCLUDED.event_date;

-- 4.2 Event Config
INSERT INTO public.event_config (id, phase, event_date)
VALUES (1, 'pre_event', '2026-10-18 06:00:00+03')
ON CONFLICT (id) DO UPDATE SET phase = 'pre_event';

-- 4.3 Ensure all 6 activity slugs exist and map to activities
UPDATE public.activities SET slug = 'cyclathon'      WHERE title ILIKE '%cycl%' OR category = 'Cycling';
UPDATE public.activities SET slug = 'marathon'       WHERE title ILIKE '%marathon%' OR category = 'Running';
UPDATE public.activities SET slug = 'walkathon'      WHERE title ILIKE '%walkathon%';
UPDATE public.activities SET slug = 'yoga'           WHERE category = 'Wellness' OR title ILIKE '%yoga%';
UPDATE public.activities SET slug = 'zumba'          WHERE category = 'Fitness' OR title ILIKE '%zumba%';
UPDATE public.activities SET slug = 'community_walk' WHERE title ILIKE '%community%' AND slug IS NULL;

-- Insert any missing activity using the actual edition_id from the database
DO $$
DECLARE
  v_ed_id UUID;
BEGIN
  SELECT id INTO v_ed_id FROM public.event_editions WHERE year = 2026 LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.activities WHERE slug = 'cyclathon') THEN
    INSERT INTO public.activities (edition_id, title, category, distance_km, start_time, flag_off_location, capacity, early_bird_price_tsh, standard_price_tsh, status, slug)
    VALUES (v_ed_id, 'Grand Cyclathon Elite & Enthusiasts', 'Cycling', 65.0, '06:00 AM', 'Green Grounds, Oysterbay', 800, 35000, 45000, 'open', 'cyclathon');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.activities WHERE slug = 'marathon') THEN
    INSERT INTO public.activities (edition_id, title, category, distance_km, start_time, flag_off_location, capacity, early_bird_price_tsh, standard_price_tsh, status, slug)
    VALUES (v_ed_id, 'Half Marathon Coastal Run', 'Running', 21.1, '06:30 AM', 'Green Grounds, Oysterbay', 600, 30000, 40000, 'open', 'marathon');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.activities WHERE slug = 'walkathon') THEN
    INSERT INTO public.activities (edition_id, title, category, distance_km, start_time, flag_off_location, capacity, early_bird_price_tsh, standard_price_tsh, status, slug)
    VALUES (v_ed_id, 'Community Walkathon for Charity', 'Walking', 10.0, '07:00 AM', 'Green Grounds, Oysterbay', 1000, 20000, 25000, 'open', 'walkathon');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.activities WHERE slug = 'yoga') THEN
    INSERT INTO public.activities (edition_id, title, category, distance_km, start_time, flag_off_location, capacity, early_bird_price_tsh, standard_price_tsh, status, slug)
    VALUES (v_ed_id, 'Coastal Sunrise Yoga Flow', 'Wellness', 0.0, '07:30 AM', 'Coco Beach Amphitheatre', 300, 15000, 20000, 'open', 'yoga');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.activities WHERE slug = 'zumba') THEN
    INSERT INTO public.activities (edition_id, title, category, distance_km, start_time, flag_off_location, capacity, early_bird_price_tsh, standard_price_tsh, status, slug)
    VALUES (v_ed_id, 'High-Energy Afrobeats Zumba Fiesta', 'Fitness', 0.0, '08:00 AM', 'Green Grounds Stage', 400, 15000, 20000, 'open', 'zumba');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.activities WHERE slug = 'community_walk') THEN
    INSERT INTO public.activities (edition_id, title, category, distance_km, start_time, flag_off_location, capacity, early_bird_price_tsh, standard_price_tsh, status, slug)
    VALUES (v_ed_id, 'Rotary Family Community Walk', 'Walking', 5.0, '08:30 AM', 'Green Grounds Loop', 500, 15000, 20000, 'open', 'community_walk');
  END IF;
END $$;

-- 4.4 Products (Merchandise) - using valid hexadecimal UUIDs: 0-9, a-f
INSERT INTO public.products (id, name, slug, description, category, price_participant, price_public, stock, sizes)
VALUES
  ('b1000001-0000-0000-0000-000000000001', 'Official Event Tech Jersey', 'event-tech-jersey', 'Tour de Rotary DSM 2026 moisture-wicking aerodynamic cycling jersey', 'apparel', 25000, 35000, 120, ARRAY['S','M','L','XL','2XL']),
  ('b1000002-0000-0000-0000-000000000002', 'Cotton Finisher T-Shirt', 'cotton-finisher-tshirt', 'Premium commemorative cotton crewneck', 'apparel', 15000, 20000, 200, ARRAY['S','M','L','XL','2XL']),
  ('b1000003-0000-0000-0000-000000000003', 'Pro Cycling Cap', 'cycling-cap', 'Classic breathable cycling cap with sweatband', 'accessories', 8000, 12000, 85, ARRAY['One Size']),
  ('b1000004-0000-0000-0000-000000000004', 'BPA-Free 750ml Water Bottle', 'water-bottle', 'Ergonomic easy-squeeze hydration bottle', 'accessories', 6000, 10000, 150, ARRAY['One Size'])
ON CONFLICT (slug) DO UPDATE
SET stock = EXCLUDED.stock, price_participant = EXCLUDED.price_participant, price_public = EXCLUDED.price_public;

-- Product variants
INSERT INTO public.product_variants (edition_id, product_name, variant_type, price_tsh, stock_quantity, reserved_quantity, product_id)
SELECT 
  (SELECT id FROM public.event_editions WHERE year = 2026 LIMIT 1),
  p.name,
  s.size_val,
  p.price_public,
  30,
  0,
  p.id
FROM public.products p
CROSS JOIN LATERAL unnest(p.sizes) AS s(size_val)
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.variant_type = s.size_val
);

-- ── 5. SEED TEST ACCOUNTS (PASSWORD: user1234 FOR ALL) ────────────────────────
DO $$
DECLARE
  v_pwd_hash        TEXT;
  v_ed_id           UUID;
  v_cyclathon_id    UUID;
  v_uid_user        UUID := 'a0000000-0000-0000-0000-000000000000';
  v_uid_participant UUID := 'a0000001-0000-0000-0000-000000000001';
  v_uid_volunteer   UUID := 'a0000002-0000-0000-0000-000000000002';
  v_uid_sponsor     UUID := 'a0000003-0000-0000-0000-000000000003';
  v_uid_partner     UUID := 'a0000004-0000-0000-0000-000000000004';
  v_uid_admin       UUID := 'a0000005-0000-0000-0000-000000000005';
  v_uid_hqadmin     UUID := 'a0000006-0000-0000-0000-000000000006';
BEGIN
  -- Dynamic lookups
  SELECT id INTO v_ed_id FROM public.event_editions WHERE year = 2026 LIMIT 1;
  SELECT id INTO v_cyclathon_id FROM public.activities WHERE slug = 'cyclathon' LIMIT 1;

  -- Generate bcrypt hash for "user1234"
  v_pwd_hash := crypt('user1234', gen_salt('bf', 10));

  -- Insert accounts into auth.users (Pre-confirmed)
  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
    is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES
  (
    v_uid_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'user@gmail.com', v_pwd_hash, NOW(), NOW(), NOW(),
    '{"full_name":"Master Test User (HQ Admin)","role":"hq_admin"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_uid_participant, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'participant@gmail.com', v_pwd_hash, NOW(), NOW(), NOW(),
    '{"full_name":"Amani Participant","role":"participant"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_uid_volunteer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'volunteer@gmail.com', v_pwd_hash, NOW(), NOW(), NOW(),
    '{"full_name":"Baraka Volunteer","role":"volunteer"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_uid_sponsor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'sponsor@gmail.com', v_pwd_hash, NOW(), NOW(), NOW(),
    '{"full_name":"CRDB Sponsor Rep","role":"sponsor"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_uid_partner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'partner@gmail.com', v_pwd_hash, NOW(), NOW(), NOW(),
    '{"full_name":"Aga Khan Health Lead","role":"partner"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_uid_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'admin@gmail.com', v_pwd_hash, NOW(), NOW(), NOW(),
    '{"full_name":"System Admin","role":"admin"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_uid_hqadmin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'hqadmin@gmail.com', v_pwd_hash, NOW(), NOW(), NOW(),
    '{"full_name":"HQ Command Lead","role":"hq_admin"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  )
  ON CONFLICT (id) DO UPDATE 
    SET encrypted_password = EXCLUDED.encrypted_password,
        email_confirmed_at = NOW();

  -- Upsert profiles matching exactly id = auth_user_id
  INSERT INTO public.profiles (id, auth_user_id, email, full_name, role, phone_number, phone, referral_code)
  VALUES
    (v_uid_user, v_uid_user, 'user@gmail.com', 'Master Test User', 'hq_admin', '+255700000000', '+255700000000', 'TDRUSER01'),
    (v_uid_participant, v_uid_participant, 'participant@gmail.com', 'Amani Participant', 'participant', '+255711000001', '+255711000001', 'TDRPART01'),
    (v_uid_volunteer, v_uid_volunteer, 'volunteer@gmail.com', 'Baraka Volunteer', 'volunteer', '+255712000002', '+255712000002', 'TDRVOL001'),
    (v_uid_sponsor, v_uid_sponsor, 'sponsor@gmail.com', 'CRDB Sponsor Rep', 'sponsor', '+255713000003', '+255713000003', 'TDRSPON01'),
    (v_uid_partner, v_uid_partner, 'partner@gmail.com', 'Aga Khan Health Lead', 'partner', '+255714000004', '+255714000004', 'TDRPART02'),
    (v_uid_admin, v_uid_admin, 'admin@gmail.com', 'System Admin', 'admin', '+255715000005', '+255715000005', 'TDRADM001'),
    (v_uid_hqadmin, v_uid_hqadmin, 'hqadmin@gmail.com', 'HQ Command Lead', 'hq_admin', '+255716000006', '+255716000006', 'TDRHQ0001')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role,
        auth_user_id = EXCLUDED.auth_user_id,
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        phone_number = EXCLUDED.phone_number,
        referral_code = COALESCE(public.profiles.referral_code, EXCLUDED.referral_code);

  -- ── 6. SEED TEST PORTAL DATA ──────────────────────────────────────────────

  -- SPONSOR: Seed sponsor and assets for sponsor@gmail.com
  INSERT INTO public.sponsors (id, user_id, name, logo_url, tier, amount_tsh, website_url, contact_name, status)
  VALUES (
    'b2000001-0000-0000-0000-000000000001',
    v_uid_sponsor,
    'CRDB Bank Plc',
    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=128&q=80',
    'platinum',
    25000000,
    'https://crdbbank.co.tz',
    'Neema Mushi',
    'active'
  )
  ON CONFLICT (user_id) DO UPDATE
    SET tier = 'platinum', status = 'active', amount_tsh = 25000000;

  INSERT INTO public.sponsor_assets (id, sponsor_id, label, description, file_url, file_type, size_bytes)
  VALUES
    ('b3000001-0000-0000-0000-000000000001', 'b2000001-0000-0000-0000-000000000001', 'Primary Vector Logo', 'EPS / SVG format for start banner', 'https://example.com/crdb_logo.svg', 'svg', 245000),
    ('b3000002-0000-0000-0000-000000000002', 'b2000001-0000-0000-0000-000000000001', 'Event Day Social Card', 'Square 1080x1080 co-branded banner', 'https://example.com/crdb_social.png', 'png', 820000)
  ON CONFLICT (id) DO NOTHING;

  -- PARTNER: Seed partner and deliverables for partner@gmail.com
  INSERT INTO public.partners (id, user_id, name, logo_url, category, contact_name, status)
  VALUES (
    'b4000001-0000-0000-0000-000000000001',
    v_uid_partner,
    'Aga Khan Health Services',
    'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=128&q=80',
    'medical',
    'Dr. Faraja Kilonzo',
    'active'
  )
  ON CONFLICT (user_id) DO UPDATE
    SET category = 'medical', status = 'active';

  INSERT INTO public.partner_deliverables (id, partner_id, title, description, due_date, status, hq_notes)
  VALUES
    ('b5000001-0000-0000-0000-000000000001', 'b4000001-0000-0000-0000-000000000001', 'Deploy 4 Advanced Life Support Ambulances', '2 stationed at Start/Finish Green Grounds, 2 mobile along coastal circuit', CURRENT_DATE + 30, 'completed', 'Approved by City Safety Chief'),
    ('b5000002-0000-0000-0000-000000000002', 'b4000001-0000-0000-0000-000000000001', 'First-Aid Tent Logistics & Staffing', 'Provide 8 licensed paramedical staff with resuscitation kits', CURRENT_DATE + 30, 'in_progress', 'Pending staff shift rosters')
  ON CONFLICT (id) DO NOTHING;

  -- VOLUNTEER: Shifts & claimed shift for volunteer@gmail.com
  INSERT INTO public.shifts (id, title, start_time, end_time, location)
  VALUES
    ('b6000001-0000-0000-0000-000000000001', 'Elite Cyclathon Flag-off & Marshalling', '2026-10-18 05:30:00+03', '2026-10-18 09:30:00+03', 'Oysterbay Green Grounds'),
    ('b6000002-0000-0000-0000-000000000002', 'Hydration Station B (Masaki Loop)', '2026-10-18 06:00:00+03', '2026-10-18 10:30:00+03', 'Masaki Coastal Road km 25'),
    ('b6000003-0000-0000-0000-000000000003', 'Finish Line Medal & Refreshment Chute', '2026-10-18 08:00:00+03', '2026-10-18 12:30:00+03', 'Main Arena Finisher Village')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.volunteer_shifts (id, volunteer_id, shift_id, checked_in)
  VALUES ('b7000001-0000-0000-0000-000000000001', v_uid_volunteer, 'b6000001-0000-0000-0000-000000000001', false)
  ON CONFLICT (id) DO NOTHING;

  -- PARTICIPANT: Completed registration, order, and ticket for participant@gmail.com
  INSERT INTO public.registrations (id, user_id, activity_slug, status, payment_status, amount_tsh, bib_number)
  VALUES (
    'b8000001-0000-0000-0000-000000000001',
    v_uid_participant,
    'cyclathon',
    'confirmed',
    'completed',
    45000,
    'TDR-1042'
  )
  ON CONFLICT (id) DO UPDATE
    SET status = 'confirmed', payment_status = 'completed';

  IF v_ed_id IS NOT NULL THEN
    INSERT INTO public.orders (id, order_number, profile_id, user_id, edition_id, status, subtotal_tsh, total_tsh, currency, billing_phone, source_registration_id)
    VALUES (
      'b9000001-0000-0000-0000-000000000001',
      'TDR-2026-10042',
      v_uid_participant,
      v_uid_participant,
      v_ed_id,
      'paid',
      45000,
      45000,
      'TZS',
      '+255711000001',
      'b8000001-0000-0000-0000-000000000001'
    )
    ON CONFLICT (id) DO UPDATE SET status = 'paid';

    IF v_cyclathon_id IS NOT NULL THEN
      INSERT INTO public.order_items (id, order_id, item_type, reference_id, description, quantity, unit_price_tsh, subtotal_tsh)
      VALUES (
        'ba000001-0000-0000-0000-000000000001',
        'b9000001-0000-0000-0000-000000000001',
        'activity_ticket',
        v_cyclathon_id,
        'Grand Cyclathon Entry (Early Bird)',
        1,
        45000,
        45000
      )
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.tickets (id, order_id, profile_id, activity_id, bib_number, qr_verification_token, checked_in, source_registration_id)
      VALUES (
        'bb000001-0000-0000-0000-000000000001',
        'b9000001-0000-0000-0000-000000000001',
        v_uid_participant,
        v_cyclathon_id,
        'TDR-1042',
        'VERIFY-TDR2026-AMANIPARTICIPANT-QR',
        false,
        'b8000001-0000-0000-0000-000000000001'
      )
      ON CONFLICT (id) DO UPDATE SET bib_number = 'TDR-1042';
    END IF;
  END IF;

  -- Also seed a registration for user@gmail.com
  INSERT INTO public.registrations (id, user_id, activity_slug, status, payment_status, amount_tsh, bib_number)
  VALUES (
    'b8000000-0000-0000-0000-000000000000',
    v_uid_user,
    'cyclathon',
    'confirmed',
    'completed',
    45000,
    'TDR-9999'
  )
  ON CONFLICT (id) DO UPDATE SET status = 'confirmed', payment_status = 'completed';

END $$;

-- ── 7. VERIFICATION QUERY ──────────────────────────────────────────────────────
SELECT 
  p.email,
  p.role,
  p.full_name,
  p.referral_code,
  u.email_confirmed_at IS NOT NULL AS email_confirmed,
  u.created_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.email IN (
  'user@gmail.com',
  'participant@gmail.com',
  'volunteer@gmail.com',
  'sponsor@gmail.com',
  'partner@gmail.com',
  'admin@gmail.com',
  'hqadmin@gmail.com'
)
ORDER BY p.email;
