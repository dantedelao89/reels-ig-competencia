import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { uploadToR2, r2Enabled } from '@/lib/r2';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB (son imágenes de referencia)

// Next solo permite exportar métodos HTTP desde route.ts — la lista se duplica en RefsManager.
const REF_TIPOS = ['portada', 'lista', 'quote', 'numero', 'contenido', 'cta'] as const;

// Biblioteca de referencias del regenerador de carruseles: imágenes ancla del branding cuaderno
// y fotos de CTA con la cara de Dante, etiquetadas por tipo de slide. Viven en R2 (regen/refs/)
// y en la tabla regen_refs.
export async function GET(req: NextRequest) {
  const all = req.nextUrl.searchParams.get('all') === '1';
  let q = getSupabase()
    .from('regen_refs')
    .select('id, tipo, nombre, url, notas, activo, creado_en')
    .order('tipo')
    .order('creado_en');
  if (!all) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ refs: data || [] });
}

export async function POST(req: NextRequest) {
  if (!r2Enabled()) {
    return NextResponse.json({ error: 'R2 no configurado en el dashboard' }, { status: 500 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Se esperaba multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  const tipo = (form.get('tipo') || '').toString();
  const nombre = (form.get('nombre') || '').toString().trim();
  const notas = (form.get('notas') || '').toString().trim() || null;

  if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
  if (!REF_TIPOS.includes(tipo as any)) {
    return NextResponse.json({ error: `tipo inválido (${REF_TIPOS.join(', ')})` }, { status: 400 });
  }
  if (!nombre) return NextResponse.json({ error: 'Falta el nombre' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'La imagen supera 25 MB' }, { status: 413 });

  const ext = ((file.name || '').split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const buf = Buffer.from(await file.arrayBuffer());
  const key = `regen/refs/${randomUUID()}.${ext}`;

  try {
    const url = await uploadToR2(key, buf, file.type || 'image/png');
    const { data, error } = await getSupabase()
      .from('regen_refs')
      .insert({ tipo, nombre, url, notas })
      .select('id, tipo, nombre, url, notas, activo, creado_en')
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, ref: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Soft-delete: los planes viejos pueden seguir referenciando el uuid, así que solo se desactiva.
export async function DELETE(req: NextRequest) {
  const { id, activo } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const { error } = await getSupabase()
    .from('regen_refs')
    .update({ activo: activo === true }) // DELETE con {activo:true} reactiva
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
