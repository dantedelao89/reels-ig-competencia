export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function fmtDateRel(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const day = 86_400_000;
  const days = Math.floor(diff / day);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days}d`;
  if (days < 365) return `hace ${Math.floor(days / 30)}mes`;
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short' });
}

export function fmtDateShort(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' });
}

// Convierte una transcripción "corrida" en párrafos legibles agrupando por oraciones. Ignora a
// propósito los saltos de línea del texto original: los subtítulos de YouTube traen un salto por
// cada línea de caption (no por párrafo), así que respetarlos deja bloques enormes o cortados mal.
export function toParagraphs(text: string | null | undefined, sentencesPerPara = 3): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  const clean = trimmed.replace(/\s+/g, ' ');
  // Oraciones: texto hasta un . ! ? … (con posible cierre de comillas/paréntesis), o el resto final.
  const sentences = clean.match(/[^.!?…]+[.!?…]+["'”’)\]]*|\S.*$/g) || [clean];
  const paras: string[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerPara) {
    const p = sentences.slice(i, i + sentencesPerPara).map((s) => s.trim()).join(' ').trim();
    if (p) paras.push(p);
  }
  return paras;
}
