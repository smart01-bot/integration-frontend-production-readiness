-- ==============================================================================
-- 007: LINK SUPABASE AUTH SIGNUPS TO PROFILES
--
-- Neither app currently creates a profiles row on signup:
--  - The backend's guest checkout (cartController) creates one, matched by
--    email, with a random id and no auth_user_id.
--  - The frontend's UserContext.tsx only READS profiles by id = auth user
--    id — it never creates a row. A user who signs up without ever
--    checking out first has no profile at all, and login silently
--    resolves to "no role".
--
-- This trigger handles the common case (sign up first, the normal flow)
-- by creating a profiles row with id = auth.users.id directly, satisfying
-- the frontend's lookup convention with zero frontend changes required. It
-- also sets auth_user_id to the same value, satisfying the backend's
-- middleware/auth.js convention.
--
-- Edge case: if someone already has a guest-checkout profile (created by
-- email, before ever signing up) and THEN signs up with the same email,
-- their existing profile keeps its original random id — profiles.id is a
-- primary key referenced by orders/tickets/etc, so it must never be
-- rewritten. In that case, only auth_user_id gets linked; the frontend's
-- id-based lookup will not find that row. The recommended fix for that
-- edge case is updating UserContext.tsx to also try auth_user_id (see
-- docs handed over separately) — this trigger alone covers the majority,
-- more common case where someone signs up before checking out.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Case 1: a guest-checkout profile already exists for this email — link it.
  UPDATE public.profiles
  SET auth_user_id = NEW.id
  WHERE email = NEW.email
    AND auth_user_id IS NULL;

  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- Case 2: brand-new signup, no existing profile — create one where
  -- id = auth.users.id, so both lookup conventions resolve correctly.
  INSERT INTO public.profiles (id, auth_user_id, full_name, email, phone_number, role)
  VALUES (
    NEW.id,
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'phone_number', ''),
    'participant'
  )
  ON CONFLICT (email) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id
  WHERE public.profiles.auth_user_id IS NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
