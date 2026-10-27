-- Reddit como cuarta plataforma del radar (27 oct 2026).
--
-- NO crea tablas. El radar ya es una tabla única con columna `plataforma` (decisión del 19 oct
-- 2026: con cuatro tablas hacían falta cuatro pantallas y cuatro crons para la misma decisión), así
-- que añadir Reddit es solo dejar que `plataforma` valga 'rd'. Lo que bloquea son dos CHECK que
-- enumeran las plataformas permitidas:
--
--   new row for relation "radar" violates check constraint "radar_plataforma_check"
--   new row for relation "radar_busquedas" violates check constraint "radar_busquedas_plataforma_check"
--
-- Por qué Reddit y no otra cosa, medido el 27 oct 2026: el sistema actual responde «qué videos
-- existen ya», que llega inherentemente tarde. En una sola corrida de Reddit salieron «Kling 4.0»,
-- «Seedance 2.5» y «Wan 3.0» —números de versión que el centinela no ve porque vigila canales, no
-- lanzamientos— y subreddits dedicados por modelo que el sistema no miraba: r/HiggsfieldAI,
-- r/KlingAI_Videos, r/Seedance_AI.
--
-- Se recrean con la lista COMPLETA en vez de añadir solo 'rd' porque un CHECK no se amplía, se
-- reemplaza. Las tres que ya estaban son las que usa el código (`x`, `yt`, `li`): si tu tabla
-- admitiera alguna más, hay que añadirla a estas dos listas antes de correr esto.
--
-- Es aditivo y reversible: no toca datos ni columnas, solo qué valores se aceptan de aquí en
-- adelante. Correrlo dos veces no hace daño.

alter table disecta.radar
  drop constraint if exists radar_plataforma_check;
alter table disecta.radar
  add constraint radar_plataforma_check
  check (plataforma in ('x', 'yt', 'li', 'rd'));

alter table disecta.radar_busquedas
  drop constraint if exists radar_busquedas_plataforma_check;
alter table disecta.radar_busquedas
  add constraint radar_busquedas_plataforma_check
  check (plataforma in ('x', 'yt', 'li', 'rd'));

-- Comprobación: debe devolver las dos filas con 'rd' dentro de la definición.
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conname in ('radar_plataforma_check', 'radar_busquedas_plataforma_check');
