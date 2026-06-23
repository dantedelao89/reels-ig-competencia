import { NextRequest, NextResponse } from 'next/server';
import { SOURCE_DEFS, SourceType, normalizeKey } from '@/lib/sources';

export const dynamic = 'force-dynamic';

function cfg() {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) throw new Error('Falta AIRTABLE_TOKEN / AIRTABLE_BASE_ID');
  return { token, base };
}

function tableFor(type: SourceType): string {
  const d = SOURCE_DEFS[type];
  return process.env[d.tableEnv] || d.tableDefault;
}

function urlFor(type: SourceType, recordId?: string): string {
  const { base } = cfg();
  const t = encodeURIComponent(tableFor(type));
  return `https://api.airtable.com/v0/${base}/${t}${recordId ? `/${recordId}` : ''}`;
}

async function airtable(method: string, url: string, body?: any) {
  const { token } = cfg();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || data?.error?.type || `Airtable ${res.status}`);
  return data;
}

function isValidType(t: any): t is SourceType {
  return t === 'ig' || t === 'yt_channel' || t === 'yt_search';
}

function toRecord(type: SourceType, rec: any) {
  const d = SOURCE_DEFS[type];
  const f = rec.fields || {};
  return {
    id: rec.id,
    key: (f[d.keyField] ?? '').toString(),
    activo: f['Activo'] === true,
    proyecto: f['Proyecto'] ?? null,
    num: f[d.numField] ?? null,
    ultimaCorrida: f['Última corrida'] ?? null,
  };
}

// GET /api/sources?type=ig|yt_channel|yt_search
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');
  if (!isValidType(type)) return NextResponse.json({ error: 'type inválido' }, { status: 400 });
  try {
    const records: any[] = [];
    let offset: string | undefined;
    do {
      const u = new URL(urlFor(type));
      u.searchParams.set('pageSize', '100');
      if (offset) u.searchParams.set('offset', offset);
      const data = await airtable('GET', u.toString());
      records.push(...(data.records || []));
      offset = data.offset;
    } while (offset);
    return NextResponse.json({ records: records.map((r) => toRecord(type, r)) });
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
    // Candado anti-duplicados: comparamos la key normalizada contra lo que ya existe en Airtable.
    const norm = normalizeKey(type, body.key);
    const existing: any[] = [];
    let offset: string | undefined;
    do {
      const u = new URL(urlFor(type));
      u.searchParams.set('pageSize', '100');
      u.searchParams.set('fields[]', d.keyField);
      if (offset) u.searchParams.set('offset', offset);
      const page = await airtable('GET', u.toString());
      existing.push(...(page.records || []));
      offset = page.offset;
    } while (offset);
    const dup = existing.find((r) => normalizeKey(type, (r.fields?.[d.keyField] ?? '').toString()) === norm);
    if (dup) {
      return NextResponse.json(
        { error: `Ya existe: "${(dup.fields?.[d.keyField] ?? '').toString()}"`, duplicate: true },
        { status: 409 }
      );
    }

    const fields: Record<string, any> = { [d.keyField]: body.key.trim(), Activo: body.activo !== false };
    if (body.proyecto) fields['Proyecto'] = body.proyecto;
    if (body.num != null && body.num !== '') fields[d.numField] = Number(body.num);
    const data = await airtable('POST', urlFor(type), { fields, typecast: true });
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
  const fields: Record<string, any> = {};
  if (body.activo !== undefined) fields['Activo'] = !!body.activo;
  if (body.proyecto !== undefined) fields['Proyecto'] = body.proyecto;
  if (body.num !== undefined) fields[d.numField] = body.num === '' || body.num == null ? null : Number(body.num);
  try {
    const data = await airtable('PATCH', urlFor(type, id), { fields, typecast: true });
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
  try {
    await airtable('DELETE', urlFor(type, id));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
