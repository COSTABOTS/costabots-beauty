import { createClient } from '@supabase/supabase-js';
import { beautyEnvironment } from '../config/environment';

export const isSupabaseConfigured = true;
export const supabase = createClient(beautyEnvironment.supabaseUrl, beautyEnvironment.supabaseAnonKey);
