import { supabase } from '../config/supabase.js';

/**
 * Public activity catalogue. The database is the only source of activity
 * data; an unavailable or empty database must never be disguised as a
 * successful response containing invented registrations or prices.
 */
export const getActivities = async (req, res) => {
  try {
    const { category } = req.query;
    let query = supabase
      .from('activities')
      .select('*')
      .order('distance_km', { ascending: false });

    if (category) query = query.ilike('category', category);

    const { data, error } = await query;
    if (error) {
      console.error('getActivities database error:', error.message);
      return res.status(500).json({ error: 'Failed to retrieve activities' });
    }

    return res.status(200).json({
      edition: 'Tour de Rotary DSM 2026',
      edition_year: 2026,
      count: data.length,
      data
    });
  } catch (error) {
    console.error('getActivities exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve activities' });
  }
};

export const getActivityById = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) {
      console.error('getActivityById database error:', error.message);
      return res.status(500).json({ error: 'Failed to retrieve activity' });
    }
    if (!data) return res.status(404).json({ error: 'Activity not found' });

    return res.status(200).json({ data });
  } catch (error) {
    console.error('getActivityById exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve activity' });
  }
};
