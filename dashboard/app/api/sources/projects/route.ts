import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { SOURCE_DEFS, ALL_SOURCE_ORDER } from '@/lib/sources';

export const dynamic = 'force-dynamic';

// Devuelve los proyectos distintos que ya existen en las 4 tablas de fuentes (Supabase),
// para poblar el desplegable de "Proyecto".
export async function GET() {
  const set = new Set<string>();
  try {
    const c = getSupabase();
    for (const type of ALL_SOURCE_ORDER) {
      const d = SOURCE_DEFS[type];
      const { data, error } = await c.from(d.table).select('proyecto');
      if (error) throw new Error(error.message);
      for (const r of data || []) {
        if (r.proyecto) set.add(r.proyecto.toString());
      }
    }
    return NextResponse.json({ projects: Array.from(set).sort((a, b) => a.localeCompare(b)) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
