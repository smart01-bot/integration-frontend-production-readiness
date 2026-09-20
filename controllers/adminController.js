import { supabase } from '../config/supabase.js';

/**
 * Admin Controller - Production event telemetry, phase control, order management,
 * capacities, promo codes, refunds, and security audit logs.
 */
export const getDashboardOverview = async (req, res) => {
  try {
    // 1. Fetch current active edition
    const { data: edition, error: edErr } = await supabase
      .from('event_editions')
      .select('*')
      .eq('year', 2026)
      .maybeSingle();

    if (edErr) {
      console.error('Error fetching event edition:', edErr.message);
    }

    // 2. Fetch all activities with capacities
    const { data: activities, error: actErr } = await supabase
      .from('activities')
      .select('*')
      .order('distance_km', { ascending: false });

    if (actErr) {
      console.error('Error fetching activities:', actErr.message);
    }

    // 3. Aggregate revenue from successful payments
    const { data: payments, error: payErr } = await supabase
      .from('payments')
      .select('amount_tsh')
      .eq('status', 'successful');

    if (payErr) {
      console.error('Error fetching payments:', payErr.message);
    }

    // 4. Query active inventory reservations
    const { data: activeReservations, error: resErr } = await supabase
      .from('inventory_reservations')
      .select('id, quantity')
      .eq('status', 'active');

    if (resErr) {
      console.error('Error fetching reservations:', resErr.message);
    }

    // 5. Query checked-in tickets count
    const { count: checkedInCount, error: tktErr } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('checked_in', true);

    if (tktErr) {
      console.error('Error counting checked-in tickets:', tktErr.message);
    }

    const currentPhase = edition?.current_phase || 'pre_event';
    const activityList = activities || [];

    const totalRegistrations = activityList.reduce((sum, a) => sum + (Number(a.registered_count) || 0), 0);
    const totalCapacity = activityList.reduce((sum, a) => sum + (Number(a.capacity) || 0), 0);
    const totalRevenueTsh = (payments || []).reduce((sum, p) => sum + (Number(p.amount_tsh) || 0), 0);
    const activeLocksCount = (activeReservations || []).length;

    const breakdown = activityList.map(a => ({
      activity: a.title,
      category: a.category,
      registered: a.registered_count || 0,
      capacity: a.capacity || 0,
      price_tsh: a.early_bird_price_tsh || a.standard_price_tsh || 0,
      status: a.status || 'open'
    }));

    return res.status(200).json({
      status: 'success',
      event_edition: edition?.title || 'Tour de Rotary Dar es Salaam 2026',
      edition_year: edition?.year || 2026,
      current_phase: currentPhase,
      telemetry: {
        total_registrations: totalRegistrations,
        capacity_max: totalCapacity,
        capacity_percentage: totalCapacity > 0 ? parseFloat(((totalRegistrations / totalCapacity) * 100).toFixed(1)) : 0,
        total_revenue_tsh: totalRevenueTsh,
        active_merchandise_reservations: activeLocksCount,
        checked_in_participants: checkedInCount || 0
      },
      registration_breakdown: breakdown
    });
  } catch (error) {
    console.error('getDashboardOverview exception:', error);
    return res.status(500).json({ error: 'Failed to aggregate dashboard overview' });
  }
};

