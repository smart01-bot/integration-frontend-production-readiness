import supabase from '../config/supabase.js';

// Schema: migration 017 `digital_bibs`:
// user_id, bib_number (TEXT UNIQUE), athlete_name (NOT NULL),
// category_name (NOT NULL), team_name, qr_code_data (NOT NULL),
// rendered_image_url, share_slug (UNIQUE NOT NULL), is_claimed.

/**
 * Helper: auto-generate a digital bib for a user if they don't have one
 */
export const autoIssueBibForUser = async ({
  userId,
  bibNumber,
  athleteName,
  categoryName,
  teamName
}) => {
  try {
    if (!userId) return null;

    // Check if user already has a bib
    const { data: existing } = await supabase
      .from('digital_bibs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) return existing;

    // Resolve athlete name if missing
    let resolvedName = athleteName;
    if (!resolvedName) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle();
      resolvedName = prof?.full_name || 'Athlete';
    }

    // Resolve or generate bib number
    let bib = bibNumber;
    if (!bib) {
      // Check if user has an assigned bib in registrations or tickets
      const { data: reg } = await supabase
        .from('registrations')
        .select('bib_number, activity_slug')
        .eq('user_id', userId)
        .not('bib_number', 'is', null)
        .maybeSingle();

      if (reg?.bib_number) {
        bib = reg.bib_number;
      } else {
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        bib = String(randomNum);
      }
    }

    const share_slug = 'bib-' + String(bib).toLowerCase() + '-' + Date.now().toString(36);
    const qr_code_data = JSON.stringify({
      type: 'tour-de-dar-bib',
      bib_number: String(bib),
      share_slug
    });

    const { data, error } = await supabase
      .from('digital_bibs')
      .upsert(
        {
          user_id: userId,
          bib_number: String(bib),
          athlete_name: resolvedName,
          category_name: categoryName || 'Triathlon',
          team_name: teamName || null,
          share_slug,
          qr_code_data,
          is_claimed: true
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('Error in autoIssueBibForUser:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('autoIssueBibForUser error:', err);
    return null;
  }
};

export const getBib = async (req, res) => {
  try {
    const { identifier } = req.params;
    let query = supabase.from('digital_bibs').select('*, profiles:user_id (full_name)');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
      query = query.eq('user_id', identifier);
    } else if (/^\d+$/.test(identifier)) {
      query = query.eq('bib_number', identifier);
    } else {
      query = query.eq('share_slug', identifier);
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Bib not found' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error fetching bib:', err);
    res.status(500).json({ error: 'Failed to retrieve bib' });
  }
};

/**
 * GET /api/v1/bibs/me
 * Returns caller's digital bib. If participant registered or has a ticket
 * but lacks a digital bib row, auto-issues one so they are never left without one (§6).
 */
export const getMyBib = async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });

    let { data, error } = await supabase
      .from('digital_bibs')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();

    if (error) throw error;

    // If no bib exists, check if user is registered/ticketed and auto-provision
    if (!data) {
      const [regRes, ticketRes, profileRes] = await Promise.all([
        supabase.from('registrations').select('*').eq('user_id', user_id).maybeSingle(),
        supabase.from('tickets').select('*').eq('profile_id', user_id).maybeSingle(),
        supabase.from('profiles').select('full_name').eq('id', user_id).maybeSingle()
      ]);

      const reg = regRes.data;
      const ticket = ticketRes.data;
      const profile = profileRes.data;

      if (reg || ticket) {
        const bibNum = ticket?.bib_number || reg?.bib_number || ('0' + Math.floor(1000 + Math.random() * 9000));
        const catName = reg?.activity_slug || 'Olympic Triathlon';
        data = await autoIssueBibForUser({
          userId: user_id,
          bibNumber: bibNum,
          athleteName: profile?.full_name || 'Athlete',
          categoryName: catName
        });
      }
    }

    if (!data) {
      return res.status(404).json({
        error: 'No bib found. Register for the event to receive your digital bib identity.'
      });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error fetching my bib:', err);
    res.status(500).json({ error: 'Failed to retrieve your bib' });
  }
};

