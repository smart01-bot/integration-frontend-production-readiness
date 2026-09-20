-- ==============================================================================
-- 004: SITE CONTENT (CMS) — supports Schedule A6 "Content and campaign
-- management" / "scheduled content", and A1 phase-aware public content.
-- Simple key-value content store: each row is one editable content block
-- (hero copy, about section, countdown target, etc.), addressed by a
-- unique content_key.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS site_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_key TEXT NOT NULL UNIQUE,
  section TEXT NOT NULL DEFAULT 'general', -- e.g. 'home', 'about', 'sponsors'
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  visible_from TIMESTAMPTZ, -- optional scheduled publish time
  visible_until TIMESTAMPTZ,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_content_section ON site_content(section);
