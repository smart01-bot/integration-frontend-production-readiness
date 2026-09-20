import supabase from '../config/supabase.js';

// Schema: migration 017 `teams` / `team_members`.
// - teams: name, slug (UNIQUE NOT NULL — derived from the name here),
//   team_type (corporate|university|hospital|club|friends|ngo|community),
//   story, logo_url, captain_id, is_relay + relay_{swimmer,cyclist,runner}_id,
//   member_count (denormalized, kept in sync below).
// - team_members: role (captain|member|swimmer|cyclist|runner),
//   UNIQUE (team_id, user_id).
const TEAM_TYPES = ['corporate', 'university', 'hospital', 'club', 'friends', 'ngo', 'community'];
const RELAY_ROLES = ['swimmer', 'cyclist', 'runner'];
// Relay teams field exactly three legs; open teams get a generous ceiling.
const capacityOf = (team) => (team?.is_relay ? RELAY_ROLES.length : 100);

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'team';
}

async function uniqueSlug(name) {
  const base = slugify(name);
  const { data } = await supabase.from('teams').select('slug').eq('slug', base).maybeSingle();
  return data ? `${base}-${Date.now().toString(36)}` : base;
}

export const getTeams = async (req, res) => {
  try {
    const { page, limit, offset } = req.pagination || { page: 1, limit: 20, offset: 0 };
    const { type } = req.query;
    let query = supabase
      .from('teams')
      .select('*, captain:captain_id (full_name)', { count: 'exact' })
      .order('member_count', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (type) {
      if (!TEAM_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid team type. Use: ' + TEAM_TYPES.join(', ') });
      query = query.eq('team_type', type);
    }
    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data, pagination: { page, limit, total: count, pages: Math.ceil((count || 0) / limit) } });
  } catch (err) {
    console.error('Error fetching teams:', err);
    res.status(500).json({ error: 'Failed to retrieve teams' });
  }
};

export const getTeamDetail = async (req, res) => {
  try {
    const { teamId } = req.params;
    const [teamRes, membersRes] = await Promise.all([
      supabase.from('teams').select('*, captain:captain_id (full_name)').eq('id', teamId).maybeSingle(),
      supabase.from('team_members').select('*, profiles:user_id (full_name)').eq('team_id', teamId).order('joined_at', { ascending: true })
    ]);
    if (teamRes.error) throw teamRes.error;
    if (!teamRes.data) return res.status(404).json({ error: 'Team not found' });
    if (membersRes.error) throw membersRes.error;
    res.json({ success: true, data: { ...teamRes.data, members: membersRes.data || [] } });
  } catch (err) {
    console.error('Error fetching team detail:', err);
    res.status(500).json({ error: 'Failed to retrieve team detail' });
  }
};

export const createTeam = async (req, res) => {
  try {
    const { name, story, team_type = 'community', is_relay = false, logo_url } = req.body || {};
    const captain_id = req.user?.id;
    if (!captain_id) return res.status(401).json({ error: 'Authentication required' });
    if (!name || name.trim().length === 0) return res.status(400).json({ error: 'Team name is required' });
    if (!TEAM_TYPES.includes(team_type)) return res.status(400).json({ error: 'Invalid team_type. Use: ' + TEAM_TYPES.join(', ') });

    const slug = await uniqueSlug(name);
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({ name: name.trim(), slug, story: story?.trim() || null, team_type, is_relay: Boolean(is_relay), logo_url: logo_url || null, captain_id })
      .select().single();
    if (teamError) throw teamError;

    const { error: memberError } = await supabase
      .from('team_members')
      .insert({ team_id: team.id, user_id: captain_id, role: 'captain' });
    if (memberError) {
      // Don't leave a captain-less team behind.
      await supabase.from('teams').delete().eq('id', team.id);
      throw memberError;
    }
    res.status(201).json({ success: true, data: team });
  } catch (err) {
    console.error('Error creating team:', err);
    res.status(500).json({ error: 'Failed to create team' });
  }
};

export const joinTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { role = 'member' } = req.body;
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });

    const { data: team } = await supabase.from('teams').select('id, name, is_relay, member_count').eq('id', teamId).maybeSingle();
    if (!team) return res.status(404).json({ error: 'Team not found' });

    if (team.is_relay) {
      if (!RELAY_ROLES.includes(role)) return res.status(400).json({ error: 'Relay teams join as swimmer, cyclist or runner' });
    } else if (role !== 'member') {
      return res.status(400).json({ error: 'Only relay teams take discipline roles' });
    }

    if ((team.member_count || 0) >= capacityOf(team)) return res.status(409).json({ error: 'Team is at full capacity' });

    const { error } = await supabase.from('team_members').insert({ team_id: teamId, user_id, role });
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'You are already a member of this team' });
      throw error;
    }

    // Keep the denormalized counter honest.
    const { count } = await supabase.from('team_members').select('id', { count: 'exact', head: true }).eq('team_id', teamId);
    await supabase.from('teams').update({ member_count: count || 0 }).eq('id', teamId);

    res.json({ success: true, message: 'Successfully joined ' + team.name });
  } catch (err) {
    console.error('Error joining team:', err);
    res.status(500).json({ error: 'Failed to join team' });
  }
};

