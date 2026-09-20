import { supabase } from '../config/supabase.js';

export const subscribe = async (req, res) => {
  const email = req.body?.email?.trim().toLowerCase();
  const name = req.body?.name?.trim() || null;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message: 'A valid email address is required' });
  }

  const { error } = await supabase.from('newsletter_subscribers').upsert(
    { email, name, subscribed_at: new Date().toISOString(), unsubscribed_at: null },
    { onConflict: 'email' }
  );
  if (error) {
    console.error('newsletter subscription error:', error.message);
    return res.status(500).json({ message: 'Unable to save subscription' });
  }
  return res.status(201).json({ success: true });
};
