import supabase from '../config/supabase.js';

/**
 * §18 DATA / RESEARCH LAYER — consent API (audit gap 11).
 *
 * Migration 017 ships the `research_consents` table (RLS-enabled, one row per
 * user) but nothing could read or write it. This controller exposes the
 * minimal, explicit consent surface the brief demands:
 *
 *   GET   /api/v1/consent          → my current consent record (or defaults)
 *   PUT   /api/v1/consent          → grant / update consent flags
 *   DELETE /api/v1/consent         → withdraw consent entirely (row deleted)
 *
 * Design notes (brief §18):
 * - Consent is per-user, versionable in time: every write stamps
 *   consent_given_at. Withdrawal DELETES the row so no stale record lingers.
 * - The three flags are independent; a user may allow anonymized analytics
 *   while refusing motivation research.
 * - Admin can read aggregated consent totals only — never an individual's
 *   choices — via GET /api/v1/consent/summary.
 */

const FLAG_COLUMNS = [
  'allow_anonymized_analytics',
  'allow_motivation_research',
  'allow_demographic_study'
];

export const getMyConsent = async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });

    const { data, error } = await supabase
      .from('research_consents')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();
    if (error) throw error;

    // No row yet = no explicit consent on file. Report the schema defaults as
    // "not set" rather than silently implying the user consented.
    if (!data) {
      return res.json({
        success: true,
        data: {
          user_id,
          allow_anonymized_analytics: null,
          allow_motivation_research: null,
          allow_demographic_study: null,
          consent_given_at: null,
          status: 'not_set'
        }
      });
    }

    res.json({ success: true, data: { ...data, status: 'active' } });
  } catch (err) {
    console.error('Error fetching consent:', err);
    res.status(500).json({ error: 'Failed to retrieve consent preferences' });
  }
};

export const updateMyConsent = async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });

    const body = req.body || {};
    const updates = {};
    for (const flag of FLAG_COLUMNS) {
      if (flag in body) updates[flag] = Boolean(body[flag]);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'Provide at least one consent flag: ' + FLAG_COLUMNS.join(', ')
      });
    }
    updates.consent_given_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('research_consents')
      .upsert({ user_id, ...updates }, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, data: { ...data, status: 'active' } });
  } catch (err) {
    console.error('Error updating consent:', err);
    res.status(500).json({ error: 'Failed to save consent preferences' });
  }
};

export const withdrawMyConsent = async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });

    const { error } = await supabase
      .from('research_consents')
      .delete()
      .eq('user_id', user_id);
    if (error) throw error;

    res.json({ success: true, message: 'Consent withdrawn. No research record remains.' });
  } catch (err) {
    console.error('Error withdrawing consent:', err);
    res.status(500).json({ error: 'Failed to withdraw consent' });
  }
};

export const getConsentSummary = async (req, res) => {
  try {
    // Aggregated counts only — per brief §18, research tooling never sees
    // who consented to what.
    const [analytics, motivation, demographic, total] = await Promise.all([
      supabase.from('research_consents').select('id', { count: 'exact', head: true }).eq('allow_anonymized_analytics', true),
      supabase.from('research_consents').select('id', { count: 'exact', head: true }).eq('allow_motivation_research', true),
      supabase.from('research_consents').select('id', { count: 'exact', head: true }).eq('allow_demographic_study', true),
      supabase.from('profiles').select('id', { count: 'exact', head: true })
    ]);

    res.json({
      success: true,
      data: {
        total_profiles: total.count || 0,
        allow_anonymized_analytics: analytics.count || 0,
        allow_motivation_research: motivation.count || 0,
        allow_demographic_study: demographic.count || 0
      }
    });
  } catch (err) {
    console.error('Error summarizing consent:', err);
    res.status(500).json({ error: 'Failed to summarize consent' });
  }
};
