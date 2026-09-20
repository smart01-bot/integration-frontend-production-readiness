import { supabase } from '../config/supabase.js';

/**
 * Partner Controller
 * Coordinates emergency medical, police escort, traffic and logistics
 * partners. Backed by the `partner_clearances` table.
 */
export const getPartnerClearances = async (req, res) => {
  try {
    let query = supabase
      .from('partner_clearances')
      .select('*')
      .order('created_at', { ascending: false });

    // Partners see only their own clearance record(s); admins see everything
    // or can filter by ?profile_id=
    if (req.user.role === 'partner') {
      query = query.eq('profile_id', req.user.id);
    } else if (req.query.profile_id) {
      query = query.eq('profile_id', req.query.profile_id);
    }

    const { data: clearances, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: clearances ? clearances.length : 0,
      data: clearances || []
    });
  } catch (error) {
    console.error('getPartnerClearances exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve partner clearances' });
  }
};

export const updateSafetyClearance = async (req, res) => {
  try {
    const { id, cleared = true } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Clearance record id is required' });
    }

    let query = supabase
      .from('partner_clearances')
      .update({
        route_safety_cleared: cleared,
        cleared_at: cleared ? new Date().toISOString() : null
      })
      .eq('id', id);

    // Partners may only update their own record
    if (req.user.role === 'partner') {
      query = query.eq('profile_id', req.user.id);
    }

    const { data, error } = await query.select().maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'Clearance record not found, or not owned by this account' });
    }

    return res.status(200).json({
      success: true,
      message: `Safety and deployment clearance updated for ${data.partner_name}`,
      data
    });
  } catch (error) {
    console.error('updateSafetyClearance exception:', error);
    return res.status(500).json({ error: 'Failed to update safety clearance' });
  }
};
