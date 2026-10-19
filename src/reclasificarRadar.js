// Vuelve a clasificar por tema los hallazgos que YA están en el radar.
//
// Hace falta porque los temas son editables: añadir el alias "opus" al tema Claude, o crear un tema
// nuevo para Veo, no serviría de nada si solo afectara a los hallazgos futuros — los de ayer
// seguirían con sus etiquetas viejas y el filtro mentiría. Esto es lo que cierra ese círculo.
//
// No cuesta nada: solo lee y escribe en Supabase, sin tocar actores de Apify.

import { getRadarTemas } from './sources.js';
import { clasificar } from './radarTemas.js';
import { getRadarParaClasificar, updateRadarTemas } from './supabase.js';

export async function reclasificarRadar() {
  const temas = await getRadarTemas();
  const filas = await getRadarParaClasificar();

  let revisadas = 0;
  let cambiadas = 0;
  let sinTema = 0;
  const conteo = new Map();

  for (const f of filas) {
    revisadas++;
    // Se clasifica con el texto Y los hashtags: un post etiquetado #nanobanana sin mencionarlo en
    // el cuerpo igual es de ese tema.
    const t = clasificar(`${f.caption || ''} ${f.hashtags || ''}`, temas);
    if (!t.length) sinTema++;
    t.forEach((x) => conteo.set(x, (conteo.get(x) || 0) + 1));
    const antes = Array.isArray(f.temas) ? f.temas : [];
    // Solo se escribe si de verdad cambió: así una corrida sin cambios no toca 80 filas.
    if (JSON.stringify([...t].sort()) !== JSON.stringify([...antes].sort())) {
      await updateRadarTemas(f.id, t);
      cambiadas++;
    }
  }

  const porTema = Object.fromEntries([...conteo.entries()].sort((a, b) => b[1] - a[1]));
  console.log(
    `[reclasificar] ${revisadas} revisadas · ${cambiadas} actualizadas · ${sinTema} sin tema · ` +
      JSON.stringify(porTema)
  );
  return { ok: true, revisadas, cambiadas, sinTema, porTema, temas: temas.length };
}
