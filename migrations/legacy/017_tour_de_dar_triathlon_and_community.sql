-- ==============================================================================
-- 017: TOUR DE DAR — TRIATHLON & TEMPORARY DIGITAL COMMUNITY SCHEMA
-- ==============================================================================
-- Product Brief: "The city moves. The memory remains."
-- Core Journey: Discover → Join → Connect → Participate → Experience → Remember
-- Disciplines: SWIM → TRANSITION 1 → BIKE → TRANSITION 2 → RUN
-- ==============================================================================

-- ── 1. EVENT IDENTITY & LIFECYCLE ─────────────────────────────────────────────
-- States: live (pre-race & race), memory (post-race stories & photos), archive (read-only)
CREATE TABLE IF NOT EXISTS public.event_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL DEFAULT 'Tour de Dar',
  tagline TEXT NOT NULL DEFAULT 'The city moves. The memory remains.',
  current_mode TEXT NOT NULL DEFAULT 'live' CHECK (current_mode IN ('live', 'memory', 'archive')),
  event_date TIMESTAMPTZ NOT NULL DEFAULT '2026-10-18 06:00:00+03',
  memory_mode_unlocked_at TIMESTAMPTZ,
  archive_date TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed singleton lifecycle record if not exists
INSERT INTO public.event_lifecycle (event_name, tagline, current_mode, event_date)
SELECT 'Tour de Dar', 'The city moves. The memory remains.', 'live', '2026-10-18 06:00:00+03'
WHERE NOT EXISTS (SELECT 1 FROM public.event_lifecycle);

-- ── 2. TRIATHLON DISCIPLINES & STAGES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.triathlon_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline TEXT NOT NULL CHECK (discipline IN ('swim', 'transition_1', 'bike', 'transition_2', 'run')),
  name TEXT NOT NULL,
  order_index INT NOT NULL,
  distance_label TEXT,
  distance_meters INT,
  start_point TEXT,
  end_point TEXT,
  safety_briefing TEXT,
  transition_info TEXT,
  map_geojson JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Triathlon Stages
INSERT INTO public.triathlon_stages (discipline, name, order_index, distance_label, distance_meters, start_point, end_point, safety_briefing, transition_info)
VALUES
  ('swim', 'Open Water Swim', 1, '1.5 km (Olympic) / 750m (Sprint)', 1500, 'Msasani Bay Beach', 'Slipway Beach Exit', 'Water rescue boats stationed every 100m. Mandatory swim caps.', 'Swim exit ramp with non-slip mat leading to Transition 1.'),
  ('transition_1', 'Transition 1 (Swim → Bike)', 2, 'T1 Zone', 150, 'Slipway Exit', 'Bike Mount Line', 'Helmets must be buckled before un-racking bike. No riding in transition area.', 'Numbered bike racks, wetsuit drop bags.'),
  ('bike', 'Peninsula Coastal Ride', 3, '40 km (Olympic) / 20 km (Sprint)', 40000, 'Toure Drive Mount Line', 'Toure Drive Dismount Line', 'Draft-legal rules apply. 3 Aid stations along Chole Road & Toure Drive.', 'Dismount before line at Transition 2 entrance.'),
  ('transition_2', 'Transition 2 (Bike → Run)', 4, 'T2 Zone', 100, 'Bike Dismount Line', 'Run Exit Gate', 'Rack bike before unbuckling helmet. Grab running bib & shoes.', 'Shoe change area, direct access to run course.'),
  ('run', 'Dar Waterfront Run', 5, '10 km (Olympic) / 5 km (Sprint)', 10000, 'Oysterbay Waterfront Gate', 'Coco Beach Finish Line Arena', 'Hydration every 1.5km. Medical tents at km 3, km 6 and Finish.', 'High-energy finish chute with grandstands and timing mats.')
ON CONFLICT DO NOTHING;

-- ── 3. RACE CATEGORIES & WAVES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.race_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('individual', 'relay', 'corporate')),
  swim_distance_m INT NOT NULL,
  bike_distance_m INT NOT NULL,
  run_distance_m INT NOT NULL,
  wave_start_time TIME,
  entry_fee_tsh NUMERIC(12,2) NOT NULL DEFAULT 50000,
  max_participants INT DEFAULT 500,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.race_categories (slug, name, format, swim_distance_m, bike_distance_m, run_distance_m, wave_start_time, entry_fee_tsh, description)