export const updateEventPhase = async (req, res) => {
  try {
    const new_phase = req.body.new_phase || req.body.phase;
    const validPhases = ['pre_event', 'event_day', 'post_event', 'archive'];

    if (!validPhases.includes(new_phase)) {
      return res.status(400).json({
        error: `Invalid phase. Allowed values: ${validPhases.join(', ')}`
      });
    }

    const { data: updatedEdition, error } = await supabase
      .from('event_editions')
      .update({ current_phase: new_phase, updated_at: new Date().toISOString() })
      .eq('year', 2026)
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to update event phase in database' });
    }

    // Synchronize frontend event_config and Tour de Dar event_lifecycle
    const lifecycleMode = new_phase === 'post_event' ? 'memory' : 'live';
    await Promise.allSettled([
      supabase.from('event_config').update({ phase: new_phase, updated_at: new Date().toISOString() }).eq('id', 1),
      supabase.from('event_lifecycle').update({ current_mode: lifecycleMode, updated_at: new Date().toISOString() }).neq('current_mode', 'custom')
    ]);

    // Record audit log
    await supabase.from('audit_logs').insert([{
      action: 'UPDATE_EVENT_PHASE',
      target_resource: 'event_editions:2026',
      details_json: { new_phase },
      actor_profile_id: req.user.id,
      actor_role: req.user.role,
      ip_address: req.ip
    }]);

    return res.status(200).json({
      success: true,
      message: `Event phase updated to '${new_phase}'`,
      edition: updatedEdition
    });
  } catch (error) {
    console.error('updateEventPhase exception:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const broadcastAnnouncementSms = async (req, res) => {
  try {
    const { target_group = 'all_participants', message, role_filter } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    let profileQuery = supabase
      .from('profiles')
      .select('phone_number')
      .not('phone_number', 'is', null);

    if (role_filter) {
      profileQuery = profileQuery.eq('role', role_filter);
    }

    const { data: profiles, error } = await profileQuery;

    if (error) {
      return res.status(500).json({ error: 'Failed to retrieve recipient profiles' });
    }

    const recipients = profiles || [];

    if (recipients.length > 0) {
      const queueRows = recipients.map(p => ({
        channel: 'SMS',
        provider: 'TextifyAfrica',
        recipient: p.phone_number,
        message_body: message,
        status: 'pending',
        scheduled_for: new Date().toISOString(),
        metadata_json: { target_group }
      }));

      const { error: queueErr } = await supabase.from('communication_queue').insert(queueRows);
      if (queueErr) {
        console.error('broadcastAnnouncementSms queue insert failed:', queueErr.message);
        return res.status(500).json({ error: 'Failed to queue broadcast messages' });
      }
    }

    const queuedCount = recipients.length;

    await supabase.from('audit_logs').insert([{
      action: 'BROADCAST_SMS',
      target_resource: target_group,
      details_json: { message_length: message.length, recipients_count: queuedCount },
      actor_profile_id: req.user.id,
      actor_role: req.user.role,
      ip_address: req.ip
    }]);

    return res.status(200).json({
      success: true,
      target_group,
      recipients_queued: queuedCount,
      status: 'QUEUED_FOR_DISPATCH'
    });
  } catch (error) {
    console.error('broadcastAnnouncementSms exception:', error);
    return res.status(500).json({ error: 'Failed to queue announcement' });
  }
};

export const getOrdersList = async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      // orders has two FKs to profiles (profile_id + user_id): disambiguate.
      .select('*, profiles:profile_id(full_name, email, phone_number), order_items(*)')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error querying orders:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: orders ? orders.length : 0,
      data: orders || []
    });
  } catch (error) {
    console.error('getOrdersList exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve orders list' });
  }
};

export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await supabase.from('audit_logs').insert([{
      action: 'UPDATE_ORDER_STATUS',
      target_resource: `orders:${id}`,
      details_json: { status, notes },
      actor_profile_id: req.user.id,
      actor_role: req.user.role,
      ip_address: req.ip
    }]);

    return res.status(200).json({
      status: 'success',
      message: `Order ${id} status updated to '${status}'`,
      data
    });
  } catch (error) {
    console.error('updateOrderStatus exception:', error);
    return res.status(500).json({ error: 'Failed to update order status' });
  }
};

export const getUsersList = async (req, res) => {
  try {
    const { role } = req.query;
    let query = supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (role) {
      query = query.eq('role', role);
    }

    const { data: users, error } = await query;

    if (error) {
      console.error('Error fetching users:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: users ? users.length : 0,
      data: users || []
    });
  } catch (error) {
    console.error('getUsersList exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve users' });
  }
};

export const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_role } = req.body;
    const validRoles = ['participant', 'volunteer', 'sponsor', 'partner', 'admin'];

    if (!validRoles.includes(new_role)) {
      return res.status(400).json({ error: `Invalid role. Allowed: ${validRoles.join(', ')}` });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ role: new_role, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await supabase.from('audit_logs').insert([{
      action: 'UPDATE_USER_ROLE',
      target_resource: `profiles:${id}`,
      details_json: { new_role },
      actor_profile_id: req.user.id,
      actor_role: req.user.role,
      ip_address: req.ip
    }]);

    return res.status(200).json({
      status: 'success',
      message: `User ${id} role updated to '${new_role}'`,
      data
    });
  } catch (error) {
    console.error('updateUserRole exception:', error);
    return res.status(500).json({ error: 'Failed to update user role' });
  }
};

