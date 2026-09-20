-- ==============================================================================
-- FIX: correct activity slug mapping for migration 010
--
-- Migration 010's built-in mapping used placeholder titles ('Cyclathon',
-- 'Marathon', 'Zumba', 'Yoga', 'Walkathon', 'Community Walk') that do not
-- match the real seeded activity titles in seeds/001_seed_rotary_2026.sql.
-- As shipped, EVERY registration insert would fail with:
--   "No activities row has slug=...; fill in the slug mapping..."
-- because activities.slug was left NULL for every real row.
--
-- Run this AFTER migration 010 (safe to run any time — it's just UPDATEs).
-- ==============================================================================

UPDATE activities SET slug = 'cyclathon'  WHERE title = 'Grand Cyclathon Elite & Enthusiasts';
UPDATE activities SET slug = 'marathon'   WHERE title = 'Half Marathon Coastal Run';
UPDATE activities SET slug = 'walkathon'  WHERE title = 'Community Walkathon for Charity';
UPDATE activities SET slug = 'yoga'       WHERE title = 'Coastal Sunrise Yoga Flow';
UPDATE activities SET slug = 'zumba'      WHERE title = 'High-Energy Afrobeats Zumba Fiesta';

-- Verify every activity now has a slug — this should return 0 rows.
-- If it returns any rows, the frontend is using an activity_slug value on
-- signup that doesn't match any of the five above — check
-- src/lib/constants.ts or wherever ACTIVITY_SLUGS is defined in the
-- frontend and adjust the UPDATE statements above to match exactly.
SELECT id, title, slug FROM activities WHERE slug IS NULL;
