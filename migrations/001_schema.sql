-- ==============================================================================
-- TOUR DE DAR 2026 — CONSOLIDATED SCHEMA  (001_schema.sql)
--
-- This file is the single source of truth for every table in the live
-- Supabase project (zovnkeaoorrxfjdxcmlk).
-- It replaces migrations 001 – 017 (table creation portions only).
--
-- HOW TO APPLY:
--   1. Open Supabase → SQL Editor.
--   2. Paste this entire file and click "Run".
--   3. Then run  002_triggers_rls.sql
--   4. Then run  003_seed.sql
--
-- IMPORTANT: Run in a fresh schema only. If tables already exist, the
-- CREATE TABLE IF NOT EXISTS guards will skip them safely, but later
-- ALTER TABLE lines may conflict. Review before re-running on a live DB.
-- ==============================================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. CORE IDENTITY TABLES
-- ==============================================================================

-- event_editions — one row per year's race
CREATE TABLE IF NOT EXISTS public.event_editions (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  year            INTEGER     NOT NULL UNIQUE,
  slug            TEXT        NOT NULL UNIQUE,
  title           TEXT        NOT NULL,
  current_phase   TEXT        NOT NULL DEFAULT 'pre_event'
                              CHECK (current_phase = ANY (ARRAY['pre_event','event_day','post_event'])),
  event_date      TIMESTAMPTZ NOT NULL,
  location_name   TEXT        NOT NULL DEFAULT 'Dar es Salaam, Tanzania',
  config_json     JSONB       NOT NULL DEFAULT '{
    "sms_sender_id":"ROTARY-DSM",
    "payme_currency":"TZS",
    "currency_symbol":"TSh",
    "early_bird_active":true,
    "merch_reservation_days":7
  }'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_editions_pkey PRIMARY KEY (id)
);

-- profiles — one row per user (linked to auth.users via auth_user_id)
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  auth_user_id    UUID        UNIQUE,
  full_name       TEXT        NOT NULL DEFAULT '',
  email           TEXT        UNIQUE,
  phone_number    TEXT,
  phone           TEXT,
  role            TEXT        NOT NULL DEFAULT 'participant'
                              CHECK (role IN ('participant','volunteer','sponsor','partner','admin','hq_admin')),
  referral_code   TEXT        UNIQUE
                              DEFAULT ('TDR' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 8))),
  national_id     TEXT,
  emergency_contact TEXT,
  medical_notes   TEXT,
  avatar_url      TEXT,
  bio             TEXT,
  city            TEXT,
  country         TEXT        DEFAULT 'Tanzania',
  date_of_birth   DATE,
  gender          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- 2. REGISTRATIONS, ORDERS, PAYMENTS, TICKETS
-- ==============================================================================

-- activities — legacy event categories (cyclathon era)
CREATE TABLE IF NOT EXISTS public.activities (
  id                      UUID        NOT NULL DEFAULT uuid_generate_v4(),
  edition_id              UUID        REFERENCES public.event_editions(id) ON DELETE CASCADE,
  title                   TEXT        NOT NULL,
  category                TEXT        NOT NULL DEFAULT 'General',
  description             TEXT,
  distance_km             NUMERIC(6,2),
  start_time              TEXT,
  flag_off_location       TEXT,
  capacity                INTEGER     DEFAULT 500,
  early_bird_price_tsh    NUMERIC(12,2) DEFAULT 0,
  standard_price_tsh      NUMERIC(12,2) DEFAULT 0,
  status                  TEXT        NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open','closed','cancelled')),
  slug                    TEXT        UNIQUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activities_pkey PRIMARY KEY (id)
);

-- registrations — frontend writes here directly
CREATE TABLE IF NOT EXISTS public.registrations (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_slug   TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','paid','checked_in','cancelled')),
  payment_status  TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (payment_status IN ('pending','processing','completed','failed','refunded')),
  amount_tsh      NUMERIC(12,2),
  bib_number      TEXT,
  t_shirt_size    TEXT,
  emergency_contact TEXT,
  dietary_notes   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT registrations_pkey PRIMARY KEY (id)
);