export const getInventoryStatus = async (req, res) => {
  try {
    const { data: variants, error } = await supabase
      .from('product_variants')
      .select('*')
      .order('product_name', { ascending: true });

    if (error) {
      console.error('Error fetching product variants:', error.message);
      return res.status(500).json({ error: error.message });
    }

    const { data: activeReservations } = await supabase
      .from('inventory_reservations')
      .select('id, quantity')
      .eq('status', 'active');

    const items = (variants || []).map(v => {
      const stock = Number(v.stock_quantity) || 0;
      const reserved = Number(v.reserved_quantity) || 0;
      const available = Math.max(0, stock - reserved);
      return {
        id: v.id,
        product: v.product_name,
        variant_type: v.variant_type,
        total_stock: stock,
        reserved: reserved,
        available: available,
        price_tsh: v.price_tsh,
        warning_level: available < 10 ? 'low_stock' : 'healthy'
      };
    });

    const totalStock = items.reduce((sum, i) => sum + i.total_stock, 0);
    const totalReserved = items.reduce((sum, i) => sum + i.reserved, 0);
    const totalAvailable = items.reduce((sum, i) => sum + i.available, 0);

    return res.status(200).json({
      status: 'success',
      inventory_summary: {
        total_stock_units: totalStock,
        reserved_locked_units: totalReserved,
        available_sellable_units: totalAvailable,
        lock_retention_days: 7,
        active_reservation_baskets: (activeReservations || []).length
      },
      items
    });
  } catch (error) {
    console.error('getInventoryStatus exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve inventory status' });
  }
};

export const releaseExpiredReservationsNow = async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { data: expiredList, error: findErr } = await supabase
      .from('inventory_reservations')
      .select('*')
      .eq('status', 'active')
      .lt('expires_at', now);

    if (findErr) {
      return res.status(500).json({ error: findErr.message });
    }

    if (!expiredList || expiredList.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'No expired inventory reservations to release.',
        released_count: 0
      });
    }

    for (const item of expiredList) {
      // 'expired_released' is the only expiry status allowed by the
      // inventory_reservations CHECK constraint ('expired' violates it).
      await supabase
        .from('inventory_reservations')
        .update({ status: 'expired_released', updated_at: now })
        .eq('id', item.id);

      // Atomic stock release via RPC (migration 008) — releasing must add
      // availability back exactly once, never via read-then-write loops.
      await supabase.rpc('decrement_reserved_inventory', {
        variant_uuid: item.variant_id,
        decrement_by: item.quantity
      });
    }

    await supabase.from('audit_logs').insert([{
      action: 'RELEASE_EXPIRED_RESERVATIONS',
      target_resource: 'inventory_reservations',
      details_json: { released_count: expiredList.length },
      actor_profile_id: req.user.id,
      actor_role: req.user.role,
      ip_address: req.ip
    }]);

    return res.status(200).json({
      status: 'success',
      message: `Successfully released ${expiredList.length} expired reservation items.`,
      released_count: expiredList.length
    });
  } catch (error) {
    console.error('releaseExpiredReservationsNow exception:', error);
    return res.status(500).json({ error: 'Failed to execute manual release' });
  }
};

export const getContentCMS = async (req, res) => {
  try {
    const { section } = req.query;
    let query = supabase.from('site_content').select('*').order('content_key', { ascending: true });
    if (section) {
      query = query.eq('section', section);
    }

    const { data: content, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: content ? content.length : 0,
      data: content || []
    });
  } catch (error) {
    console.error('getContentCMS exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve site content' });
  }
};

export const updateContentCMS = async (req, res) => {
  try {
    const { content_key, section = 'general', value_json, visible_from, visible_until } = req.body;

    if (!content_key || value_json === undefined) {
      return res.status(400).json({ error: 'content_key and value_json are required' });
    }

    const record = {
      content_key,
      section,
      value_json,
      visible_from: visible_from ? new Date(visible_from).toISOString() : null,
      visible_until: visible_until ? new Date(visible_until).toISOString() : null,
      updated_by: req.user.id,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('site_content')
      .upsert(record, { onConflict: 'content_key' })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await supabase.from('audit_logs').insert([{
      action: 'UPDATE_SITE_CONTENT',
      target_resource: `site_content:${content_key}`,
      details_json: { section },
      actor_profile_id: req.user.id,
      actor_role: req.user.role,
      ip_address: req.ip
    }]);

    return res.status(200).json({
      status: 'success',
      message: `Content block '${content_key}' saved`,
      data
    });
  } catch (error) {
    console.error('updateContentCMS exception:', error);
    return res.status(500).json({ error: 'Failed to update site content' });
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching audit logs:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: logs ? logs.length : 0,
      data: logs || []
    });
  } catch (error) {
    console.error('getAuditLogs exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve audit logs' });
  }
};

