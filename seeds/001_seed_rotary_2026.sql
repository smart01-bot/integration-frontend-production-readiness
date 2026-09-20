-- ==============================================================================
-- TOUR DE ROTARY DSM 2026 - SEED DATA SCRIPT
-- Seeds default 2026 Edition, 5 Activities, Merchandise, Roles, and Clearances
-- ==============================================================================

-- 1. Insert 2026 Edition
INSERT INTO event_editions (id, year, slug, title, current_phase, event_date, location_name)
VALUES (
  'e2026000-0000-0000-0000-000000000001',
  2026,
  'tdr-dsm-2026',
  'Tour de Rotary Dar es Salaam 2026',
  'pre_event',
  '2026-11-01 06:00:00+03',
  'Rotary Grounds & Oysterbay Waterfront, Dar es Salaam'
) ON CONFLICT (year) DO NOTHING;

-- 2. Insert Activities
INSERT INTO activities (id, edition_id, title, category, distance_km, start_time, flag_off_location, capacity, registered_count, early_bird_price_tsh, standard_price_tsh, status)
VALUES 
(
  'a2026001-0000-0000-0000-000000000001',
  'e2026000-0000-0000-0000-000000000001',
  'Grand Cyclathon Elite & Enthusiasts',
  'Cycling',
  60.00,
  '06:00 AM',
  'Oysterbay Waterfront Main Arch',
  500,
  142,
  45000,
  60000,
  'open'
),
(
  'a2026002-0000-0000-0000-000000000002',
  'e2026000-0000-0000-0000-000000000001',
  'Half Marathon Coastal Run',
  'Running',
  21.10,
  '06:30 AM',
  'Toure Drive Start Line',
  800,
  310,
  35000,
  50000,
  'open'
),
(
  'a2026003-0000-0000-0000-000000000003',
  'e2026000-0000-0000-0000-000000000001',
  'Community Walkathon for Charity',
  'Walking',
  10.00,
  '07:00 AM',
  'Masaki Peninsula Loop Gate',
  1200,
  580,
  20000,
  30000,
  'open'
),
(
  'a2026004-0000-0000-0000-000000000004',
  'e2026000-0000-0000-0000-000000000001',
  'Coastal Sunrise Yoga Flow',
  'Wellness',
  0.00,
  '07:30 AM',
  'Coco Beach Ocean Lawn',
  250,
  89,
  15000,
  25000,
  'open'
),
(
  'a2026005-0000-0000-0000-000000000005',
  'e2026000-0000-0000-0000-000000000001',
  'High-Energy Afrobeats Zumba Fiesta',
  'Fitness',
  0.00,
  '08:15 AM',
  'Finish Village Main Stage',
  400,
  175,
  15000,
  25000,
  'open'
) ON CONFLICT (id) DO NOTHING;

-- 3. Insert Official Merchandise Variants
INSERT INTO product_variants (id, edition_id, product_name, variant_type, price_tsh, stock_quantity, reserved_quantity)
VALUES 
(
  'b2026001-0000-0000-0000-000000000001',
  'e2026000-0000-0000-0000-000000000001',
  'Tour de Rotary 2026 Pro Cycling Jersey (Dar Blue)',
  'Size M',
  65000,
  200,
  24
),
(
  'b2026002-0000-0000-0000-000000000002',
  'e2026000-0000-0000-0000-000000000001',
  'Tour de Rotary 2026 Pro Cycling Jersey (Dar Blue)',
  'Size L',
  65000,
  250,
  38
),
(
  'b2026003-0000-0000-0000-000000000003',
  'e2026000-0000-0000-0000-000000000001',
  'Commemorative Dry-Fit Running Singlet',
  'Size M',
  35000,
  300,
  15
),
(
  'b2026004-0000-0000-0000-000000000004',
  'e2026000-0000-0000-0000-000000000001',
  'Thermal Stainless Cycling Water Bottle 750ml',
  'Navy Blue',
  25000,
  500,
  42
) ON CONFLICT (id) DO NOTHING;

-- 4. Insert HQ Admin Profile
INSERT INTO profiles (id, full_name, email, phone_number, role, tshirt_size, referral_code)
VALUES (
  'f2026001-0000-0000-0000-000000000001',
  'HQ Operations Director',
  'ops@tourderotary.co.tz',
  '+255754000001',
  'admin',
  'L',
  'TDRADMIN01'
) ON CONFLICT (email) DO NOTHING;

-- 5. Insert Official Promo Codes
INSERT INTO promo_codes (code, discount_percent, max_uses, used_count, active, expires_at)
VALUES 
  ('ROTARY2026', 10, 500, 0, TRUE, '2026-10-31 23:59:59+03'),
  ('EARLYBIRD20', 20, 200, 0, TRUE, '2026-09-30 23:59:59+03'),
  ('CORPORATE15', 15, 100, 0, TRUE, '2026-10-15 23:59:59+03')
ON CONFLICT (code) DO NOTHING;

-- 6. Insert System Communication Templates
INSERT INTO communication_templates (template_key, channel, title, subject, body_template, is_system)
VALUES
(
  'reg_confirmed_sms',
  'SMS',
  'Registration Confirmation SMS',
  NULL,
  'Karibu Tour de Rotary DSM 2026, {{athlete_name}}! Your pass for {{activity_title}} is confirmed. Official BIB: {{bib_number}}. View your gate QR pass at: {{pass_url}}',
  TRUE
),
(
  'day4_reservation_warning_sms',
  'SMS',
  'Day 4 Merchandise Hold Reminder',
  NULL,
  'Habari {{athlete_name}}, your Tour de Rotary merchandise order {{order_number}} (TSh {{amount_tsh}}) has 3 days remaining before stock is auto-released. Complete payment at {{checkout_url}}',
  TRUE
),
(
  'day6_reservation_warning_sms',
  'SMS',
  'Day 6 Final Expiration Warning SMS',
  NULL,
  'URGENT: Tour de Rotary reservation for order {{order_number}} expires in {{hours_remaining}} hours. Reserved jerseys & gear will be released to the public queue.',
  TRUE
),
(
  'finisher_celebration_sms',
  'SMS',
  'Finisher Certificate & Results SMS',
  NULL,
  'Hongera sana {{athlete_name}}! You conquered Tour de Rotary DSM 2026 (BIB: {{bib_number}}) in {{finish_time}}. View and share your verified Finisher Certificate: {{cert_url}}',
  TRUE
)
ON CONFLICT (template_key) DO NOTHING;