/**
 * POST /api/v1/bibs/generate
 * Issues a bib for a participant.
 * Allowed for:
 *   - Admins/staff for any user_id
 *   - Authenticated participants generating their own bib (user_id === req.user.id)
 */
export const generateBib = async (req, res) => {
  try {
    let { user_id, bib_number, athlete_name, category_name, team_name } = req.body || {};
    const callerId = req.user?.id;
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'hq_admin';

    // If caller is not staff, force user_id to caller's own ID
    if (!isStaff) {
      user_id = callerId;
    } else if (!user_id) {
      user_id = callerId;
    }

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_id)) {
      return res.status(400).json({ error: 'user_id must be a UUID' });
    }

    if (!athlete_name) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user_id)
        .maybeSingle();
      athlete_name = prof?.full_name || 'Athlete';
    }

    if (!bib_number) {
      bib_number = '0' + Math.floor(1000 + Math.random() * 9000);
    }

    if (!category_name) {
      category_name = 'Olympic Triathlon';
    }

    const share_slug = 'bib-' + String(bib_number).toLowerCase() + '-' + Date.now().toString(36);
    const qr_code_data = JSON.stringify({
      type: 'tour-de-dar-bib',
      bib_number: String(bib_number),
      share_slug
    });

    const { data, error } = await supabase
      .from('digital_bibs')
      .upsert(
        {
          user_id,
          bib_number: String(bib_number),
          athlete_name,
          category_name,
          team_name: team_name || null,
          share_slug,
          qr_code_data,
          is_claimed: true
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That bib number is already taken' });
      }
      throw error;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('Error generating bib:', err);
    res.status(500).json({ error: 'Failed to generate bib' });
  }
};

/**
 * POST /api/v1/bibs/claim
 * POST /api/v1/bibs/claim/:bibNumber
 * Claim a pre-assigned or unclaimed bib
 */
export const claimBib = async (req, res) => {
  try {
    const bibNumber = req.params.bibNumber || req.body.bib_number;
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });
    if (!bibNumber) return res.status(400).json({ error: 'bib_number is required' });

    // Find bib by number
    const { data: bib, error: findError } = await supabase
      .from('digital_bibs')
      .select('*')
      .eq('bib_number', String(bibNumber))
      .maybeSingle();

    if (findError) throw findError;
    if (!bib) {
      return res.status(404).json({ error: `Bib #${bibNumber} not found` });
    }

    if (bib.is_claimed && bib.user_id && bib.user_id !== user_id) {
      return res.status(409).json({ error: `Bib #${bibNumber} has already been claimed by another athlete` });
    }

    const { data: updated, error: updateError } = await supabase
      .from('digital_bibs')
      .update({
        user_id,
        is_claimed: true
      })
      .eq('id', bib.id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      message: `Bib #${bibNumber} claimed successfully`,
      data: updated
    });
  } catch (err) {
    console.error('Error claiming bib:', err);
    res.status(500).json({ error: 'Failed to claim bib' });
  }
};

/**
 * POST /api/v1/bibs/batch
 * Admin batch generation of digital bibs.
 */
export const batchGenerateBibs = async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body.bibs;
    if (!items || !items.length) {
      return res.status(400).json({ error: 'Array of bib records required' });
    }

    const generated = [];
    for (const item of items) {
      if (!item.user_id) continue;
      const res = await autoIssueBibForUser({
        userId: item.user_id,
        bibNumber: item.bib_number,
        athleteName: item.athlete_name,
        categoryName: item.category_name,
        teamName: item.team_name
      });
      if (res) generated.push(res);
    }

    res.status(201).json({
      success: true,
      count: generated.length,
      data: generated
    });
  } catch (err) {
    console.error('Error batch generating bibs:', err);
    res.status(500).json({ error: 'Failed to batch generate bibs' });
  }
};
