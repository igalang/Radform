// Radform Supabase client.
// The publishable key is intentionally safe for browser use; access control lives in PostgreSQL RLS.
const SUPABASE_URL = 'https://lcpeibwnigyuudmmpetp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gSz2lGKPEWSEtE__Fsb5kQ_e9MQgcIL';

let clientPromise = null;

export function getSupabaseConfig() {
  return { url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY };
}

export async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }))
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}
