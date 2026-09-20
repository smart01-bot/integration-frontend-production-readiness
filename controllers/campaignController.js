import { supabase } from '../config/supabase.js';

/**
 * Campaign Controller — marketing/UTM campaign landing pages and click
 * tracking. Backed by the real `campaigns` table.
 *
 * IMPORTANT: this previously returned a hardcoded, in-memory array of fake
 * campaigns with fabricated click/conversion/revenue numbers and stock
 * photo banners — none of it persisted, none of it real. trackCampaignClick
 * incremented an in-memory counter that reset every server restart, so no
 * click was ever actually recorded anywhere. All of that is replaced with
 * real reads/writes against the `campaigns` table below.
 */
export const getCampaignLanding = async (req, res) => {
  try {
    const { campaign: campaignSlug } = req.query;

    const { data: edition, error: editionError } = await supabase
      .from('event_editions')
      .select('*')
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (editionError) {
      return res.status(503).json({ error: 'Unable to load event details right now.' });
    }

    let campaign = null;
    if (campaignSlug) {
      const { data } = await supabase
        .from('campaigns')
        .select('*')
        .eq('slug', campaignSlug)
        .maybeSingle();
      campaign = data || null;
    }

    // Real, current pricing — pulled from activities, never hardcoded.
    const { data: activities } = await supabase
      .from('activities')
      .select('title, category, early_bird_price_tsh, standard_price_tsh')
      .eq('edition_id', edition?.id);

    // Editable via GET/PUT /api/v1/admin/content — falls back to an empty
    // array if nobody has set landing-page highlights yet, rather than
    // fabricating marketing copy.
    const { data: highlightsContent } = await supabase
      .from('site_content')
      .select('value_json')
      .eq('content_key', 'campaign_landing_highlights')
      .maybeSingle();

    return res.status(200).json({
      status: 'success',
      edition: edition?.title || 'Tour de Rotary DSM',
      event_date: edition?.event_date || null,
      flag_off_location: edition?.location_name || null,
      current_phase: edition?.current_phase || 'pre_event',
      campaign: campaign || null,
      highlights: highlightsContent?.value_json || [],
      pricing: activities || []
    });
  } catch (error) {
    console.error('getCampaignLanding exception:', error);
    return res.status(500).json({ error: 'Failed to load campaign landing data' });
  }
};

export const getCampaignsList = async (req, res) => {
  try {
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(503).json({ error: 'Unable to retrieve campaigns right now.' });
    }

    return res.status(200).json({
      status: 'success',
      count: campaigns ? campaigns.length : 0,
      data: campaigns || []
    });
  } catch (error) {
    console.error('getCampaignsList exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve campaigns' });
  }
};

export const trackCampaignClick = async (req, res) => {
  try {
    const { slug, utm_source, utm_medium, utm_campaign } = req.body;

    if (slug) {
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('id, clicks_count')
        .eq('slug', slug)
        .maybeSingle();

      if (campaign) {
        await supabase
          .from('campaigns')
          .update({ clicks_count: (campaign.clicks_count || 0) + 1 })
          .eq('id', campaign.id);
      }
    }

    return res.status(200).json({
      status: 'success',
      message: 'Campaign click tracked',
      tracked_params: {
        slug: slug || 'direct',
        utm_source: utm_source || 'organic',
        utm_medium: utm_medium || 'web',
        utm_campaign: utm_campaign || 'rotary-2026'
      }
    });
  } catch (error) {
    console.error('trackCampaignClick exception:', error);
    return res.status(500).json({ error: 'Failed to track campaign click' });
  }
};
