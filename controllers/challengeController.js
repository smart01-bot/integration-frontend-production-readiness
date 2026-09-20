import supabase from '../config/supabase.js';
import { darToday, darDateOffset } from '../utils/darTime.js';

// Schema: migration 017 `challenges` / `user_challenges`.
// - challenges: discipline (swim|bike|run|community|general), start_date/end_date
//   (DATE), target_metric, target_value, unit, completion_count, badge_name/badge_icon.
// - user_challenges: status ('joined'|'in_progress'|'completed'), progress_value,
//   UNIQUE (user_id, challenge_id).

const DISCIPLINES = ['swim', 'bike', 'run', 'community', 'general'];

export const getChallenges = async (req, res) => {
  try {
    const user_id = req.user?.id;
    const { include_past = 'false', discipline } = req.query;
    const today = darToday();

    let query = supabase
      .from('challenges')
      .select('*')
      .order('end_date', { ascending: true });

    if (include_past !== 'true') {
      query = query.gte('end_date', today);
    }
    if (discipline && DISCIPLINES.includes(discipline)) {
      query = query.eq('discipline', discipline);
    }

    const { data: challenges, error } = await query;
    if (error) throw error;

    let userStatuses = {};
    if (user_id && challenges && challenges.length > 0) {
      const { data: uc } = await supabase
        .from('user_challenges')
        .select('challenge_id, status, progress_value, completed_at')
        .eq('user_id', user_id)
        .in('challenge_id', challenges.map(c => c.id));
      (uc || []).forEach(u => { userStatuses[u.challenge_id] = u; });
    }

    const enriched = (challenges || []).map(c => ({
      ...c,
      is_open: c.end_date >= today && c.start_date <= today,
      user_status: userStatuses[c.id] || null
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Error fetching challenges:', err);
    res.status(500).json({ error: 'Failed to retrieve challenges' });
  }
};

export const joinChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });

    const { data: challenge } = await supabase
      .from('challenges').select('id, title, end_date').eq('id', challengeId).maybeSingle();
    if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
    const today = darToday();
    if (today > challenge.end_date) return res.status(409).json({ error: 'This challenge has already ended' });

    const { data, error } = await supabase
      .from('user_challenges').insert({ challenge_id: challengeId, user_id, status: 'joined' }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'You have already joined this challenge' });
      throw error;
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('Error joining challenge:', err);
    res.status(500).json({ error: 'Failed to join challenge' });
  }
};

export const completeChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { progress_value } = req.body;
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });

    const { data, error } = await supabase
      .from('user_challenges')
      .update({ status: 'completed', completed_at: new Date().toISOString(), progress_value: progress_value != null ? progress_value : 1 })
      .eq('challenge_id', challengeId).eq('user_id', user_id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Challenge not found or not joined' });

    // §9 — "Completion count": increment the challenge's denormalized counter.
    const { error: rpcError } = await supabase.rpc('increment_challenge_completion', { challenge_id: challengeId });
    if (rpcError) console.error('completion_count increment failed:', rpcError.message);

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error completing challenge:', err);
    res.status(500).json({ error: 'Failed to mark challenge as complete' });
  }
};

export const getChallengeLeaderboard = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { limit = 50 } = req.query;
    const { data, error } = await supabase
      .from('user_challenges')
      .select('completed_at, profiles:user_id (full_name)')
      .eq('challenge_id', challengeId).eq('status', 'completed').not('completed_at', 'is', null)
      .order('completed_at', { ascending: true }).limit(parseInt(limit));
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('Error fetching challenge leaderboard:', err);
    res.status(500).json({ error: 'Failed to retrieve challenge leaderboard' });
  }
};

// ── Admin Challenge Management (§9) ─────────────────────────────────────────

/**
 * POST /api/v1/challenges
 * Create a new challenge. Requires admin.
 */
export const createChallenge = async (req, res) => {
  try {
    const {
      title,
      description,
      discipline = 'general',
      target_metric = 'completion',
      target_value = 1,
      unit = 'count',
      badge_name,
      badge_icon,
      start_date,
      end_date
    } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'title and description are required' });
    }
    if (discipline && !DISCIPLINES.includes(discipline)) {
      return res.status(400).json({ error: 'Invalid discipline. Allowed: ' + DISCIPLINES.join(', ') });
    }

    const today = darToday();
    const in30Days = darDateOffset(30);

    const { data, error } = await supabase
      .from('challenges')
      .insert({
        title: title.trim(),
        description: description.trim(),
        discipline,
        target_metric,
        target_value: parseFloat(target_value) || 1,
        unit,
        badge_name: badge_name || null,
        badge_icon: badge_icon || null,
        start_date: start_date || today,
        end_date: end_date || in30Days
      })
      .select()
      .single();

    if (error) throw error;

    await supabase.from('audit_logs').insert([{
      action: 'CREATE_CHALLENGE',
      target_resource: 'challenges:' + data.id,
      details_json: { title: data.title },
      actor_role: req.user?.role || 'admin',
      actor_profile_id: req.user?.id || null
    }]);

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('Error creating challenge:', err);
    res.status(500).json({ error: 'Failed to create challenge: ' + err.message });
  }
};

/**
 * PUT /api/v1/challenges/:challengeId
 * Update an existing challenge. Requires admin.
 */
export const updateChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;

    if (updates.discipline && !DISCIPLINES.includes(updates.discipline)) {
      return res.status(400).json({ error: 'Invalid discipline. Allowed: ' + DISCIPLINES.join(', ') });
    }

    const { data, error } = await supabase
      .from('challenges')
      .update(updates)
      .eq('id', challengeId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Challenge not found' });

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error updating challenge:', err);
    res.status(500).json({ error: 'Failed to update challenge' });
  }
};

/**
 * DELETE /api/v1/challenges/:challengeId
 * Remove a challenge. Requires admin.
 */
export const deleteChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { error } = await supabase
      .from('challenges')
      .delete()
      .eq('id', challengeId);

    if (error) throw error;
    res.json({ success: true, message: 'Challenge deleted successfully' });
  } catch (err) {
    console.error('Error deleting challenge:', err);
    res.status(500).json({ error: 'Failed to delete challenge' });
  }
};

/**
 * PATCH /api/v1/challenges/:challengeId/end
 * End an active challenge early. Sets end_date to yesterday.
 */
export const endChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const yesterday = darDateOffset(-1);

    const { data, error } = await supabase
      .from('challenges')
      .update({ end_date: yesterday })
      .eq('id', challengeId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Challenge not found' });

    res.json({ success: true, message: 'Challenge ended successfully', data });
  } catch (err) {
    console.error('Error ending challenge:', err);
    res.status(500).json({ error: 'Failed to end challenge' });
  }
};
