import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 🔴 REPLACE THESE WITH YOUR REAL VALUES
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_PUBLIC_ANON_KEY';

// Create client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
