import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Fail fast rather than silently falling back to an undefined/leaked client.
// A missing service-role key must never be masked by a hardcoded default —
// that key grants full, RLS-bypassing database access.
if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '[config/supabase.js] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. ' +
    'Set them in your .env file — do not hardcode credentials in source.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export default supabase;
