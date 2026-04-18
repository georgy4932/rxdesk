import { createClient, SupabaseClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || supabaseUrl.trim() === '') {
  throw new Error('[supabaseAdmin] SUPABASE_URL is not set. Check your .env file.');
}

if (!supabaseServiceRoleKey || supabaseServiceRoleKey.trim() === '') {
  throw new Error('[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY is not set. Check your .env file.');
}

/**
 * Server-only privileged Supabase client.
 * Never import this into frontend/browser code.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  }
);
