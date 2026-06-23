import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, IG_TABLE, YT_TABLE } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const VALID = ['por_curar', 'curado', 'produccion', 'publicado', 'descartado'];

// PATCH: cambia el estado (y opcionalmente campos de producción) de uno o varios items.
// Body: { items: [{id, platform}], estado?, mi_guion?, mi_notas?, mi_link? }
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.items?.length) {
    return NextResponse.json({ error: 'items requerido' }, { status: 400 });
  }
  const { estado, mi_guion, mi_notas, mi_link, mi_video_url } = body;
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

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nada que actualizar' }, { status: 400 });
  }

  const supabase = getSupabase();
  const igIds = body.items.filter((i: any) => i.platform === 'ig').map((i: any) => i.id);
  const ytIds = body.items.filter((i: any) => i.platform === 'yt').map((i: any) => i.id);

  try {
    if (igIds.length) {
      const { error } = await supabase.from(IG_TABLE).update(patch).in('id', igIds);
      if (error) throw new Error(error.message);
    }
    if (ytIds.length) {
      const { error } = await supabase.from(YT_TABLE).update(patch).in('id', ytIds);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, updated: igIds.length + ytIds.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
