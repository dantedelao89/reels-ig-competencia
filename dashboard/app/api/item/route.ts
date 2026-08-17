import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { CURATION_TABLES, CURATION_TEXT_COL, PLATFORMS, isCurable } from '@/lib/platforms';

export const dynamic = 'force-dynamic';

// Trae los campos pesados de un item (transcripción/subtítulos) bajo demanda, al abrir el detalle.
// Así la lista queda ligera y rápida.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const platform = sp.get('platform');
  const id = sp.get('id');
  // Sin esta validación, una plataforma desconocida caía en el `else` (que era YouTube) y leía
  // la tabla equivocada devolviendo 200 con datos de otro contenido.
  if (!id || !isCurable(platform)) {
    return NextResponse.json({ error: 'platform e id requeridos' }, { status: 400 });
  }
  const table = CURATION_TABLES[platform];
  const textCol = CURATION_TEXT_COL[platform];
  // Columnas propias de cada plataforma (variantes A/B en YouTube, regenerador en Instagram).
  const extraCols = platform === 'ad' ? '' : PLATFORMS[platform].detailExtraCols;
  try {
    const { data, error } = await getSupabase()
      .from(table)
      .select(`${textCol}, traduccion, hashtags, mi_guion, mi_notas, mi_link, mi_video_url, recurso_url, recurso_nombre${extraCols}`)
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({
      transcripcion: (data as any)[textCol] ?? null,
      traduccion: (data as any).traduccion ?? null,
      hashtags: (data as any).hashtags ?? null,
      miGuion: (data as any).mi_guion ?? null,
      miNotas: (data as any).mi_notas ?? null,
      miLink: (data as any).mi_link ?? null,
      miVideoUrl: (data as any).mi_video_url ?? null,
      recursoUrl: (data as any).recurso_url ?? null,
      recursoNombre: (data as any).recurso_nombre ?? null,
      variantes: (data as any).variantes ?? [],
      videoId: (data as any).video_id ?? null,
      regen: (data as any).regen ?? null,
      regenEstado: (data as any).regen_estado ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
