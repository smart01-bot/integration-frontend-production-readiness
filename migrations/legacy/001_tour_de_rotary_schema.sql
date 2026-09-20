-- ==============================================================================
-- TOUR DE ROTARY DSM 2026 - COMPLETE BACKEND DATABASE SCHEMA
-- PostgreSQL 16 / Supabase Schema Definition
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. EVENT EDITIONS (Annual Lifecycle Management)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_editions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year INTEGER NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  current_phase TEXT NOT NULL DEFAULT 'pre_event' 
    CHECK (current_phase IN ('pre_event', 'event_day', 'post_event')),
  event_date TIMESTAMPTZ NOT NULL,
  location_name TEXT NOT NULL DEFAULT 'Dar es Salaam, Tanzania',
  config_json JSONB NOT NULL DEFAULT '{
    "early_bird_active": true,
    "merch_reservation_days": 7,
    "sms_sender_id": "ROTARY-DSM",
    "payme_currency": "TZS",
    "currency_symbol": "TSh"
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 2. USER PROFILES & 5-ROLE RBAC
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID UNIQUE, -- Supabase Auth ID if using Supabase Auth
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone_number TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'participant'
    CHECK (role IN ('participant', 'volunteer', 'sponsor', 'partner', 'admin')),
  tshirt_size TEXT CHECK (tshirt_size IN ('XS', 'S', 'M', 'L', 'XL', '2XL', '3XL')),
  emergency_contact JSONB DEFAULT '{"name": "", "phone": "", "relationship": ""}'::jsonb,
  fitness_sharing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- ------------------------------------------------------------------------------
-- 3. ACTIVITIES (Events, Routes & Pricing)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Cycling', 'Running', 'Walking', 'Fitness', 'Wellness')),
  distance_km NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  route_gpx_url TEXT,
  start_time TEXT NOT NULL,
  flag_off_location TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 500,
  registered_count INTEGER NOT NULL DEFAULT 0,
  early_bird_price_tsh INTEGER NOT NULL,
  standard_price_tsh INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold_out', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_edition ON activities(edition_id);

-- ------------------------------------------------------------------------------
-- 4. MERCHANDISE & INVENTORY VARIANTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  variant_type TEXT NOT NULL, -- e.g. 'Size L', 'Size M', 'Red 750ml'
  price_tsh INTEGER NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 5. ORDERS & MIXED CART CHECKOUT
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT NOT NULL UNIQUE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  edition_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'processing', 'paid', 'cancelled', 'expired')),
  subtotal_tsh INTEGER NOT NULL DEFAULT 0,
  discount_tsh INTEGER NOT NULL DEFAULT 0,
  total_tsh INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TZS',
  billing_phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_profile ON orders(profile_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('activity_ticket', 'merchandise')),
  reference_id UUID NOT NULL, -- references activity_id or product_variant_id
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_tsh INTEGER NOT NULL,
  subtotal_tsh INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ------------------------------------------------------------------------------
-- 6. 7-DAY INVENTORY RESERVATIONS STATE MACHINE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  day4_reminded BOOLEAN NOT NULL DEFAULT FALSE,
  day6_reminded BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' 
    CHECK (status IN ('active', 'completed_paid', 'expired_released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_res_status ON inventory_reservations(status, expires_at);

-- ------------------------------------------------------------------------------
-- 7. PAYMENTS & PAYME AFRICA IDEMPOTENT LEDGER
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  payme_reference TEXT UNIQUE,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('mpesa', 'tigopesa', 'airtel', 'card', 'cash_at_gate')),
  phone_number TEXT NOT NULL,
  amount_tsh INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated' 
    CHECK (status IN ('initiated', 'processing', 'successful', 'failed', 'refunded')),
  raw_webhook_payload JSONB,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- ------------------------------------------------------------------------------
-- 8. TICKETS & GATE QR CHECK-IN ENGINE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  bib_number TEXT NOT NULL UNIQUE,
  qr_verification_token TEXT NOT NULL UNIQUE,
  checked_in BOOLEAN NOT NULL DEFAULT FALSE,
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID REFERENCES profiles(id),
  check_in_station TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_qr ON tickets(qr_verification_token);
CREATE INDEX IF NOT EXISTS idx_tickets_bib ON tickets(bib_number);
CREATE INDEX IF NOT EXISTS idx_tickets_profile ON tickets(profile_id);

-- ------------------------------------------------------------------------------
-- 9. DIGITAL COLLECTIBLES & NFT VERIFICATION
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS digital_collectibles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  edition_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  serial_number TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'Finisher' CHECK (tier IN ('Finisher', 'Podium_1st', 'Podium_2nd', 'Podium_3rd', 'Century_Club', 'VIP_Ambassador')),
  public_verification_hash TEXT NOT NULL UNIQUE,
  finish_time_seconds INTEGER,
  certificate_pdf_url TEXT,
  on_chain_network TEXT DEFAULT 'Polygon',
  on_chain_tx_hash TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collectibles_hash ON digital_collectibles(public_verification_hash);
CREATE INDEX IF NOT EXISTS idx_collectibles_profile ON digital_collectibles(profile_id);

-- ------------------------------------------------------------------------------
-- 10. COMMUNICATION QUEUE (Textify Africa SMS & Resend Email)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communication_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel TEXT NOT NULL CHECK (channel IN ('SMS', 'EMAIL')),
  provider TEXT NOT NULL CHECK (provider IN ('TextifyAfrica', 'Resend')),
  recipient TEXT NOT NULL,
  subject TEXT,
  message_body TEXT NOT NULL,
  metadata_json JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_queue_status ON communication_queue(status, scheduled_for);

-- ------------------------------------------------------------------------------
-- 11. SPONSORS, PARTNERS & VOLUNTEER DELIVERABLES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS volunteer_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  edition_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE CASCADE,
  station_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  shift_start TIMESTAMPTZ NOT NULL,
  shift_end TIMESTAMPTZ NOT NULL,
  briefing_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_clearances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE CASCADE,
  partner_name TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('Ambulance_Medical', 'Police_Escort', 'Traffic_Management', 'Waste_Management', 'Hydration_Supply')),
  units_deployed INTEGER NOT NULL DEFAULT 1,
  contact_person TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  route_safety_cleared BOOLEAN NOT NULL DEFAULT FALSE,
  cleared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sponsor_deliverables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE CASCADE,
  sponsor_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('Title', 'Platinum', 'Gold', 'Silver', 'Hydration_Partner')),
  contribution_amount_tsh INTEGER NOT NULL DEFAULT 0,
  logo_vector_url TEXT,
  vip_passes_allotted INTEGER NOT NULL DEFAULT 0,
  vip_passes_claimed INTEGER NOT NULL DEFAULT 0,
  banner_placement_cleared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- DATABASE TRIGGER: Automatic registered_count increment on ticket creation
-- ==============================================================================
CREATE OR REPLACE FUNCTION increment_activity_registration()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE activities
  SET registered_count = registered_count + 1
  WHERE id = NEW.activity_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_registered_count ON tickets;
CREATE TRIGGER trg_ticket_registered_count
  AFTER INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION increment_activity_registration();
