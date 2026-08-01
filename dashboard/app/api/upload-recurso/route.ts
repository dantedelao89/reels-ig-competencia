import { NextRequest, NextResponse } from 'next/server';
import { uploadToR2, r2Enabled } from '@/lib/r2';
import { getSupabase, IG_TABLE, YT_TABLE } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB (PDFs, imágenes, docs…)

// Sube a R2 el "recurso del creador" (PDF, imagen, etc.) bajo el prefijo recursos/ y guarda su URL +
// nombre original en recurso_url / recurso_nombre del item. Es opcional; alternativa a pegar una URL.
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
  const externalId = (form.get('externalId') || 'item').toString().replace(/[^\w.-]/g, '_');

  if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
  if (!id || (platform !== 'ig' && platform !== 'yt' && platform !== 'ad')) {
    return NextResponse.json({ error: 'id/platform inválidos' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'El archivo supera 100 MB' }, { status: 413 });
  }

  const nombre = file.name || 'recurso';
  const ext = (nombre.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const buf = Buffer.from(await file.arrayBuffer());
  const key = `recursos/${platform}_${externalId}.${ext}`;

  const TABLES: Record<string, string> = { ig: IG_TABLE, yt: YT_TABLE, ad: 'meta_ads' };

  try {
    const url = await uploadToR2(key, buf, file.type || 'application/octet-stream');
    const { error } = await getSupabase()
      .from(TABLES[platform])
      .update({ recurso_url: url, recurso_nombre: nombre })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, url, nombre });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
