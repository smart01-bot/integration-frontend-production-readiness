import { supabase } from '../config/supabase.js';

/**
 * Ticket Controller
 * Production gate check-in and QR ticket retrieval
 */

export const getMyTickets = async (req, res) => {
  try {
    const userEmail = req.user.email;

    // tickets has two FKs to profiles (profile_id + checked_in_by):
    // the embed must be disambiguated or PostgREST rejects it as ambiguous.
    let query = supabase
      .from('tickets')
      .select(`
        id,
        bib_number,
        qr_verification_token,
        checked_in,
        checked_in_at,
        check_in_station,
        race_categories:race_categories!activity_id (
          name,
          slug,
          format,
          description
        ),
        profiles:profile_id (
          full_name,
          tshirt_size
        )
      `)
      .order('created_at', { ascending: false });

    // Fail CLOSED, not open: if there's no email to resolve an identity
    // from, we must not fall through and run `query` unfiltered — that
    // previously returned every ticket for every participant (including
    // bib_number and qr_verification_token, the token used at gate
    // check-in) to whoever hit this endpoint with a session that had no
    // resolvable email.
    if (!userEmail) {
      return res.status(403).json({ error: 'Unable to resolve participant identity' });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', userEmail)
      .maybeSingle();

    if (!profile) {
      return res.status(200).json({
        status: 'success',
        count: 0,
        data: []
      });
    }

    query = query.eq('profile_id', profile.id);

    const { data: tickets, error } = await query;

    if (error) {
      console.error('Error fetching tickets:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: tickets ? tickets.length : 0,
      data: tickets || []
    });
  } catch (error) {
    console.error('getMyTickets exception:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const getTicketByQrToken = async (req, res) => {
  try {
    const { qr_token } = req.params;

    if (!qr_token) {
      return res.status(400).json({ error: 'QR verification token is required' });
    }

    const { data: ticket, error } = await supabase
      .from('tickets')
      .select(`
        id,
        bib_number,
        qr_verification_token,
        checked_in,
        checked_in_at,
        check_in_station,
        race_categories:race_categories!activity_id (name, slug, format, description),
        profiles:profile_id (full_name, tshirt_size)
      `)
      .eq('qr_verification_token', qr_token)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found for provided QR token' });
    }

    return res.status(200).json({
      status: 'success',
      data: ticket
    });
  } catch (error) {
    console.error('getTicketByQrToken exception:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const checkInTicket = async (req, res) => {
  try {
    const { qr_token, station_name = 'Gate 1 (Waterfront Arch)' } = req.body;

    if (!qr_token) {
      return res.status(400).json({ error: 'QR token is required for check-in' });
    }

    // 1. Fetch ticket from database
    const { data: ticket, error } = await supabase
      .from('tickets')
      .select(`
        id,
        bib_number,
        checked_in,
        checked_in_at,
        check_in_station,
        profiles:profile_id (full_name)
      `)
      .eq('qr_verification_token', qr_token)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!ticket) {
      return res.status(404).json({ error: 'Invalid QR token. Ticket not found in registry.' });
    }

    // 2. Prevent duplicate check-ins
    if (ticket.checked_in) {
      return res.status(409).json({
        error: 'Ticket already checked in',
        bib_number: ticket.bib_number,
        participant_name: ticket.profiles?.full_name,
        checked_in_at: ticket.checked_in_at,
        check_in_station: ticket.check_in_station
      });
    }

    // 3. Mark ticket checked-in
    const checkInTime = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('tickets')
      .update({
        checked_in: true,
        checked_in_at: checkInTime,
        check_in_station: station_name
      })
      .eq('id', ticket.id)
      .select(`
        id,
        bib_number,
        checked_in,
        checked_in_at,
        check_in_station,
        profiles:profile_id (full_name)
      `)
      .single();

    if (updateError) {
      return res.status(500).json({ error: 'Failed to record check-in' });
    }

    return res.status(200).json({
      status: 'success',
      message: `Check-in confirmed for BIB #${updated.bib_number}`,
      ticket: updated
    });
  } catch (error) {
    console.error('checkInTicket exception:', error);
    return res.status(500).json({ error: 'Internal server error during check-in' });
  }
};
