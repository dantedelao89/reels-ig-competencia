import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, IG_TABLE } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Estado del regenerador de un carrusel: la UI hace polling aquí mientras trabaja el job.
// Lee Supabase directo (más barato que proxyear al scraper).
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const { data, error } = await getSupabase()
    .from(IG_TABLE)
    .select('regen, regen_estado, regen_actualizado, regen_meta, regen_progreso')
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    regen: data.regen ?? null,
    regenEstado: data.regen_estado ?? null,
    regenActualizado: data.regen_actualizado ?? null,
    regenMeta: data.regen_meta ?? null,
    regenProgreso: data.regen_progreso ?? null,
  });
}
