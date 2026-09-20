import { supabase } from '../config/supabase.js';
import crypto from 'crypto';

/**
 * Participant Controller
 * 100% Database-backed self-service participant endpoints.
 *
 * Identity convention: middleware/auth.js already resolves the caller's
 * profiles row (accepting both lookup conventions) and sets req.user.id to
 * profiles.id — the primary key every commerce table references. All
 * lookups here key on that id directly instead of re-resolving by email,
 * which failed for profiles whose email changed or whose auth_user_id was
 * linked later (migration 007 edge case).
 */

export const getParticipantProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!profile) {
      return res.status(404).json({ error: 'Participant profile not found' });
    }

    // §5 Digital Home Aggregations:
    // 1. Registered tickets count
    // 2. Orders count
    // 3. Digital bib
    // 4. Team membership
    // 5. Challenges joined & completed
    // 6. Triathlon race results
    // 7. Community activity counts (posts, comments, stories)
    const [
      ticketCountRes,
      orderCountRes,
      bibRes,
      teamMemberRes,
      challengesRes,
      resultRes,
      postsCountRes,
      storiesCountRes
    ] = await Promise.all([
      supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('profile_id', userId),
      supabase.from('orders').select('id', { count: 'exact', head: true }).or(`profile_id.eq.${userId},user_id.eq.${userId}`),
      supabase.from('digital_bibs').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('team_members').select('role, joined_at, teams(id, name, slug, team_type, is_relay, logo_url)').eq('user_id', userId).maybeSingle(),
      supabase.from('user_challenges').select('status, completed_at, progress_value, challenges(id, title, badge_name, badge_icon, discipline)').eq('user_id', userId),
      supabase.from('triathlon_results').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('community_posts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('why_i_participate').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    ]);

    const userChallenges = challengesRes.data || [];
    const completedChallenges = userChallenges.filter(c => c.status === 'completed');

    return res.status(200).json({
      status: 'success',
      data: {
        ...profile,
        registered_activities_count: ticketCountRes.count || 0,
        orders_count: orderCountRes.count || 0,
        digital_bib: bibRes.data || null,
        team: teamMemberRes.data ? {
          role: teamMemberRes.data.role,
          joined_at: teamMemberRes.data.joined_at,
          ...(teamMemberRes.data.teams || {})
        } : null,
        challenges: {
          total_joined: userChallenges.length,
          completed_count: completedChallenges.length,
          badges: completedChallenges.map(c => ({
            challenge_id: c.challenges?.id,
            challenge_title: c.challenges?.title,
            badge_name: c.challenges?.badge_name,
            badge_icon: c.challenges?.badge_icon,
            discipline: c.challenges?.discipline,
            completed_at: c.completed_at
          }))
        },
        race_result: resultRes.data || null,
        activity: {
          posts_count: postsCountRes.count || 0,
          stories_count: storiesCountRes.count || 0
        }
      }
    });
  } catch (error) {
    console.error('getParticipantProfile exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve participant profile' });
  }
};

