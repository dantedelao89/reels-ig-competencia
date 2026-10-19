import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Acciones sobre un hallazgo del radar: promoverlo (dar de alta a su autor en Fuentes) o
// descartarlo. Promover es el puente entre descubrimiento y pipeline: a partir de ahí la cuenta se
// scrapea como cualquier otra y su contenido SÍ se archiva a R2.
//
// Promover depende de la plataforma, y confundirlas corrompería Fuentes en silencio: un hallazgo de
// YouTube promovido a `x_creators` crearía una cuenta de X con el nombre de un canal, que luego el
// scraper intentaría buscar en X. Por eso cada plataforma tiene su tabla y su columna.
const DESTINO: Record<string, { tabla: string; columna: string; desde: 'creador' | 'creador_url'; donde: string }> = {
  x: { tabla: 'x_creators', columna: 'username', desde: 'creador', donde: 'Fuentes → Cuentas X' },
  yt: { tabla: 'yt_channels', columna: 'canal_url', desde: 'creador_url', donde: 'Fuentes → Canales YT' },
};

export async function POST(req: NextRequest) {
  const { id, accion } = await req.json().catch(() => ({}));
  if (!id || !['promover', 'descartar', 'restaurar'].includes(accion)) {
    return NextResponse.json({ error: 'id y accion (promover|descartar|restaurar) requeridos' }, { status: 400 });
  }
  const supabase = getSupabase();

  if (accion !== 'promover') {
    const { error } = await supabase
      .from('radar')
      .update({ descartado: accion === 'descartar' })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { data: fila, error: e1 } = await supabase
    .from('radar')
    .select('id,plataforma,creador,creador_url')
    .eq('id', id)
    .maybeSingle();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!fila) return NextResponse.json({ error: 'No se encontró ese hallazgo' }, { status: 404 });

  const destino = DESTINO[fila.plataforma];
  if (!destino) {
    return NextResponse.json(
      { error: `Promover todavía no está soportado en ${fila.plataforma}. Usa 💾 Guardar para quedarte con el contenido.` },
      { status: 400 }
    );
  }

  const valorCrudo = (fila as any)[destino.desde];
  if (!valorCrudo) {
    return NextResponse.json({ error: 'Ese hallazgo no trae los datos de su autor' }, { status: 400 });
  }
  // En X la clave es el handle normalizado; en YouTube es la URL del canal, que ya viene limpia.
  const clave =
    fila.plataforma === 'x' ? String(valorCrudo).replace(/^@/, '').toLowerCase() : String(valorCrudo).trim();

  // ¿Ya estaba? Se compara normalizado, igual que normalizeKey del gestor de fuentes: la misma
  // cuenta puede estar guardada con @, con mayúsculas o con la URL terminada en /.
  const { data: cuentas, error: e2 } = await supabase.from(destino.tabla).select(`id,${destino.columna}`);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  const norm = (v: any) =>
    String(v || '')
      .trim()
      .replace(/^@/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  const yaEstaba = (cuentas || []).find((c: any) => norm(c[destino.columna]) === norm(clave));

  if (!yaEstaba) {
    const { error: e3 } = await supabase
      .from(destino.tabla)
      .insert({ [destino.columna]: clave, activo: true });
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });
  }

  // Se marca el hallazgo aunque la cuenta ya existiera: promovido significa "ya lo juzgué".
  const { error: e4 } = await supabase.from('radar').update({ promovido: true }).eq('id', id);
  if (e4) return NextResponse.json({ error: e4.message }, { status: 500 });

  return NextResponse.json({ ok: true, handle: clave, yaEstaba: !!yaEstaba, donde: destino.donde });
}
