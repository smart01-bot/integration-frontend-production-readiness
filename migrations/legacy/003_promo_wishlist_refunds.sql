-- ==============================================================================
-- TOUR DE ROTARY DSM 2026 - MIGRATION 003: PROMO CODES, WISHLIST & REFUNDS
-- Production Schemas for Schedule A Commercial & Self-Service Operations
-- ==============================================================================

-- 1. PROMO CODES & DISCOUNTS
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  max_uses INTEGER NOT NULL DEFAULT 100,
  used_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);

-- 2. PARTICIPANT WISHLIST (Self-Service Apparel & Memorabilia)
CREATE TABLE IF NOT EXISTS participant_wishlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_profile_variant UNIQUE (profile_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_profile ON participant_wishlist(profile_id);

-- 3. REFUND REQUESTS & DISPUTE AUDIT TRAIL
CREATE TABLE IF NOT EXISTS refund_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL,
  amount_tsh INTEGER NOT NULL CHECK (amount_tsh > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processed')),
  notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_status ON refund_requests(status);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refund_requests(order_number);
