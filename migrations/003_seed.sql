-- ==============================================================================
-- TOUR DE DAR 2026 — CONSOLIDATED SEED DATA (003_seed.sql)
--
-- This file populates:
--   1. Pre-confirmed test accounts across all roles (password: user1234)
--   2. Default 2026 Event Edition & Singleton Config
--   3. Triathlon Stages & Race Categories
--   4. Pre-Race Challenges & Dar Es Salaam Map Waypoints
--   5. Official Merchandise & Products
--   6. Rotary Community Impact Projects
--
-- Apply in Supabase SQL Editor AFTER 001_schema.sql and 002_triggers_rls.sql.
-- ==============================================================================

-- ==============================================================================
-- 1. PRE-CONFIRMED TEST ACCOUNTS (Password: user1234 for all)
-- ==============================================================================
DO $$
DECLARE
  v_password_hash   TEXT;
  v_hq_admin_id     UUID := 'a0000000-0000-0000-0000-000000000000';
  v_participant_id  UUID := 'a0000001-0000-0000-0000-000000000001';
  v_volunteer_id    UUID := 'a0000002-0000-0000-0000-000000000002';
  v_sponsor_id      UUID := 'a0000003-0000-0000-0000-000000000003';
  v_partner_id      UUID := 'a0000004-0000-0000-0000-000000000004';
  v_admin_id        UUID := 'a0000005-0000-0000-0000-000000000005';
  v_hqadmin_id      UUID := 'a0000006-0000-0000-0000-000000000006';
