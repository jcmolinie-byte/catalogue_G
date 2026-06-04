import { createClient } from '@supabase/supabase-js';

// Fallback values prevent crash when Supabase is not configured
// The app still works for AI features (Gemini/Groq) without Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);