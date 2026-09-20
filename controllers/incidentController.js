import { supabase } from '../config/supabase.js';

/**
 * Incident Controller — event-day incident reporting for volunteers and
 * HQ status management (proposal volunteer journey 75, HQ flow 91/104).
 * Volunteers can create reports and read their own; admins get full
 * visibility and status control (see adminController).
 */
export const submitIncidentReport = async (req, res) => {
  try {
    const {
      title,
      description,
      incident_type = 'other',
      severity = 'low',
      station,
      edition_id
    } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'title and description are required' });
    }

    const validTypes = ['medical', 'route_hazard', 'security', 'mechanical', 'lost_participant', 'supply_shortage', 'other'];
    const validSeverities = ['low', 'medium', 'high', 'critical'];

    if (!validTypes.includes(incident_type)) {
      return res.status(400).json({ error: `incident_type must be one of: ${validTypes.join(', ')}` });
    }
    if (!validSeverities.includes(severity)) {
      return res.status(400).json({ error: `severity must be one of: ${validSeverities.join(', ')}` });
    }

    const { data, error } = await supabase
      .from('incidents')
      .insert([{
        edition_id: edition_id || null,
        reported_by: req.user.id,
        station: station || null,
        incident_type,
        severity,
        title,
        description,
        status: 'open'
      }])
      .select()
      .single();

    if (error) {
      console.error('submitIncidentReport insert failed:', error.message);
      return res.status(500).json({ error: 'Failed to record incident report' });
    }

    return res.status(201).json({
      status: 'success',
      message: 'Incident report recorded. HQ has been notified.',
      data
    });
  } catch (error) {
    console.error('submitIncidentReport exception:', error);
    return res.status(500).json({ error: 'Failed to record incident report' });
  }
};
