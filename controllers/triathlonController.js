import supabase from '../config/supabase.js';

/**
 * GET /api/v1/triathlon/overview
 * Returns the triathlon structure: Swim → T1 → Bike → T2 → Run, plus active categories.
 */
export const getTriathlonOverview = async (req, res) => {
  try {
    const [stagesRes, categoriesRes, lifecycleRes] = await Promise.all([
      supabase.from('triathlon_stages').select('*').order('order_index', { ascending: true }),
      supabase.from('race_categories').select('*').order('entry_fee_tsh', { ascending: true }),
      supabase.from('event_lifecycle').select('*').limit(1).maybeSingle()
    ]);

    res.json({
      success: true,
      event: lifecycleRes.data || {
        event_name: 'Tour de Dar',
        tagline: 'The city moves. The memory remains.',
        current_mode: 'live'
      },
      stages: stagesRes.data || [],
      categories: categoriesRes.data || []
    });
  } catch (error) {
    console.error('Error fetching triathlon overview:', error);
    res.status(500).json({ error: 'Failed to retrieve triathlon overview' });
  }
};

/**
 * GET /api/v1/triathlon/live-activity
 * Product Brief Requirement: "Where possible, activity should come from actual platform data:
 * New registrations, new teams, participant stories, challenge activity. No fake activity."
 */
export const getLiveActivity = async (req, res) => {
  try {
    const [regsRes, teamsRes, storiesRes, challengesRes, recentRegsRes] = await Promise.all([
      supabase.from('registrations').select('id', { count: 'exact', head: true }).neq('status', 'cancelled'),
      supabase.from('teams').select('id', { count: 'exact', head: true }),
      supabase.from('why_i_participate').select('id', { count: 'exact', head: true }),
      supabase.from('user_challenges').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('registrations')
        .select('id, activity_slug, created_at, profiles(full_name)')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(5)
    ]);

    const stats = {
      total_participants: regsRes.count || 0,
      total_teams: teamsRes.count || 0,
      stories_shared: storiesRes.count || 0,
      challenges_completed: challengesRes.count || 0,
      recent_activity: (recentRegsRes.data || []).map(r => ({
        id: r.id,
        type: 'registration',
        athlete: r.profiles?.full_name ? r.profiles.full_name.split(' ')[0] : 'Athlete',
        category: r.activity_slug,
        timestamp: r.created_at
      }))
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching live activity:', error);
    res.status(500).json({ error: 'Failed to retrieve live activity data' });
  }
};

/**
 * GET /api/v1/triathlon/map?discipline=swim|bike|run|event
 * Returns interactive course waypoints and checkpoints for the Dar map.
 */
export const getCourseMap = async (req, res) => {
  try {
    const { discipline } = req.query;
    let query = supabase.from('map_waypoints').select('*').order('order_index', { ascending: true });

    if (discipline && ['swim', 'bike', 'run', 'event'].includes(discipline)) {
      query = query.eq('discipline', discipline);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      discipline: discipline || 'all',
      waypoints: data || []
    });
  } catch (error) {
    console.error('Error fetching course map:', error);
    res.status(500).json({ error: 'Failed to retrieve course map data' });
  }
};

/**
 * GET /api/v1/triathlon/impact
 * Product Brief Requirement: "Where your participation goes — Rotary / community impact"
 */
export const getCommunityImpact = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('community_impact')
      .select('*')
      .order('order_index', { ascending: true });

    if (error) throw error;
    res.json({ success: true, projects: data || [] });
  } catch (error) {
    console.error('Error fetching community impact:', error);
    res.status(500).json({ error: 'Failed to retrieve community impact data' });
  }
};

/**
 * PATCH /api/v1/triathlon/lifecycle
 * Update the event lifecycle mode: 'live', 'memory', or 'archive'.
 * Requires admin.
 */
export const updateLifecycleMode = async (req, res) => {
  try {
    const { mode } = req.body;
    const VALID_MODES = ['live', 'memory', 'archive'];
    if (!mode || !VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `Invalid mode. Allowed values: ${VALID_MODES.join(', ')}` });
    }

    const updates = { current_mode: mode, updated_at: new Date().toISOString() };
    if (mode === 'memory') updates.memory_mode_unlocked_at = new Date().toISOString();
    if (mode === 'archive') updates.archive_date = new Date().toISOString();

    const { data, error } = await supabase
      .from('event_lifecycle')
      .update(updates)
      .neq('current_mode', 'custom_never_match')
      .select()
      .maybeSingle();

    if (error) throw error;

    res.json({ success: true, mode, data, message: `Event lifecycle updated to '${mode}'` });
  } catch (error) {
    console.error('Error updating lifecycle mode:', error);
    res.status(500).json({ error: 'Failed to update lifecycle mode' });
  }
};
