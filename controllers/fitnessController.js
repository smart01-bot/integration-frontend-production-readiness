import { supabase } from '../config/supabase.js';

/**
 * Fitness & Strava Sync Controller
 *
 * IMPORTANT: Strava integration is explicitly deferred per Schedule A11
 * ("subject to third-party access and approvals") — there is no live
 * Strava OAuth connection, and no table exists yet to store training
 * activity data. This previously returned entirely fabricated data
 * (a fake athlete_id, fake distances, fake badges with fake dates) on
 * every single request, and syncStravaActivity did not persist anything
 * at all — it just echoed back a number computed from a hardcoded base
 * value. Both are now honest about the real state instead.
 */
export const getFitnessSyncStatus = async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('fitness_sharing_opt_in')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: 'Failed to check fitness sync status' });
    }

    return res.status(200).json({
      connected_service: null,
      status: 'NOT_CONNECTED',
      opt_in_active: profile?.fitness_sharing_opt_in || false,
      message: 'Strava sync is not yet available — this integration is pending third-party approval (Schedule A11). No training data is connected or stored for this account.'
    });
  } catch (error) {
    console.error('getFitnessSyncStatus exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve fitness sync status' });
  }
};

export const syncStravaActivity = async (req, res) => {
  // Honest 501: there is nowhere for this data to go yet — no Strava OAuth
  // connection and no training_activities table exist. Returning a fake
  // "success" here would silently discard whatever the caller sent.
  return res.status(501).json({
    error: 'NOT_IMPLEMENTED',
    message: 'Strava activity sync is not yet built. This endpoint is a placeholder pending Schedule A11 third-party approval.'
  });
};
