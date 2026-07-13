import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Id numérico de una URL de Facebook (profile.php?id=... o /<id>/).
function idOf(url: string): string | null {
  const m = (url || '').match(/(\d{8,})/);
  return m ? m[1] : null;
}

// GET /api/ads/advertisers → [{ url, name, adCount, lastRun, activo }]
export async function GET() {
  try {
    const c = getSupabase();
    const [advRes, adsRes] = await Promise.all([
      c.from('fb_advertisers').select('url, activo, ultima_corrida'),
      c.from('meta_ads').select('anunciante, pagina_url'),
    ]);
    if (advRes.error) throw new Error(advRes.error.message);
    if (adsRes.error) throw new Error(adsRes.error.message);

    // Agrupa meta_ads por id numérico de pagina_url → { nombre, conteo }.
    const byId = new Map<string, { name: string; count: number }>();
    for (const row of (adsRes.data || []) as any[]) {
      const id = idOf(row.pagina_url || '');
      if (!id) continue;
      const cur = byId.get(id) || { name: '', count: 0 };
      cur.count++;
      if (!cur.name && row.anunciante) cur.name = row.anunciante;
      byId.set(id, cur);
    }

    const advertisers = (advRes.data || [])
      .map((a: any) => {
        const url = (a.url ?? '').toString();
        const id = idOf(url);
        const info = id ? byId.get(id) : undefined;
        return {
          url,
          activo: a.activo === true,
          lastRun: a.ultima_corrida ?? null,
          name: info?.name || url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, ''),
          adCount: info?.count || 0,
        };
      })
      .sort((x, y) => x.name.localeCompare(y.name));

    return NextResponse.json({ advertisers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
