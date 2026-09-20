import supabase from '../config/supabase.js';

// Schema: migration 017 `why_i_participate`:
// user_id, display_name (NOT NULL — resolved from profiles here), discipline
// (triathlon|swim|bike|run), prompt, quote (NOT NULL — the short answer),
// story_details, photo_url, is_featured, is_approved (added in 017's
// moderation block — the approve workflow gates the public collection).
const DISCIPLINES = ['triathlon', 'swim', 'bike', 'run'];

export const getStories = async (req, res) => {
  try {
    const { page, limit, offset } = req.pagination || { page: 1, limit: 12, offset: 0 };
    const { featured } = req.query;
    let query = supabase
      .from('why_i_participate')
      .select('*, profiles:user_id (full_name)', { count: 'exact' })
      .eq('is_approved', true)
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (featured === 'true') query = query.eq('is_featured', true);
    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data, pagination: { page, limit, total: count, pages: Math.ceil((count || 0) / limit) } });
  } catch (err) {
    console.error('Error fetching stories:', err);
    res.status(500).json({ error: 'Failed to retrieve stories' });
  }
};

export const submitStory = async (req, res) => {
  try {
    const { quote, story_text, story_details, photo_url, discipline = 'triathlon' } = req.body;
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });
    // Accept both `quote` and the legacy `story_text` field name.
    const text = (quote || story_text || '').trim();
    if (text.length < 20) return res.status(400).json({ error: 'Story must be at least 20 characters' });
    if (!DISCIPLINES.includes(discipline)) return res.status(400).json({ error: 'Invalid discipline. Use: ' + DISCIPLINES.join(', ') });

    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user_id).maybeSingle();

    const { data, error } = await supabase
      .from('why_i_participate')
      .insert({
        user_id,
        display_name: profile?.full_name || 'Participant',
        quote: text,
        story_details: story_details?.trim() || null,
        photo_url: photo_url || null,
        discipline,
        is_approved: false
      })
      .select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data, message: 'Story submitted for review' });
  } catch (err) {
    console.error('Error submitting story:', err);
    res.status(500).json({ error: 'Failed to submit story' });
  }
};

export const approveStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const { is_featured = false } = req.body;
    const { data, error } = await supabase
      .from('why_i_participate')
      .update({ is_approved: true, is_featured })
      .eq('id', storyId).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Story not found' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error approving story:', err);
    res.status(500).json({ error: 'Failed to approve story' });
  }
};
