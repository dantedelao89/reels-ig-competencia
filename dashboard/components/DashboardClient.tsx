'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentItem, Estado } from '@/lib/types';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import FilterBar from './FilterBar';
import type { DateState } from './DateFilter';
import ContentGrid from './ContentGrid';
import TableView from './TableView';
import DetailModal from './DetailModal';
import SourcesManager from './SourcesManager';
import AdsView from './AdsView';

interface Facets {
  creadores: { value: string; count: number }[];
  proyectos: { value: string; count: number }[];
}

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

  const [facets, setFacets] = useState<Facets | null>(null);
  const [creadores, setCreadores] = useState<string[]>([]);
  const [proyectos, setProyectos] = useState<string[]>([]);
  const [origen, setOrigen] = useState(''); // '', 'canal', 'busqueda' (solo YouTube)
  const [date, setDate] = useState<DateState>({ dateField: 'fecha_publicacion', desde: '', hasta: '' });

  const [items, setItems] = useState<ContentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<ContentItem | null>(null);
  const [section, setSection] = useState<'contenido' | 'fuentes'>('contenido');
  const [mode, setMode] = useState<'organico' | 'ads'>('organico');

  // Agregar contenido ad-hoc pegando una URL de Instagram (reel/post/carrusel).
  const [igUrl, setIgUrl] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const [addUrlMsg, setAddUrlMsg] = useState('');

  const refreshStats = useCallback(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((d) => !d.error && setStats(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStats();
    fetch('/api/facets')
      .then((r) => r.json())
      .then((d) => !d.error && setFacets(d))
      .catch(() => {});
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
      if (creadores.length) params.set('creador', creadores.join(','));
      if (proyectos.length) params.set('proyecto', proyectos.join(','));
      if (origen) params.set('origen', origen);
      if (date.desde || date.hasta) {
        params.set('dateField', date.dateField);
        if (date.desde) params.set('desde', date.desde);
        if (date.hasta) params.set('hasta', date.hasta);
      }
      const res = await fetch(`/api/content?${params}`);
      const data = await res.json();
      setLoading(false);
      if (data.error) return;
      setTotal(data.total);
      setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
    },
    [platform, estado, debouncedQ, sort, dir, creadores, proyectos, origen, date]
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

  async function saveProduction(
    target: ContentItem,
    fields: { mi_guion: string; mi_notas: string; mi_link: string }
  ) {
    await fetch('/api/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: target.id, platform: target.platform }], ...fields }),
    });
    const patch = { miGuion: fields.mi_guion, miNotas: fields.mi_notas, miLink: fields.mi_link };
    setItems((prev) => prev.map((it) => (it.id === target.id ? { ...it, ...patch } : it)));
    setDetail((d) => (d && d.id === target.id ? { ...d, ...patch } : d));
  }

  async function addByUrl() {
    const u = igUrl.trim();
    if (!u || addingUrl) return;
    const isYt = /youtu\.?be/i.test(u);
    const isIg = /instagram\.com/i.test(u);
    if (!isYt && !isIg) {
      setAddUrlMsg('Pega una URL de Instagram o YouTube');
      return;
    }
    setAddingUrl(true);
    setAddUrlMsg('');
    try {
      const res = await fetch(isYt ? '/api/scrape-yt-url' : '/api/scrape-ig-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Error al agregar');
      if (data.inserted > 0) {
        const quien = data.creador || data.canal;
        setAddUrlMsg(`✓ Agregado${quien ? ` (${quien})` : ''}`);
        setIgUrl('');
        refreshStats();
        setPage(1);
        fetchPage(1, true);
      } else {
        setAddUrlMsg(data.message || 'Ya estaba en la base');
      }
    } catch (e: any) {
      setAddUrlMsg('Error: ' + e.message);
    } finally {
      setAddingUrl(false);
    }
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
      <Sidebar
        stats={stats}
        estado={estado}
        onEstado={setEstado}
        section={section}
        onSection={setSection}
        mode={mode}
        onMode={(m) => {
          setMode(m);
          setSection('contenido'); // al cambiar de Orgánico/Ads, aterriza en la galería
        }}
      />

      <main className="flex-1 min-w-0 px-4 md:px-6 py-5">
        {section === 'fuentes' && <SourcesManager mode={mode} />}
        {section !== 'fuentes' && mode === 'ads' && <AdsView />}
        <div style={{ display: section === 'fuentes' || mode === 'ads' ? 'none' : undefined }}>
        <Topbar
          q={q}
          onQ={setQ}
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

        <FilterBar
          platform={platform}
          onPlatform={setPlatform}
          facets={facets}
          creadores={creadores}
          proyectos={proyectos}
          date={date}
          origen={origen}
          onCreadores={setCreadores}
          onProyectos={setProyectos}
          onDate={setDate}
          onOrigen={setOrigen}
          onClearAll={() => {
            setCreadores([]);
            setProyectos([]);
            setOrigen('');
            setDate({ dateField: 'fecha_publicacion', desde: '', hasta: '' });
          }}
        />

        <div className="flex flex-wrap items-center gap-2 mb-4 p-2.5 rounded-lg border border-line bg-gray-50">
          <span className="text-xs font-medium text-gray-600 shrink-0">＋ Agregar por URL:</span>
          <input
            value={igUrl}
            onChange={(e) => {
              setIgUrl(e.target.value);
              setAddUrlMsg('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && addByUrl()}
            placeholder="URL de Instagram (reel/post/carrusel) o de YouTube (video)"
            className="flex-1 min-w-[220px] h-9 px-3 rounded-lg border border-line bg-white text-sm outline-none focus:border-accent"
          />
          <button
            onClick={addByUrl}
            disabled={!igUrl.trim() || addingUrl}
            className="h-9 px-4 text-sm rounded-lg bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {addingUrl ? 'Agregando…' : 'Agregar'}
          </button>
          {addUrlMsg && <span className="text-xs text-muted whitespace-nowrap">{addUrlMsg}</span>}
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-accent-soft">
            <span className="text-sm font-medium text-accent">{selected.size} seleccionados</span>
            <span className="flex-1" />
            <button onClick={() => setEstadoFor(selectedItems(), 'por_curar')} className="h-8 px-3 text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-800">
              Por curar
            </button>
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
        </div>
      </main>

      {detail && (
        <DetailModal
          item={detail}
          onClose={() => setDetail(null)}
          onEstado={(it, e) => setEstadoFor([it], e)}
          onSaveProduction={saveProduction}
          onUploaded={() => fetchPage(1, true)}
        />
      )}
    </div>
  );
}
