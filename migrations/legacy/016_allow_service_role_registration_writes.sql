-- ==============================================================================
-- 016: ALLOW SERVICE ROLE TO WRITE PROTECTED REGISTRATION COLUMNS
--
-- protect_registration_columns (migration 009) exists to stop a *participant*
-- forging their own payment_status/amount_tsh/bib_number via the anon client.
-- It keys off public.is_staff(), which resolves to a signed-in admin/hq_admin
-- profile via auth.uid(). The backend talks to Supabase with the service role
-- key (no user JWT), so auth.uid() is NULL, is_staff() is false, and every
-- backend attempt to write the payment outcome to a registration is rejected:
--
--   "Only staff may change fields other than status"
--
-- That blocks the registration payment flow end to end: the PayMe webhook
-- (controllers/paymentController.js handlePayMeWebhook) must be able to flip
-- the originating registration to payment_status=completed, and initiatePayment
-- records the charged amount (amount_tsh). RLS is untouched — the service role
-- already bypasses RLS per the README's security model; this merely lets those
-- trusted writes through the column-level safeguard. Unauthenticated anon
-- calls still get is_staff()=false and no registrations UPDATE policy matches,
-- so nothing is opened to the public.
--
-- Idempotent: safe to re-run.
--
-- Apply in the Supabase dashboard → SQL editor, or via `psql`:
--   psql "$DATABASE_URL" -f migrations/016_allow_service_role_registration_writes.sql
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.protect_registration_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_staff() OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.activity_slug IS DISTINCT FROM OLD.activity_slug
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.amount_tsh IS DISTINCT FROM OLD.amount_tsh
     OR NEW.bib_number IS DISTINCT FROM OLD.bib_number
  THEN
    RAISE EXCEPTION 'Only staff may change fields other than status';
  END IF;
  RETURN NEW;
END;
$$;