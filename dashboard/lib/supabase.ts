import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Cliente server-only con service role. NUNCA importar desde un componente cliente.
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY');
  }
  client = createClient(url, key, {
    // Esquema de la BD. En el proyecto Pro las tablas viven en 'disecta' (aislado del otro sistema
    // en 'public'). Default 'public' para no cambiar nada hasta que se setee SUPABASE_SCHEMA.
    db: { schema: process.env.SUPABASE_SCHEMA || 'public' },
    auth: { persistSession: false },
    // Next.js cachea fetch() por defecto; supabase-js usa fetch internamente. Forzamos no-store
    // para que las lecturas (stats/content) siempre reflejen el estado real de la BD.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: 'no-store' }),
    },
  }) as unknown as SupabaseClient;
  return client;
}

export const IG_TABLE = 'ig_reels';
export const YT_TABLE = 'yt_videos';
