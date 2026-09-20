-- ==============================================================================
-- 005: LINK SPONSOR / PARTNER RECORDS TO LOGIN PROFILES
-- sponsor_deliverables and partner_clearances previously had no foreign key
-- back to `profiles`, so there was no reliable way to resolve "this logged
-- -in sponsor/partner user" to "their deliverable/clearance record" other
-- than fragile name-matching. Add explicit profile_id columns.
-- ==============================================================================
ALTER TABLE sponsor_deliverables
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sponsor_deliverables_profile ON sponsor_deliverables(profile_id);

ALTER TABLE partner_clearances
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partner_clearances_profile ON partner_clearances(profile_id);
