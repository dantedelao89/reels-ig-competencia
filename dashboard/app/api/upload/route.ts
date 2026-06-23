import { NextRequest, NextResponse } from 'next/server';
import { uploadToR2, r2Enabled } from '@/lib/r2';
import { getSupabase, IG_TABLE, YT_TABLE } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

// Sube el video final de producción a R2 (prefijo mis-videos/) y guarda la URL en mi_video_url.
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
  const id = (form.get('id') || '').toString();
  const platform = (form.get('platform') || '').toString();
  const externalId = (form.get('externalId') || 'video').toString().replace(/[^\w.-]/g, '_');

  if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
  if (!id || (platform !== 'ig' && platform !== 'yt')) {
    return NextResponse.json({ error: 'id/platform inválidos' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'El video supera 200 MB' }, { status: 413 });
  }

  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const buf = Buffer.from(await file.arrayBuffer());
  const key = `mis-videos/${platform}_${externalId}.${ext}`;

  try {
    const url = await uploadToR2(key, buf, file.type || 'video/mp4');
    const table = platform === 'ig' ? IG_TABLE : YT_TABLE;
    const { error } = await getSupabase().from(table).update({ mi_video_url: url }).eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
