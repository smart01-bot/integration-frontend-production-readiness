import { supabase } from '../config/supabase.js';

/**
 * Cart Controller - Processes mixed checkout (tickets + official merchandise)
 * Creates orders and locks merchandise for 7 days in inventory_reservations
 *
 * IMPORTANT — billing integrity: every price in this file is now looked up
 * from the database. Previously, an unrecognized activity_id silently fell
 * back to a hardcoded TSh 45,000, merchandise price came directly from
 * whatever the client sent in the request body (unit_price_tsh — a client
 * could set this to anything, including 0), and the promo code check was a
 * single hardcoded string instead of the real promo_codes table. All of
 * that has been replaced with server-side validation against real records.
 * A checkout with an unrecognized activity or merchandise variant is now
 * rejected outright, never silently priced from a guess.
 */
export const checkoutCart = async (req, res) => {
  try {    const {
      full_name,
      email,
      phone_number,
      activity_id,
      merchandise_items = [],
      tshirt_size,
      promo_code,
      referral_code
    } = req.body;

    if (!full_name || !email || !phone_number || !activity_id) {
      return res.status(400).json({ error: 'Missing required registration parameters (full_name, email, phone_number, activity_id)' });
    }

    // 1. Get or create participant profile. Financial/registration path —
    // any database write failure here must fail the request loudly.
    let profile = null;
    const { data: existingProfile, error: profileLookupErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (profileLookupErr) {
      console.error('Profile lookup failed:', profileLookupErr.message);
      return res.status(500).json({ error: 'Failed to look up participant profile' });
    }

    if (existingProfile) {
      profile = existingProfile;
    } else {
      const { data: newProfile, error: profileInsertErr } = await supabase
        .from('profiles')
        .insert([{
          full_name,
          email,
          phone_number,
          tshirt_size: tshirt_size || 'L',
          role: 'participant'
        }])
        .select('id')
        .single();

      if (profileInsertErr || !newProfile) {
        console.error('Profile creation failed:', profileInsertErr?.message);
        return res.status(500).json({ error: 'Failed to create participant profile' });
      }
      profile = newProfile;

      // Referral attribution (proposal flows 55-59): a brand-new profile
      // created with a referral code is attributed to the code owner.
      // Existing profiles are never re-attributed.
      if (referral_code) {
        const { data: referrer } = await supabase
          .from('profiles')
          .select('id')
          .eq('referral_code', referral_code.toUpperCase())
          .neq('id', profile.id)
          .maybeSingle();

        if (referrer) {
          await supabase.from('referrals').insert([{
            referrer_profile_id: referrer.id,
            referred_profile_id: profile.id,
            referral_code: referral_code.toUpperCase(),
            status: 'registered'
          }]);
        }
      }
    }

    // 2. Fetch the current event edition — required, no fabricated fallback ID.
    const { data: edition, error: editionErr } = await supabase
      .from('event_editions')
      .select('id')
      .eq('year', 2026)
      .maybeSingle();

    if (editionErr || !edition) {
      console.error('Event edition lookup failed:', editionErr?.message || 'not found');
      return res.status(500).json({ error: 'Event edition is not configured. Contact support.' });
    }
    const editionId = edition.id;

    // 3. Fetch and validate the activity — required, must be real and open.
    const { data: activity, error: activityErr } = await supabase
      .from('activities')
      .select('*')
      .eq('id', activity_id)
      .maybeSingle();

    if (activityErr) {
      console.error('Activity lookup failed:', activityErr.message);
      return res.status(500).json({ error: 'Failed to look up activity' });
    }
    if (!activity) {
      return res.status(404).json({ error: 'The selected activity does not exist' });
    }
    if (activity.status !== 'open') {
      return res.status(400).json({ error: `Registration for "${activity.title}" is not currently open` });
    }

    const activityPriceTsh = activity.early_bird_price_tsh;
    const activityTitle = activity.title;

    // 4. Calculate merchandise prices — price and stock always come from
    // product_variants, NEVER from the client-supplied request body.
    let merchSubtotalTsh = 0;
    const resolvedMerch = [];

    for (const item of merchandise_items) {
      const qty = item.quantity || 1;

      if (!item.variant_id) {
        return res.status(400).json({ error: 'Each merchandise item must include a valid variant_id' });
      }

      const { data: variant, error: variantErr } = await supabase
        .from('product_variants')
        .select('*')
        .eq('id', item.variant_id)
        .maybeSingle();

      if (variantErr) {
        console.error('Variant lookup failed:', variantErr.message);
        return res.status(500).json({ error: 'Failed to look up merchandise item' });
      }
      if (!variant) {
        return res.status(404).json({ error: `Merchandise item not found: ${item.variant_id}` });
      }

      const availableStock = (variant.stock_quantity || 0) - (variant.reserved_quantity || 0);
      if (availableStock < qty) {
        return res.status(400).json({ error: `Insufficient stock for ${variant.product_name}` });
      }

      const unitPrice = variant.price_tsh;
      const subtotal = unitPrice * qty;
      merchSubtotalTsh += subtotal;

      resolvedMerch.push({
        item_type: 'merchandise',
        reference_id: variant.id,
        description: variant.product_name || 'Official Event Merchandise',
        quantity: qty,
        unit_price_tsh: unitPrice,
        subtotal_tsh: subtotal
      });
    }

    const subtotalTsh = activityPriceTsh + merchSubtotalTsh;

    // 5. Promo code — validated against the real promo_codes table, not a
    // hardcoded string. Checks active flag, expiry, and usage limit.
    let discountTsh = 0;
    let appliedPromoCode = null;

    if (promo_code) {
      const { data: promo, error: promoErr } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('code', promo_code.toUpperCase())
        .maybeSingle();

      if (promoErr) {
        console.error('Promo code lookup failed:', promoErr.message);
        return res.status(500).json({ error: 'Failed to validate promo code' });
      }

      if (promo) {
        const isExpired = promo.expires_at && new Date(promo.expires_at) < new Date();
        const isExhausted = promo.used_count >= promo.max_uses;

        if (!promo.active || isExpired || isExhausted) {
          return res.status(400).json({ error: 'This promo code is no longer valid' });
        }

        discountTsh = Math.round(subtotalTsh * (promo.discount_percent / 100));
        appliedPromoCode = promo;
      } else {
        return res.status(400).json({ error: 'Invalid promo code' });
      }
    }

    const totalTsh = subtotalTsh - discountTsh;
    const orderNumber = `TDR-2026-${Math.floor(10000 + Math.random() * 90000)}`;

    // 6. Insert order into Supabase — must succeed for real, no fabricated fallback
    const { data: orderRecord, error: orderErr } = await supabase
      .from('orders')
      .insert([{
        order_number: orderNumber,
        profile_id: profile.id,
        user_id: profile.id, // frontend-compatibility column, added in migration 006
        edition_id: editionId,
        status: 'pending',
        subtotal_tsh: subtotalTsh,
        discount_tsh: discountTsh,
        total_tsh: totalTsh,
        currency: 'TZS',
        billing_phone: phone_number
      }])
      .select('*')
      .single();

    if (orderErr || !orderRecord) {
      console.error('Order creation failed:', orderErr?.message);
      return res.status(500).json({ error: 'Failed to create order' });
    }

    // 7. Insert order items
    const orderItemsToInsert = [
      {
        order_id: orderRecord.id,
        item_type: 'activity_ticket',
        reference_id: activity_id,
        description: activityTitle,
        quantity: 1,
        unit_price_tsh: activityPriceTsh,
        subtotal_tsh: activityPriceTsh
      },
      ...resolvedMerch.map(m => ({
        order_id: orderRecord.id,
        item_type: 'merchandise',
        reference_id: m.reference_id,
        description: m.description,
        quantity: m.quantity,
        unit_price_tsh: m.unit_price_tsh,
        subtotal_tsh: m.subtotal_tsh
      }))
    ];

    const { error: itemsErr } = await supabase.from('order_items').insert(orderItemsToInsert);
    if (itemsErr) {
      console.error('Order items insert failed:', itemsErr.message);
      return res.status(500).json({ error: 'Failed to save order items' });
    }

    // 8. Lock 7-day inventory reservations for merchandise, and increment
    // promo code usage now that the order has definitely been created.
    if (resolvedMerch.length > 0) {
      const reservations = resolvedMerch.map(m => ({
        order_id: orderRecord.id,
        variant_id: m.reference_id,
        quantity: m.quantity,
        status: 'active',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      }));

      const { error: reservationErr } = await supabase.from('inventory_reservations').insert(reservations);
      if (reservationErr) {
        console.error('Inventory reservation insert failed:', reservationErr.message);
        return res.status(500).json({ error: 'Failed to reserve merchandise stock' });
      }

      // Atomic stock reservation via RPC (migration 008): availability is
      // decremented server-side in one statement, so concurrent checkouts
      // can never oversell. Any failure here aborts the reservation.
      for (const m of resolvedMerch) {
        const { error: reserveErr } = await supabase.rpc('reserve_variant_stock', {
          p_variant_id: m.reference_id,
          p_qty: m.quantity
        });

        if (reserveErr) {
          console.error('Atomic stock reservation failed:', reserveErr.message);
          // Roll back reservations already made for this order.
          for (const done of resolvedMerch.slice(0, resolvedMerch.indexOf(m))) {
            await supabase.rpc('release_variant_stock', {
              p_variant_id: done.reference_id,
              p_qty: done.quantity
            });
          }
          return res.status(409).json({ error: `Stock for ${m.description} was just taken by another order. Please review your cart.` });
        }
      }
    }

    if (appliedPromoCode) {
      await supabase
        .from('promo_codes')
        .update({ used_count: appliedPromoCode.used_count + 1 })
        .eq('id', appliedPromoCode.id);
    }

    return res.status(201).json({
      success: true,
      message: 'Order created with 7-day inventory lock. Ready for PayMe payment.',
      order: {
        id: orderRecord.id,
        order_number: orderRecord.order_number,
        total_tsh: totalTsh,
        currency: 'TZS',
        items: orderItemsToInsert,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      },
      next_step: {
        payme_endpoint: '/api/v1/payments/initiate',
        payload: {
          order_number: orderNumber,
          amount_tsh: totalTsh,
          phone_number
        }
      }
    });
  } catch (error) {
    console.error('Cart checkout exception:', error);
    return res.status(500).json({ error: 'Failed to process checkout' });
  }
};
