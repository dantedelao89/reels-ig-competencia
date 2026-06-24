import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { ESTADOS } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function count(estado?: string, activo?: boolean): Promise<number> {
  let q = getSupabase().from('meta_ads').select('id', { count: 'exact', head: true });
  if (estado) q = q.eq('estado', estado);
  if (activo !== undefined) q = q.eq('activo', activo);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function GET() {
  try {
    const total = await count();
    const porEstado: Record<string, number> = {};
    await Promise.all(ESTADOS.map(async (e) => (porEstado[e.key] = await count(e.key))));
    const activos = await count(undefined, true);
    return NextResponse.json({ total, activos, porEstado });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
