import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function distinct(col: string): Promise<{ value: string; count: number }[]> {
  const { data, error } = await getSupabase().from('meta_ads').select(col).limit(10000);
  if (error) throw new Error(error.message);
  const map = new Map<string, number>();
  for (const r of data || []) {
    const v = (r as any)[col];
    if (v) map.set(v, (map.get(v) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

export async function GET() {
  try {
    const [anunciantes, proyectos] = await Promise.all([distinct('anunciante'), distinct('proyecto')]);
    return NextResponse.json({ anunciantes, proyectos });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
