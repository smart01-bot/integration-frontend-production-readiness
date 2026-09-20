import supabase from '../config/supabase.js';

/**
 * §18 Research & Consent Layer Controller
 *
 * Transparent, consent-driven research on motivations, engagement & participation.
 * Strictly differentiates between operational data and research data.
 * Aggregated analytics only process data from users who explicitly opted in.
 */

/**
 * GET /api/v1/research/consent
 * Returns current user's consent settings.
 */
export const getMyConsent = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    let { data, error } = await supabase
      .from('research_consents')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    // Default state if user has not explicitly configured preferences yet
    if (!data) {
      data = {
        user_id: userId,
        allow_anonymized_analytics: true,
        allow_motivation_research: true,
        allow_demographic_study: true,
        consent_given_at: new Date().toISOString()
      };
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error fetching research consent:', err);
    res.status(500).json({ error: 'Failed to retrieve research consent' });
  }
};

/**
 * PUT /api/v1/research/consent
 * Updates current user's consent settings.
 */
export const updateMyConsent = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const {
      allow_anonymized_analytics = true,
      allow_motivation_research = true,
      allow_demographic_study = true
    } = req.body;

    const { data, error } = await supabase
      .from('research_consents')
      .upsert({
        user_id: userId,
        allow_anonymized_analytics: Boolean(allow_anonymized_analytics),
        allow_motivation_research: Boolean(allow_motivation_research),
        allow_demographic_study: Boolean(allow_demographic_study),
        consent_given_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Research consent preferences updated successfully',
      data
    });
  } catch (err) {
    console.error('Error updating research consent:', err);
    res.status(500).json({ error: 'Failed to update research consent' });
  }
};

/**
 * GET /api/v1/research/summary
 * Anonymized research summary & analytics for M&E and academic research (§18).
 * Strictly aggregates data only from participants who have granted consent.
 * Requires admin / research access.
 */
export const getAnonymizedResearchSummary = async (req, res) => {
  try {
    // 1. Fetch all consents
    const { data: consents, error: consentErr } = await supabase
      .from('research_consents')
      .select('user_id, allow_anonymized_analytics, allow_motivation_research, allow_demographic_study');

    if (consentErr) throw consentErr;

    const consentList = consents || [];
    const analyticsOptInIds = consentList.filter(c => c.allow_anonymized_analytics).map(c => c.user_id);
    const motivationOptInIds = consentList.filter(c => c.allow_motivation_research).map(c => c.user_id);
    const demographicOptInIds = consentList.filter(c => c.allow_demographic_study).map(c => c.user_id);

    // 2. Aggregate Demographics (ONLY from users with allow_demographic_study = true)
    let demographicStats = {
      consented_sample_size: demographicOptInIds.length,
      gender_distribution: {},
      city_distribution: {}
    };

    if (demographicOptInIds.length > 0) {
      const { data: demographicData } = await supabase
        .from('profiles')
        .select('gender, city')
        .in('id', demographicOptInIds);

      (demographicData || []).forEach(p => {
        const g = p.gender || 'unspecified';
        demographicStats.gender_distribution[g] = (demographicStats.gender_distribution[g] || 0) + 1;
        const c = p.city || 'unspecified';
        demographicStats.city_distribution[c] = (demographicStats.city_distribution[c] || 0) + 1;
      });
    }

    // 3. Aggregate Motivations (ONLY from users with allow_motivation_research = true)
    let motivationStats = {
      consented_sample_size: motivationOptInIds.length,
      stories_count: 0,
      discipline_breakdown: {}
    };

    if (motivationOptInIds.length > 0) {
      const { data: stories } = await supabase
        .from('why_i_participate')
        .select('discipline')
        .in('user_id', motivationOptInIds);

      motivationStats.stories_count = (stories || []).length;
      (stories || []).forEach(s => {
        motivationStats.discipline_breakdown[s.discipline] = (motivationStats.discipline_breakdown[s.discipline] || 0) + 1;
      });
    }

    // 4. Aggregate Performance / Analytics (ONLY from users with allow_anonymized_analytics = true)
    let analyticsStats = {
      consented_sample_size: analyticsOptInIds.length,
      challenges_completed: 0,
      results_recorded: 0
    };

    if (analyticsOptInIds.length > 0) {
      const [chalRes, resRes] = await Promise.all([
        supabase.from('user_challenges').select('id', { count: 'exact', head: true }).in('user_id', analyticsOptInIds).eq('status', 'completed'),
        supabase.from('triathlon_results').select('id', { count: 'exact', head: true }).in('user_id', analyticsOptInIds)
      ]);
      analyticsStats.challenges_completed = chalRes.count || 0;
      analyticsStats.results_recorded = resRes.count || 0;
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ethics_statement: 'All data is aggregated and anonymized in strict accordance with participants consent preferences (§18).',
      consents: {
        total_recorded_consents: consentList.length,
        analytics_opt_in_count: analyticsOptInIds.length,
        motivation_opt_in_count: motivationOptInIds.length,
        demographic_opt_in_count: demographicOptInIds.length
      },
      demographics: demographicStats,
      motivations: motivationStats,
      analytics: analyticsStats
    });
  } catch (err) {
    console.error('Error generating anonymized research summary:', err);
    res.status(500).json({ error: 'Failed to generate research summary: ' + err.message });
  }
};
