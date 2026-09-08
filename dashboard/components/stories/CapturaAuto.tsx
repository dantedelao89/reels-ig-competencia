'use client';

// Panel de captura automática de historias.
//
// Vive en Historias y no en Fuentes a propósito. Antes esto estaba repartido en tres sitios que no
// se hablaban: una columna "Historias auto" perdida en la tabla de Creadores IG, una variable de
// entorno en Railway que no se ve desde ninguna pantalla, y la sección de Historias, que no decía
// nada. Para saber si la captura estaba encendida había que entrar a Railway; para cambiar qué
// cuentas entraban, ir a otra pestaña. Aquí se responde de una vez: si está encendida, cuándo
// corre, a quién le corre, cuánto cuesta, y cómo se le añade o se le quita una cuenta.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../ui/Toast';
import SearchSelect from '../ui/SearchSelect';
import Spinner from '../ui/Spinner';

interface CuentaIG {
  id: string;
  key: string;
  extra?: boolean;
}

interface EstadoCron {
  activo: boolean;
  horario: string;
  zona: string;
  valido: boolean;
  cuentas: string[] | null;
}

// El actor cobra por historia. Una cuenta que publica ~15 al día, 2 pasadas diarias, ronda los
// $3/mes; se muestra para que encender cuentas nunca sea una decisión a ciegas.
const USD_MES_POR_CUENTA = 3;

// "0 9,21 * * *" → "9:00 y 21:00". Solo entiende la forma "minuto horas * * *", que es la que
// usamos; cualquier otra cosa se muestra tal cual en vez de mentir con una traducción inventada.
function horarioLegible(expr: string): string | null {
  const partes = (expr || '').trim().split(/\s+/);
  if (partes.length !== 5) return null;
  const [min, horas, ...resto] = partes;
  if (resto.join(' ') !== '* * *') return null;
  if (!/^\d{1,2}$/.test(min)) return null;
  if (!/^\d{1,2}(,\d{1,2})*$/.test(horas)) return null;
  const hs = horas.split(',').map((h) => `${Number(h)}:${min.padStart(2, '0')}`);
  return hs.length === 1 ? hs[0] : `${hs.slice(0, -1).join(', ')} y ${hs[hs.length - 1]}`;
}

