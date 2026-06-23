import { NextResponse } from 'next/server';
import { getSupabase, IG_TABLE, YT_TABLE } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Devuelve los valores distintos (con conteo) de creador y proyecto, para los selectores facetados.
// Une los creadores de IG (columna creador) y los canales de YT (columna canal).
async function distinctCounts(table: string, col: string): Promise<Map<string, number>> {
  const supabase = getSupabase();
  const map = new Map<string, number>();
  // Traemos solo la columna; a escala actual (cientos) es barato contar en memoria.
  const { data, error } = await supabase.from(table).select(col).limit(10000);
  if (error) throw new Error(`${table}.${col}: ${error.message}`);
  for (const row of data || []) {
    const v = (row as any)[col];
    if (!v) continue;
    map.set(v, (map.get(v) || 0) + 1);
  }
  return map;
}

function mergeSorted(...maps: Map<string, number>[]): { value: string; count: number }[] {
  const total = new Map<string, number>();
  for (const m of maps) for (const [k, v] of m) total.set(k, (total.get(k) || 0) + v);
  return Array.from(total.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

export async function GET() {
  try {
    const [igCreador, ytCanal, igProy, ytProy] = await Promise.all([
      distinctCounts(IG_TABLE, 'creador'),
      distinctCounts(YT_TABLE, 'canal'),
      distinctCounts(IG_TABLE, 'proyecto'),
      distinctCounts(YT_TABLE, 'proyecto'),
    ]);
    return NextResponse.json({
      creadores: mergeSorted(igCreador, ytCanal),
      proyectos: mergeSorted(igProy, ytProy),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
