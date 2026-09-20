import supabase from '../config/supabase.js';

/**
 * Results Controller
 * Covers §8 (Race Results & Discipline Splits) and §14 (Results Ingestion)
 */

export const getResults = async (req, res) => {
  try {
    const { page, limit, offset } = req.pagination || { page: 1, limit: 50, offset: 0 };
    const { category, search } = req.query;
    let query = supabase
      .from('triathlon_results')
      .select('*, profiles:user_id (full_name)', { count: 'exact' })
      .order('rank_overall', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (category) query = query.eq('category_slug', category);
    if (search) {
      query = query.or(`athlete_name.ilike.%${search}%,bib_number.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching results:', err);
    res.status(500).json({ error: 'Failed to retrieve results' });
  }
};

/**
 * §8 Per-discipline & overall leaderboards:
 * board: 'overall' | 'performance' | 'swim' | 'bike' | 'run' | 'community' | 'participation'
 */
export const getLeaderboard = async (req, res) => {
  try {
    const { board = 'performance', limit = 20, category } = req.query;
    let data, error;
    const maxRows = parseInt(limit) || 20;

    if (board === 'performance' || board === 'overall') {
      let query = supabase
        .from('triathlon_results')
        .select('rank_overall, rank_category, rank_gender, total_time_seconds, swim_time_seconds, t1_time_seconds, bike_time_seconds, t2_time_seconds, run_time_seconds, athlete_name, bib_number, category_slug, profiles:user_id (full_name)')
        .not('total_time_seconds', 'is', null)
        .eq('status', 'finished')
        .order('rank_overall', { ascending: true, nullsFirst: false })
        .limit(maxRows);
      if (category) query = query.eq('category_slug', category);
      ({ data, error } = await query);
    } else if (board === 'swim') {
      let query = supabase
        .from('triathlon_results')
        .select('rank_overall, rank_category, swim_time_seconds, total_time_seconds, athlete_name, bib_number, category_slug, profiles:user_id (full_name)')
        .not('swim_time_seconds', 'is', null)
        .gt('swim_time_seconds', 0)
        .order('swim_time_seconds', { ascending: true })
        .limit(maxRows);
      if (category) query = query.eq('category_slug', category);
      ({ data, error } = await query);
    } else if (board === 'bike') {
      let query = supabase
        .from('triathlon_results')
        .select('rank_overall, rank_category, bike_time_seconds, total_time_seconds, athlete_name, bib_number, category_slug, profiles:user_id (full_name)')
        .not('bike_time_seconds', 'is', null)
        .gt('bike_time_seconds', 0)
        .order('bike_time_seconds', { ascending: true })
        .limit(maxRows);
      if (category) query = query.eq('category_slug', category);
      ({ data, error } = await query);
    } else if (board === 'run') {
      let query = supabase
        .from('triathlon_results')
        .select('rank_overall, rank_category, run_time_seconds, total_time_seconds, athlete_name, bib_number, category_slug, profiles:user_id (full_name)')
        .not('run_time_seconds', 'is', null)
        .gt('run_time_seconds', 0)
        .order('run_time_seconds', { ascending: true })
        .limit(maxRows);
      if (category) query = query.eq('category_slug', category);
      ({ data, error } = await query);
    } else if (board === 'community' || board === 'teams') {
      ({ data, error } = await supabase
        .from('teams')
        .select('name, slug, team_type, is_relay, member_count, captain:captain_id (full_name)')
        .order('member_count', { ascending: false })
        .limit(maxRows));
    } else if (board === 'participation') {
      ({ data, error } = await supabase
        .from('registrations')
        .select('profiles:user_id (full_name), activity_slug, created_at')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(maxRows));
    } else {
      return res.status(400).json({
        error: 'Invalid board type. Use: overall, performance, swim, bike, run, community, or participation'
      });
    }

    if (error) throw error;
    res.json({ success: true, board, category: category || 'all', data: data || [] });
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ error: 'Failed to retrieve leaderboard' });
  }
};

export const getMyResult = async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });
    const { data, error } = await supabase
      .from('triathlon_results')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error fetching my result:', err);
    res.status(500).json({ error: 'Failed to retrieve your result' });
  }
};

// ── Helper: parse time strings (e.g. "01:23:45" or "23:45" or raw seconds) ──
function parseTimeToSeconds(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') return Math.round(val);
  const str = String(val).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

/**
 * §14 Ingest Results (JSON Array or single result object)
 * POST /api/v1/results
 * POST /api/v1/results/batch
 * Requires admin.
 */
export const ingestResults = async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : (req.body.results || [req.body]);
    if (!payload || payload.length === 0) {
      return res.status(400).json({ error: 'No results data provided' });
    }

    const records = [];
    for (const item of payload) {
      const bib = String(item.bib_number || item.bib || '').trim();
      const athlete = String(item.athlete_name || item.athlete || item.name || '').trim();
      const category = String(item.category_slug || item.category || 'olympic-individual').trim();

      if (!bib || !athlete) continue;

      const swim = parseTimeToSeconds(item.swim_time_seconds ?? item.swim);
      const t1 = parseTimeToSeconds(item.t1_time_seconds ?? item.t1);
      const bike = parseTimeToSeconds(item.bike_time_seconds ?? item.bike);
      const t2 = parseTimeToSeconds(item.t2_time_seconds ?? item.t2);
      const run = parseTimeToSeconds(item.run_time_seconds ?? item.run);
      let total = parseTimeToSeconds(item.total_time_seconds ?? item.total);

      // Auto-compute total if omitted but splits exist
      if (total == null && swim != null && bike != null && run != null) {
        total = swim + (t1 || 0) + bike + (t2 || 0) + run;
      }

      records.push({
        bib_number: bib,
        athlete_name: athlete,
        category_slug: category,
        user_id: item.user_id || null,
        swim_time_seconds: swim,
        t1_time_seconds: t1,
        bike_time_seconds: bike,
        t2_time_seconds: t2,
        run_time_seconds: run,
        total_time_seconds: total,
        rank_overall: item.rank_overall ? parseInt(item.rank_overall, 10) : null,
        rank_category: item.rank_category ? parseInt(item.rank_category, 10) : null,
        rank_gender: item.rank_gender ? parseInt(item.rank_gender, 10) : null,
        status: ['finished', 'dnf', 'dns', 'disqualified'].includes(item.status) ? item.status : 'finished'
      });
    }

    if (records.length === 0) {
      return res.status(400).json({ error: 'Valid results must include bib_number and athlete_name' });
    }

    // Auto-link user_id from digital_bibs if user_id was not provided
    const bibNumbers = records.filter(r => !r.user_id).map(r => r.bib_number);
    if (bibNumbers.length > 0) {
      const { data: bibMatches } = await supabase
        .from('digital_bibs')
        .select('bib_number, user_id')
        .in('bib_number', bibNumbers);

      if (bibMatches && bibMatches.length > 0) {
        const bibMap = new Map(bibMatches.map(b => [b.bib_number, b.user_id]));
        for (const rec of records) {
          if (!rec.user_id && bibMap.has(rec.bib_number)) {
            rec.user_id = bibMap.get(rec.bib_number);
          }
        }
      }
    }

    // Delete existing records with matching bib numbers then insert cleanly
    const bibList = records.map(r => r.bib_number);
    if (bibList.length > 0) {
      await supabase.from('triathlon_results').delete().in('bib_number', bibList);
    }
    const { data: inserted, error } = await supabase
      .from('triathlon_results')
      .insert(records)
      .select();

    if (error) throw error;

    await supabase.from('audit_logs').insert([{
      action: 'INGEST_TRIATHLON_RESULTS',
      target_resource: 'triathlon_results',
      details_json: { count: records.length, bibs: records.map(r => r.bib_number) },
      actor_role: req.user?.role || 'admin',
      actor_profile_id: req.user?.id || null
    }]);

    res.status(201).json({
      success: true,
      message: `Successfully ingested ${records.length} race results`,
      count: records.length,
      data: inserted
    });
  } catch (err) {
    console.error('Error ingesting results:', err);
    res.status(500).json({ error: 'Failed to ingest results: ' + err.message });
  }
};

/**
 * §14 Ingest Results via CSV
 * POST /api/v1/results/csv
 * Accepts plain text CSV or { csv: "bib,athlete,category,swim,t1,bike,t2,run,total,status\n..." }
 * Requires admin.
 */
export const ingestResultsCsv = async (req, res) => {
  try {
    let csvText = typeof req.body === 'string' ? req.body : (req.body?.csv || req.body?.data);
    if (!csvText || typeof csvText !== 'string') {
      return res.status(400).json({ error: 'CSV string content is required in body or as { csv: "..." }' });
    }

    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV must contain a header row and at least one data row' });
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
      const row = {};
      headers.forEach((h, idx) => { row[h] = cols[idx]; });

      const bib = row.bib_number || row.bib;
      const athlete = row.athlete_name || row.athlete || row.name;
      if (!bib || !athlete) continue;

      const swim = parseTimeToSeconds(row.swim || row.swim_time);
      const t1 = parseTimeToSeconds(row.t1 || row.t1_time);
      const bike = parseTimeToSeconds(row.bike || row.bike_time);
      const t2 = parseTimeToSeconds(row.t2 || row.t2_time);
      const run = parseTimeToSeconds(row.run || row.run_time);
      let total = parseTimeToSeconds(row.total || row.total_time);

      if (total == null && swim != null && bike != null && run != null) {
        total = swim + (t1 || 0) + bike + (t2 || 0) + run;
      }

      records.push({
        bib_number: String(bib),
        athlete_name: athlete,
        category_slug: row.category_slug || row.category || 'olympic-individual',
        swim_time_seconds: swim,
        t1_time_seconds: t1,
        bike_time_seconds: bike,
        t2_time_seconds: t2,
        run_time_seconds: run,
        total_time_seconds: total,
        rank_overall: row.rank_overall ? parseInt(row.rank_overall, 10) : null,
        rank_category: row.rank_category ? parseInt(row.rank_category, 10) : null,
        rank_gender: row.rank_gender ? parseInt(row.rank_gender, 10) : null,
        status: ['finished', 'dnf', 'dns', 'disqualified'].includes(row.status) ? row.status : 'finished'
      });
    }

    if (records.length === 0) {
      return res.status(400).json({ error: 'No valid rows found in CSV' });
    }

    // Auto-link user_id from digital_bibs
    const bibNumbers = records.map(r => r.bib_number);
    const { data: bibMatches } = await supabase
      .from('digital_bibs')
      .select('bib_number, user_id')
      .in('bib_number', bibNumbers);

    if (bibMatches && bibMatches.length > 0) {
      const bibMap = new Map(bibMatches.map(b => [b.bib_number, b.user_id]));
      for (const rec of records) {
        if (bibMap.has(rec.bib_number)) {
          rec.user_id = bibMap.get(rec.bib_number);
        }
      }
    }

    const bibList = records.map(r => r.bib_number);
    if (bibList.length > 0) {
      await supabase.from('triathlon_results').delete().in('bib_number', bibList);
    }
    const { data: inserted, error } = await supabase
      .from('triathlon_results')
      .insert(records)
      .select();

    if (error) throw error;

    await supabase.from('audit_logs').insert([{
      action: 'INGEST_TRIATHLON_RESULTS_CSV',
      target_resource: 'triathlon_results',
      details_json: { count: records.length, rowsParsed: lines.length - 1 },
      actor_role: req.user?.role || 'admin',
      actor_profile_id: req.user?.id || null
    }]);

    res.status(201).json({
      success: true,
      message: `Successfully imported ${records.length} results from CSV`,
      count: records.length,
      data: inserted
    });
  } catch (err) {
    console.error('Error ingesting results CSV:', err);
    res.status(500).json({ error: 'Failed to import CSV: ' + err.message });
  }
};

/**
 * PATCH /api/v1/results/:id
 * Update an individual result record. Requires admin.
 */
export const updateResult = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    delete updates.id;

    if (updates.swim_time_seconds !== undefined) updates.swim_time_seconds = parseTimeToSeconds(updates.swim_time_seconds);
    if (updates.bike_time_seconds !== undefined) updates.bike_time_seconds = parseTimeToSeconds(updates.bike_time_seconds);
    if (updates.run_time_seconds !== undefined) updates.run_time_seconds = parseTimeToSeconds(updates.run_time_seconds);
    if (updates.total_time_seconds !== undefined) updates.total_time_seconds = parseTimeToSeconds(updates.total_time_seconds);

    const { data, error } = await supabase
      .from('triathlon_results')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Result not found' });

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error updating result:', err);
    res.status(500).json({ error: 'Failed to update result' });
  }
};

/**
 * DELETE /api/v1/results/:id
 * Delete a result record. Requires admin.
 */
export const deleteResult = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('triathlon_results')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'Result deleted successfully' });
  } catch (err) {
    console.error('Error deleting result:', err);
    res.status(500).json({ error: 'Failed to delete result' });
  }
};
