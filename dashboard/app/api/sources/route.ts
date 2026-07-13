import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { SOURCE_DEFS, SourceType, normalizeKey } from '@/lib/sources';

export const dynamic = 'force-dynamic';

function isValidType(t: any): t is SourceType {
  return t === 'ig' || t === 'yt_channel' || t === 'yt_search' || t === 'fb_advertiser';
}

function toRecord(type: SourceType, row: any) {
  const d = SOURCE_DEFS[type];
  return {
    id: row.id,
    key: (row[d.keyColumn] ?? '').toString(),
    activo: row.activo === true,
    proyecto: row.proyecto ?? null,
    num: row[d.numColumn] ?? null,
    ultimaCorrida: row.ultima_corrida ?? null,
  };
}

// GET /api/sources?type=ig|yt_channel|yt_search|fb_advertiser
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');
  if (!isValidType(type)) return NextResponse.json({ error: 'type inválido' }, { status: 400 });
  const d = SOURCE_DEFS[type];
  try {
    const { data, error } = await getSupabase().from(d.table).select('*');
    if (error) throw new Error(error.message);
    return NextResponse.json({ records: (data || []).map((r) => toRecord(type, r)) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST { type, key, proyecto?, num?, activo? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { type } = body;
  if (!isValidType(type) || !body.key?.trim()) {
    return NextResponse.json({ error: 'type y key requeridos' }, { status: 400 });
  }
  const d = SOURCE_DEFS[type];
  try {
    const c = getSupabase();
    // Candado anti-duplicados: comparamos la key normalizada contra lo que ya existe en Supabase.
    const norm = normalizeKey(type, body.key);
    const { data: existing, error: selErr } = await c.from(d.table).select(`id, ${d.keyColumn}`);
    if (selErr) throw new Error(selErr.message);
    const dup = (existing || []).find((r: any) => normalizeKey(type, (r[d.keyColumn] ?? '').toString()) === norm);
    if (dup) {
      return NextResponse.json(
        { error: `Ya existe: "${(dup as any)[d.keyColumn]}"`, duplicate: true },
        { status: 409 }
      );
    }

    const row: Record<string, any> = { [d.keyColumn]: body.key.trim(), activo: body.activo !== false };
    if (body.proyecto) row.proyecto = body.proyecto;
    if (body.num != null && body.num !== '') row[d.numColumn] = Number(body.num);
    const { data, error } = await c.from(d.table).insert(row).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, record: toRecord(type, data) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH { type, id, activo?, proyecto?, num? }
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { type, id } = body;
  if (!isValidType(type) || !id) return NextResponse.json({ error: 'type e id requeridos' }, { status: 400 });
  const d = SOURCE_DEFS[type];
  const row: Record<string, any> = {};
  if (body.activo !== undefined) row.activo = !!body.activo;
  if (body.proyecto !== undefined) row.proyecto = body.proyecto;
  if (body.num !== undefined) row[d.numColumn] = body.num === '' || body.num == null ? null : Number(body.num);
  try {
    const { data, error } = await getSupabase().from(d.table).update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, record: toRecord(type, data) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE ?type=&id=
export async function DELETE(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');
  const id = req.nextUrl.searchParams.get('id');
  if (!isValidType(type) || !id) return NextResponse.json({ error: 'type e id requeridos' }, { status: 400 });
  const d = SOURCE_DEFS[type];
  try {
    const { error } = await getSupabase().from(d.table).delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
