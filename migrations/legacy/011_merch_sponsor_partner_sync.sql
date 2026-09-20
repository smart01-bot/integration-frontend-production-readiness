-- ==============================================================================
-- 011: MERCH + SPONSOR + PARTNER — SEED DATA & FORWARD SYNC
--
-- Unlike registrations/orders (010), there was no live data in products,
-- product_variants, sponsors, sponsor_deliverables, partners, or
-- partner_clearances to reconcile — every count was 0. That means the
-- relationship between each pair can be defined fresh instead of guessed
-- at, rather than risking silent data loss merging real rows.
--
-- Decision made here, stated explicitly: product_variants /
-- sponsor_deliverables / partner_clearances (the original backend tables)
-- stay authoritative — they're what the reservation worker, HQ deliverable
-- tracking, and safety-clearance tracking actually operate on. The
-- frontend's tables (products / sponsors / partners) are kept in sync
-- automatically by trigger, in both directions where it matters (stock).
--
-- If real merch/sponsor/partner data already exists by the time this runs,
-- STOP — re-check counts first, this migration assumes empty tables.
-- Apply after 001-010.
-- ==============================================================================

-- ── Linking columns for traceability (same pattern as source_registration_id) ─
ALTER TABLE product_variants     ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE sponsor_deliverables ADD COLUMN IF NOT EXISTS sponsor_id UUID REFERENCES sponsors(id) ON DELETE SET NULL;
ALTER TABLE partner_clearances   ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id) ON DELETE SET NULL;

