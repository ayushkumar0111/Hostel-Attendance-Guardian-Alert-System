import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Detect whether valid Supabase credentials have been configured
export const isSupabaseConfigured = (): boolean => {
  const url = supabaseUrl.trim();
  const key = supabaseAnonKey.trim();

  const isInvalidUrl =
    !url ||
    url.includes('your-project-id') ||
    url.includes('placeholder') ||
    !url.startsWith('https://');

  const isInvalidKey =
    !key ||
    key.includes('your-supabase-anon-key') ||
    key.includes('placeholder') ||
    key.length < 30;

  return !isInvalidUrl && !isInvalidKey;
};

// Create the Supabase client using configured credentials or fallback safely
export const supabase = createClient(
  isSupabaseConfigured() ? supabaseUrl : 'https://placeholder-ct-hostel.supabase.co',
  isSupabaseConfigured() ? supabaseAnonKey : 'placeholder-anon-key'
);
