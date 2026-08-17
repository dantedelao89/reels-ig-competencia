import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { ESTADOS } from '@/lib/types';
import { PLATFORMS, PLATFORM_ORDER } from '@/lib/platforms';

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
    const totales = await Promise.all(PLATFORM_ORDER.map((p) => countWhere(PLATFORMS[p].table)));
    const porPlataforma: Record<string, number> = {};
    PLATFORM_ORDER.forEach((p, i) => (porPlataforma[p] = totales[i]));

    const porEstado: Record<string, number> = {};
    await Promise.all(
      ESTADOS.map(async (e) => {
        const n = await Promise.all(PLATFORM_ORDER.map((p) => countWhere(PLATFORMS[p].table, e.key)));
        porEstado[e.key] = n.reduce((a, b) => a + b, 0);
      })
    );

    return NextResponse.json({
      total: totales.reduce((a, b) => a + b, 0),
      porPlataforma,
      porEstado,
      // Se conservan las claves planas para no romper a nadie que aún las lea.
      ...porPlataforma,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
