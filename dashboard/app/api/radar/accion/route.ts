import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Acciones sobre un hallazgo del radar: promoverlo (dar de alta a su autor en Fuentes) o
// descartarlo. Promover es el puente entre descubrimiento y pipeline: a partir de ahí la cuenta se
// scrapea como cualquier otra y su contenido SÍ se archiva a R2.
export async function POST(req: NextRequest) {
  const { id, accion } = await req.json().catch(() => ({}));
  if (!id || !['promover', 'descartar', 'restaurar'].includes(accion)) {
    return NextResponse.json({ error: 'id y accion (promover|descartar|restaurar) requeridos' }, { status: 400 });
  }
  const supabase = getSupabase();

  if (accion !== 'promover') {
    const { error } = await supabase
      .from('x_radar')
      .update({ descartado: accion === 'descartar' })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { data: fila, error: e1 } = await supabase
    .from('x_radar')
    .select('id,creador')
    .eq('id', id)
    .maybeSingle();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!fila?.creador) return NextResponse.json({ error: 'Ese hallazgo no tiene autor' }, { status: 400 });

  const handle = String(fila.creador).replace(/^@/, '').toLowerCase();

  // ¿Ya estaba? Se compara normalizado, igual que normalizeKey del gestor de fuentes: la misma
  // cuenta puede estar guardada con @ o con mayúsculas.
  const { data: cuentas, error: e2 } = await supabase.from('x_creators').select('id,username');
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  const yaEstaba = (cuentas || []).find(
    (c: any) => String(c.username || '').replace(/^@/, '').toLowerCase() === handle
  );

  if (!yaEstaba) {
    const { error: e3 } = await supabase.from('x_creators').insert({ username: handle, activo: true });
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });
  }

  // Se marca el hallazgo aunque la cuenta ya existiera: promovido significa "ya lo juzgué".
  const { error: e4 } = await supabase.from('x_radar').update({ promovido: true }).eq('id', id);
  if (e4) return NextResponse.json({ error: e4.message }, { status: 500 });

  return NextResponse.json({ ok: true, handle, yaEstaba: !!yaEstaba });
}
