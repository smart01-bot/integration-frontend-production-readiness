import { supabase } from '../config/supabase.js';
import crypto from 'crypto';
import { buildTwibbonComposition } from './socialController.js';

const VALID_TIERS = ['Finisher', 'Podium_1st', 'Podium_2nd', 'Podium_3rd', 'Century_Club', 'VIP_Ambassador'];

/**
 * Digital Collectible Controller - Tamper-proof certificate verification
 * Validates finisher certificates via unique verification hash on Polygon / Supabase
 */
export const getMyCollectible = async (req, res) => {
  try {
    const userEmail = req.user.email;

    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', userEmail)
      .maybeSingle();

    if (!profile) {
      return res.status(200).json({
        status: 'success',
        message: 'No profile found for athlete.',
        data: null
      });
    }

    const { data: collectibles, error } = await supabase
      .from('digital_collectibles')
      .select(`
        id,
        serial_number,
        tier,
        finish_time_seconds,
        public_verification_hash,
        certificate_pdf_url,
        on_chain_network,
        on_chain_tx_hash,
        issued_at,
        profiles ( full_name ),
        activities ( title, category, distance_km )
      `)
      .eq('profile_id', profile.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!collectibles || collectibles.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'No finisher certificates issued yet for this athlete.',
        data: null
      });
    }

    return res.status(200).json({
      status: 'success',
      data: collectibles[0]
    });
  } catch (error) {
    console.error('getMyCollectible exception:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Flat alias for the frontend's expected POST /api/v1/collectibles/frame
 * (src/lib/api.ts: frameApi.generate). Reuses the same identity-verified
 * composition logic as /api/v1/social/twibbon/generate — see that function
 * for why identity is always resolved server-side, never trusted from the
 * caller. There is no separate image-hosting step in this backend, so
 * frameUrl/thumbnailUrl are both the same inline SVG data URI, which is a
 * valid <img src> value and can be rendered directly by the frontend.
 */
export const generateFrame = async (req, res) => {
  try {
    const { activity: frameId, photoBase64 } = req.body;
    const result = await buildTwibbonComposition({
      userId: req.user.id,
      frameId,
      photoUrl: photoBase64 || null
    });

    return res.status(200).json({
      frameUrl: result.svgDataUri,
      thumbnailUrl: result.svgDataUri
    });
  } catch (error) {
    if (error && error.status) {
      return res.status(error.status).json({ error: error.error });
    }
    console.error('generateFrame exception:', error);
    return res.status(500).json({ error: 'Failed to generate frame' });
  }
};

/**
 * Matches the frontend's expected POST /api/v1/collectibles/issue
 * (src/lib/api.ts: collectiblesApi.issue). Admin-only — a participant must
 * never be able to award themselves a finisher badge. Requires the target
 * profile to have an actual checked-in ticket; a collectible can't be
 * issued for participation that never happened.
 */
export const issueCollectible = async (req, res) => {
  try {
    const { userId, badgeId } = req.body;

    if (!userId || !badgeId) {
      return res.status(400).json({ error: 'userId and badgeId are required' });
    }
    if (!VALID_TIERS.includes(badgeId)) {
      return res.status(400).json({ error: `badgeId must be one of: ${VALID_TIERS.join(', ')}` });
    }

    // Accept either a profiles.id or a Supabase auth_user_id for userId
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id')
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
      .maybeSingle();

    if (profileErr) {
      return res.status(500).json({ error: 'Failed to look up participant' });
    }
    if (!profile) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    // tickets.activity_id has NO FK to activities — embed would fail (PGRST200).
    // Fetch the ticket, then resolve the edition in a second query.
    const { data: ticket, error: ticketErr } = await supabase
      .from('tickets')
      .select('activity_id')
      .eq('profile_id', profile.id)
      .eq('checked_in', true)
      .limit(1)
      .maybeSingle();

    if (ticketErr) {
      return res.status(500).json({ error: 'Failed to verify participation' });
    }
    if (!ticket) {
      return res.status(400).json({ error: 'This participant has no checked-in ticket — cannot issue a finisher collectible' });
    }

    let editionId = null;
    if (ticket.activity_id) {
      const { data: act } = await supabase
        .from('activities')
        .select('edition_id')
        .eq('id', ticket.activity_id)
        .maybeSingle();
      editionId = act?.edition_id || null;
    }

    const serialNumber = `TDR2026-${badgeId.toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const verificationHash = crypto.randomBytes(16).toString('hex');

    const { error: insertErr } = await supabase
      .from('digital_collectibles')
      .insert([{
        profile_id: profile.id,
        edition_id: editionId,
        activity_id: ticket.activity_id,
        serial_number: serialNumber,
        tier: badgeId,
        public_verification_hash: verificationHash
      }]);

    if (insertErr) {
      console.error('issueCollectible insert failed:', insertErr.message);
      return res.status(500).json({ error: 'Failed to issue collectible' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('issueCollectible exception:', error);
    return res.status(500).json({ error: 'Failed to issue collectible' });
  }
};

export const verifyCertificateByHash = async (req, res) => {
  try {
    const { hash } = req.params;
    if (!hash) {
      return res.status(400).json({ error: 'Verification hash is required' });
    }

    const { data: collectible, error } = await supabase
      .from('digital_collectibles')
      .select(`
        id,
        serial_number,
        tier,
        finish_time_seconds,
        public_verification_hash,
        certificate_pdf_url,
        on_chain_network,
        on_chain_tx_hash,
        issued_at,
        profiles ( full_name ),
        activities ( title, distance_km )
      `)
      .eq('public_verification_hash', hash)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!collectible) {
      return res.status(404).json({
        verified: false,
        status: 'invalid',
        message: 'Certificate hash not found in official event registry',
        public_verification_hash: hash
      });
    }

    return res.status(200).json({
      verified: true,
      status: 'verified',
      message: 'Official Tour de Rotary DSM 2026 Verified Finisher Certificate',
      certificate: {
        id: collectible.id,
        serial_number: collectible.serial_number,
        tier: collectible.tier,
        finish_time: collectible.finish_time_seconds,
        public_verification_hash: collectible.public_verification_hash,
        certificate_pdf_url: collectible.certificate_pdf_url,
        on_chain_network: collectible.on_chain_network,
        on_chain_tx_hash: collectible.on_chain_tx_hash,
        athlete_name: collectible.profiles?.full_name,
        activity_title: collectible.activities?.title,
        issued_at: collectible.issued_at
      }
    });
  } catch (error) {
    console.error('verifyCertificateByHash exception:', error);
    return res.status(500).json({ error: 'Internal server error during verification' });
  }
};