VALUES
  ('olympic-individual', 'Olympic Distance Triathlon', 'individual', 1500, 40000, 10000, '06:00:00', 75000, 'The premier test: 1.5km swim, 40km bike, 10km run across Dar es Salaam.'),
  ('sprint-individual', 'Sprint Distance Triathlon', 'individual', 750, 20000, 5000, '06:45:00', 50000, 'Fast and accessible: 750m swim, 20km bike, 5km run.'),
  ('triathlon-relay', 'Team Relay (3 Athletes)', 'relay', 1500, 40000, 10000, '07:15:00', 120000, 'Form a team of 3: one swimmer, one cyclist, one runner.')
ON CONFLICT (slug) DO NOTHING;

-- ── 4. TEAMS & RELAY TEAMS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  team_type TEXT NOT NULL DEFAULT 'community' CHECK (team_type IN ('corporate', 'university', 'hospital', 'club', 'friends', 'ngo', 'community')),
  story TEXT,
  logo_url TEXT,
  captain_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_relay BOOLEAN NOT NULL DEFAULT FALSE,
  relay_swimmer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  relay_cyclist_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  relay_runner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  member_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('captain', 'member', 'swimmer', 'cyclist', 'runner')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, user_id)
);

-- ── 5. TEMPORARY COMMUNITY FEED ──────────────────────────────────────────────
-- Before and during the event: training updates, tips, stories, milestones
CREATE TABLE IF NOT EXISTS public.community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  discipline TEXT CHECK (discipline IN ('swim', 'bike', 'run', 'triathlon', 'general')),
  post_type TEXT NOT NULL DEFAULT 'training' CHECK (post_type IN ('training', 'story', 'prep', 'tip', 'question', 'milestone', 'team_update', 'excitement')),
  content TEXT NOT NULL,
  image_url TEXT,
  likes_count INT NOT NULL DEFAULT 0,
  comments_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'flagged', 'hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.post_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL DEFAULT 'cheer' CHECK (reaction_type IN ('cheer', 'fire', 'heart', 'applause', 'strong')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, user_id, reaction_type)
);

CREATE TABLE IF NOT EXISTS public.post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. "WHY I PARTICIPATE" / "WHY I RACE" STORIES ────────────────────────────
-- "Why are you doing this?" browsable collection
CREATE TABLE IF NOT EXISTS public.why_i_participate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  discipline TEXT NOT NULL DEFAULT 'triathlon' CHECK (discipline IN ('triathlon', 'swim', 'bike', 'run')),
  prompt TEXT NOT NULL DEFAULT 'Why are you doing this?',
  quote TEXT NOT NULL,
  story_details TEXT,
  photo_url TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 7. PRE-RACE CHALLENGES ────────────────────────────────────────────────────
-- "Swim 500m this week", "Ride 10km", "Run 3km", "Bring a friend"
CREATE TABLE IF NOT EXISTS public.challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  discipline TEXT NOT NULL DEFAULT 'general' CHECK (discipline IN ('swim', 'bike', 'run', 'community', 'general')),
  target_metric TEXT NOT NULL DEFAULT 'completion',
  target_value NUMERIC(10,2) DEFAULT 1,
  unit TEXT DEFAULT 'count',
  badge_name TEXT,
  badge_icon TEXT,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  completion_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'joined' CHECK (status IN ('joined', 'in_progress', 'completed')),
  progress_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, challenge_id)
);

