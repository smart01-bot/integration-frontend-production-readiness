import { supabase } from '../config/supabase.js';
import textifySms from './textifySmsService.js';

/**
 * 7-Day Merchandise Inventory Reservation Worker
 * - Auto-releases stock reserved for > 7 days where order remains unpaid
 * - Sends Day 4 SMS friendly payment reminder
 * - Sends Day 6 SMS urgent 24-hour warning
 */
export async function runInventoryReservationWorker() {
  try {
    console.log('[Reservation Worker] ⏳ Checking stock reservations & reminders in Supabase...');

    const nowIso = new Date().toISOString();

    // 1. Release expired reservations (> 7 days)
    const { data: expiredReservations, error: expErr } = await supabase
      .from('inventory_reservations')
      .select(`
        id,
        variant_id,
        quantity,
        order_id,
        orders (order_number, status, billing_phone)
      `)
      .eq('status', 'active')
      .lte('expires_at', nowIso);

    if (expErr) {
      console.error('[Reservation Worker] Error querying expired reservations:', expErr);
      return;
    }

    if (expiredReservations && expiredReservations.length > 0) {
      for (const item of expiredReservations) {
        console.log(`[Reservation Worker] Auto-releasing ${item.quantity} units for Order ${item.orders?.order_number}`);

        // Update reservation status
        await supabase
          .from('inventory_reservations')
          .update({ status: 'expired_released', updated_at: nowIso })
          .eq('id', item.id);

        // Release reserved stock atomically via RPC (migration 008).
        // Reservation decrements availability at reserve time; release adds
        // it back exactly once. (The previous read-then-write here both
        // raced and inflated stock_quantity for units never subtracted.)
        const { error: releaseErr } = await supabase.rpc('release_variant_stock', {
          p_variant_id: item.variant_id,
          p_qty: item.quantity
        });

        if (releaseErr) {
          console.error(`[Reservation Worker] Atomic release failed for variant ${item.variant_id}:`, releaseErr.message);
        }

        // Mark order as expired if still pending
        if (item.orders?.status === 'pending') {
          await supabase
            .from('orders')
            .update({ status: 'expired', updated_at: nowIso })
            .eq('id', item.order_id);
        }
      }
    }

    // 2. Day 4 Reminder Check
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const { data: day4Items } = await supabase
      .from('inventory_reservations')
      .select(`
        id,
        orders (order_number, billing_phone, total_tsh)
      `)
      .eq('status', 'active')
      .eq('day4_reminded', false)
      .lte('reserved_at', fourDaysAgo);

    if (day4Items && day4Items.length > 0) {
      for (const item of day4Items) {
        if (item.orders?.billing_phone) {
          await textifySms.sendDay4ReservationReminder(item.orders.billing_phone, {
            orderNumber: item.orders.order_number,
            totalTsh: item.orders.total_tsh,
            daysRemaining: 3
          });
          await supabase
            .from('inventory_reservations')
            .update({ day4_reminded: true })
            .eq('id', item.id);
        }
      }
    }

    // 3. Day 6 Final Warning Check
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const { data: day6Items } = await supabase
      .from('inventory_reservations')
      .select(`
        id,
        orders (order_number, billing_phone, total_tsh)
      `)
      .eq('status', 'active')
      .eq('day6_reminded', false)
      .lte('reserved_at', sixDaysAgo);

    if (day6Items && day6Items.length > 0) {
      for (const item of day6Items) {
        if (item.orders?.billing_phone) {
          await textifySms.sendDay6FinalWarning(item.orders.billing_phone, {
            orderNumber: item.orders.order_number,
            totalTsh: item.orders.total_tsh
          });
          await supabase
            .from('inventory_reservations')
            .update({ day6_reminded: true })
            .eq('id', item.id);
        }
      }
    }
  } catch (error) {
    console.error('[Reservation Worker] Exception:', error.message || error);
  }
}