export const updateParticipantProfile = async (req, res) => {
  try {
    const { tshirt_size, emergency_contact, fitness_sharing_opt_in } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (tshirt_size !== undefined) updates.tshirt_size = tshirt_size;
    if (emergency_contact !== undefined) updates.emergency_contact = emergency_contact;
    if (fitness_sharing_opt_in !== undefined) updates.fitness_sharing_opt_in = fitness_sharing_opt_in;

    const { data: updated, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('updateParticipantProfile exception:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
};

export const getParticipantOrders = async (req, res) => {
  try {
    // profile_id covers backend-created orders; user_id covers orders the
    // frontend created via Supabase using the auth-user id (migration 006).
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .or(`profile_id.eq.${req.user.id},user_id.eq.${req.user.id}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getParticipantOrders query failed:', error.message);
      return res.status(500).json({ error: 'Failed to retrieve order history' });
    }

    return res.status(200).json({
      status: 'success',
      count: orders ? orders.length : 0,
      data: orders || []
    });
  } catch (error) {
    console.error('getParticipantOrders exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve order history' });
  }
};

export const getParticipantTickets = async (req, res) => {
  try {
    const { data: tickets, error } = await supabase
      .from('tickets')
      .select('*, activities(*)')
      .eq('profile_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: tickets ? tickets.length : 0,
      data: tickets || []
    });
  } catch (error) {
    console.error('getParticipantTickets exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve participant tickets' });
  }
};

export const getParticipantTraining = async (req, res) => {
  try {
    // Honest empty state: the Strava integration is deferred per Schedule
    // A11 and no training-activity store exists yet, so weekly stats are
    // genuinely zero — never fabricated numbers.
    const { data: profile } = await supabase
      .from('profiles')
      .select('fitness_sharing_opt_in')
      .eq('id', req.user.id)
      .maybeSingle();

    return res.status(200).json({
      status: 'success',
      opt_in_active: profile?.fitness_sharing_opt_in || false,
      integration_status: 'PENDING_THIRD_PARTY_APPROVAL',
      weekly_stats: {
        total_kms_completed: 0,
        target_kms: 60,
        completion_percent: 0,
        rides_count: 0,
        avg_speed_kmh: 0,
        longest_ride_km: 0
      },
      message: 'Training sync activates once the Strava/Health Connect integration is approved (Schedule A11).'
    });
  } catch (error) {
    console.error('getParticipantTrainingProgress exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve training progress' });
  }
};

export const getParticipantCertificates = async (req, res) => {
  try {
    const { data: certificates, error } = await supabase
      .from('digital_collectibles')
      .select('*, activities(title, category, distance_km)')
      .eq('profile_id', req.user.id)
      .order('issued_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Expose the schema column (finish_time_seconds) under the
    // finish_time alias the portal expects, without selecting a
    // nonexistent column.
    const data = (certificates || []).map(c => ({
      ...c,
      finish_time: c.finish_time_seconds ?? null
    }));

    return res.status(200).json({
      status: 'success',
      count: data.length,
      data
    });
  } catch (error) {
    console.error('getParticipantCertificates exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve certificates' });
  }
};

export const getParticipantWishlist = async (req, res) => {
  try {
    const { data: wishlistItems, error } = await supabase
      .from('participant_wishlist')
      .select('id, variant_id, created_at, product_variants(*)')
      .eq('profile_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: wishlistItems ? wishlistItems.length : 0,
      data: wishlistItems || []
    });
  } catch (error) {
    console.error('getParticipantWishlist exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve wishlist' });
  }
};

export const toggleWishlistItem = async (req, res) => {
  try {
    const { variant_id } = req.body;

    if (!variant_id) {
      return res.status(400).json({ error: 'variant_id is required' });
    }

    // Check if exists
    const { data: existing } = await supabase
      .from('participant_wishlist')
      .select('id')
      .eq('profile_id', req.user.id)
      .eq('variant_id', variant_id)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('participant_wishlist')
        .delete()
        .eq('id', existing.id);

      return res.status(200).json({
        status: 'success',
        message: 'Item removed from wishlist',
        in_wishlist: false
      });
    }

    const { data: inserted, error: insErr } = await supabase
      .from('participant_wishlist')
      .insert([{ profile_id: req.user.id, variant_id }])
      .select()
      .single();

    if (insErr) {
      return res.status(500).json({ error: insErr.message });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Item added to wishlist',
      in_wishlist: true,
      data: inserted
    });
  } catch (error) {
    console.error('toggleWishlistItem exception:', error);
    return res.status(500).json({ error: 'Failed to toggle wishlist item' });
  }
};

export const getParticipantOrderTracking = async (req, res) => {
  try {
    const { order_id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .or(`id.eq.${order_id},order_number.eq.${order_id}`)
      .maybeSingle();

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Ownership check: participants may only track their own orders.
    // Volunteers/admins (pickup desk staff) may track any order.
    const isOwner = order.profile_id === req.user.id || order.user_id === req.user.id;
    const isStaff = req.user.role === 'volunteer' || req.user.role === 'admin';
    if (!isOwner && !isStaff) {
      return res.status(403).json({ error: 'You do not have access to this order' });
    }

    return res.status(200).json({
      status: 'success',
      order_number: order.order_number,
      delivery_type: 'pickup',
      pickup_station: 'Dar es Salaam Gymkhana Club Official Expo Booth',
      pickup_window: 'Friday 30 Oct - Saturday 31 Oct 2026 (09:00 - 18:00)',
      logistics_status: order.delivery_status || (order.status === 'paid' ? 'READY_FOR_PICKUP' : 'PENDING_PAYMENT'),
      paid: order.status === 'paid',
      collected_at: order.picked_up_at || null
    });
  } catch (error) {
    console.error('getParticipantOrderTracking exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve order tracking' });
  }
};

export const confirmMerchandisePickup = async (req, res) => {
  try {
    const { order_id } = req.params;
    const { scanned_by_marshall_id = 'VOL-MARSHALL-01' } = req.body;

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from('orders')
      .update({
        delivery_status: 'collected',
        picked_up_at: now,
        notes: `Collected at Expo Desk. Scanned by ${scanned_by_marshall_id}`
      })
      .or(`id.eq.${order_id},order_number.eq.${order_id}`)
      .select()
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!updated) {
      return res.status(404).json({ error: `Order not found: ${order_id}` });
    }

    return res.status(200).json({
      status: 'success',
      message: `Order ${order_id} marked as COLLECTED`,
      order: updated
    });
  } catch (error) {
    console.error('confirmMerchandisePickup exception:', error);
    return res.status(500).json({ error: 'Failed to confirm merchandise pickup' });
  }
};

export const getParticipantPreferences = async (req, res) => {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('fitness_sharing_opt_in, emergency_contact, tshirt_size')
      .eq('id', req.user.id)
      .maybeSingle();

    return res.status(200).json({
      status: 'success',
      preferences: profile || {}
    });
  } catch (error) {
    console.error('getParticipantPreferences exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve preferences' });
  }
};

export const updateParticipantPreferences = async (req, res) => {
  try {
    const { fitness_sharing_opt_in, emergency_contact, tshirt_size } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (fitness_sharing_opt_in !== undefined) updates.fitness_sharing_opt_in = fitness_sharing_opt_in;
    if (emergency_contact !== undefined) updates.emergency_contact = emergency_contact;
    if (tshirt_size !== undefined) updates.tshirt_size = tshirt_size;

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Preferences saved successfully',
      data
    });
  } catch (error) {
    console.error('updateParticipantPreferences exception:', error);
    return res.status(500).json({ error: 'Failed to update preferences' });
  }
};

// ==============================================================================
// REFERRAL CENTRE (proposal flows 55-61)
// ==============================================================================

/**
 * The participant's unique referral code/link, conversion stats and the
 * public leaderboard. Codes are provisioned for all profiles by migration
 * 008; a null here means the row predates the backfill and the caller can
 * hit /referrals/code to mint one.
 */
export const getReferralCentre = async (req, res) => {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, referral_code')
      .eq('id', req.user.id)
      .maybeSingle();

    if (!profile) {
      return res.status(404).json({ error: 'Participant profile not found' });
    }

    const { data: myReferrals } = await supabase
      .from('referrals')
      .select('id, referral_code, status, reward_label, converted_at, rewarded_at, created_at')
      .eq('referrer_profile_id', req.user.id)
      .order('created_at', { ascending: false });

    const referrals = myReferrals || [];
    const conversions = referrals.filter(r => r.status === 'converted' || r.status === 'rewarded').length;

    // Public leaderboard: top converted referrers, aggregated only — no
    // personal data beyond the display name.
    const { data: converted } = await supabase
      .from('referrals')
      .select('referrer_profile_id, profiles!referrals_referrer_profile_id_fkey(full_name)')
      .eq('status', 'converted');

    const counts = new Map();
    for (const row of converted || []) {
      counts.set(row.referrer_profile_id, (counts.get(row.referrer_profile_id) || 0) + 1);
    }
    const leaderboard = [...counts.entries()]
      .map(([pid, count]) => ({
        name: (converted || []).find(c => c.referrer_profile_id === pid)?.profiles?.full_name || 'Athlete',
        conversions: count
      }))
      .sort((a, b) => b.conversions - a.conversions)
      .slice(0, 10);

    return res.status(200).json({
      status: 'success',
      referral_code: profile.referral_code,
      referral_link: profile.referral_code
        ? `https://tourderotary.co.tz/register?ref=${profile.referral_code}`
        : null,
      stats: {
        shares: referrals.length,
        registered: referrals.filter(r => r.status === 'registered').length,
        converted: conversions,
        rewarded: referrals.filter(r => r.status === 'rewarded').length
      },
      referrals,
      leaderboard
    });
  } catch (error) {
    console.error('getReferralCentre exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve referral centre' });
  }
};

/**
 * Mints a referral code for profiles created before migration 008's
 * backfill (or whose insert raced it).
 */
export const mintReferralCode = async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from('profiles')
      .select('referral_code')
      .eq('id', req.user.id)
      .maybeSingle();

    if (existing?.referral_code) {
      return res.status(200).json({ status: 'success', referral_code: existing.referral_code });
    }

    const code = `TDR${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const { data, error } = await supabase
      .from('profiles')
      .update({ referral_code: code })
      .eq('id', req.user.id)
      .select('referral_code')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to mint referral code' });
    }

    return res.status(200).json({ status: 'success', referral_code: data.referral_code });
  } catch (error) {
    console.error('mintReferralCode exception:', error);
    return res.status(500).json({ error: 'Failed to mint referral code' });
  }
};
