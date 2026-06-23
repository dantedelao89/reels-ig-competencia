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
  try {
    const { data, error } = await getSupabase()
      .from(table)
      .select(`${textCol}, mi_guion, mi_notas, mi_link, mi_video_url`)
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({
      transcripcion: (data as any)[textCol] ?? null,
      miGuion: (data as any).mi_guion ?? null,
      miNotas: (data as any).mi_notas ?? null,
      miLink: (data as any).mi_link ?? null,
      miVideoUrl: (data as any).mi_video_url ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
