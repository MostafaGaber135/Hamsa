import { createClient } from 'npm:@supabase/supabase-js@2'
import { requireEnv } from './env.ts'

/** The service-role client: bypasses RLS, so every function checks who's asking first. */
export const admin = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'))
