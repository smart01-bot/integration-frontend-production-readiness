-- ==============================================================================
-- 008: PROPOSAL ALIGNMENT — SCHEMA REPAIRS + NEW PLATFORM FEATURES
--
-- Fixes every backend/DB mismatch found in the consistency audit against the
-- executive proposal, and adds the missing platform features:
--   1. Orders: add the participant-service and fulfilment columns the
--      participant portal and tracking flow require.
--   2. Drop the duplicate, half-featured `audit_log` table (migration 006
--      created it; all backend code uses `audit_logs` from migration 002).
--   3. Referral programme (flows B/55-61): unique per-profile codes,
--      attributed conversions, and a public leaderboard.
--   4. Incident reporting (volunteer journey 75, HQ console "incidents").
--   5. Atomic inventory RPCs: reservation must decrement availability at
--      reserve time (release adds it back) — the current read-then-write
--      loops race under concurrent checkouts and the worker release path
--      corrupts stock by adding units that were never subtracted.
--   6. profiles.referral_code for "one account ... referrals ... event
--      history" and the public leaderboard attribution key.
--
-- Apply after migrations 001-007.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ORDERS: participant service desk & fulfilment columns
-- ------------------------------------------------------------------------------
-- Customer email is denormalised for guest-checkout order lookup and the
-- participant service desk's "search by email" journey.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);

-- Fulfilment tracking for the pickup desk (merchandise journeys).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;

-- ------------------------------------------------------------------------------
-- 2. AUDIT: drop the duplicate table created in 006 (code uses audit_logs)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS public.audit_log;

-- ------------------------------------------------------------------------------
-- 3. REFERRAL PROGRAMME
-- ------------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- Backfill unique codes for existing profiles (8-char URL-safe code).
UPDATE public.profiles
SET referral_code = 'TDR' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || id::TEXT), 1, 8))
WHERE referral_code IS NULL;

ALTER TABLE profiles ALTER COLUMN referral_code SET NOT NULL;

-- Referral conversions: one row per referred friend who registers and pays.
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  referral_code TEXT NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'converted', 'rewarded')),
  reward_label TEXT,
  converted_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_profile_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_order ON referrals(order_id);

-- ------------------------------------------------------------------------------
-- 4. INCIDENT REPORTING (volunteer portal + HQ command centre)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  edition_id UUID REFERENCES event_editions(id) ON DELETE SET NULL,
  reported_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  station TEXT,
  incident_type TEXT NOT NULL DEFAULT 'other'
    CHECK (incident_type IN ('medical', 'route_hazard', 'security', 'mechanical', 'lost_participant', 'supply_shortage', 'other')),
  severity TEXT NOT NULL DEFAULT 'low'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'closed')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, severity);

-- ------------------------------------------------------------------------------
-- 5. ATOMIC INVENTORY RPCs (oversell / corruption protection)
-- ------------------------------------------------------------------------------
-- Reserve stock atomically: availability = stock - reserved. Returns the
-- new available count, or raises if there is insufficient stock. Checkout
-- calls this per merch line instead of read-then-write loops.
CREATE OR REPLACE FUNCTION public.reserve_variant_stock(p_variant_id UUID, p_qty INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_available INTEGER;
BEGIN
  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION 'Quantity must be at least 1';
  END IF;

  UPDATE public.product_variants
  SET reserved_quantity = reserved_quantity + p_qty,
      updated_at = NOW()
  WHERE id = p_variant_id
    AND (stock_quantity - reserved_quantity) >= p_qty;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: variant % has fewer than % units available', p_variant_id, p_qty;
  END IF;

  SELECT stock_quantity - reserved_quantity INTO v_available
  FROM public.product_variants WHERE id = p_variant_id;

  RETURN v_available;
END;
$$ LANGUAGE plpgsql;

-- Release stock atomically (worker expiry / manual release / order cancel).
CREATE OR REPLACE FUNCTION public.release_variant_stock(p_variant_id UUID, p_qty INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE public.product_variants
  SET reserved_quantity = GREATEST(0, reserved_quantity - p_qty),
      updated_at = NOW()
  WHERE id = p_variant_id;
END;
$$ LANGUAGE plpgsql;

-- Backwards-compat shim: the admin controller already calls this RPC name.
CREATE OR REPLACE FUNCTION public.decrement_reserved_inventory(variant_uuid UUID, decrement_by INTEGER)
RETURNS VOID AS $$
BEGIN
  PERFORM public.release_variant_stock(variant_uuid, decrement_by);
END;
$$ LANGUAGE plpgsql;

-- Keep reserved_quantity >= 0 no matter what.
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_reserved_nonnegative;
ALTER TABLE product_variants ADD CONSTRAINT product_variants_reserved_nonnegative
  CHECK (reserved_quantity >= 0);

-- ------------------------------------------------------------------------------
-- 6. COLLECTIBLES: expose finish_time_seconds under the alias the portal uses
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.digital_collectibles_view AS
SELECT *, finish_time_seconds AS finish_time
FROM public.digital_collectibles;
