import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lhtgdaxexvdbswkycaxr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxodGdkYXhleHZkYnN3a3ljYXhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMjk5NzksImV4cCI6MjA5NTgwNTk3OX0.LIfqfgZxK2_bWP31kVSdA8ccVSrg2E7fSeaCcN_tQCk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