-- ══════════════════════════════════════════════════════════════════════════
-- MERCH — triggers defined FIRST, seed data LAST, so seeding actually fires
-- them (an earlier draft of this file had this backwards; fixed before you
-- ever ran it).
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Fan out each product into product_variants (one row per size) ────────
-- product_variants.stock_quantity is what the reservation worker actually
-- decrements/increments — seeding a real starting stock here, not 0.
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
  SELECT id INTO v_edition_id FROM event_editions ORDER BY year DESC LIMIT 1;
  IF v_edition_id IS NULL THEN
    RAISE EXCEPTION 'No event_editions row exists yet — seed one before adding products';
  END IF;

  v_sizes := NEW.sizes;
  IF v_sizes IS NULL OR array_length(v_sizes, 1) IS NULL THEN
    v_sizes := ARRAY['One Size'];
  END IF;

  FOREACH v_size IN ARRAY v_sizes
  LOOP
    INSERT INTO product_variants (edition_id, product_name, variant_type, price_tsh, stock_quantity, product_id)
    VALUES (v_edition_id, NEW.name, v_size, NEW.price_public, 50, NEW.id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_to_variants ON products;
CREATE TRIGGER trg_product_to_variants
  AFTER INSERT ON products
  FOR EACH ROW EXECUTE FUNCTION public.product_to_variants();

-- ── 2. Keep products.stock as a live mirror of the SUM of its variants ──────
-- Reverse direction: product_variants is authoritative (the reservation
-- worker writes here), products.stock just reflects the total for the
-- frontend's simpler display.
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
    UPDATE products SET stock = (
      SELECT COALESCE(SUM(GREATEST(stock_quantity - reserved_quantity, 0)), 0)
      FROM product_variants WHERE product_id = v_product_id
    ), updated_at = NOW()
    WHERE id = v_product_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_stock ON product_variants;
CREATE TRIGGER trg_sync_product_stock
  AFTER INSERT OR UPDATE OF stock_quantity, reserved_quantity OR DELETE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_stock();

-- ── 3. NOW seed three products — both triggers above already exist, so this
-- single INSERT fans out into product_variants AND back-fills products.stock
-- automatically. Edit names/prices/sizes freely, this is a starting point.
INSERT INTO products (name, slug, description, category, price_participant, price_public, stock, sizes, image_url)
VALUES
  ('Official Event T-Shirt', 'event-tshirt', 'Tour de Rotary DSM 2026 official ride shirt', 'apparel', 15000, 20000, 0, ARRAY['S','M','L','XL'], NULL),
  ('Cycling Cap', 'cycling-cap', 'Branded cycling cap', 'apparel', 8000, 10000, 0, ARRAY['One Size'], NULL),
  ('Water Bottle', 'water-bottle', '750ml branded water bottle', 'accessories', 6000, 8000, 0, ARRAY['One Size'], NULL)
ON CONFLICT (slug) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════
-- SPONSORS
-- ══════════════════════════════════════════════════════════════════════════

-- Tier vocabularies differ by casing/values between the two tables —
-- sponsors uses lowercase (platinum/gold/silver/bronze), sponsor_deliverables
-- uses title case plus an extra tier (Title/Platinum/Gold/Silver/
-- Hydration_Partner) that has no equivalent on the frontend side. Mapped
-- one-directionally below; a sponsor created as 'bronze' has no
-- sponsor_deliverables equivalent tier, so it maps to 'Silver' as the
-- closest fit — reset manually in the HQ console if that's wrong for a
-- given sponsor.
CREATE OR REPLACE FUNCTION public.sponsor_tier_to_deliverable_tier(t TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE t
    WHEN 'platinum' THEN 'Platinum'
    WHEN 'gold'      THEN 'Gold'
    WHEN 'silver'    THEN 'Silver'
    WHEN 'bronze'    THEN 'Silver'
    ELSE 'Silver'
  END;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_to_deliverable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_edition_id UUID;
BEGIN
  SELECT id INTO v_edition_id FROM event_editions ORDER BY year DESC LIMIT 1;

  INSERT INTO sponsor_deliverables (edition_id, sponsor_name, tier, contribution_amount_tsh, logo_vector_url, sponsor_id)
  VALUES (v_edition_id, NEW.name, public.sponsor_tier_to_deliverable_tier(NEW.tier), NEW.amount_tsh, NEW.logo_url, NEW.id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sponsor_to_deliverable ON sponsors;
CREATE TRIGGER trg_sponsor_to_deliverable
  AFTER INSERT ON sponsors
  FOR EACH ROW EXECUTE FUNCTION public.sponsor_to_deliverable();

-- No sponsors seeded here — unlike merch, a fake sponsor name/logo isn't
-- useful test data the way placeholder products are. Create real sponsor
-- rows through the frontend's sponsor sign-up/HQ invite flow when ready;
-- the trigger above will fire correctly whenever that happens.

-- ══════════════════════════════════════════════════════════════════════════
-- PARTNERS
-- ══════════════════════════════════════════════════════════════════════════

-- partners.category (medical/media/logistics/venue/catering/technology/
-- other) has no clean equivalent to partner_clearances.service_type
-- (Ambulance_Medical/Police_Escort/Traffic_Management/Waste_Management/
-- Hydration_Supply) — these describe genuinely different things (what kind
-- of partner vs what service they clear for event day). Mapped where there's
-- an obvious fit; 'other' categories need a manual service_type set in HQ,
-- since there's no reasonable default to guess.
CREATE OR REPLACE FUNCTION public.partner_category_to_service_type(c TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE c
    WHEN 'medical'    THEN 'Ambulance_Medical'
    WHEN 'logistics'  THEN 'Traffic_Management'
    WHEN 'catering'   THEN 'Hydration_Supply'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.partner_to_clearance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_edition_id UUID;
  v_service    TEXT;
BEGIN
  v_service := public.partner_category_to_service_type(NEW.category);
  IF v_service IS NULL THEN
    RETURN NEW; -- no safe mapping (media/venue/technology/other) — HQ must add the clearance record manually
  END IF;

  SELECT id INTO v_edition_id FROM event_editions ORDER BY year DESC LIMIT 1;

  INSERT INTO partner_clearances (edition_id, partner_name, service_type, contact_person, contact_phone, partner_id)
  VALUES (v_edition_id, NEW.name, v_service, COALESCE(NEW.contact_name, 'TBD'), 'TBD', NEW.id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_to_clearance ON partners;
CREATE TRIGGER trg_partner_to_clearance
  AFTER INSERT ON partners
  FOR EACH ROW EXECUTE FUNCTION public.partner_to_clearance();

-- No partners seeded either, same reasoning as sponsors above.
