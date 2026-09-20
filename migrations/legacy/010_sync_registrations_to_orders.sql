-- ==============================================================================
-- 010: SYNC REGISTRATIONS → ORDERS/TICKETS
--
-- Context: the frontend writes participant registrations directly into
-- `registrations` (migration 006), bypassing this backend's real order/
-- payment/ticket pipeline (`orders` → `payments` → `tickets`) entirely.
-- That pipeline has the actual security work from this project — webhook
-- signature verification, amount validation, QR/bib ticket issuance — and
-- currently has zero live data flowing through it, because nothing creates
-- an order when someone registers through the frontend.
--
-- This migration makes every registrations row automatically produce a
-- matching orders/order_items row (on INSERT), and issues a real ticket —
-- reusing the bib_number registrations already assigns, generating a QR
-- token — the moment a registration's payment_status becomes 'completed'.
-- Gate check-in (registrations.status -> 'checked_in') also marks the real
-- ticket checked in, so ticketController.js's existing QR-based check-in
-- flow has real data to work against.
--
-- Apply after 001-009.
-- ==============================================================================

-- ── 1. Link activities to the frontend's fixed slug set ─────────────────────
ALTER TABLE activities ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- ------------------------------------------------------------------------------
-- FILL THIS IN YOURSELF before running the rest of this file: match each
-- slug to the real activities.title in your database. Run
--   SELECT id, title, category FROM activities;
-- first, then edit the six lines below to match your actual titles exactly
-- (case-sensitive). Any slug left unmatched will make registrations for
-- that activity fail at the trigger step below, loudly (not silently).
-- ------------------------------------------------------------------------------
UPDATE activities SET slug = 'cyclathon'      WHERE title = 'Cyclathon';
UPDATE activities SET slug = 'marathon'       WHERE title = 'Marathon';
UPDATE activities SET slug = 'walkathon'      WHERE title = 'Walkathon';
UPDATE activities SET slug = 'zumba'          WHERE title = 'Zumba';
UPDATE activities SET slug = 'yoga'           WHERE title = 'Yoga';
UPDATE activities SET slug = 'community_walk' WHERE title = 'Community Walk';

-- ── 2. Traceability: which order/ticket did this registration produce? ─────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_registration_id UUID REFERENCES registrations(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source_registration_id UUID REFERENCES registrations(id) ON DELETE SET NULL;

-- ── 3. AFTER INSERT: registration → order + order_item ──────────────────────
CREATE OR REPLACE FUNCTION public.registration_to_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activity      activities%ROWTYPE;
  v_edition_id    UUID;
  v_phone         TEXT;
  v_order_number  TEXT;
  v_order_id      UUID;
BEGIN
  SELECT * INTO v_activity FROM activities WHERE slug = NEW.activity_slug LIMIT 1;
  IF v_activity.id IS NULL THEN
    RAISE EXCEPTION 'No activities row has slug=%; fill in the slug mapping at the top of migration 010 before registrations can sync', NEW.activity_slug;
  END IF;

  SELECT id INTO v_edition_id FROM event_editions ORDER BY year DESC LIMIT 1;
  SELECT phone_number INTO v_phone FROM profiles WHERE id = NEW.user_id;

  v_order_number := 'TDR-2026-' || LPAD((10000 + floor(random() * 90000))::TEXT, 5, '0');

  INSERT INTO orders (
    order_number, profile_id, user_id, edition_id, status,
    subtotal_tsh, discount_tsh, total_tsh, currency, billing_phone,
    source_registration_id
  ) VALUES (
    v_order_number, NEW.user_id, NEW.user_id, v_edition_id,
    CASE NEW.status WHEN 'paid' THEN 'paid' WHEN 'cancelled' THEN 'cancelled' ELSE 'pending' END,
    COALESCE(NEW.amount_tsh, 0), 0, COALESCE(NEW.amount_tsh, 0), 'TZS',
    COALESCE(v_phone, 'unknown'), NEW.id
  )
  RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, item_type, reference_id, description, quantity, unit_price_tsh, subtotal_tsh)
  VALUES (v_order_id, 'activity_ticket', v_activity.id, v_activity.title, 1,
          COALESCE(NEW.amount_tsh, 0), COALESCE(NEW.amount_tsh, 0));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registration_to_order ON registrations;
CREATE TRIGGER trg_registration_to_order
  AFTER INSERT ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.registration_to_order();

-- ── 4. AFTER UPDATE: payment completes → real ticket issued ─────────────────
CREATE OR REPLACE FUNCTION public.registration_status_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id   UUID;
  v_activity_id UUID;
  v_bib        TEXT;
BEGIN
  SELECT id INTO v_order_id FROM orders WHERE source_registration_id = NEW.id LIMIT 1;
  IF v_order_id IS NULL THEN
    RETURN NEW; -- no mirrored order (shouldn't happen post-migration, but don't crash existing rows)
  END IF;

  UPDATE orders SET
    status = CASE NEW.status WHEN 'paid' THEN 'paid' WHEN 'cancelled' THEN 'cancelled' ELSE status END,
    updated_at = NOW()
  WHERE id = v_order_id;

  -- Issue a real ticket the moment payment completes, if one doesn't exist yet.
  IF NEW.payment_status = 'completed' AND OLD.payment_status IS DISTINCT FROM 'completed' THEN
    SELECT reference_id INTO v_activity_id FROM order_items WHERE order_id = v_order_id AND item_type = 'activity_ticket' LIMIT 1;

    v_bib := COALESCE(NEW.bib_number, 'TDR-' || UPPER(SUBSTRING(MD5(NEW.id::TEXT), 1, 6)));
    IF NEW.bib_number IS NULL THEN
      UPDATE registrations SET bib_number = v_bib WHERE id = NEW.id;
    END IF;

    INSERT INTO tickets (order_id, profile_id, activity_id, bib_number, qr_verification_token, source_registration_id)
    SELECT v_order_id, NEW.user_id, v_activity_id, v_bib,
           UPPER(MD5(RANDOM()::TEXT || NEW.id::TEXT || clock_timestamp()::TEXT)), NEW.id
    WHERE NOT EXISTS (SELECT 1 FROM tickets WHERE source_registration_id = NEW.id);
  END IF;

  -- Gate check-in: mirror onto the real ticket too.
  IF NEW.status = 'checked_in' AND OLD.status IS DISTINCT FROM 'checked_in' THEN
    UPDATE tickets SET checked_in = TRUE, checked_in_at = NOW()
    WHERE source_registration_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registration_status_sync ON registrations;
CREATE TRIGGER trg_registration_status_sync
  AFTER UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.registration_status_sync();

-- ── 5. RLS for the two new columns is inherited automatically — no policy
-- changes needed, source_registration_id is just a plain column on tables
-- migration 009 already secured.
