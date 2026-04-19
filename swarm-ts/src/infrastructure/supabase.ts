import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getConfig } from '../core/config.js'

let supabaseClient: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    const config = getConfig()
    supabaseClient = createClient(
      config.SUPABASE_URL,
      config.SUPABASE_ANON_KEY
    )
  }
  return supabaseClient
}