-- Seed standard pre-race challenges
INSERT INTO public.challenges (title, description, discipline, target_metric, target_value, unit, badge_name, badge_icon)
VALUES
  ('Swim 500m This Week', 'Log a continuous 500m swim session in preparation for Msasani Bay.', 'swim', 'distance', 500, 'meters', 'Aqua Pioneer', 'waves'),
  ('Ride 15 km Coastal', 'Ride along Toure Drive and Chole Road to test your cadence and pacing.', 'bike', 'distance', 15, 'km', 'Cadence Rider', 'bike'),
  ('Run 4 km Sunrise', 'Complete a morning run before 07:00 AM along the waterfront.', 'run', 'distance', 4, 'km', 'Sunrise Strider', 'flame'),
  ('Share Why You Race', 'Submit your story to the "Why I Participate" community wall.', 'community', 'completion', 1, 'story', 'Storyteller', 'heart'),
  ('Bring a Relay Teammate', 'Invite a friend or colleague to join your relay team.', 'community', 'completion', 1, 'athlete', 'Squad Builder', 'users')
ON CONFLICT DO NOTHING;

-- ── 8. DIGITAL RACE BIBS & SHARABLE IDS ───────────────────────────────────────
-- Format: TOUR DE DAR | JOSHUA | TRIATHLON | #08421
CREATE TABLE IF NOT EXISTS public.digital_bibs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bib_number TEXT UNIQUE NOT NULL,
  athlete_name TEXT NOT NULL,
  category_name TEXT NOT NULL,
  team_name TEXT,
  qr_code_data TEXT NOT NULL,
  rendered_image_url TEXT,
  share_slug TEXT UNIQUE NOT NULL,
  is_claimed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 9. RACE RESULTS (TRIATHLON SPLITS) ─────────────────────────────────────────
