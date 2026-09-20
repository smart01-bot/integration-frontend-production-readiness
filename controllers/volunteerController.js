import { supabase } from '../config/supabase.js';

/**
 * Volunteer Controller
 * Handles shifts, briefing acknowledgement, and gate scanner access.
 * Backed by the `volunteer_assignments` table.
 */
export const getMyVolunteerShift = async (req, res) => {
  try {
    const { data: assignment, error } = await supabase
      .from('volunteer_assignments')
      .select('*, profiles(full_name), event_editions(title, year)')
      .eq('profile_id', req.user.id)
      .order('shift_start', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!assignment) {
      return res.status(404).json({ error: 'No volunteer shift assignment found for this account' });
    }

    return res.status(200).json({
      status: 'success',
      role: 'volunteer',
      volunteer_name: assignment.profiles?.full_name,
      assigned_station: assignment.station_name,
      role_title: assignment.role_title,
      shift_start: assignment.shift_start,
      shift_end: assignment.shift_end,
      briefing_status: assignment.briefing_acknowledged ? 'Completed' : 'Pending',
      gate_scanner_access_granted: assignment.briefing_acknowledged
    });
  } catch (error) {
    console.error('getMyVolunteerShift exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve volunteer shift' });
  }
};

export const acknowledgeBriefing = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('volunteer_assignments')
      .update({ briefing_acknowledged: true })
      .eq('profile_id', req.user.id)
      .select()
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'No volunteer assignment found for this account' });
    }

    return res.status(200).json({
      success: true,
      message: 'Safety and hydration briefing acknowledged.'
    });
  } catch (error) {
    console.error('acknowledgeBriefing exception:', error);
    return res.status(500).json({ error: 'Failed to acknowledge briefing' });
  }
};
