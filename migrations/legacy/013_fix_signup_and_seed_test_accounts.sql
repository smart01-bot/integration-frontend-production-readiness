-- ==============================================================================
-- 013: FIX SIGNUP TRIGGER + SEED TEST ACCOUNTS
--
-- Two things in one migration:
--
-- A. FIX: handle_new_auth_user never set referral_code.
--    profiles.referral_code is NOT NULL UNIQUE (added in 008). The trigger
--    from 007 was never updated to generate one, so every signup attempt
--    since 008 has failed with Supabase''s generic "Database error saving
--    new user" — the INSERT into profiles was rolling back because
--    referral_code was NULL in a NOT NULL column.
--
-- B. SEED: one pre-confirmed test account per role so you can login
--    immediately without needing to click email confirmation links.
--    All accounts use password: user1234
--    Emails: participant@gmail.com, volunteer@gmail.com, sponsor@gmail.com,
--            partner@gmail.com, admin@gmail.com, hqadmin@gmail.com
--
-- Apply after 001-012.
-- ==============================================================================

-- ── A. FIX: rebuild handle_new_auth_user with referral_code generation ────────
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_referral_code TEXT;
BEGIN
  -- Generate a unique referral code: TDR + 8 uppercase hex chars.
  -- Derived from the new user UUID so it is deterministic and unique.
  v_referral_code := 'TDR' || UPPER(SUBSTRING(MD5(NEW.id::TEXT), 1, 8));

  -- Case 1: a guest-checkout profile already exists for this email — link it.
  UPDATE public.profiles
  SET
    auth_user_id  = NEW.id,
    referral_code = COALESCE(referral_code, v_referral_code)
  WHERE email = NEW.email
    AND auth_user_id IS NULL;

  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- Case 2: brand-new signup — create a profiles row where id = auth.users.id
  -- so both lookup conventions (by id and by auth_user_id) resolve correctly.
  INSERT INTO public.profiles (
    id,
    auth_user_id,
    full_name,
    email,
    phone_number,
    role,
    referral_code
  )
  VALUES (
    NEW.id,
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'phone_number', NULL),
    COALESCE(NEW.raw_user_meta_data->>'role', 'participant'),
    v_referral_code
  )
  ON CONFLICT (email) DO UPDATE
    SET auth_user_id  = EXCLUDED.auth_user_id,
        referral_code = COALESCE(public.profiles.referral_code, EXCLUDED.referral_code)
  WHERE public.profiles.auth_user_id IS NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();


-- ── B. SEED TEST ACCOUNTS ─────────────────────────────────────────────────────
-- One confirmed auth.users row + matching profiles row per role.
-- Password for every account: user1234
--
-- The encrypted_password value below is the bcrypt hash for "user1234".
-- Generate a fresh one if needed:
--   SELECT crypt('user1234', gen_salt('bf', 10));
--
-- Accounts:
--   participant  → participant@gmail.com  / user1234
--   volunteer    → volunteer@gmail.com   / user1234
--   sponsor      → sponsor@gmail.com     / user1234
--   partner      → partner@gmail.com     / user1234
--   admin        → admin@gmail.com       / user1234
--   hq_admin     → hqadmin@gmail.com     / user1234

DO $$
DECLARE
  v_password_hash TEXT;
  v_participant_id  UUID := 'a0000001-0000-0000-0000-000000000001';
  v_volunteer_id    UUID := 'a0000002-0000-0000-0000-000000000002';
  v_sponsor_id      UUID := 'a0000003-0000-0000-0000-000000000003';
  v_partner_id      UUID := 'a0000004-0000-0000-0000-000000000004';
  v_admin_id        UUID := 'a0000005-0000-0000-0000-000000000005';
  v_hqadmin_id      UUID := 'a0000006-0000-0000-0000-000000000006';
BEGIN

  -- Generate bcrypt hash for "user1234" at runtime using pgcrypto.
  -- This avoids embedding a hardcoded hash that might not match your
  -- Supabase instance's auth settings.
  v_password_hash := crypt('user1234', gen_salt('bf', 10));

  -- Insert into auth.users — email_confirmed_at is set so no email click needed.
  -- ON CONFLICT (id) DO NOTHING makes re-runs safe.
  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data,
    is_super_admin, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES
  (
    v_participant_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'participant@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test Participant","role":"participant"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_volunteer_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'volunteer@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test Volunteer","role":"volunteer"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_sponsor_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'sponsor@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test Sponsor","role":"sponsor"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_partner_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'partner@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test Partner","role":"partner"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_admin_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'admin@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test Admin","role":"admin"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  ),
  (
    v_hqadmin_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'hqadmin@gmail.com', v_password_hash,
    NOW(), NOW(), NOW(),
    '{"full_name":"Test HQ Admin","role":"hq_admin"}'::jsonb,
    '{"provider":"email","providers":["email"]}'::jsonb,
    FALSE, '', '', '', ''
  )
  ON CONFLICT (id) DO NOTHING;

  -- The trigger fires on each INSERT above and creates profiles rows
  -- with role='participant'. Correct non-participant roles now.
  -- Use UPDATE ... WHERE to avoid errors if re-running (profiles already exist).
  UPDATE public.profiles SET role = 'volunteer' WHERE id = v_volunteer_id;
  UPDATE public.profiles SET role = 'sponsor'   WHERE id = v_sponsor_id;
  UPDATE public.profiles SET role = 'partner'   WHERE id = v_partner_id;
  UPDATE public.profiles SET role = 'admin'     WHERE id = v_admin_id;
  UPDATE public.profiles SET role = 'hq_admin'  WHERE id = v_hqadmin_id;

  RAISE NOTICE 'Test accounts seeded. Login with password: user1234';

END $$;


-- ── C. VERIFY — should return 6 rows, all with referral_code and confirmed ────
SELECT
  p.email,
  p.role,
  p.referral_code,
  p.auth_user_id IS NOT NULL     AS has_auth_link,
  u.email_confirmed_at IS NOT NULL AS email_confirmed
FROM public.profiles p
JOIN auth.users u ON u.id = p.auth_user_id
WHERE p.email IN (
  'participant@gmail.com', 'volunteer@gmail.com', 'sponsor@gmail.com',
  'partner@gmail.com', 'admin@gmail.com', 'hqadmin@gmail.com'
)
ORDER BY p.role;


-- ── D. BACKFILL any existing profiles still missing referral_code ─────────────
-- Catches accounts created between migration 008 and this fix via paths
-- that bypassed the trigger (e.g. direct service-role INSERT).
UPDATE public.profiles
SET referral_code = 'TDR' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || id::TEXT), 1, 8))
WHERE referral_code IS NULL;

-- Should return 0 rows — any remaining NULLs need manual investigation.
SELECT id, email FROM public.profiles WHERE referral_code IS NULL;