-- Split times: Swim, T1, Bike, T2, Run, Overall
CREATE TABLE IF NOT EXISTS public.triathlon_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bib_number TEXT NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  athlete_name TEXT NOT NULL,
  category_slug TEXT NOT NULL,
  swim_time_seconds INT,
  t1_time_seconds INT,
  bike_time_seconds INT,
  t2_time_seconds INT,
  run_time_seconds INT,
  total_time_seconds INT,
  rank_overall INT,
  rank_category INT,
  rank_gender INT,
  status TEXT NOT NULL DEFAULT 'finished' CHECK (status IN ('finished', 'dnf', 'dns', 'disqualified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 10. DAR INTERACTIVE MAP WAYPOINTS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.map_waypoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline TEXT NOT NULL CHECK (discipline IN ('swim', 'bike', 'run', 'event')),
  point_type TEXT NOT NULL CHECK (point_type IN ('start', 'turn', 'aid_station', 'medical', 'transition', 'spectator', 'parking', 'finish')),
  name TEXT NOT NULL,
  description TEXT,
  lat NUMERIC(10, 7) NOT NULL,
  lng NUMERIC(10, 7) NOT NULL,
  landmark TEXT,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Dar Es Salaam Iconic Waypoints
INSERT INTO public.map_waypoints (discipline, point_type, name, description, lat, lng, landmark, order_index)
VALUES
  ('swim', 'start', 'Msasani Bay Swim Launch', 'Beach entry point with official timing mat', -6.7492100, 39.2731500, 'Msasani Slipway Beach', 1),
  ('swim', 'turn', 'Outer Bay Turning Buoy 1', 'Turn right around large yellow pyramid buoy', -6.7431000, 39.2798000, 'Msasani Bay Channel', 2),
  ('swim', 'finish', 'Slipway Swim Exit', 'Ramp exit with fresh water rinse station', -6.7485000, 39.2724000, 'The Slipway Promenade', 3),
  ('bike', 'transition', 'Transition Area T1/T2', 'Secured bike corrals and timing gate', -6.7481000, 39.2720000, 'Slipway Upper Carpark', 4),
  ('bike', 'start', 'Bike Mount Line', 'Toure Drive Northbound mount area', -6.7475000, 39.2735000, 'Toure Drive Entrance', 5),
  ('bike', 'aid_station', 'Chole Road Aid Station', 'Hydration, electrolyte replacement & mechanical support', -6.7621000, 39.2792000, 'Chole Road Junction', 6),
  ('bike', 'turn', 'Oysterbay Roundabout Loop', 'Controlled hairpin turn with safety barriers', -6.7725000, 39.2718000, 'Oysterbay Roundabout', 7),
  ('run', 'start', 'Run Course Departure', 'Exit transition toward Coco Beach boulevard', -6.7479000, 39.2730000, 'Slipway Gate', 8),
  ('run', 'aid_station', 'Coco Beach Water Station', 'Ice sponges, water bottles and energy gels', -6.7650000, 39.2885000, 'Coco Beach Boardwalk', 9),
  ('run', 'medical', 'Kigamboni View Medical Post', 'First aid, ambulance standby and recovery', -6.7780000, 39.2890000, 'Ocean Road Hospital Zone', 10),
  ('run', 'finish', 'Tour de Dar Finish Arena', 'Grandstand, timing arch, medal ceremony and recovery zone', -6.7680000, 39.2860000, 'Coco Beach Central Arena', 11),
  ('event', 'parking', 'Official Athlete Parking', 'Secured park-and-ride facility with shuttle to start', -6.7550000, 39.2650000, 'Haile Selassie Field', 12),
  ('event', 'spectator', 'Coco Beach Grandstand', 'Prime view of transition exit and final sprint', -6.7675000, 39.2855000, 'Coco Beach Amphitheatre', 13)
ON CONFLICT DO NOTHING;

-- ── 11. "FIND ME IN THE RACE" PHOTOS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.race_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT NOT NULL,
  thumb_url TEXT,
  discipline TEXT CHECK (discipline IN ('swim', 'bike', 'run', 'finish', 'awards', 'general')),
  checkpoint_name TEXT,
  bib_numbers TEXT[] DEFAULT '{}',
  photographer TEXT,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_race_photos_bibs ON public.race_photos USING GIN (bib_numbers);

-- ── 12. ROTARY COMMUNITY IMPACT ──────────────────────────────────────────────
-- "Where your participation goes"
CREATE TABLE IF NOT EXISTS public.community_impact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_title TEXT NOT NULL,
  beneficiary TEXT NOT NULL,
  impact_metric TEXT NOT NULL,
  metric_value TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  order_index INT NOT NULL DEFAULT 0
);

INSERT INTO public.community_impact (project_title, beneficiary, impact_metric, metric_value, description, order_index)
VALUES
  ('Clean Water for Dar Schools', '5,000+ Students across Kinondoni', 'Water Purification Units', '12 Schools', 'Installing solar-powered UV water filtration units in public primary schools.', 1),
  ('Ocean Clean-up & Coastline Preservation', 'Msasani Bay & Coco Beach Shores', 'Coastline Cleaned', '18 Kilometers', 'Direct support for local youth beach clean-up teams and mangrove regeneration.', 2),
  ('Youth Bicycle Mobility Project', 'Rural Secondary School Students', 'Bicycles Donated', '250 Bikes', 'Providing rugged bicycles to students walking more than 8km daily to attend school.', 3)
ON CONFLICT DO NOTHING;

-- ── 13. RESEARCH & CONSENT LAYER ──────────────────────────────────────────────
-- Transparent, consent-driven research on motivations, engagement & participation
CREATE TABLE IF NOT EXISTS public.research_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  allow_anonymized_analytics BOOLEAN NOT NULL DEFAULT TRUE,
  allow_motivation_research BOOLEAN NOT NULL DEFAULT TRUE,
  allow_demographic_study BOOLEAN NOT NULL DEFAULT TRUE,
  consent_given_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

-- ── 14. SEED SAMPLE STORIES ("WHY I PARTICIPATE") ─────────────────────────────
INSERT INTO public.why_i_participate (user_id, display_name, discipline, quote, story_details, is_featured)
SELECT
  p.id,
  'Neema M.',
  'triathlon',
  'I wanted to prove to myself that I could.',
  'After two years of running 10k races, taking on the Indian Ocean swim and the Toure Drive headwinds felt terrifying. That is exactly why I had to do it.',
  TRUE
FROM public.profiles p WHERE p.email = 'participant@gmail.com'
LIMIT 1
ON CONFLICT DO NOTHING;

-- ── 15. ENABLE ROW LEVEL SECURITY ────────────────────────────────────────────
ALTER TABLE public.event_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triathlon_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.why_i_participate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_bibs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triathlon_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_waypoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_impact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_consents ENABLE ROW LEVEL SECURITY;

-- Public read policies for open community & event content
CREATE POLICY "Public read event_lifecycle" ON public.event_lifecycle FOR SELECT USING (true);
CREATE POLICY "Public read triathlon_stages" ON public.triathlon_stages FOR SELECT USING (true);
CREATE POLICY "Public read race_categories" ON public.race_categories FOR SELECT USING (true);
CREATE POLICY "Public read teams" ON public.teams FOR SELECT USING (true);
CREATE POLICY "Public read team_members" ON public.team_members FOR SELECT USING (true);
CREATE POLICY "Public read community_posts" ON public.community_posts FOR SELECT USING (status = 'published');
CREATE POLICY "Public read post_reactions" ON public.post_reactions FOR SELECT USING (true);
CREATE POLICY "Public read post_comments" ON public.post_comments FOR SELECT USING (true);
CREATE POLICY "Public read why_i_participate" ON public.why_i_participate FOR SELECT USING (true);
CREATE POLICY "Public read challenges" ON public.challenges FOR SELECT USING (true);
CREATE POLICY "Public read user_challenges" ON public.user_challenges FOR SELECT USING (true);
CREATE POLICY "Public read digital_bibs" ON public.digital_bibs FOR SELECT USING (true);
CREATE POLICY "Public read triathlon_results" ON public.triathlon_results FOR SELECT USING (true);
CREATE POLICY "Public read map_waypoints" ON public.map_waypoints FOR SELECT USING (true);
CREATE POLICY "Public read race_photos" ON public.race_photos FOR SELECT USING (true);
CREATE POLICY "Public read community_impact" ON public.community_impact FOR SELECT USING (true);

-- Authenticated write policies
CREATE POLICY "Auth write community_posts" ON public.community_posts FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');
CREATE POLICY "Auth write post_reactions" ON public.post_reactions FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');
CREATE POLICY "Auth write post_comments" ON public.post_comments FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');
CREATE POLICY "Auth write why_i_participate" ON public.why_i_participate FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');
CREATE POLICY "Auth write teams" ON public.teams FOR INSERT WITH CHECK (auth.uid() IS NOT NULL OR auth.role() = 'service_role');
CREATE POLICY "Auth write team_members" ON public.team_members FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');
CREATE POLICY "Auth write user_challenges" ON public.user_challenges FOR ALL USING (auth.uid() = user_id OR auth.role() = 'service_role');
CREATE POLICY "Auth write research_consents" ON public.research_consents FOR ALL USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- =============================================================================
-- §15 MODERATION — REPORTS (designed into the system, not added later)
--
-- post_reports.id is a TEXT PK so a duplicate report (same reporter, same
-- post) upserts onto the existing row instead of erroring — the idempotent
-- "one report per user per post" pattern. RLS: a reporter sees only their own
-- reports; the backend reads/writes everything with the service role.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.post_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'inappropriate', 'misinformation', 'other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  moderator_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, reporter_id)
);

