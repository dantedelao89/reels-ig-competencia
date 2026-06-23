import { NextResponse } from 'next/server';
import { SOURCE_DEFS, SOURCE_ORDER } from '@/lib/sources';

export const dynamic = 'force-dynamic';

// Devuelve los proyectos distintos que ya existen en las 3 tablas de fuentes (Airtable),
// para poblar el desplegable de "Proyecto".
export async function GET() {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) {
    return NextResponse.json({ error: 'Falta AIRTABLE_TOKEN / AIRTABLE_BASE_ID' }, { status: 500 });
  }
  const set = new Set<string>();
  try {
    for (const type of SOURCE_ORDER) {
      const d = SOURCE_DEFS[type];
      const table = process.env[d.tableEnv] || d.tableDefault;
      let offset: string | undefined;
      do {
        const u = new URL(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`);
        u.searchParams.set('pageSize', '100');
        u.searchParams.set('fields[]', 'Proyecto');
        if (offset) u.searchParams.set('offset', offset);
        const res = await fetch(u.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || `Airtable ${res.status}`);
        for (const r of data.records || []) {
          const p = r.fields?.['Proyecto'];
          if (p) set.add(p.toString());
        }
        offset = data.offset;
      } while (offset);
    }
    return NextResponse.json({ projects: Array.from(set).sort((a, b) => a.localeCompare(b)) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
