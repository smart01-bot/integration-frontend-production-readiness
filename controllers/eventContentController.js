import supabase from '../config/supabase.js';

/**
 * Event-content admin (audit gaps 12 & 13).
 *
 * - Waypoints: the Dar Map (§10) needs swim buoys, aid stations, parking and
 *   spectator areas maintained by staff — there was no write path at all.
 * - Race categories: brief §12 requires configurable "categories/distances/
 *   waves". The column existed (wave_start_time) with no admin surface.
 *
 * All endpoints require admin; both tables are public-read via RLS so no
 * extra read endpoints are needed.
 */

const WAYPOINT_DISCIPLINES = ['swim', 'bike', 'run', 'event'];
const WAYPOINT_TYPES = ['start', 'turn', 'aid_station', 'medical', 'transition', 'spectator', 'parking', 'finish'];
const CATEGORY_FORMATS = ['individual', 'relay', 'corporate'];

const isPresent = (v) => v !== undefined && v !== null && v !== '';

// ── Waypoints (§10 THE DAR MAP) ─────────────────────────────────────────────

export const createWaypoint = async (req, res) => {
  try {
    const { discipline, point_type, name, description, lat, lng, landmark, order_index } = req.body || {};

    if (!WAYPOINT_DISCIPLINES.includes(discipline)) {
      return res.status(400).json({ error: 'Invalid discipline. Use: ' + WAYPOINT_DISCIPLINES.join(', ') });
    }
    if (!WAYPOINT_TYPES.includes(point_type)) {
      return res.status(400).json({ error: 'Invalid point_type. Use: ' + WAYPOINT_TYPES.join(', ') });
    }
    if (!isPresent(name) || !isPresent(lat) || !isPresent(lng)) {
      return res.status(400).json({ error: 'name, lat and lng are required' });
    }
    const latN = Number(lat), lngN = Number(lng);
    if (!Number.isFinite(latN) || latN < -90 || latN > 90 || !Number.isFinite(lngN) || lngN < -180 || lngN > 180) {
      return res.status(400).json({ error: 'lat/lng out of range' });
    }

    const { data, error } = await supabase
      .from('map_waypoints')
      .insert({
        discipline, point_type,
        name: String(name).trim(),
        description: description?.trim() || null,
        lat: latN, lng: lngN,
        landmark: landmark?.trim() || null,
        order_index: Number.isFinite(parseInt(order_index)) ? parseInt(order_index) : 0
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('Error creating waypoint:', err);
    res.status(500).json({ error: 'Failed to create waypoint' });
  }
};

export const updateWaypoint = async (req, res) => {
  try {
    const { waypointId } = req.params;
    const body = req.body || {};
    const updates = {};

    if ('discipline' in body) {
      if (!WAYPOINT_DISCIPLINES.includes(body.discipline)) {
        return res.status(400).json({ error: 'Invalid discipline. Use: ' + WAYPOINT_DISCIPLINES.join(', ') });
      }
      updates.discipline = body.discipline;
    }
    if ('point_type' in body) {
      if (!WAYPOINT_TYPES.includes(body.point_type)) {
        return res.status(400).json({ error: 'Invalid point_type. Use: ' + WAYPOINT_TYPES.join(', ') });
      }
      updates.point_type = body.point_type;
    }
    for (const key of ['name', 'description', 'landmark']) {
      if (key in body) updates[key] = body[key] === null ? null : String(body[key]).trim();
    }
    if ('lat' in body) {
      const n = Number(body.lat);
      if (!Number.isFinite(n) || n < -90 || n > 90) return res.status(400).json({ error: 'lat out of range' });
      updates.lat = n;
    }
    if ('lng' in body) {
      const n = Number(body.lng);
      if (!Number.isFinite(n) || n < -180 || n > 180) return res.status(400).json({ error: 'lng out of range' });
      updates.lng = n;
    }
    if ('order_index' in body) {
      const n = parseInt(body.order_index);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'order_index must be an integer' });
      updates.order_index = n;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('map_waypoints')
      .update(updates)
      .eq('id', waypointId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Waypoint not found' });

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error updating waypoint:', err);
    res.status(500).json({ error: 'Failed to update waypoint' });
  }
};

export const deleteWaypoint = async (req, res) => {
  try {
    const { waypointId } = req.params;
    const { error } = await supabase
      .from('map_waypoints')
      .delete()
      .eq('id', waypointId);
    if (error) throw error;
    res.json({ success: true, message: 'Waypoint deleted' });
  } catch (err) {
    console.error('Error deleting waypoint:', err);
    res.status(500).json({ error: 'Failed to delete waypoint' });
  }
};

// ── Race categories incl. waves (§2, §12) ───────────────────────────────────

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const createCategory = async (req, res) => {
  try {
    const {
      slug, name, format = 'individual',
      swim_distance_m, bike_distance_m, run_distance_m,
      wave_start_time, entry_fee_tsh, max_participants, description
    } = req.body || {};

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'slug is required (lowercase letters, digits, hyphens)' });
    }
    if (!isPresent(name)) return res.status(400).json({ error: 'name is required' });
    if (!CATEGORY_FORMATS.includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use: ' + CATEGORY_FORMATS.join(', ') });
    }
    for (const [key, min, max] of [['swim_distance_m', 0, 100_000], ['bike_distance_m', 0, 500_000], ['run_distance_m', 0, 300_000]]) {
      if (isPresent(req.body[key])) {
        const n = parseInt(req.body[key]);
        if (!Number.isFinite(n) || n < min || n > max) return res.status(400).json({ error: `${key} out of range` });
      }
    }
    if (isPresent(wave_start_time) && !TIME_RE.test(wave_start_time)) {
      return res.status(400).json({ error: 'wave_start_time must be HH:MM or HH:MM:SS (24h)' });
    }

    const { data, error } = await supabase
      .from('race_categories')
      .insert({
        slug, name: String(name).trim(), format,
        swim_distance_m: isPresent(swim_distance_m) ? parseInt(swim_distance_m) : 0,
        bike_distance_m: isPresent(bike_distance_m) ? parseInt(bike_distance_m) : 0,
        run_distance_m: isPresent(run_distance_m) ? parseInt(run_distance_m) : 0,
        wave_start_time: isPresent(wave_start_time) ? wave_start_time : null,
        entry_fee_tsh: isPresent(entry_fee_tsh) ? Number(entry_fee_tsh) : 50000,
        max_participants: isPresent(max_participants) ? parseInt(max_participants) : 500,
        description: description?.trim() || null
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'A category with that slug already exists' });
    }
    console.error('Error creating category:', err);
    res.status(500).json({ error: 'Failed to create race category' });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const body = req.body || {};
    const updates = {};

    if ('wave_start_time' in body) {
      if (body.wave_start_time === null) updates.wave_start_time = null;
      else if (!TIME_RE.test(String(body.wave_start_time))) {
        return res.status(400).json({ error: 'wave_start_time must be HH:MM or HH:MM:SS (24h)' });
      } else updates.wave_start_time = body.wave_start_time;
    }
    if ('name' in body && isPresent(body.name)) updates.name = String(body.name).trim();
    if ('description' in body) updates.description = body.description === null ? null : String(body.description).trim();
    if ('format' in body) {
      if (!CATEGORY_FORMATS.includes(body.format)) {
        return res.status(400).json({ error: 'Invalid format. Use: ' + CATEGORY_FORMATS.join(', ') });
      }
      updates.format = body.format;
    }
    for (const key of ['swim_distance_m', 'bike_distance_m', 'run_distance_m', 'max_participants']) {
      if (key in body) {
        const n = parseInt(body[key]);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${key} must be a non-negative integer` });
        updates[key] = n;
      }
    }
    if ('entry_fee_tsh' in body) {
      const n = Number(body.entry_fee_tsh);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'entry_fee_tsh must be a non-negative number' });
      updates.entry_fee_tsh = n;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('race_categories')
      .update(updates)
      .eq('id', categoryId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Category not found' });

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error updating category:', err);
    res.status(500).json({ error: 'Failed to update race category' });
  }
};
