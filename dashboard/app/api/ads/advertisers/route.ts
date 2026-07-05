import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const ADV_TABLE = process.env.ADVERTISERS_TABLE || 'Anunciantes';

// Lee los anunciantes (fuentes) de Airtable: su URL (para scrapear) + última corrida + activo.
async function airtableAdvertisers() {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) throw new Error('Falta AIRTABLE_TOKEN / AIRTABLE_BASE_ID');
  const records: any[] = [];
  let offset: string | undefined;
  do {
    const u = new URL(`https://api.airtable.com/v0/${base}/${encodeURIComponent(ADV_TABLE)}`);
    u.searchParams.set('pageSize', '100');
    if (offset) u.searchParams.set('offset', offset);
    const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Airtable ${res.status}`);
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records.map((r) => ({
    url: (r.fields?.URL ?? '').toString(),
    activo: r.fields?.Activo === true,
    lastRun: r.fields?.['Última corrida'] ?? null,
  }));
}

// Id numérico de una URL de Facebook (profile.php?id=... o /<id>/).
function idOf(url: string): string | null {
  const m = (url || '').match(/(\d{8,})/);
  return m ? m[1] : null;
}

// GET /api/ads/advertisers → [{ url, name, adCount, lastRun, activo }]
export async function GET() {
  try {
    const [advs, adsRes] = await Promise.all([
      airtableAdvertisers(),
      getSupabase().from('meta_ads').select('anunciante, pagina_url'),
    ]);
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

    const advertisers = advs
      .map((a) => {
        const info = idOf(a.url) ? byId.get(idOf(a.url)!) : undefined;
        return {
          url: a.url,
          activo: a.activo,
          lastRun: a.lastRun,
          name: info?.name || a.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, ''),
          adCount: info?.count || 0,
        };
      })
      .sort((x, y) => x.name.localeCompare(y.name));

    return NextResponse.json({ advertisers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
