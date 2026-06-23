import { NextResponse } from 'next/server';
import { getSupabase, IG_TABLE, YT_TABLE } from '@/lib/supabase';
import { ESTADOS } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function countWhere(table: string, estado?: string): Promise<number> {
  const supabase = getSupabase();
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  if (estado) q = q.eq('estado', estado);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

export async function GET() {
  try {
    const [ig, yt] = await Promise.all([countWhere(IG_TABLE), countWhere(YT_TABLE)]);
    const porEstado: Record<string, number> = {};
    await Promise.all(
      ESTADOS.map(async (e) => {
        const [a, b] = await Promise.all([countWhere(IG_TABLE, e.key), countWhere(YT_TABLE, e.key)]);
        porEstado[e.key] = a + b;
      })
    );
    return NextResponse.json({ total: ig + yt, ig, yt, porEstado });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
