-- ==============================================================================
-- TOUR DE ROTARY DSM 2026 - MIGRATION 002: EXTENDED SCOPE TABLES
-- Supporting Campaigns, Twibbon Generation, Comms Templates & Schedule C Evaluation
-- ==============================================================================

-- 1. CAMPAIGNS & MARKETING UTM TRACKING
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID REFERENCES event_editions(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source TEXT NOT NULL, -- e.g. 'instagram', 'strava_club', 'corporate_email'
  medium TEXT NOT NULL, -- e.g. 'social', 'banner', 'newsletter'
  discount_percentage INTEGER DEFAULT 0,
  clicks_count INTEGER NOT NULL DEFAULT 0,
  conversions_count INTEGER NOT NULL DEFAULT 0,
  revenue_generated_tsh BIGINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_slug ON campaigns(slug);

-- 2. COMMUNICATION TEMPLATES (SMS & Email Workflows)
CREATE TABLE IF NOT EXISTS communication_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_key TEXT NOT NULL UNIQUE, -- 'reg_confirmed', 'day4_warning', 'day6_warning', 'finisher_cert', 'volunteer_shift'
  channel TEXT NOT NULL CHECK (channel IN ('SMS', 'EMAIL')),
  title TEXT NOT NULL,
  subject TEXT,
  body_template TEXT NOT NULL, -- contains merge variables like {{athlete_name}}, {{bib_number}}
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TWIBBON SOCIAL FRAME GENERATIONS & METADATA
CREATE TABLE IF NOT EXISTS social_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  participant_name TEXT NOT NULL,
  bib_number TEXT,
  frame_template TEXT NOT NULL DEFAULT 'cyclathon_60km_gold',
  rendered_image_url TEXT,
  shared_platform TEXT CHECK (shared_platform IN ('whatsapp', 'twitter', 'instagram', 'facebook', 'download')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. POST-EVENT MONITORING & EVALUATION (SCHEDULE C)
CREATE TABLE IF NOT EXISTS evaluation_surveys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID REFERENCES event_editions(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  nps_score INTEGER NOT NULL CHECK (nps_score BETWEEN 0 AND 10),
  route_safety_rating INTEGER NOT NULL CHECK (route_safety_rating BETWEEN 1 AND 5),
  hydration_rating INTEGER NOT NULL CHECK (hydration_rating BETWEEN 1 AND 5),
  merchandise_rating INTEGER CHECK (merchandise_rating BETWEEN 1 AND 5),
  app_experience_rating INTEGER NOT NULL CHECK (app_experience_rating BETWEEN 1 AND 5),
  what_went_well TEXT,
  areas_for_improvement TEXT,
  would_recommend BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. HQ AUDIT LOGS (Security & Traceability)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  target_resource TEXT NOT NULL,
  details_json JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at);