-- orders — backend/trigger created
CREATE TABLE IF NOT EXISTS public.orders (
  id                      UUID        NOT NULL DEFAULT uuid_generate_v4(),
  order_number            TEXT        NOT NULL UNIQUE,
  profile_id              UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  edition_id              UUID        REFERENCES public.event_editions(id) ON DELETE SET NULL,
  status                  TEXT        NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending','paid','cancelled','refunded')),
  subtotal_tsh            NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_tsh            NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_tsh               NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency                TEXT        NOT NULL DEFAULT 'TZS',
  billing_phone           TEXT        NOT NULL DEFAULT '',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id                 UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  customer_email          TEXT,
  delivery_status         TEXT,
  picked_up_at            TIMESTAMPTZ,
  notes                   TEXT,
  source_registration_id  UUID        REFERENCES public.registrations(id) ON DELETE SET NULL,
  CONSTRAINT orders_pkey PRIMARY KEY (id)
);

-- order_items
CREATE TABLE IF NOT EXISTS public.order_items (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  order_id        UUID        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  item_type       TEXT        NOT NULL CHECK (item_type IN ('activity_ticket','merchandise','donation')),
  reference_id    UUID,
  description     TEXT        NOT NULL DEFAULT '',
  quantity        INTEGER     NOT NULL DEFAULT 1,
  unit_price_tsh  NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal_tsh    NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_items_pkey PRIMARY KEY (id)
);

-- payments
CREATE TABLE IF NOT EXISTS public.payments (
  id                  UUID        NOT NULL DEFAULT uuid_generate_v4(),
  order_id            UUID        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  idempotency_key     TEXT        NOT NULL UNIQUE,
  payme_reference     TEXT,
  payment_method      TEXT        NOT NULL DEFAULT 'mpesa'
                                  CHECK (payment_method IN ('mpesa','tigopesa','airtelmoney','halopesa','card')),
  phone_number        TEXT,
  amount_tsh          NUMERIC(12,2) NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','processing','completed','failed','refunded')),
  webhook_received_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_pkey PRIMARY KEY (id)
);