export const getPromoCodes = async (req, res) => {
  try {
    const { data: promoCodes, error } = await supabase
      .from('promo_codes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error querying promo codes:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: promoCodes ? promoCodes.length : 0,
      data: promoCodes || []
    });
  } catch (error) {
    console.error('getPromoCodes exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve promo codes' });
  }
};

export const createPromoCode = async (req, res) => {
  try {
    const { code, discount_percent, max_uses, expires_at } = req.body;

    if (!code || !discount_percent) {
      return res.status(400).json({ error: 'Code and discount_percent are required' });
    }

    const newPromo = {
      code: code.trim().toUpperCase(),
      discount_percent: Number(discount_percent),
      max_uses: Number(max_uses) || 100,
      used_count: 0,
      active: true,
      expires_at: expires_at ? new Date(expires_at).toISOString() : null
    };

    const { data, error } = await supabase
      .from('promo_codes')
      .insert([newPromo])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    await supabase.from('audit_logs').insert([{
      action: 'CREATE_PROMO_CODE',
      target_resource: `promo_codes:${newPromo.code}`,
      details_json: newPromo,
      actor_profile_id: req.user.id,
      actor_role: req.user.role,
      ip_address: req.ip
    }]);

    return res.status(201).json({
      status: 'success',
      message: `Promo code ${newPromo.code} created successfully`,
      data
    });
  } catch (error) {
    console.error('createPromoCode exception:', error);
    return res.status(500).json({ error: 'Failed to create promo code' });
  }
};

export const getActivityCapacities = async (req, res) => {
  try {
    const { data: activities, error } = await supabase
      .from('activities')
      .select('id, title, category, capacity, registered_count, early_bird_price_tsh, standard_price_tsh, status')
      .order('title', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: activities ? activities.length : 0,
      capacities: activities || []
    });
  } catch (error) {
    console.error('getActivityCapacities exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve activity capacities' });
  }
};

export const updateActivityCapacity = async (req, res) => {
  try {
    const { id } = req.params;
    const { capacity, early_bird_price_tsh, standard_price_tsh, status } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (capacity !== undefined) updates.capacity = Number(capacity);
    if (early_bird_price_tsh !== undefined) updates.early_bird_price_tsh = Number(early_bird_price_tsh);
    if (standard_price_tsh !== undefined) updates.standard_price_tsh = Number(standard_price_tsh);
    if (status !== undefined) updates.status = status;

    const { data, error } = await supabase
      .from('activities')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await supabase.from('audit_logs').insert([{
      action: 'UPDATE_ACTIVITY_CAPACITY',
      target_resource: `activities:${id}`,
      details_json: updates,
      actor_profile_id: req.user.id,
      actor_role: req.user.role,
      ip_address: req.ip
    }]);

    return res.status(200).json({
      status: 'success',
      message: `Activity ${id} updated successfully`,
      data
    });
  } catch (error) {
    console.error('updateActivityCapacity exception:', error);
    return res.status(500).json({ error: 'Failed to update activity capacity' });
  }
};

export const getRefundRequests = async (req, res) => {
  try {
    const { data: refunds, error } = await supabase
      .from('refund_requests')
      .select('*, profiles(full_name, email, phone_number)')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching refunds:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: refunds ? refunds.length : 0,
      data: refunds || []
    });
  } catch (error) {
    console.error('getRefundRequests exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve refund requests' });
  }
};

export const processRefundRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, notes } = req.body; // 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: "Action must be 'approve' or 'reject'" });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    const { data, error } = await supabase
      .from('refund_requests')
      .update({
        status: newStatus,
        notes: notes || (action === 'approve' ? 'Refund approved by administrator' : 'Refund request rejected'),
        resolved_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await supabase.from('audit_logs').insert([{
      action: 'PROCESS_REFUND',
      target_resource: `refund_requests:${id}`,
      details_json: { action, status: newStatus, notes },
      actor_profile_id: req.user.id,
      actor_role: req.user.role,
      ip_address: req.ip
    }]);

    return res.status(200).json({
      status: 'success',
      message: `Refund ${id} marked as ${newStatus}`,
      data
    });
  } catch (error) {
    console.error('processRefundRequest exception:', error);
    return res.status(500).json({ error: 'Failed to process refund request' });
  }
};

