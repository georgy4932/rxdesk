import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://zymynzcffxjplzuqkkno.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5bXluemNmZnhqcGx6dXFra25vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MjYyMzMsImV4cCI6MjA5MjEwMjIzM30.mlQxTz5EAH6cGwEsQkE3_YHCv7-LTjkqFH6LXNlQIfc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
