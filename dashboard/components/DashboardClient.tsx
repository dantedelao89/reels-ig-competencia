'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentItem, Estado } from '@/lib/types';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import ContentGrid from './ContentGrid';
import TableView from './TableView';
import DetailModal from './DetailModal';

interface Stats {
  total: number;
  ig: number;
  yt: number;
  porEstado: Record<string, number>;
}

const PAGE_SIZE = 40;

export default function DashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [platform, setPlatform] = useState('all');
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState('fecha_publicacion');
  const [dir, setDir] = useState('desc');
  const [view, setView] = useState<'grid' | 'table'>('grid');

  const [items, setItems] = useState<ContentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<ContentItem | null>(null);

  const refreshStats = useCallback(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((d) => !d.error && setStats(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Debounce de la búsqueda.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback(
    async (pageNum: number, replace: boolean) => {
      setLoading(true);
      const params = new URLSearchParams({
        platform,
        estado,
        q: debouncedQ,
        sort,
        dir,
        page: String(pageNum),
        pageSize: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/content?${params}`);
      const data = await res.json();
      setLoading(false);
      if (data.error) return;
      setTotal(data.total);
      setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
    },
    [platform, estado, debouncedQ, sort, dir]
  );

  // Al cambiar filtros → reset a página 1.
  useEffect(() => {
    setPage(1);
    fetchPage(1, true);
  }, [fetchPage]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const clearSel = () => setSelected(new Set());

  const selectedItems = () => items.filter((it) => selected.has(it.id));

  async function setEstadoFor(target: ContentItem[], nuevo: Estado) {
    if (target.length === 0) return;
    await fetch('/api/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: target.map((t) => ({ id: t.id, platform: t.platform })),
        estado: nuevo,
      }),
    });
    clearSel();
    setDetail(null);
    refreshStats();
    fetchPage(1, true);
    setPage(1);
  }

  function downloadThumbs(target: ContentItem[]) {
    target.forEach((it, i) => {
      if (!it.thumbnail) return;
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = `/api/download?url=${encodeURIComponent(it.thumbnail!)}&name=${it.platform}_${it.externalId}.jpg`;
        a.click();
      }, i * 250);
    });
  }

  const more = items.length < total;

  return (
    <div className="flex">
      <Sidebar stats={stats} estado={estado} onEstado={setEstado} />

      <main className="flex-1 min-w-0 px-4 md:px-6 py-5">
        <Topbar
          q={q}
          onQ={setQ}
          platform={platform}
          onPlatform={setPlatform}
          sort={sort}
          dir={dir}
          onSort={(f, d) => {
            setSort(f);
            setDir(d);
          }}
          view={view}
          onView={setView}
          total={total}
          igCount={stats?.ig}
          ytCount={stats?.yt}
        />

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-accent-soft">
            <span className="text-sm font-medium text-accent">{selected.size} seleccionados</span>
            <span className="flex-1" />
            <button onClick={() => setEstadoFor(selectedItems(), 'curado')} className="h-8 px-3 text-xs rounded-md border border-line bg-white">
              Marcar curado
            </button>
            <button onClick={() => setEstadoFor(selectedItems(), 'produccion')} className="h-8 px-3 text-xs rounded-md border border-line bg-white">
              A producción
            </button>
            <button onClick={() => downloadThumbs(selectedItems())} className="h-8 px-3 text-xs rounded-md border border-line bg-white">
              Descargar thumbnails
            </button>
            <button onClick={() => setEstadoFor(selectedItems(), 'descartado')} className="h-8 px-3 text-xs rounded-md border border-line bg-white">
              Descartar
            </button>
            <button onClick={clearSel} className="h-8 px-3 text-xs rounded-md text-muted">
              Limpiar
            </button>
          </div>
        )}

        {view === 'grid' ? (
          <ContentGrid items={items} selected={selected} onToggle={toggle} onOpen={setDetail} />
        ) : (
          <TableView items={items} selected={selected} onToggle={toggle} onOpen={setDetail} />
        )}

        {items.length === 0 && !loading && (
          <div className="text-center text-muted text-sm py-16">Sin resultados.</div>
        )}

        <div className="flex justify-center py-6">
          {more && (
            <button
              onClick={() => {
                const next = page + 1;
                setPage(next);
                fetchPage(next, false);
              }}
              disabled={loading}
              className="h-10 px-5 text-sm rounded-lg border border-line bg-white disabled:opacity-60"
            >
              {loading ? 'Cargando…' : 'Cargar más'}
            </button>
          )}
        </div>
      </main>

      {detail && (
        <DetailModal
          item={detail}
          onClose={() => setDetail(null)}
          onEstado={(it, e) => setEstadoFor([it], e)}
        />
      )}
    </div>
  );
}
