import { supabase } from '../config/supabase.js';

/**
 * Public Content Controller (proposal §03 phase-aware behaviour, journey
 * N/99) — read-only site content for the frontend homepage/landing pages.
 *
 * Phase-aware: returns the latest edition's current_phase alongside the
 * blocks, and filters out content whose visibility window has not opened
 * or has expired (site_content.visible_from / visible_until). Scheduled
 * campaigns and post-event content go live and expire automatically with
 * zero code changes; admins manage blocks via /api/v1/admin/content.
 * Phase-specific blocks use the section convention "home:pre_event",
 * "home:event_day", "home:post_event" (exact section match still works).
 */
export const getPublicContent = async (req, res) => {
  try {
    const { section } = req.query;
    const now = new Date().toISOString();

    // Latest edition drives the phase answer.
    const { data: edition } = await supabase
      .from('event_editions')
      .select('title, year, current_phase, event_date, location_name, config_json')
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle();

    let query = supabase.from('site_content').select('*');

    if (section) {
      // Exact section, or its phase-specific variants (section:phase).
      query = query.or(`section.eq.${section},section.eq.${section}:${edition?.current_phase || 'pre_event'}`);
    }

    const { data: blocks, error } = await query.order('content_key', { ascending: true });

    if (error) {
      console.error('getPublicContent query failed:', error.message);
      return res.status(503).json({ error: 'Unable to load site content right now.' });
    }

    // Visibility window filtering — expired or not-yet-live blocks are
    // hidden from the public site entirely.
    const visible = (blocks || []).filter(b => {
      if (b.visible_from && new Date(b.visible_from) > new Date(now)) return false;
      if (b.visible_until && new Date(b.visible_until) < new Date(now)) return false;
      return true;
    });

    // Event-day countdown target for the homepage (journey A/1).
    const countdown = edition?.event_date
      ? { target: edition.event_date, phase: edition.current_phase }
      : null;

    return res.status(200).json({
      status: 'success',
      edition: edition?.title || null,
      edition_year: edition?.year || null,
      event_date: edition?.event_date || null,
      location: edition?.location_name || null,
      current_phase: edition?.current_phase || 'pre_event',
      countdown,
      count: visible.length,
      data: visible
    });
  } catch (error) {
    console.error('getPublicContent exception:', error);
    return res.status(500).json({ error: 'Failed to load site content' });
  }
};