// ==============================================================================
// INCIDENT MANAGEMENT (HQ command centre — proposal flow 91/104)
// ==============================================================================

export const getIncidents = async (req, res) => {
  try {
    const { status, severity } = req.query;
    let query = supabase
      .from('incidents')
      .select('*, profiles(full_name, phone_number)')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (severity) query = query.eq('severity', severity);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      status: 'success',
      count: data ? data.length : 0,
      data: data || []
    });
  } catch (error) {
    console.error('getIncidents exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve incidents' });
  }
};

export const updateIncidentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolution_notes } = req.body;
    const validStatuses = ['open', 'acknowledged', 'resolved', 'closed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const updates = { status, updated_at: new Date().toISOString() };
    if (resolution_notes !== undefined) updates.resolution_notes = resolution_notes;
    if (status === 'resolved' || status === 'closed') updates.resolved_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('incidents')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await supabase.from('audit_logs').insert([{
      action: 'UPDATE_INCIDENT_STATUS',
      target_resource: `incidents:${id}`,
      details_json: { status },
      actor_profile_id: req.user.id,
      actor_role: req.user.role,
      ip_address: req.ip
    }]);

    return res.status(200).json({
      status: 'success',
      message: `Incident ${id} updated to '${status}'`,
      data
    });
  } catch (error) {
    console.error('updateIncidentStatus exception:', error);
    return res.status(500).json({ error: 'Failed to update incident' });
  }
};

// ==============================================================================
// CSV EXPORTS (M&E and reporting — proposal journey N/103)
// ==============================================================================

const toCsv = (rows, fallbackHeaders = null) => {
  if (!rows || rows.length === 0) {
    // Emit a header-only CSV so an empty export is still a valid, openable file.
    return fallbackHeaders ? fallbackHeaders.join(',') : '';
  }
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
};

export const exportRegistrationsCsv = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tickets')
      // tickets has two FKs to profiles (profile_id + checked_in_by): disambiguate.
      // NOTE: tickets.activity_id has NO FK constraint to activities, so a PostgREST
      // embed would fail with PGRST200. Resolve activity titles in a second query.
      .select('bib_number, checked_in, checked_in_at, created_at, profiles:profile_id(full_name, email, phone_number)')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const activityIds = [...new Set((data || []).map(t => t.activity_id).filter(Boolean))];
    let activitiesById = {};
    if (activityIds.length) {
      const { data: acts } = await supabase
        .from('activities')
        .select('id, title, category')
        .in('id', activityIds);
      activitiesById = Object.fromEntries((acts || []).map(a => [a.id, a]));
    }

    const rows = (data || []).map(t => ({
      bib_number: t.bib_number,
      participant: t.profiles?.full_name,
      email: t.profiles?.email,
      phone: t.profiles?.phone_number,
      activity: activitiesById[t.activity_id]?.title || '',
      category: activitiesById[t.activity_id]?.category || '',
      checked_in: t.checked_in,
      checked_in_at: t.checked_in_at,
      registered_at: t.created_at
    }));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="registrations.csv"');
    return res.status(200).send(toCsv(rows, ['bib_number', 'participant', 'email', 'phone', 'activity', 'category', 'checked_in', 'checked_in_at', 'registered_at']));
  } catch (error) {
    console.error('exportRegistrationsCsv exception:', error);
    return res.status(500).json({ error: 'Failed to export registrations' });
  }
};

export const exportRevenueCsv = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('order_number, status, subtotal_tsh, discount_tsh, total_tsh, currency, created_at, profiles:profile_id(full_name, email)')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const rows = (data || []).map(o => ({
      order_number: o.order_number,
      customer: o.profiles?.full_name,
      email: o.profiles?.email,
      status: o.status,
      subtotal_tsh: o.subtotal_tsh,
      discount_tsh: o.discount_tsh,
      total_tsh: o.total_tsh,
      currency: o.currency,
      created_at: o.created_at
    }));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="revenue.csv"');
    return res.status(200).send(toCsv(rows));
  } catch (error) {
    console.error('exportRevenueCsv exception:', error);
    return res.status(500).json({ error: 'Failed to export revenue' });
  }
};
