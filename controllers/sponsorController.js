import { supabase } from '../config/supabase.js';

/**
 * Sponsor Controller
 * Manages sponsor tier benefits, vector logo assets, and VIP passes.
 * Backed by the `sponsor_deliverables` table, scoped to the authenticated
 * sponsor's own profile (or any record, for admin).
 */
export const getSponsorPortal = async (req, res) => {
  try {
    let query = supabase
      .from('sponsor_deliverables')
      .select('*')
      .order('created_at', { ascending: false });

    // Sponsors only ever see their own record; admins may pass ?profile_id=
    // to inspect a specific sponsor, or see the most recent one by default.
    if (req.user.role === 'sponsor') {
      query = query.eq('profile_id', req.user.id);
    } else if (req.query.profile_id) {
      query = query.eq('profile_id', req.query.profile_id);
    }

    const { data: sponsor, error } = await query.limit(1).maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!sponsor) {
      return res.status(404).json({ error: 'No sponsor deliverable record found for this account' });
    }

    return res.status(200).json({
      status: 'success',
      sponsor_name: sponsor.sponsor_name,
      tier: sponsor.tier,
      contribution_amount_tsh: sponsor.contribution_amount_tsh,
      deliverables: {
        logo_vector_uploaded: Boolean(sponsor.logo_vector_url),
        logo_url: sponsor.logo_vector_url,
        banner_placement_cleared: sponsor.banner_placement_cleared
      },
      vip_passes: {
        allotted: sponsor.vip_passes_allotted,
        claimed: sponsor.vip_passes_claimed,
        remaining: Math.max(0, (sponsor.vip_passes_allotted || 0) - (sponsor.vip_passes_claimed || 0))
      }
    });
  } catch (error) {
    console.error('getSponsorPortal exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve sponsor portal data' });
  }
};

export const uploadSponsorLogo = async (req, res) => {
  try {
    const { logo_vector_url } = req.body;
    if (!logo_vector_url) {
      return res.status(400).json({ error: 'Vector logo URL is required' });
    }

    let query = supabase.from('sponsor_deliverables').update({ logo_vector_url });

    if (req.user.role === 'sponsor') {
      query = query.eq('profile_id', req.user.id);
    } else if (req.body.profile_id) {
      query = query.eq('profile_id', req.body.profile_id);
    } else {
      return res.status(400).json({ error: 'profile_id is required for admin-initiated uploads' });
    }

    const { data, error } = await query.select().maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'No sponsor deliverable record found to update' });
    }

    return res.status(200).json({
      success: true,
      message: 'High-res vector logo received and staged for print banners.',
      logo_vector_url: data.logo_vector_url
    });
  } catch (error) {
    console.error('uploadSponsorLogo exception:', error);
    return res.status(500).json({ error: 'Failed to upload sponsor logo' });
  }
};
