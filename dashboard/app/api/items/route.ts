import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { CURATION_TABLES, isCurable } from '@/lib/platforms';

export const dynamic = 'force-dynamic';

const VALID = ['por_curar', 'curado', 'produccion', 'publicado', 'descartado'];

// PATCH: cambia el estado (y opcionalmente campos de producción) de uno o varios items.
// Body: { items: [{id, platform}], estado?, mi_guion?, mi_notas?, mi_link? }
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.items?.length) {
    return NextResponse.json({ error: 'items requerido' }, { status: 400 });
  }
  const { estado, mi_guion, mi_notas, mi_link, mi_video_url, recurso_url, recurso_nombre } = body;
  if (estado && !VALID.includes(estado)) {
    return NextResponse.json({ error: 'estado inválido' }, { status: 400 });
  }

  const patch: Record<string, any> = {};
  if (estado) {
    patch.estado = estado;
    if (estado === 'curado') patch.curado_en = new Date().toISOString();
    if (estado === 'publicado') patch.publicado_en = new Date().toISOString();
  }
  if (mi_guion !== undefined) patch.mi_guion = mi_guion;
  if (mi_notas !== undefined) patch.mi_notas = mi_notas;
  if (mi_link !== undefined) patch.mi_link = mi_link;
  if (mi_video_url !== undefined) patch.mi_video_url = mi_video_url;
  // Recurso que regaló el creador (URL externa o archivo subido a R2). Opcional; null = quitar.
  if (recurso_url !== undefined) patch.recurso_url = recurso_url || null;
  if (recurso_nombre !== undefined) patch.recurso_nombre = recurso_nombre || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nada que actualizar' }, { status: 400 });
  }

  // El bucle recorre las TABLAS, no los items: un item con una plataforma desconocida no coincidía
  // con ninguna y se ignoraba en silencio, devolviendo ok:true. Se valida antes.
  const desconocidas = [
    ...new Set(body.items.map((i: any) => i.platform).filter((p: any) => !isCurable(p))),
  ];
  if (desconocidas.length) {
    return NextResponse.json({ error: `plataforma desconocida: ${desconocidas.join(', ')}` }, { status: 400 });
  }

  const supabase = getSupabase();

  try {
    let updated = 0;
    for (const platform of Object.keys(CURATION_TABLES)) {
      const ids = body.items.filter((i: any) => i.platform === platform).map((i: any) => i.id);
      if (!ids.length) continue;
      const { error } = await supabase.from(CURATION_TABLES[platform as keyof typeof CURATION_TABLES]).update(patch).in('id', ids);
      if (error) throw new Error(error.message);
      updated += ids.length;
    }
    // Red de seguridad: si por lo que sea no se tocaron todos, no se miente con un ok:true.
    if (updated !== body.items.length) {
      return NextResponse.json(
        { error: `se actualizaron ${updated} de ${body.items.length} items` },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