BEGIN
  -- Generate bcrypt hash for "user1234"
  v_password_hash := crypt('user1234', gen_salt('bf', 10));

  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data,
    is_super_admin, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES
  (
    v_hq_admin_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'user@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Lead HQ Admin","role":"hq_admin"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_participant_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'participant@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test Participant","role":"participant"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_volunteer_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'volunteer@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test Volunteer","role":"volunteer"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_sponsor_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'sponsor@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test Sponsor","role":"sponsor"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_partner_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'partner@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test Partner","role":"partner"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_admin_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'admin@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test Admin","role":"admin"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_hqadmin_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'hqadmin@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test HQ Admin","role":"hq_admin"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  )
  ON CONFLICT (id) DO NOTHING;

  -- Ensure profile roles are accurately assigned
  UPDATE public.profiles SET role = 'hq_admin'  WHERE id = v_hq_admin_id;
  UPDATE public.profiles SET role = 'volunteer' WHERE id = v_volunteer_id;
  UPDATE public.profiles SET role = 'sponsor'   WHERE id = v_sponsor_id;
  UPDATE public.profiles SET role = 'partner'   WHERE id = v_partner_id;
  UPDATE public.profiles SET role = 'admin'     WHERE id = v_admin_id;
  UPDATE public.profiles SET role = 'hq_admin'  WHERE id = v_hqadmin_id;

END $$;

-- ==============================================================================
-- 2. BASELINE EVENT EDITION & CONFIG
-- ==============================================================================
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

INSERT INTO public.event_config (id, phase, event_date)
VALUES (1, 'pre_event', '2026-10-18 06:00:00+03')
ON CONFLICT (id) DO UPDATE SET phase = 'pre_event';

-- ==============================================================================
-- 3. TRIATHLON STAGES & RACE CATEGORIES
-- ==============================================================================
INSERT INTO public.triathlon_stages (discipline, name, order_index, distance_label, distance_meters, start_point, end_point, safety_briefing, transition_info, is_confirmed)
VALUES
  ('swim', 'Open Water Swim', 1, '1.5 km (Olympic) / 750m (Sprint)', 1500, 'Msasani Bay Beach', 'Slipway Beach Exit', 'Water rescue boats stationed every 100m. Mandatory swim caps.', 'Swim exit ramp with non-slip mat leading to Transition 1.', FALSE),
  ('transition_1', 'Transition 1 (Swim → Bike)', 2, 'T1 Zone', 150, 'Slipway Exit', 'Bike Mount Line', 'Helmets must be buckled before un-racking bike. No riding in transition area.', 'Numbered bike racks, wetsuit drop bags.', FALSE),
  ('bike', 'Peninsula Coastal Ride', 3, '40 km (Olympic) / 20 km (Sprint)', 40000, 'Toure Drive Mount Line', 'Toure Drive Dismount Line', 'Draft-legal rules apply. 3 Aid stations along Chole Road & Toure Drive.', 'Dismount before line at Transition 2 entrance.', FALSE),
  ('transition_2', 'Transition 2 (Bike → Run)', 4, 'T2 Zone', 100, 'Bike Dismount Line', 'Run Exit Gate', 'Rack bike before unbuckling helmet. Grab running bib & shoes.', 'Shoe change area, direct access to run course.', FALSE),
  ('run', 'Dar Waterfront Run', 5, '10 km (Olympic) / 5 km (Sprint)', 10000, 'Oysterbay Waterfront Gate', 'Coco Beach Finish Line Arena', 'Hydration every 1.5km. Medical tents at km 3, km 6 and Finish.', 'High-energy finish chute with grandstands and timing mats.', FALSE)
ON CONFLICT DO NOTHING;

INSERT INTO public.race_categories (slug, name, format, swim_distance_m, bike_distance_m, run_distance_m, wave_start_time, entry_fee_tsh, max_participants, description)
VALUES
  ('olympic-individual', 'Olympic Distance Triathlon', 'individual', 1500, 40000, 10000, '06:00:00', 75000, 500, 'The premier test: 1.5km swim, 40km bike, 10km run across Dar es Salaam.'),
  ('sprint-individual', 'Sprint Distance Triathlon', 'individual', 750, 20000, 5000, '06:45:00', 50000, 600, 'Fast and accessible: 750m swim, 20km bike, 5km run.'),
  ('triathlon-relay', 'Team Relay (3 Athletes)', 'relay', 1500, 40000, 10000, '07:15:00', 120000, 200, 'Form a team of 3: one swimmer, one cyclist, one runner.')
ON CONFLICT (slug) DO UPDATE
SET entry_fee_tsh = EXCLUDED.entry_fee_tsh,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

-- ==============================================================================
-- 4. PRE-RACE CHALLENGES & DAR WAYPOINTS
-- ==============================================================================
INSERT INTO public.challenges (title, description, discipline, target_metric, target_value, unit, badge_name, badge_icon)
VALUES
  ('Swim 500m This Week', 'Log a continuous 500m swim session in preparation for Msasani Bay.', 'swim', 'distance', 500, 'meters', 'Aqua Pioneer', 'waves'),
  ('Ride 15 km Coastal', 'Ride along Toure Drive and Chole Road to test your cadence and pacing.', 'bike', 'distance', 15, 'km', 'Cadence Rider', 'bike'),
  ('Run 4 km Sunrise', 'Complete a morning run before 07:00 AM along the waterfront.', 'run', 'distance', 4, 'km', 'Sunrise Strider', 'flame'),
  ('Share Why You Race', 'Submit your story to the "Why I Participate" community wall.', 'community', 'completion', 1, 'story', 'Storyteller', 'heart'),
  ('Bring a Relay Teammate', 'Invite a friend or colleague to join your relay team.', 'community', 'completion', 1, 'athlete', 'Squad Builder', 'users')
ON CONFLICT DO NOTHING;

INSERT INTO public.map_waypoints (discipline, point_type, name, description, lat, lng, landmark, order_index, is_confirmed)
VALUES
  ('swim', 'start', 'Msasani Bay Swim Launch', 'Beach entry point with official timing mat', -6.7492100, 39.2731500, 'Msasani Slipway Beach', 1, FALSE),
  ('swim', 'turn', 'Outer Bay Turning Buoy 1', 'Turn right around large yellow pyramid buoy', -6.7431000, 39.2798000, 'Msasani Bay Channel', 2, FALSE),
  ('swim', 'finish', 'Slipway Swim Exit', 'Ramp exit with fresh water rinse station', -6.7485000, 39.2724000, 'The Slipway Promenade', 3, FALSE),
  ('bike', 'transition', 'Transition Area T1/T2', 'Secured bike corrals and timing gate', -6.7481000, 39.2720000, 'Slipway Upper Carpark', 4, FALSE),
  ('bike', 'start', 'Bike Mount Line', 'Toure Drive Northbound mount area', -6.7475000, 39.2735000, 'Toure Drive Entrance', 5, FALSE),
  ('bike', 'aid_station', 'Chole Road Aid Station', 'Hydration, electrolyte replacement & mechanical support', -6.7621000, 39.2792000, 'Chole Road Junction', 6, FALSE),
  ('bike', 'turn', 'Oysterbay Roundabout Loop', 'Controlled hairpin turn with safety barriers', -6.7725000, 39.2718000, 'Oysterbay Roundabout', 7, FALSE),
  ('run', 'start', 'Run Course Departure', 'Exit transition toward Coco Beach boulevard', -6.7479000, 39.2730000, 'Slipway Gate', 8, FALSE),
  ('run', 'aid_station', 'Coco Beach Water Station', 'Ice sponges, water bottles and energy gels', -6.7650000, 39.2885000, 'Coco Beach Boardwalk', 9, FALSE),
  ('run', 'medical', 'Kigamboni View Medical Post', 'First aid, ambulance standby and recovery', -6.7780000, 39.2890000, 'Ocean Road Hospital Zone', 10, FALSE),
  ('run', 'finish', 'Tour de Dar Finish Arena', 'Grandstand, timing arch, medal ceremony and recovery zone', -6.7680000, 39.2860000, 'Coco Beach Central Arena', 11, FALSE),
  ('event', 'parking', 'Official Athlete Parking', 'Secured park-and-ride facility with shuttle to start', -6.7550000, 39.2650000, 'Haile Selassie Field', 12, FALSE),
  ('event', 'spectator', 'Coco Beach Grandstand', 'Prime view of transition exit and final sprint', -6.7675000, 39.2855000, 'Coco Beach Amphitheatre', 13, FALSE)
ON CONFLICT DO NOTHING;

-- ==============================================================================
-- 5. OFFICIAL MERCHANDISE
-- ==============================================================================
INSERT INTO public.products (id, name, slug, description, category, price_participant, price_public, stock, sizes)
VALUES
  ('b1000001-0000-0000-0000-000000000001', 'Official Event Tech Jersey', 'event-tech-jersey', 'Tour de Rotary DSM 2026 moisture-wicking aerodynamic cycling jersey', 'apparel', 25000, 35000, 120, ARRAY['S','M','L','XL','2XL']),
  ('b1000002-0000-0000-0000-000000000002', 'Cotton Finisher T-Shirt', 'cotton-finisher-tshirt', 'Premium commemorative cotton crewneck', 'apparel', 15000, 20000, 200, ARRAY['S','M','L','XL','2XL']),
  ('b1000003-0000-0000-0000-000000000003', 'Pro Cycling Cap', 'cycling-cap', 'Classic breathable cycling cap with sweatband', 'accessories', 8000, 12000, 85, ARRAY['One Size']),
  ('b1000004-0000-0000-0000-000000000004', 'BPA-Free 750ml Water Bottle', 'water-bottle', 'Ergonomic easy-squeeze hydration bottle', 'accessories', 6000, 10000, 150, ARRAY['One Size'])
ON CONFLICT (slug) DO UPDATE
SET stock = EXCLUDED.stock,
    price_participant = EXCLUDED.price_participant,
    price_public = EXCLUDED.price_public;

-- ==============================================================================
-- 6. ROTARY COMMUNITY IMPACT
-- ==============================================================================
INSERT INTO public.community_impact (project_title, beneficiary, impact_metric, metric_value, description, order_index)
VALUES
  ('Clean Water for Dar Schools', '5,000+ Students across Kinondoni', 'Water Purification Units', '12 Schools', 'Installing solar-powered UV water filtration units in public primary schools.', 1),
  ('Ocean Clean-up & Coastline Preservation', 'Msasani Bay & Coco Beach Shores', 'Coastline Cleaned', '18 Kilometers', 'Direct support for local youth beach clean-up teams and mangrove regeneration.', 2),
  ('Youth Bicycle Mobility Project', 'Rural Secondary School Students', 'Bicycles Donated', '250 Bikes', 'Providing rugged bicycles to students walking more than 8km daily to attend school.', 3)
ON CONFLICT DO NOTHING;