-- tickets
CREATE TABLE IF NOT EXISTS public.tickets (
  id                      UUID        NOT NULL DEFAULT uuid_generate_v4(),
  order_id                UUID        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  profile_id              UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_id             UUID        REFERENCES public.race_categories(id) ON DELETE SET NULL,
  bib_number              TEXT,
  qr_verification_token   TEXT        NOT NULL UNIQUE DEFAULT UPPER(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT)),
  checked_in              BOOLEAN     NOT NULL DEFAULT FALSE,
  checked_in_at           TIMESTAMPTZ,
  checked_in_by           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_registration_id  UUID        REFERENCES public.registrations(id) ON DELETE SET NULL,
  issued_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tickets_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- 3. MERCHANDISE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.products (
  id                  UUID        NOT NULL DEFAULT uuid_generate_v4(),
  name                TEXT        NOT NULL,
  slug                TEXT        UNIQUE NOT NULL,
  description         TEXT,
  category            TEXT        NOT NULL DEFAULT 'apparel',
  image_url           TEXT,
  price_participant   NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_public        NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock               INTEGER     NOT NULL DEFAULT 0,
  sizes               TEXT[],
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.product_variants (
  id                  UUID        NOT NULL DEFAULT uuid_generate_v4(),
  edition_id          UUID        REFERENCES public.event_editions(id) ON DELETE CASCADE,
  product_id          UUID        REFERENCES public.products(id) ON DELETE SET NULL,
  product_name        TEXT        NOT NULL,
  variant_type        TEXT        NOT NULL DEFAULT 'One Size',
  price_tsh           NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_quantity      INTEGER     NOT NULL DEFAULT 0,
  reserved_quantity   INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_variants_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id                  UUID        NOT NULL DEFAULT uuid_generate_v4(),
  order_id            UUID        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  variant_id          UUID        NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  quantity            INTEGER     NOT NULL DEFAULT 1,
  reserved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  status              TEXT        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','released','fulfilled')),
  CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- 4. SPONSORS & PARTNERS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.sponsors (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  user_id         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  company_name    TEXT        NOT NULL,
  tier            TEXT        NOT NULL DEFAULT 'bronze'
                              CHECK (tier IN ('title','gold','silver','bronze','inkind')),
  logo_url        TEXT,
  website_url     TEXT,
  contact_person  TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  amount_tsh      NUMERIC(14,2) DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','confirmed','active','declined')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sponsors_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.sponsor_deliverables (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  sponsor_id      UUID        REFERENCES public.sponsors(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  due_date        DATE,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','in_progress','completed','overdue')),
  completed_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sponsor_deliverables_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.sponsor_assets (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  sponsor_id      UUID        NOT NULL REFERENCES public.sponsors(id) ON DELETE CASCADE,
  asset_type      TEXT        NOT NULL,
  file_url        TEXT        NOT NULL,
  file_name       TEXT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sponsor_assets_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.partners (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  user_id         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  organization    TEXT        NOT NULL,
  category        TEXT        NOT NULL DEFAULT 'media'
                              CHECK (category IN ('media','logistics','health','venue','tech','ngo','government','other')),
  logo_url        TEXT,
  contact_person  TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','confirmed','active','declined')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT partners_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.partner_clearances (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  partner_id      UUID        REFERENCES public.partners(id) ON DELETE CASCADE,
  clearance_type  TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','granted','revoked')),
  granted_at      TIMESTAMPTZ,
  notes           TEXT,
  hq_notes        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT partner_clearances_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.partner_deliverables (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  partner_id      UUID        REFERENCES public.partners(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  due_date        DATE,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','in_progress','completed','overdue')),
  completed_at    TIMESTAMPTZ,
  hq_notes        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT partner_deliverables_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- 5. VOLUNTEERS & SHIFTS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.shifts (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  edition_id      UUID        REFERENCES public.event_editions(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  location        TEXT,
  discipline      TEXT,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  capacity        INTEGER     NOT NULL DEFAULT 10,
  filled          INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shifts_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.volunteer_shifts (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  volunteer_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shift_id        UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'confirmed'
                              CHECK (status IN ('confirmed','cancelled','completed')),
  signed_up_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (volunteer_id, shift_id),
  CONSTRAINT volunteer_shifts_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.volunteer_assignments (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  volunteer_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_title      TEXT        NOT NULL,
  area            TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT volunteer_assignments_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- 6. COMMUNICATION
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.communication_templates (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  name            TEXT        NOT NULL UNIQUE,
  channel         TEXT        NOT NULL CHECK (channel IN ('sms','email','push')),
  subject         TEXT,
  body            TEXT        NOT NULL,
  variables       TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT communication_templates_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.communication_queue (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  recipient_id    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  channel         TEXT        NOT NULL CHECK (channel IN ('sms','email','push')),
  template_id     UUID        REFERENCES public.communication_templates(id) ON DELETE SET NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued','sent','failed','cancelled')),
  attempts        INTEGER     NOT NULL DEFAULT 0,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT communication_queue_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  email           TEXT        NOT NULL UNIQUE,
  full_name       TEXT,
  source          TEXT        DEFAULT 'website',
  subscribed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ,
  CONSTRAINT newsletter_subscribers_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- 7. PROMOTIONS & FINANCIAL
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  code            TEXT        NOT NULL UNIQUE,
  description     TEXT,
  discount_type   TEXT        NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value  NUMERIC(10,2) NOT NULL,
  min_order_tsh   NUMERIC(12,2) DEFAULT 0,
  max_uses        INTEGER,
  uses_count      INTEGER     NOT NULL DEFAULT 0,
  valid_from      TIMESTAMPTZ,
  valid_until     TIMESTAMPTZ,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promo_codes_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  order_id        UUID        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  profile_id      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason          TEXT        NOT NULL,
  amount_tsh      NUMERIC(12,2) NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','rejected','processed')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,
  CONSTRAINT refund_requests_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  referrer_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_id     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  referral_code   TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','converted','expired')),
  reward_tsh      NUMERIC(12,2) DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referrals_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.participant_wishlist (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id      UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id),
  CONSTRAINT participant_wishlist_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- 8. MARKETING & ANALYTICS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.campaigns (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  name            TEXT        NOT NULL,
  channel         TEXT        NOT NULL CHECK (channel IN ('sms','email','social','paid')),
  status          TEXT        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','active','paused','completed')),
  target_audience JSONB       DEFAULT '{}',
  send_at         TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaigns_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.social_shares (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  user_id         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  share_type      TEXT        NOT NULL,
  platform        TEXT,
  referral_code   TEXT,
  metadata        JSONB       DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT social_shares_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.site_content (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  key             TEXT        NOT NULL UNIQUE,
  value           TEXT        NOT NULL,
  content_type    TEXT        NOT NULL DEFAULT 'text'
                              CHECK (content_type IN ('text','html','json','markdown')),
  updated_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT site_content_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- 9. INCIDENTS & EVALUATION
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.incidents (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  reported_by     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  title           TEXT        NOT NULL,
  description     TEXT        NOT NULL,
  severity        TEXT        NOT NULL DEFAULT 'low'
                              CHECK (severity IN ('low','medium','high','critical')),
  status          TEXT        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','in_progress','resolved','closed')),
  location        TEXT,
  resolved_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT incidents_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.evaluation_surveys (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  user_id         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  edition_id      UUID        REFERENCES public.event_editions(id) ON DELETE CASCADE,
  overall_rating  INTEGER     CHECK (overall_rating BETWEEN 1 AND 5),
  organization    INTEGER     CHECK (organization BETWEEN 1 AND 5),
  course          INTEGER     CHECK (course BETWEEN 1 AND 5),
  safety          INTEGER     CHECK (safety BETWEEN 1 AND 5),
  experience      INTEGER     CHECK (experience BETWEEN 1 AND 5),
  comments        TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT evaluation_surveys_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- 10. ADMIN & AUDIT
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id                UUID        NOT NULL DEFAULT uuid_generate_v4(),
  action            TEXT        NOT NULL,
  target_resource   TEXT        NOT NULL,
  details_json      JSONB       NOT NULL DEFAULT '{}',
  actor_profile_id  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id)
);

-- event_config — singleton (id=1), controls active phase
CREATE TABLE IF NOT EXISTS public.event_config (
  id          INTEGER     NOT NULL DEFAULT 1,
  phase       TEXT        NOT NULL DEFAULT 'pre_event'
                          CHECK (phase IN ('pre_event','event_day','post_event','archive')),
  event_date  TIMESTAMPTZ,
  updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_config_pkey     PRIMARY KEY (id),
  CONSTRAINT event_config_singleton CHECK (id = 1)
);

-- Ensure singleton row exists
INSERT INTO public.event_config (id, phase, event_date)
VALUES (1, 'pre_event', '2026-10-18 06:00:00+03')
ON CONFLICT (id) DO NOTHING;

-- digital_collectibles
CREATE TABLE IF NOT EXISTS public.digital_collectibles (
  id              UUID        NOT NULL DEFAULT uuid_generate_v4(),
  profile_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  collectible_type TEXT       NOT NULL,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT digital_collectibles_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- 11. TRIATHLON-ERA TABLES (Tour de Dar 2026)
-- ==============================================================================

-- event_lifecycle — live/memory/archive framing
CREATE TABLE IF NOT EXISTS public.event_lifecycle (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name              TEXT        NOT NULL DEFAULT 'Tour de Dar',
  tagline                 TEXT        NOT NULL DEFAULT 'The city moves. The memory remains.',
  current_mode            TEXT        NOT NULL DEFAULT 'live'
                                      CHECK (current_mode IN ('live','memory','archive')),
  event_date              TIMESTAMPTZ NOT NULL DEFAULT '2026-10-18 06:00:00+03',
  memory_mode_unlocked_at TIMESTAMPTZ,
  archive_date            TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.event_lifecycle (event_name, tagline, current_mode, event_date)
SELECT 'Tour de Dar', 'The city moves. The memory remains.', 'live', '2026-10-18 06:00:00+03'
WHERE NOT EXISTS (SELECT 1 FROM public.event_lifecycle);

-- triathlon_stages
CREATE TABLE IF NOT EXISTS public.triathlon_stages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline      TEXT        NOT NULL
                              CHECK (discipline IN ('swim','transition_1','bike','transition_2','run')),
  name            TEXT        NOT NULL,
  order_index     INT         NOT NULL,
  distance_label  TEXT,
  distance_meters INT,
  start_point     TEXT,
  end_point       TEXT,
  safety_briefing TEXT,
  transition_info TEXT,
  map_geojson     JSONB,
  is_confirmed    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- race_categories — triathlon disciplines (tickets.activity_id → here)
CREATE TABLE IF NOT EXISTS public.race_categories (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        UNIQUE NOT NULL,
  name              TEXT        NOT NULL,
  format            TEXT        NOT NULL CHECK (format IN ('individual','relay','corporate')),
  swim_distance_m   INT         NOT NULL,
  bike_distance_m   INT         NOT NULL,
  run_distance_m    INT         NOT NULL,
  wave_start_time   TIME,
  entry_fee_tsh     NUMERIC(12,2) NOT NULL DEFAULT 50000,
  max_participants  INT         DEFAULT 500,
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.race_categories (slug, name, format, swim_distance_m, bike_distance_m, run_distance_m, wave_start_time, entry_fee_tsh, description)
VALUES
  ('olympic-individual','Olympic Distance Triathlon','individual',1500,40000,10000,'06:00:00',75000,'The premier test: 1.5km swim, 40km bike, 10km run across Dar es Salaam.'),
  ('sprint-individual','Sprint Distance Triathlon','individual',750,20000,5000,'06:45:00',50000,'Fast and accessible: 750m swim, 20km bike, 5km run.'),
  ('triathlon-relay','Team Relay (3 Athletes)','relay',1500,40000,10000,'07:15:00',120000,'Form a team of 3: one swimmer, one cyclist, one runner.')
ON CONFLICT (slug) DO NOTHING;

-- teams & team_members
CREATE TABLE IF NOT EXISTS public.teams (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  slug            TEXT        UNIQUE NOT NULL,
  team_type       TEXT        NOT NULL DEFAULT 'community'
                              CHECK (team_type IN ('corporate','university','hospital','club','friends','ngo','community')),
  story           TEXT,
  logo_url        TEXT,
  captain_id      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_relay        BOOLEAN     NOT NULL DEFAULT FALSE,
  relay_swimmer_id UUID       REFERENCES public.profiles(id) ON DELETE SET NULL,
  relay_cyclist_id UUID       REFERENCES public.profiles(id) ON DELETE SET NULL,
  relay_runner_id UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  member_count    INT         NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_members (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID    NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id     UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL DEFAULT 'member'
                      CHECK (role IN ('captain','member','swimmer','cyclist','runner')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, user_id)
);

-- community_posts / reactions / comments
CREATE TABLE IF NOT EXISTS public.community_posts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  discipline      TEXT        CHECK (discipline IN ('swim','bike','run','triathlon','general')),
  post_type       TEXT        NOT NULL DEFAULT 'training'
                              CHECK (post_type IN ('training','story','prep','tip','question','milestone','team_update','excitement')),
  content         TEXT        NOT NULL,
  image_url       TEXT,
  likes_count     INT         NOT NULL DEFAULT 0,
  comments_count  INT         NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'published'
                              CHECK (status IN ('published','flagged','hidden')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.post_reactions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         UUID        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction_type   TEXT        NOT NULL DEFAULT 'cheer'
                              CHECK (reaction_type IN ('cheer','fire','heart','applause','strong')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, user_id, reaction_type)
);

CREATE TABLE IF NOT EXISTS public.post_comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.post_reports (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  post_id         UUID        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  reporter_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason          TEXT        NOT NULL CHECK (reason IN ('spam','abuse','inappropriate','misinformation','other')),
  details         TEXT,
  status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  moderator_note  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, reporter_id)
);

-- why_i_participate stories
CREATE TABLE IF NOT EXISTS public.why_i_participate (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name    TEXT        NOT NULL,
  discipline      TEXT        NOT NULL DEFAULT 'triathlon'
                              CHECK (discipline IN ('triathlon','swim','bike','run')),
  prompt          TEXT        NOT NULL DEFAULT 'Why are you doing this?',
  quote           TEXT        NOT NULL,
  story_details   TEXT,
  photo_url       TEXT,
  is_featured     BOOLEAN     NOT NULL DEFAULT FALSE,
  is_approved     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- challenges & user_challenges
CREATE TABLE IF NOT EXISTS public.challenges (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT        NOT NULL,
  description       TEXT        NOT NULL,
  discipline        TEXT        NOT NULL DEFAULT 'general'
                                CHECK (discipline IN ('swim','bike','run','community','general')),
  target_metric     TEXT        NOT NULL DEFAULT 'completion',
  target_value      NUMERIC(10,2) DEFAULT 1,
  unit              TEXT        DEFAULT 'count',
  badge_name        TEXT,
  badge_icon        TEXT,
  start_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  end_date          DATE        NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  completion_count  INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_challenges (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  challenge_id    UUID        NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'joined'
                              CHECK (status IN ('joined','in_progress','completed')),
  progress_value  NUMERIC(10,2) NOT NULL DEFAULT 0,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, challenge_id)
);

-- digital_bibs
CREATE TABLE IF NOT EXISTS public.digital_bibs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bib_number      TEXT        UNIQUE NOT NULL
                              DEFAULT ('TDD-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 6))),
  athlete_name    TEXT        NOT NULL,
  category_name   TEXT        NOT NULL,
  team_name       TEXT,
  qr_code_data    TEXT        NOT NULL
                              DEFAULT (MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT)),
  rendered_image_url TEXT,
  share_slug      TEXT        UNIQUE NOT NULL
                              DEFAULT (LOWER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 10))),
  is_claimed      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_digital_bibs_user ON public.digital_bibs (user_id);

-- triathlon_results
CREATE TABLE IF NOT EXISTS public.triathlon_results (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  bib_number          TEXT    NOT NULL,
  user_id             UUID    REFERENCES public.profiles(id) ON DELETE SET NULL,
  athlete_name        TEXT    NOT NULL,
  category_slug       TEXT    NOT NULL,
  swim_time_seconds   INT,
  t1_time_seconds     INT,
  bike_time_seconds   INT,
  t2_time_seconds     INT,
  run_time_seconds    INT,
  total_time_seconds  INT,
  rank_overall        INT,
  rank_category       INT,
  rank_gender         INT,
  status              TEXT    NOT NULL DEFAULT 'finished'
                              CHECK (status IN ('finished','dnf','dns','disqualified')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_triathlon_results_bib ON public.triathlon_results (bib_number);


-- map_waypoints
CREATE TABLE IF NOT EXISTS public.map_waypoints (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline      TEXT    NOT NULL CHECK (discipline IN ('swim','bike','run','event')),
  point_type      TEXT    NOT NULL CHECK (point_type IN ('start','turn','aid_station','medical','transition','spectator','parking','finish')),
  name            TEXT    NOT NULL,
  description     TEXT,
  lat             NUMERIC(10,7) NOT NULL,
  lng             NUMERIC(10,7) NOT NULL,
  landmark        TEXT,
  order_index     INT     NOT NULL DEFAULT 0,
  is_confirmed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- race_photos
CREATE TABLE IF NOT EXISTS public.race_photos (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url       TEXT    NOT NULL,
  thumb_url       TEXT,
  discipline      TEXT    CHECK (discipline IN ('swim','bike','run','finish','awards','general')),
  checkpoint_name TEXT,
  bib_numbers     TEXT[]  DEFAULT '{}',
  photographer    TEXT,
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_race_photos_bibs ON public.race_photos USING GIN (bib_numbers);

-- community_impact
CREATE TABLE IF NOT EXISTS public.community_impact (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_title   TEXT    NOT NULL,
  beneficiary     TEXT    NOT NULL,
  impact_metric   TEXT    NOT NULL,
  metric_value    TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  image_url       TEXT,
  order_index     INT     NOT NULL DEFAULT 0
);

-- research_consents
CREATE TABLE IF NOT EXISTS public.research_consents (
  id                          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  allow_anonymized_analytics  BOOLEAN NOT NULL DEFAULT TRUE,
  allow_motivation_research   BOOLEAN NOT NULL DEFAULT TRUE,
  allow_demographic_study     BOOLEAN NOT NULL DEFAULT TRUE,
  consent_given_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

-- ==============================================================================
-- 12. USEFUL INDEXES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_registrations_user_id      ON public.registrations (user_id);
CREATE INDEX IF NOT EXISTS idx_registrations_activity_slug ON public.registrations (activity_slug);
CREATE INDEX IF NOT EXISTS idx_orders_profile_id          ON public.orders (profile_id);
CREATE INDEX IF NOT EXISTS idx_orders_status              ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_payments_order_id          ON public.payments (order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_profile_id         ON public.tickets (profile_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_user_id    ON public.community_posts (user_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_status     ON public.community_posts (status);
CREATE INDEX IF NOT EXISTS idx_post_reports_queue         ON public.post_reports (status, created_at DESC);
