import { supabase } from '../config/supabase.js';

/**
 * Merchandise Controller
 * Production endpoints querying the product_variants and products tables
 */

export const getMerchandiseCatalog = async (req, res) => {
  try {
    const { category } = req.query;

    let query = supabase
      .from('product_variants')
      .select('*')
      .order('product_name', { ascending: true });

    if (category) {
      query = query.ilike('product_name', `%${category}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching merchandise catalog from database:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: data ? data.length : 0,
      reservation_policy: '7-day automated inventory hold with SMS alerts on Day 4 and Day 6',
      data: data || []
    });
  } catch (error) {
    console.error('getMerchandiseCatalog exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve merchandise catalogue' });
  }
};

export const getMerchandiseItem = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('product_variants')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Merchandise item not found' });
    }

    return res.status(200).json({
      status: 'success',
      data
    });
  } catch (error) {
    console.error('getMerchandiseItem exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve item' });
  }
};