export const leaveTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });

    const { data: removed, error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId).eq('user_id', user_id).neq('role', 'captain')
      .select('id');
    if (error) throw error;
    if (!removed || removed.length === 0) {
      return res.status(404).json({ error: 'You are not a member of this team (captains cannot leave their own team)' });
    }

    const { count } = await supabase.from('team_members').select('id', { count: 'exact', head: true }).eq('team_id', teamId);
    await supabase.from('teams').update({ member_count: count || 0 }).eq('id', teamId);

    res.json({ success: true, message: 'Left team successfully' });
  } catch (err) {
    console.error('Error leaving team:', err);
    res.status(500).json({ error: 'Failed to leave team' });
  }
};

export const updateTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { name, story, team_type, logo_url } = req.body;
    const user_id = req.user?.id;
    const user_role = req.user?.role;

    if (!user_id) return res.status(401).json({ error: 'Authentication required' });

    const { data: team, error: fetchErr } = await supabase
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const isCaptain = team.captain_id === user_id;
    const isAdmin = user_role === 'admin' || user_role === 'hq_admin';

    if (!isCaptain && !isAdmin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the team captain or an admin can update this team'
      });
    }

    const updates = {};
    if (name && name.trim()) updates.name = name.trim();
    if (story !== undefined) updates.story = story?.trim() || null;
    if (logo_url !== undefined) updates.logo_url = logo_url || null;
    if (team_type) {
      if (!TEAM_TYPES.includes(team_type)) {
        return res.status(400).json({ error: 'Invalid team_type. Use: ' + TEAM_TYPES.join(', ') });
      }
      updates.team_type = team_type;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('teams')
      .update(updates)
      .eq('id', teamId)
      .select('*, captain:captain_id (full_name)')
      .single();

    if (updateErr) throw updateErr;

    res.json({ success: true, data: updated, message: 'Team updated successfully' });
  } catch (err) {
    console.error('Error updating team:', err);
    res.status(500).json({ error: 'Failed to update team' });
  }
};

/**
 * §15 Team Discussions / Event Chat
 * GET /api/v1/teams/:teamId/discussions
 * Returns discussion messages for a team.
 */
export const getTeamDiscussions = async (req, res) => {
  try {
    const { teamId } = req.params;
    const userId = req.user?.id;
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'hq_admin';

    // Verify team exists
    const { data: team, error: teamErr } = await supabase
      .from('teams')
      .select('id, name')
      .eq('id', teamId)
      .maybeSingle();

    if (teamErr) throw teamErr;
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Verify membership (or staff)
    if (!isStaff && userId) {
      const { data: member } = await supabase
        .from('team_members')
        .select('id')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!member) {
        return res.status(403).json({ error: 'You must be a member of this team to view discussions' });
      }
    }

    const tag = `[TEAM:${teamId}]`;
    const { data: posts, error } = await supabase
      .from('community_posts')
      .select('id, user_id, content, created_at, profiles:user_id (full_name)')
      .eq('post_type', 'team_update')
      .ilike('content', `${tag}%`)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const messages = (posts || []).map(p => ({
      id: p.id,
      user_id: p.user_id,
      author: p.profiles?.full_name || 'Team Member',
      message: p.content.replace(tag, '').trim(),
      created_at: p.created_at
    }));

    res.json({
      success: true,
      team_id: teamId,
      team_name: team.name,
      count: messages.length,
      data: messages
    });
  } catch (err) {
    console.error('Error fetching team discussions:', err);
    res.status(500).json({ error: 'Failed to retrieve team discussions' });
  }
};

/**
 * §15 Post Team Discussion Message
 * POST /api/v1/teams/:teamId/discussions
 */
export const postTeamDiscussion = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { message } = req.body;
    const userId = req.user?.id;
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'hq_admin';

    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message content is required' });

    // Verify membership or staff
    if (!isStaff) {
      const { data: member } = await supabase
        .from('team_members')
        .select('id')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!member) {
        return res.status(403).json({ error: 'Only team members can post to this team discussion' });
      }
    }

    const tag = `[TEAM:${teamId}] `;
    const { data, error } = await supabase
      .from('community_posts')
      .insert({
        user_id: userId,
        post_type: 'team_update',
        discipline: 'triathlon',
        content: tag + message.trim(),
        status: 'published'
      })
      .select('id, user_id, content, created_at, profiles:user_id (full_name)')
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data: {
        id: data.id,
        user_id: data.user_id,
        author: data.profiles?.full_name || 'Team Member',
        message: message.trim(),
        created_at: data.created_at
      }
    });
  } catch (err) {
    console.error('Error posting team discussion:', err);
    res.status(500).json({ error: 'Failed to post team message' });
  }
};


