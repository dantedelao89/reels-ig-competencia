import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Campos del slide que la UI puede editar (notas, acción, referencia, textos). El estado/output
// los maneja solo el job del scraper.
const EDITABLE = ['accion', 'refId', 'textoNuevo', 'nota', 'prompt', 'tipoSlide'] as const;

// Edita UN slide del plan del regenerador vía la RPC regen_patch_slide (merge atómico en
// Postgres): el job de fondo y la UI nunca se pisan el array completo.
export async function PATCH(req: NextRequest) {
  const { shortcode, idx, patch } = await req.json().catch(() => ({}));
  if (!shortcode || !Number.isInteger(idx) || !patch || typeof patch !== 'object') {
    return NextResponse.json({ error: 'Faltan shortcode, idx y patch' }, { status: 400 });
  }
  const clean: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in patch) clean[k] = patch[k];
  if (Object.keys(clean).length === 0) {
    return NextResponse.json({ error: 'Nada editable en el patch' }, { status: 400 });
  }
  const { error } = await getSupabase().rpc('regen_patch_slide', {
    p_shortcode: shortcode,
    p_idx: idx,
    p_patch: clean,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
