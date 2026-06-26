import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, IG_TABLE, YT_TABLE } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Trae los campos pesados de un item (transcripción/subtítulos) bajo demanda, al abrir el detalle.
// Así la lista queda ligera y rápida.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const platform = sp.get('platform');
  const id = sp.get('id');
  if (!id || (platform !== 'ig' && platform !== 'yt')) {
    return NextResponse.json({ error: 'platform e id requeridos' }, { status: 400 });
  }
  const table = platform === 'ig' ? IG_TABLE : YT_TABLE;
  const textCol = platform === 'ig' ? 'transcripcion' : 'subtitulos';
  // Solo YouTube tiene variantes A/B y video_id (para el botón "buscar variantes").
  const extraCols = platform === 'yt' ? ', variantes, video_id' : '';
  try {
    const { data, error } = await getSupabase()
      .from(table)
      .select(`${textCol}, traduccion, hashtags, mi_guion, mi_notas, mi_link, mi_video_url${extraCols}`)
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
      variantes: (data as any).variantes ?? [],
      videoId: (data as any).video_id ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