ALTER TABLE public.post_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth report posts" ON public.post_reports FOR INSERT WITH CHECK (auth.uid() = reporter_id OR auth.role() = 'service_role');
CREATE POLICY "Read own reports" ON public.post_reports FOR SELECT USING (auth.uid() = reporter_id OR auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_post_reports_queue ON public.post_reports (status, created_at DESC);

-- =============================================================================
-- §9 CHALLENGES — completion counter helper
--
-- challengeController increments challenges.completion_count through this
-- SECURITY DEFINER function so the write works under the anon/participant
-- RLS policies too (the service role bypasses RLS, but a participant-driven
-- completion path should not rely on that).
-- =============================================================================
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

-- §4 WHY I PARTICIPATE — admin-approved public collection.
-- (storiesRoutes exposes PATCH /stories/:storyId/approve; the public read
-- gates on is_approved.)
ALTER TABLE public.why_i_participate ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE;

-- §6 DIGITAL BIBS — generateBib upserts with onConflict:'user_id', which
-- PostgREST only accepts if a unique index exists on that column.
CREATE UNIQUE INDEX IF NOT EXISTS uq_digital_bibs_user ON public.digital_bibs (user_id);

-- NOTE: This migration must be applied via the Supabase dashboard
-- (SQL Editor) — the project has no programmatic migration runner.