export default function CapturaAuto() {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState<EstadoCron | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [cuentas, setCuentas] = useState<CuentaIG[]>([]);
  const [porAñadir, setPorAñadir] = useState('');
  const [guardando, setGuardando] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const [rc, rs] = await Promise.all([
        fetch('/api/crons').then((r) => r.json()),
        fetch('/api/sources?type=ig').then((r) => r.json()),
      ]);
      if (rc.error) setErrorEstado(rc.error);
      else {
        setEstado(rc.historias || null);
        setErrorEstado(null);
      }
      setCuentas(rs.records || []);
    } catch (e: any) {
      setErrorEstado(e.message || 'No se pudo leer el estado');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // La verdad de "qué cuentas entran" es la columna historias_auto, la misma que lee el cron.
  const enAuto = useMemo(() => cuentas.filter((c) => c.extra), [cuentas]);
  const disponibles = useMemo(
    () => cuentas.filter((c) => !c.extra).map((c) => ({ value: c.id, label: `@${c.key}` })),
    [cuentas]
  );

  async function marcar(cuenta: CuentaIG, valor: boolean) {
    if (guardando) return;
    // Encender cuesta dinero recurrente; apagar nunca necesita permiso.
    if (valor && !confirm(
      `¿Capturar las historias de @${cuenta.key} automáticamente, 2 veces al día?\n\n` +
      `El actor cobra por historia, así que una cuenta activa ronda los $${USD_MES_POR_CUENTA} al mes. ` +
      'Solo se cobran las cuentas de esta lista.'
    )) return;

    setGuardando(cuenta.id);
    // Optimista: el interruptor responde al instante y se revierte si el guardado falla.
    setCuentas((prev) => prev.map((c) => (c.id === cuenta.id ? { ...c, extra: valor } : c)));
    try {
      const res = await fetch('/api/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ig', id: cuenta.id, extra: valor }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo guardar');
      toast.success(
        valor
          ? `@${cuenta.key} entra en la captura automática`
          : `@${cuenta.key} ya no se captura sola`
      );
      setPorAñadir('');
    } catch (e: any) {
      setCuentas((prev) => prev.map((c) => (c.id === cuenta.id ? { ...c, extra: !valor } : c)));
      toast.error(e.message || 'No se pudo guardar');
    } finally {
      setGuardando(null);
    }
  }

  const horario = estado ? horarioLegible(estado.horario) : null;
  // Encendido de verdad = el cron corre Y hay a quién capturar. Sin cuentas no gasta nada, pero
  // tampoco hace nada: decir "encendida" ahí sería engañoso.
  const corriendo = !!estado?.activo && !!estado?.valido && enAuto.length > 0;

  return (
    <div className="mb-4 border border-line rounded-lg bg-white">
      {/* Barra siempre visible: el estado no debería requerir un clic para verse. */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-sm font-medium">🤖 Captura automática</span>

        {cargando ? (
          <Spinner />
        ) : errorEstado ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600" title={errorEstado}>
            no se pudo leer
          </span>
        ) : (
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              corriendo ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {corriendo ? '● Encendida' : '○ Apagada'}
          </span>
        )}

        {!cargando && !errorEstado && estado && (
          <span className="text-xs text-muted">
            {estado.activo && estado.valido
              ? horario
                ? `${horario} · hora de CDMX`
                : estado.horario
              : 'el cron está detenido'}
            {' · '}
            {enAuto.length === 0
              ? 'ninguna cuenta'
              : enAuto.length === 1
                ? `1 cuenta · ~$${USD_MES_POR_CUENTA}/mes`
                : `${enAuto.length} cuentas · ~$${enAuto.length * USD_MES_POR_CUENTA}/mes`}
          </span>
        )}

        <span className="flex-1" />
        <button
          onClick={() => setAbierto((v) => !v)}
          className="text-xs px-2 h-7 rounded-md border border-line bg-white hover:bg-gray-100"
        >
          {abierto ? 'Cerrar' : 'Configurar'}
        </button>
      </div>

      {abierto && (
        <div className="border-t border-line px-3 py-3">
          {/* El cron apagado es un caso aparte: marcar cuentas no serviría de nada y hay que
              decirlo, no dejar que Dante marque cuentas que nunca van a correr. */}
          {estado && !estado.activo && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-md px-2 py-1.5 mb-3">
              El cron está detenido por el freno de emergencia
              (<code className="font-mono">ENABLE_STORIES_CRON=false</code> en Railway, servicio
              {' '}<code className="font-mono">reels-ig-competencia</code>). Mientras siga así, marcar
              cuentas aquí no captura nada.
            </p>
          )}
          {estado && estado.activo && !estado.valido && (
            <p className="text-xs text-red-700 bg-red-50 rounded-md px-2 py-1.5 mb-3">
              El horario <code className="font-mono">{estado.horario}</code> no es válido, así que el
              cron no llegó a programarse.
            </p>
          )}

          <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5">
            Cuentas en automático
          </div>

          {enAuto.length === 0 ? (
            <p className="text-xs text-muted mb-3">
              Ninguna. Sin cuentas marcadas la captura corre en vacío y no gasta nada.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5 mb-3">
              {enAuto.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-1 text-xs bg-accent-soft text-accent rounded-md pl-2 pr-1 py-1"
                >
                  <span className="font-medium">@{c.key}</span>
                  <button
                    onClick={() => marcar(c, false)}
                    disabled={guardando === c.id}
                    className="px-1 rounded hover:bg-white/60 disabled:opacity-50"
                    title={`Quitar @${c.key} de la captura automática`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <SearchSelect
              value={porAñadir}
              onChange={setPorAñadir}
              options={disponibles}
              emptyLabel="Añadir una cuenta…"
              placeholder="Escribe para buscar…"
            />
            <button
              onClick={() => {
                const c = cuentas.find((x) => x.id === porAñadir);
                if (c) marcar(c, true);
              }}
              disabled={!porAñadir || !!guardando}
              className="text-xs px-2.5 h-8 rounded-md bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50"
            >
              Añadir a automático
            </button>
          </div>

          <p className="text-[10px] text-muted mt-2">
            Solo cuentas de Instagram. Cada una se captura 2 veces al día; el resto de Fuentes no se
            toca. Esto es lo mismo que la columna «Historias auto» de Creadores IG.
          </p>
        </div>
      )}
    </div>
  );
}
